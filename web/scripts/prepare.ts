import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { abiHash, allocationRoot, canonical, requireServiceRoot, requireThat, validateRows, verifyProof } from '../src/integrity';
import type { Allocation, Claims, ClaimConfig } from '../src/model';

const read = async (p: string) => JSON.parse(await readFile(p, 'utf8'));
const h = await read('data/handoff.json');
const launch = await read('data/launch.json');
requireThat(h.version === 1 && h.chainId === 11155111 && h.contracts.length === 1
  && h.contracts[0].name === 'ProofOfWorkToken', 'Unexpected handoff');
requireThat(/^[0-9a-f]{40}$/.test(h.sourceCommit) && /^[0-9a-f]{64}$/.test(h.attestationHash), 'Malformed handoff');
for (const [a, b] of [[h.launchId, launch.id], [h.chainId, launch.chainId],
  [h.sourceCommit, launch.sourceCommit], [h.attestationHash, launch.attestationHash]]) {
  requireThat(a === b, 'Launch/handoff mismatch');
}
const rows: Allocation[] = launch.allocations.map(({wallet, amount}: Allocation) => ({wallet, amount}));
validateRows(rows);
const tree = StandardMerkleTree.of(rows.map(r => [r.wallet, r.amount]), ['address', 'uint256']);
requireThat(tree.root === allocationRoot(rows), 'Independent tree reconstruction mismatch');
requireServiceRoot(launch.merkleRoot, tree.root);
const pinned = (path: string) => execFileSync('git', ['show', `${h.sourceCommit}:${path}`], { encoding: 'utf8' });
const protocol = JSON.parse(pinned('docs/protocol/MerkleDistributor.sources.json'));
requireThat(protocol.commit === 'a94632d6ea40fbd2d1bcd8a0aafe53a1619956c6', 'Protocol source commit mismatch');
for (const [name, value] of Object.entries(protocol.sources) as [string, {content: string}][]) {
  requireThat(createHash('sha256').update(value.content).digest('hex') === protocol.sha256[name], 'Protocol source digest mismatch');
}
const tokenSources: Record<string, {content: string}> = {};
const names = execFileSync('git', ['ls-tree', '-r', '--name-only', h.sourceCommit, 'src', 'lib/openzeppelin-contracts'], { encoding: 'utf8', cwd: '..' }).trim().split('\n');
for (const name of names.filter(n => n.endsWith('.sol'))) tokenSources[name] = { content: pinned(name) };
const solc = createRequire(import.meta.url)('solc');
function compile(sources: object, target: string, name: string) {
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: {
    remappings: ['@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/'],
    outputSelection: { '*': { '*': ['abi'] } },
  } })));
  requireThat(!out.errors?.some((e: {severity: string}) => e.severity === 'error'), JSON.stringify(out.errors));
  return out.contracts[target][name].abi;
}
await mkdir('public/abi', { recursive: true });
const normalized = (abi: unknown[]) => abi.map(canonical).sort();
for (const name of ['ProofOfWorkToken', 'MerkleDistributor']) {
  const bytes = pinned(`docs/abi/${name}.json`);
  const abi = JSON.parse(bytes);
  const compiled = name === 'ProofOfWorkToken' ? compile(tokenSources, 'src/ProofOfWorkToken.sol', name)
    : compile(protocol.sources, 'src/MerkleDistributor.sol', name);
  requireThat(canonical(normalized(compiled)) === canonical(normalized(abi)), `${name} ABI differs from implementation`);
  if (name === 'ProofOfWorkToken') requireThat(abiHash(abi) === h.contracts[0].abiHash, 'Attested ABI hash mismatch');
  await writeFile(`public/abi/${name}.json`, bytes);
}
const distributors = launch.artifacts.filter((a: {role: string}) => a.role === 'distributor');
requireThat(distributors.length === 1, 'Ambiguous distributor');
const d = distributors[0];
const tokenArtifact = launch.artifacts.find((a: {role: string}) => a.role === 'token');
requireThat(tokenArtifact?.address.toLowerCase() === h.contracts[0].address.toLowerCase(), 'Token artifact mismatch');
requireThat(d.txHash === h.contracts[0].txHash && d.blockNumber === h.contracts[0].blockNumber, 'Distributor launch transaction mismatch');
const total = rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
const breakdown = launch.rewardSnapshot.breakdown;
requireThat(breakdown.length === rows.length, 'Incomplete reward breakdown');
for (const row of rows) {
  const matches = breakdown.filter((b: Allocation) => b.wallet.toLowerCase() === row.wallet.toLowerCase());
  requireThat(matches.length === 1 && BigInt(matches[0].launchAmount) + BigInt(matches[0].recentAmount) === BigInt(row.amount), 'Frozen allocation breakdown mismatch');
}
const claims: Claims = {
  version: 1, launchId: h.launchId, chainId: h.chainId, token: h.contracts[0].address,
  distributor: d.address, round: 0, root: tree.root as Claims['root'], total: total.toString(),
  claims: rows.map((row, i) => ({ ...row, proof: tree.getProof(i) as Claims['claims'][number]['proof'] })),
};
requireThat(claims.claims.every(c => verifyProof(claims.root, c)), 'Invalid generated proof');
const config: ClaimConfig = {
  ...await read('data/network.json'), distributor: d.address, distributorAbiPath: 'abi/MerkleDistributor.json',
  distributorAbiHash: abiHash(await read('public/abi/MerkleDistributor.json')), distributorSourceCommit: protocol.commit,
  deploymentBlock: String(d.blockNumber), round: 0, serviceRoot: launch.merkleRoot,
  snapshotPath: 'allocation-snapshot.json', claimsPath: 'claims.json',
};
for (const [path, data] of Object.entries({ 'claims.json': claims, 'claim-config.json': config,
  'allocation-snapshot.json': { provenance: launch.provenance, launchId: launch.id, serviceRoot: launch.merkleRoot,
    allocations: rows, rewardSnapshot: launch.rewardSnapshot }, 'merkle-tree.json': tree.dump() })) {
  await writeFile(`public/${path}`, JSON.stringify(data, null, 2) + '\n');
}
console.log(`Compiled pinned ABIs; attested token hash verified. ${rows.length} proofs; total ${total}; service and reconstructed root ${tree.root}.`);
