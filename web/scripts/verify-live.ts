import { readFile, writeFile } from 'node:fs/promises';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { createPublicClient, formatUnits, http, type Address } from 'viem';
import { readState, readWithFallback, claimState } from '../src/chain';
import { allocationRoot, canonical, requireServiceRoot, requireThat, verifyProof } from '../src/integrity';
import type { Runtime } from '../src/model';

const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const h = await read('data/handoff.json');
const launch = await read('data/launch.json');
const runtime: Runtime = { deployment: h, config: await read('public/claim-config.json'),
  claims: await read('public/claims.json'), token: h.contracts[0].address,
  tokenAbi: await read('public/abi/ProofOfWorkToken.json'), distributorAbi: await read('public/abi/MerkleDistributor.json') };
requireThat(h.chainId === 11155111 && launch.id === h.launchId && launch.chainId === h.chainId
  && launch.sourceCommit === h.sourceCommit && launch.attestationHash === h.attestationHash, 'Launch/handoff mismatch');
const tree = StandardMerkleTree.of(launch.allocations.map((r: {wallet: string; amount: string}) => [r.wallet, r.amount]), ['address', 'uint256']);
requireServiceRoot(launch.merkleRoot, tree.root);
requireServiceRoot(runtime.config.serviceRoot, tree.root);
requireThat(runtime.claims.root === tree.root && allocationRoot(runtime.claims.claims) === tree.root, 'Generated claims root mismatch');
const snapshot = await read('public/allocation-snapshot.json');
requireServiceRoot(snapshot.serviceRoot, tree.root);
requireThat(allocationRoot(snapshot.allocations) === tree.root, 'Generated snapshot root mismatch');
requireThat(canonical(tree.dump()) === canonical(await read('public/merkle-tree.json')), 'Generated tree mismatch');
requireThat(runtime.claims.claims.length === 63 && runtime.claims.claims.every(c => verifyProof(runtime.claims.root, c)), 'Incomplete or invalid allocation proofs');
requireThat(runtime.claims.claims.reduce((sum, c) => sum + BigInt(c.amount), 0n).toString() === runtime.claims.total, 'Allocation total mismatch');
const wallet: Address = '0x200e710acaa6a93bbc77146026328c40f1d60fb1';
const allocation = runtime.claims.claims.find(c => c.wallet.toLowerCase() === wallet);
requireThat(allocation, 'Requested wallet allocation missing');
// readState verifies code, distributor.token(), roundOf(0), and funding/accounting at one block.
const live = await readWithFallback(runtime, async (client, rpc) => {
  const state = await readState(client, runtime, wallet, rpc);
  requireThat(state.serviceVerified, 'Service/on-chain root mismatch');
  requireThat(state.distributorBalance >= state.funded - state.totalClaimed, 'Distributor is underfunded');
  return state;
});
const crossChecks = [];
for (const url of runtime.config.rpcUrls.filter(url => url !== live.rpc)) {
  try {
    const client = createPublicClient({ transport: http(url, { timeout: 12000, retryCount: 0 }) });
    const chainId = await client.getChainId();
    const block = await client.getBlock({ blockNumber: live.block });
    crossChecks.push({ url, chainId, blockHash: block.hash, matches: chainId === h.chainId && block.hash === live.blockHash });
    if (crossChecks.at(-1)?.matches) break;
  } catch (error) { crossChecks.push({ url, error: error instanceof Error ? error.message.slice(0, 250) : 'RPC failure' }); }
}
requireThat(crossChecks.some(c => c.matches), 'No independent RPC confirmed the verification block');
const report = { checkedAt: new Date().toISOString(), readsOnly: true, chainId: h.chainId, walletRead: wallet,
  token: runtime.token, distributor: runtime.config.distributor, round: 0,
  tokenBindingVerified: true, contractCodeVerified: true,
  roots: { service: launch.merkleRoot, standardMerkleTree: tree.root, onChain: live.root, match: true },
  proofsVerified: runtime.claims.claims.length, totalWORK: formatUnits(BigInt(runtime.claims.total), 18),
  walletAllocation: { ...allocation, amountWORK: formatUnits(BigInt(allocation.amount), 18), proofVerified: true,
    state: claimState(runtime, live, allocation) },
  unlockTimeUTC: new Date(Number(live.unlocksAt) * 1000).toISOString(), unlocked: live.timestamp >= live.unlocksAt,
  live, crossChecks, limitation: 'Read-only public RPC checks; no wallet transaction signed or broadcast.' };
await writeFile('../docs/frontend/live-verification.json', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
console.log(JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
