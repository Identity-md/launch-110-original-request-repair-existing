import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { App } from '../src/App';
import { claimState } from '../src/chain';
import type { LiveState, Runtime } from '../src/model';

const mocks = vi.hoisted(() => ({ account: {} as any, live: {} as any,
  readState: vi.fn(), simulate: vi.fn(), write: vi.fn(), receipt: vi.fn(), switch: vi.fn() }));
vi.mock('wagmi', () => ({ useAccount: () => mocks.account, useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: mocks.switch, isPending: false }) }));
vi.mock('@wagmi/core', () => ({ getAccount: () => mocks.account, getConnectorClient: async () => ({}) }));
vi.mock('viem/actions', () => ({ getChainId: async () => mocks.account.chainId, writeContract: (...args: any[]) => mocks.write(...args) }));
vi.mock('@rainbow-me/rainbowkit', () => ({ ConnectButton: () => <button>Connect Wallet</button> }));
vi.mock('../src/chain', async importOriginal => {
  const original = await importOriginal<typeof import('../src/chain')>();
  return { ...original, readState: (...args: unknown[]) => mocks.readState(...args),
    readWithFallback: (_: Runtime, action: Function) => action({simulateContract:mocks.simulate,waitForTransactionReceipt:mocks.receipt}, 'Mock RPC') };
});
const read = (path: string) => JSON.parse(readFileSync(`public/${path}`, 'utf8'));
const handoff = JSON.parse(readFileSync('data/handoff.json', 'utf8'));
const runtime: Runtime = { deployment: handoff, config: read('claim-config.json'), claims: read('claims.json'),
  token: handoff.contracts[0].address, tokenAbi: read('abi/ProofOfWorkToken.json'), distributorAbi: read('abi/MerkleDistributor.json') };
