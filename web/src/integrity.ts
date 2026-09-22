import { concat, encodeAbiParameters, isAddress, keccak256, stringToHex, type Hex } from 'viem';
import type { Allocation, Claim } from './model';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const abiHash = (abi: unknown) => keccak256(stringToHex(canonical(abi))).slice(2);
export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function requireServiceRoot(root: unknown, reconstructed: string): asserts root is Hex {
  requireThat(typeof root === 'string' && /^0x[0-9a-f]{64}$/.test(root), 'Missing or malformed service Merkle root');
  requireThat(root === reconstructed, 'Service root mismatch');
}
export function safePath(path: string) {
  requireThat(typeof path === 'string' && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(path)
    && !path.split('/').some(p => p === '..' || p === '.'), 'Invalid export path');
  return path;
}
export function validateRows(rows: Allocation[]) {
  requireThat(Array.isArray(rows) && rows.length > 0, 'Missing frozen allocations');
  const seen = new Set<string>();
  for (const row of rows) {
    requireThat(isAddress(row.wallet, { strict: false }), 'Invalid allocation wallet');
    requireThat(typeof row.amount === 'string' && /^(0|[1-9][0-9]*)$/.test(row.amount), 'Invalid allocation amount');
    requireThat(BigInt(row.amount) > 0n && BigInt(row.amount) < 2n ** 256n, 'Allocation outside uint256');
    const key = row.wallet.toLowerCase();
    requireThat(!seen.has(key), 'Duplicate allocation wallet');
    seen.add(key);
  }
}
const leaf = (row: Allocation) => keccak256(keccak256(encodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }], [row.wallet, BigInt(row.amount)],
)));
const pair = (a: Hex, b: Hex) => keccak256(concat(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));

// OpenZeppelin's complete binary tree: ascending sorted leaves placed from the end.
// Independently checked against StandardMerkleTree in tests and at every build.
export function allocationRoot(rows: Allocation[]): Hex {
  validateRows(rows);
  const leaves = rows.map(leaf).sort();
  const tree: Hex[] = new Array(2 * leaves.length - 1);
  leaves.forEach((value, i) => { tree[tree.length - 1 - i] = value; });
  for (let i = tree.length - leaves.length - 1; i >= 0; i--) tree[i] = pair(tree[2 * i + 1], tree[2 * i + 2]);
  return tree[0];
}
export function verifyProof(root: Hex, claim: Claim) {
  requireThat(Array.isArray(claim.proof) && claim.proof.every(p => /^0x[0-9a-fA-F]{64}$/.test(p)), 'Invalid proof');
  return claim.proof.reduce(pair, leaf(claim)).toLowerCase() === root.toLowerCase();
}
