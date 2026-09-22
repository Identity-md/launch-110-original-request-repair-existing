import type { Abi } from 'viem';
import { isAddress } from 'viem';
import { abiHash, allocationRoot, requireThat, safePath, verifyProof } from './integrity';
import type { Allocation, ClaimConfig, Claims, Deployment, Runtime } from './model';

async function json(path: string) {
  const res = await fetch(`./${safePath(path)}`, { cache: 'no-store' });
  requireThat(res.ok, `Unable to load ${path}. Reload to retry.`);
  return res;
}
export async function loadRuntime(): Promise<Runtime> {
  const deployment: Deployment = await (await json('imd-deployment.json')).json();
  requireThat(deployment.version === 1 && Number.isSafeInteger(deployment.chainId)
    && deployment.chainId === 11155111 && deployment.contracts.length === 1
    && deployment.contracts[0].name === 'ProofOfWorkToken'
    && /^[0-9a-f]{40}$/.test(deployment.sourceCommit)
    && /^[0-9a-f]{64}$/.test(deployment.attestationHash), 'Invalid deployment configuration');
  requireThat(deployment.assets.length <= 128 && new Set(deployment.assets.map(a => a.path)).size === deployment.assets.length,
    'Invalid asset inventory');
  for (const a of deployment.assets) {
    safePath(a.path);
    requireThat(/^[0-9a-f]{64}$/.test(a.sha256), 'Invalid asset digest');
  }
  const checked = async <T,>(path: string): Promise<T> => {
    const asset = deployment.assets.find(a => a.path === path);
    requireThat(asset, `Unlisted deployment asset: ${path}`);
    const bytes = await (await json(path)).arrayBuffer();
    requireThat(bytes.byteLength <= 8388608, 'Oversized asset');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    requireThat(digest === asset.sha256, `Asset integrity failure: ${path}`);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const config = await checked<ClaimConfig>('claim-config.json');
  const [claims, snapshot, tokenAbi, distributorAbi] = await Promise.all([
    checked<Claims>(config.claimsPath),
    checked<{launchId: string; serviceRoot: string | null; allocations: Allocation[]}>(config.snapshotPath),
    checked<Abi>(deployment.contracts[0].abiPath), checked<Abi>(config.distributorAbiPath),
  ]);
  const token = deployment.contracts[0].address;
  requireThat(isAddress(token) && isAddress(config.distributor) && config.round === 0, 'Invalid contract configuration');
  requireThat(Array.isArray(tokenAbi) && abiHash(tokenAbi) === deployment.contracts[0].abiHash, 'Token ABI hash mismatch');
  requireThat(Array.isArray(distributorAbi) && abiHash(distributorAbi) === config.distributorAbiHash, 'Distributor ABI hash mismatch');
  requireThat(config.rpcUrls.length > 0 && config.rpcUrls.every(u => new URL(u).protocol === 'https:'), 'Invalid public RPC configuration');
  requireThat(/^\d+$/.test(config.deploymentBlock), 'Invalid deployment block');
  requireThat(claims.version === 1 && claims.chainId === deployment.chainId && claims.launchId === deployment.launchId
    && snapshot.launchId === deployment.launchId && claims.token.toLowerCase() === token.toLowerCase()
    && claims.distributor.toLowerCase() === config.distributor.toLowerCase() && claims.round === config.round, 'Snapshot deployment mismatch');
  const root = allocationRoot(snapshot.allocations);
  requireThat(root === claims.root && allocationRoot(claims.claims) === root, 'Frozen allocation root mismatch');
  requireThat(snapshot.serviceRoot === config.serviceRoot && (config.serviceRoot === null || root === config.serviceRoot), 'Service allocation root mismatch');
  requireThat(snapshot.allocations.reduce((n, r) => n + BigInt(r.amount), 0n).toString() === claims.total, 'Allocation total mismatch');
  requireThat(claims.claims.every(c => verifyProof(root, c)), 'Allocation proof mismatch');
  return { deployment, config, claims, token, tokenAbi, distributorAbi };
}