const claim = runtime.claims.claims[0];
const txHash = `0x${'ab'.repeat(32)}`;
const mounted = () => render(<App runtime={runtime} />);
const claimButton = () => screen.getByRole('button', {name:'Claim'});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = {address:claim.wallet,chainId:runtime.deployment.chainId,isConnected:true};
  mocks.live = { block:1n,blockHash:`0x${'01'.repeat(32)}`,timestamp:1000n,root:runtime.claims.root,funded:BigInt(runtime.claims.total),
    totalClaimed:0n,unlocksAt:1000n,sweepableAt:2000n,distributorBalance:BigInt(runtime.claims.total),balance:7n*10n**18n,
    claimed:false,decimals:18,positiveSweep:false,serviceVerified:true,rpc:'Mock RPC' } satisfies LiveState;
  mocks.readState.mockImplementation(async () => ({...mocks.live}));
  mocks.simulate.mockResolvedValue({}); mocks.write.mockResolvedValue(txHash);
  mocks.receipt.mockImplementation(async () => {
    mocks.live.claimed = true; mocks.live.balance += BigInt(claim.amount);
    return { status:'success' };
  });
  mocks.switch.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('claim page interactions (DOM simulation; not a real browser)', () => {
  it('disconnected: connect control and disabled claim', () => {
    mocks.account = {isConnected:false}; mounted();
    expect(screen.getByRole('button',{name:'Connect Wallet'})).toBeVisible();
    expect(claimButton()).toBeDisabled(); expect(mocks.readState).not.toHaveBeenCalled();
  });
  it('wrong-chain switch, including rejected switching', async () => {
    mocks.account.chainId = 1; mocks.switch.mockRejectedValue(new Error('User rejected (4001)')); mounted();
    fireEvent.click(screen.getByRole('button',{name:'Switch to Sepolia'}));
    await screen.findByText('Wallet request rejected. You can retry.');
    expect(mocks.switch).toHaveBeenCalledWith({chainId:runtime.deployment.chainId});
    expect(claimButton()).toBeDisabled(); expect(mocks.readState).not.toHaveBeenCalled();
  });
  it('absent wallet is not eligible only after a successful read', async () => {
    mocks.account.address = '0x000000000000000000000000000000000000dead'; mounted();
    await screen.findByText(/Not eligible:/); expect(claimButton()).toBeDisabled();
  });
  it('locked allocation shows unlock time and cannot claim', async () => {
    mocks.live.timestamp = 999n; mounted(); await screen.findByText('Your rewards are locked.');
    expect(screen.getByText(/Unlock time:/)).toBeVisible(); expect(claimButton()).toBeDisabled();
  });
  it('already claimed allocation cannot claim again', async () => {
    mocks.live.claimed = true; mounted(); await screen.findByText('Already claimed.'); expect(claimButton()).toBeDisabled();
  });
  it('missing service root blocks an otherwise valid eligible claim', async () => {
    mocks.live.serviceVerified = false; mounted(); await screen.findByText(/Claims unavailable:/); expect(claimButton()).toBeDisabled();
  });
  it('sweep and insufficient funding are unavailable, not ineligible', async () => {
    mocks.live.positiveSweep = true; mocks.live.distributorBalance = 0n; mounted();
    await screen.findByText(/a sweep was recorded/); expect(claimButton()).toBeDisabled();
  });
  it('RPC failure keeps balance unknown and retry recovers', async () => {
    mocks.readState.mockRejectedValueOnce(new Error('RPC unavailable')); mounted();
    await screen.findByRole('alert'); expect(screen.getByTestId('balance')).toHaveTextContent('Unknown');
    expect(claimButton()).toBeDisabled(); fireEvent.click(screen.getByRole('button',{name:'Refresh rewards'}));
    await screen.findByText('Eligible. Your rewards are ready to claim.'); expect(claimButton()).toBeEnabled();
  });
  it('exact claim arguments and zero ETH, pending then receipt refresh', async () => {
    let resolveReceipt!: (value: any) => void;
    mocks.receipt.mockImplementation(() => new Promise(resolve => {resolveReceipt = resolve;}));
    mounted(); await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    await screen.findByText('Transaction pending. Waiting for a successful receipt.');
    expect(screen.getByRole('button',{name:'Claim pending…'})).toBeDisabled();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][1]).toMatchObject({address:runtime.config.distributor,account:claim.wallet,
      functionName:'claim',args:[0n,claim.wallet,BigInt(claim.amount),claim.proof],value:0n});
    expect(mocks.simulate.mock.calls[0][0]).toMatchObject({functionName:'claim',value:0n,args:[0n,claim.wallet,BigInt(claim.amount),claim.proof]});
    mocks.live.claimed=true; mocks.live.balance += BigInt(claim.amount); resolveReceipt({status:'success'});
    await screen.findByText('Transaction confirmed. Balance and claim status refreshed.');
    expect(screen.getByText('Already claimed.')).toBeVisible(); expect(screen.getByTestId('balance')).not.toHaveTextContent(/^7 WORK$/);
  });
  it('rejected signing is recoverable', async () => {
    mocks.write.mockRejectedValueOnce(new Error('User rejected (4001)')); mounted();
    await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    await screen.findByText('Wallet request rejected. You can retry.'); expect(claimButton()).toBeEnabled();
  });
  it('reverted receipt does not show success', async () => {
    mocks.receipt.mockResolvedValueOnce({status:'reverted'}); mounted();
    await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    await screen.findByText('Transaction reverted. No rewards were claimed. Refresh before retrying.');
    expect(screen.queryByText('Transaction confirmed.',{exact:false})).toBeNull();
  });
  it('failed simulation never requests a signature', async () => {
    mocks.simulate.mockRejectedValueOnce(new Error('execution reverted')); mounted();
    await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    await screen.findByText(/Transaction reverted or simulation failed/); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('failed receipt lookup disables resubmission and allows checking the same hash', async () => {
    mocks.receipt.mockRejectedValueOnce(new Error('RPC unavailable')); mounted();
    await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    const check = await screen.findByRole('button',{name:'Check transaction status'});
    expect(screen.getByRole('button',{name:'Claim pending…'})).toBeDisabled(); fireEvent.click(check);
    await screen.findByText('Transaction confirmed. Balance and claim status refreshed.'); expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it('account changes while simulating abort before requesting a signature', async () => {
    mocks.simulate.mockImplementationOnce(async () => {mocks.account.address='0x000000000000000000000000000000000000dead';});
    mounted(); await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    await screen.findByText(/Wallet account or network changed/); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('a replaced/cancelled successful receipt without a claim does not report claimed', async () => {
    mocks.receipt.mockResolvedValueOnce({status:'success'}); mounted();
    await screen.findByText('Eligible. Your rewards are ready to claim.'); fireEvent.click(claimButton());
    await screen.findByText(/Transaction completed but this allocation is not claimed/);
    expect(screen.queryByText('Transaction confirmed.',{exact:false})).toBeNull();
  });
  it('rereads eligibility immediately before signing', async () => {
    mounted(); await screen.findByText('Eligible. Your rewards are ready to claim.');
    mocks.live.claimed=true; fireEvent.click(claimButton());
    await waitFor(()=>expect(mocks.readState).toHaveBeenCalledTimes(2));
    await screen.findByText(/Claim is currently unavailable/); expect(mocks.write).not.toHaveBeenCalled();
    expect(claimState(runtime,mocks.live,claim)).toBe('claimed');
  });
});
