import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireServiceRoot } from '../src/integrity';
import { readState } from '../src/chain';
import type { Runtime } from '../src/model';
import type { PublicClient } from 'viem';

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const h = read('data/handoff.json');
const launch = read('data/launch.json');
const runtime: Runtime = { deployment: h, config: read('public/claim-config.json'), claims: read('public/claims.json'),
  token: h.contracts[0].address, tokenAbi: read('public/abi/ProofOfWorkToken.json'), distributorAbi: read('public/abi/MerkleDistributor.json') };

test('production build exits nonzero for absent, null, malformed or mismatched service roots', () => {
  mkdirSync('../test/scratch', { recursive: true });
  for (const root of [undefined, null, '0x1234', `0x${'00'.repeat(32)}`]) {
    const cwd = mkdtempSync(resolve('../test/scratch/build-root-'));
    mkdirSync(`${cwd}/data`);
    for (const p of ['scripts', 'node_modules']) symlinkSync(resolve(p), `${cwd}/${p}`, 'dir');
    writeFileSync(`${cwd}/package.json`, readFileSync('package.json'));
    writeFileSync(`${cwd}/data/handoff.json`, JSON.stringify(h));
    writeFileSync(`${cwd}/data/launch.json`, JSON.stringify({...launch, merkleRoot: root}));
    const result = spawnSync('npm', ['run', 'build'], { cwd, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Missing or malformed service Merkle root|Service root mismatch/);
    assert.doesNotMatch(result.stdout, /vite v.*building/);
  }
});

test('service root gate rejects missing or mismatched generated configuration', () => {
  assert.doesNotThrow(() => requireServiceRoot(runtime.config.serviceRoot, runtime.claims.root));
  assert.throws(() => requireServiceRoot(null, runtime.claims.root), /Missing/);
  assert.throws(() => requireServiceRoot(`0x${'00'.repeat(32)}`, runtime.claims.root), /mismatch/);
});

function rpc(overrides: Record<string, unknown> = {}): PublicClient {
  const block = {number: BigInt(runtime.config.deploymentBlock), hash: `0x${'01'.repeat(32)}`, timestamp: 2000n};
  const values: Record<string, unknown> = {token: runtime.token,
    roundOf: {root: runtime.claims.root, funded: BigInt(runtime.claims.total), claimed: 0n, unlocksAt: 1000n},
    openedAt: 1n, sweepDelay: 3000n, balanceOf: BigInt(runtime.claims.total), claimed: false, decimals: 18, ...overrides};
  return {getBlock: async () => block, getCode: async () => '0x6001', getLogs: async () => [],
    readContract: async ({functionName}: {functionName: string}) => values[functionName]} as unknown as PublicClient;
}
test('build/runtime live reads reject wrong round root and wrong distributor token', async () => {
  const account = runtime.claims.claims[0].wallet;
  assert.equal((await readState(rpc(), runtime, account, 'mock')).serviceVerified, true);
  await assert.rejects(readState(rpc({token: '0x000000000000000000000000000000000000dead'}), runtime, account, 'mock'), /token binding mismatch/);
  await assert.rejects(readState(rpc({roundOf: {root: `0x${'00'.repeat(32)}`, funded: BigInt(runtime.claims.total), claimed: 0n, unlocksAt: 1000n}}), runtime, account, 'mock'), /On-chain round/);
});
