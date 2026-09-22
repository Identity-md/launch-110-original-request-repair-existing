import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { abiHash, allocationRoot, safePath, validateRows, verifyProof } from '../src/integrity';
import { claimState } from '../src/chain';
import type { Claims, LiveState, Runtime } from '../src/model';

const claims: Claims = JSON.parse(readFileSync('public/claims.json', 'utf8'));
const rows = claims.claims;
test('every frozen allocation rebuilds the OpenZeppelin root and verifies its proof', () => {
  const tree = StandardMerkleTree.of(rows.map(r => [r.wallet, r.amount]), ['address', 'uint256']);
  assert.equal(tree.root, claims.root);
  assert.equal(allocationRoot(rows), tree.root);
  assert.equal(rows.length, 63);
  for (const row of rows) assert.equal(verifyProof(claims.root, row), true);
  assert.equal(rows.reduce((n,r) => n + BigInt(r.amount), 0n).toString(), claims.total);
});
test('reject duplicate/malformed/overflow allocations and changed proofs', () => {
  assert.throws(() => validateRows([...rows, {...rows[0], wallet: rows[0].wallet.toUpperCase() as `0x${string}`} ]));
  assert.throws(() => validateRows([...rows, rows[0]]), /Duplicate/);
  for (const amount of ['-1', '1.2', '1e18', '01', '0', (2n ** 256n).toString()]) {
    assert.throws(() => validateRows([{...rows[0], amount}]));
  }
  assert.equal(verifyProof(claims.root, {...rows[0], amount: (BigInt(rows[0].amount) + 1n).toString()}), false);
  assert.equal(verifyProof(claims.root, {...rows[0], proof: rows[1].proof}), false);
  assert.notEqual(allocationRoot(rows.slice(1)), claims.root);
});
test('single leaf and non-power-of-two tree agree with OpenZeppelin', () => {
  for (const n of [1, 2, 3, 5, 17, 63]) {
    const subset = rows.slice(0, n);
    const tree = StandardMerkleTree.of(subset.map(r => [r.wallet, r.amount]), ['address', 'uint256']);
    assert.equal(allocationRoot(subset), tree.root);
    if (n === 1) assert.equal(verifyProof(tree.root as `0x${string}`, {...subset[0], proof: []}), true);
  }
});
test('ABI hash matches handoff, unaffected by object key order', () => {
  const abi = JSON.parse(readFileSync('public/abi/ProofOfWorkToken.json', 'utf8'));
  const handoff = JSON.parse(readFileSync('data/handoff.json', 'utf8'));
  assert.equal(abiHash(abi), handoff.contracts[0].abiHash);
  assert.equal(abiHash({b: 1, a: 2}), abiHash({a: 2, b: 1}));
});
test('reject absolute, URL and traversal asset paths', () => {
  for (const path of ['../secret', '/index.html', 'https://x/y', 'assets/../x', 'assets/%2e%2e/x']) assert.throws(() => safePath(path));
  assert.equal(safePath('abi/ProofOfWorkToken.json'), 'abi/ProofOfWorkToken.json');
});
test('qualification depends on verified reads, chain time and total remaining funding', () => {
  const live = { timestamp: 100n, unlocksAt: 100n, funded: BigInt(claims.total), totalClaimed: 0n,
    distributorBalance: BigInt(claims.total), serviceVerified: true, claimed: false } as LiveState;
  const runtime = {} as Runtime;
  assert.equal(claimState(runtime, live, rows[0]), 'eligible');
  assert.equal(claimState(runtime, {...live, timestamp: 99n}, rows[0]), 'locked');
  assert.equal(claimState(runtime, live), 'ineligible');
  assert.equal(claimState(runtime, {...live, claimed: true}, rows[0]), 'claimed');
  assert.equal(claimState(runtime, {...live, serviceVerified: false}, rows[0]), 'unverified');
  assert.equal(claimState(runtime, {...live, distributorBalance: BigInt(rows[0].amount)}, rows[0]), 'unavailable');
  assert.equal(claimState(runtime, {...live, positiveSweep: true}, rows[0]), 'eligible');
});
