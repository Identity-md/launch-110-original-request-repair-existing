import type { Abi, Address, Hex } from 'viem';

export interface Deployment {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
}
export interface ClaimConfig {
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorerUrl: string;
  rpcUrls: string[];
  distributor: Address;
  distributorAbiPath: string;
  distributorAbiHash: string;
  distributorSourceCommit: string;
  deploymentBlock: string;
  round: 0;
  serviceRoot: Hex | null;
  snapshotPath: string;
  claimsPath: string;
}
export interface Allocation { wallet: Address; amount: string }
export interface Claim extends Allocation { proof: Hex[] }
export interface Claims {
  version: 1;
  launchId: string;
  chainId: number;
  token: Address;
  distributor: Address;
  round: 0;
  root: Hex;
  total: string;
  claims: Claim[];
}
export interface Runtime {
  deployment: Deployment;
  config: ClaimConfig;
  claims: Claims;
  token: Address;
  tokenAbi: Abi;
  distributorAbi: Abi;
}
export interface LiveState {
  block: bigint;
  blockHash: Hex;
  timestamp: bigint;
  root: Hex;
  funded: bigint;
  totalClaimed: bigint;
  unlocksAt: bigint;
  sweepableAt: bigint;
  distributorBalance: bigint;
  balance: bigint;
  claimed: boolean;
  decimals: number;
  positiveSweep: boolean;
  serviceVerified: boolean;
  rpc: string;
}
