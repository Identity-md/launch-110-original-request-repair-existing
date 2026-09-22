import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { getAccount, getConnectorClient } from '@wagmi/core';
import { formatUnits, type Address, type EIP1193Provider, type Hex } from 'viem';
import { getChainId, writeContract } from 'viem/actions';
import { chainFor, claimState, readState, readWithFallback } from './chain';
import { requireThat } from './integrity';
import type { LiveState, Runtime } from './model';

function Wrap({ text }: { text: string }) {
  return <>{text.match(/.{1,24}/g)?.map((s, i) => <Fragment key={i}>{s}<wbr /></Fragment>)}</>;
}
function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/rejected|denied|4001/i.test(message)) return 'Wallet request rejected. You can retry.';
  if (/revert|AlreadyClaimed|StillLocked|InvalidProof/i.test(message)) return 'Transaction reverted or simulation failed. Refresh your rewards before retrying.';
  if (/RPC verification failed/i.test(message)) return 'RPC verification failed. Contract state could not be verified. Refresh rewards to retry.';
  return message;
}
const date = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toLocaleString();
export function App({ runtime }: { runtime: Runtime }) {
  const account = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [error, setError] = useState('');
  const wrongChain = account.isConnected && account.chainId !== runtime.deployment.chainId;
  return <main>
    <h1>Proof Of Work</h1>
    <p>$WORK · {runtime.config.name}</p>
    <p>Rewards for workers who helped build and deploy projects.</p>
    <p>2% rewards this launch’s contributors; 8% is shared equally among workers with accepted work in the preceding 12 hours.</p>
    <ConnectButton showBalance={false} />
    {!account.isConnected && <><p>Connect a wallet to check your WORK rewards.</p>
      <p>Use a browser with an Ethereum wallet extension or your wallet’s built-in browser.</p><button disabled>Claim</button></>}
    {wrongChain && <><p>Wrong network. Switch to {runtime.config.name} to check rewards.</p>
      <button disabled={isPending} onClick={async () => {
        setError('');
        try { await switchChainAsync({ chainId: runtime.deployment.chainId }); } catch (e) { setError(errorMessage(e)); }
      }}>{isPending ? 'Switching…' : `Switch to ${runtime.config.name}`}</button><p><button disabled>Claim</button></p></>}
    {error && wrongChain && <p role="alert"><Wrap text={error} /></p>}
    {account.isConnected && !wrongChain && account.address && <Rewards key={`${account.address}:${account.chainId}`}
      runtime={runtime} address={account.address} />}
    <p><a href={`${runtime.config.explorerUrl}/address/${runtime.token}`}>WORK token on explorer</a>{' · '}
      <a href={`${runtime.config.explorerUrl}/address/${runtime.config.distributor}`}>Reward distributor on explorer</a></p>
    <p><a href="./claims.json">Frozen rewards and proofs</a>{' · '}<a href="./imd-deployment.json">Deployment record</a></p>
  </main>;
}
function Rewards({ runtime, address }: { runtime: Runtime; address: Address }) {
  const wagmi = useConfig();
  const account = useAccount();
  const [live, setLive] = useState<LiveState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tx, setTx] = useState<'idle' | 'signing' | 'pending' | 'confirmed' | 'failed'>('idle');
  const [hash, setHash] = useState<Hex>();
  const [receiptUnknown, setReceiptUnknown] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const sending = useRef(false);
  const refreshing = useRef(false);
  const claim = runtime.claims.claims.find(c => c.wallet.toLowerCase() === address.toLowerCase());
  const provider = useCallback(async () => account.connector ? await account.connector.getProvider() as EIP1193Provider : undefined, [account.connector]);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    refreshing.current = true;
    setLoading(true);
    setLive(undefined);
    try {
      const next = await readWithFallback(runtime, (c, rpc) => readState(c, runtime, address, rpc), await provider());
      if (alive.current && id === sequence.current) { setLive(next); setError(''); }
      return next;
    } catch (e) {
      if (alive.current && id === sequence.current) setError(errorMessage(e));
      throw e;
    } finally {
      refreshing.current = false;
      if (alive.current && id === sequence.current) setLoading(false);
    }
  }, [runtime, address, provider]);
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => {});
    const timer = setInterval(() => { if (!sending.current && !refreshing.current) void refresh().catch(() => {}); }, 20000);
    return () => { alive.current = false; sequence.current++; clearInterval(timer); };
  }, [refresh]);

  const confirm = async (transactionHash: Hex) => {
    try {
      const receipt = await readWithFallback(runtime, c => c.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1,
        timeout: 60000, onReplaced: replacement => {
          if (alive.current) setHash(replacement.transaction.hash);
        } }), await provider());
      if (!alive.current) return;
      if (receipt.status !== 'success') {
        setTx('failed'); setReceiptUnknown(false);
        await refresh().catch(() => {});
        setError('Transaction reverted. No rewards were claimed. Refresh before retrying.');
        return;
      }
      const refreshed = await refresh();
      if (!refreshed.claimed) {
        setTx('failed'); setReceiptUnknown(false);
        setError('Transaction completed but this allocation is not claimed. It may have been replaced or cancelled. Refresh before retrying.');
        return;
      }
      if (alive.current) { setTx('confirmed'); setReceiptUnknown(false); }
    } catch (e) {
      if (alive.current) {
        setReceiptUnknown(true);
        setError(`Receipt or post-transaction reads unavailable. Check transaction status before retrying. ${errorMessage(e)}`);
      }
    }
  };
  const send = async () => {
    if (sending.current) return;
    sending.current = true; setTx('signing'); setError(''); setHash(undefined);
    try {
      const fresh = await refresh();
      requireThat(claim && claimState(runtime, fresh, claim) === 'eligible', 'Claim is currently unavailable. Refresh your rewards.');
      const active = () => {
        const a = getAccount(wagmi);
        requireThat(alive.current && a.address?.toLowerCase() === address.toLowerCase() && a.chainId === runtime.deployment.chainId,
          'Wallet account or network changed. Reconnect and retry.');
      };
      active();
      const wallet = await getConnectorClient(wagmi, { chainId: runtime.deployment.chainId });
      const args = [0n, address, BigInt(claim.amount), claim.proof] as const;
      await readWithFallback(runtime, c => c.simulateContract({ address: runtime.config.distributor,
        abi: runtime.distributorAbi, functionName: 'claim', args, account: address, value: 0n }), await provider());
      active();
      requireThat(await getChainId(wallet) === runtime.deployment.chainId, 'Wallet network changed');
      active();
      const result = await writeContract(wallet, { chain: chainFor(runtime), account: address, address: runtime.config.distributor,
        abi: runtime.distributorAbi, functionName: 'claim', args, value: 0n });
      if (!alive.current) return;
      setHash(result); setTx('pending');
      await confirm(result);
    } catch (e) {
      if (alive.current) { setTx('failed'); setError(errorMessage(e)); }
    } finally { sending.current = false; }
  };
  const state = live ? claimState(runtime, live, claim) : undefined;
  const busy = tx === 'signing' || tx === 'pending';
  const units = (value: bigint) => `${formatUnits(value, live?.decimals ?? 18)} WORK`;
  const status = state === 'ineligible' ? 'Not eligible: this wallet is absent from the frozen rewards.'
    : state === 'claimed' ? 'Already claimed.'
    : state === 'locked' ? 'Your rewards are locked.'
    : state === 'unverified' ? 'Claims unavailable: the launch service has not supplied the root needed to finish deployment verification.'
    : state === 'unavailable' ? (live?.positiveSweep ? 'Rewards unavailable: a sweep was recorded and funding is insufficient.' : 'Rewards unavailable: distributor funding is insufficient.')
    : state === 'eligible' ? 'Eligible. Your rewards are ready to claim.' : 'Rewards are unknown until verification succeeds.';
  return <section aria-label="Your rewards">
    <p>Wallet: <Wrap text={address} /></p>
    <dl>
      <dt>Wallet WORK balance</dt><dd data-testid="balance">{live ? units(live.balance) : 'Unknown'}</dd>
      <dt>Allocated rewards</dt><dd>{live ? units(BigInt(claim?.amount ?? '0')) : 'Unknown'}</dd>
      <dt>Currently claimable</dt><dd>{live ? state === 'unverified' ? 'Unavailable until verification completes' : units(state === 'eligible' && claim ? BigInt(claim.amount) : 0n) : 'Unknown'}</dd>
    </dl>
    <p role="status">{loading ? 'Checking live contract state…' : status}</p>
    {live && claim && !live.claimed && <p>Unlock time: <time dateTime={new Date(Number(live.unlocksAt) * 1000).toISOString()}>{date(live.unlocksAt)}</time>. Unlock is checked against chain time.</p>}
    <p>Claim sends your allocated WORK to this connected wallet. The transaction sends 0 ETH and requires Sepolia ETH for gas.</p>
    <button disabled={loading || state !== 'eligible' || busy || receiptUnknown} onClick={() => void send()}>
      {tx === 'signing' ? 'Confirm in wallet…' : tx === 'pending' ? 'Claim pending…' : 'Claim'}
    </button>{' '}
    <button disabled={loading || busy && !receiptUnknown} onClick={() => void refresh().catch(() => {})}>Refresh rewards</button>
    {tx === 'pending' && <p role="status">Transaction pending. Waiting for a successful receipt.</p>}
    {tx === 'confirmed' && <p role="status">Transaction confirmed. Balance and claim status refreshed.</p>}
    {hash && <p><a href={`${runtime.config.explorerUrl}/tx/${hash}`}>View transaction on explorer</a></p>}
    {receiptUnknown && hash && <button onClick={() => { setError(''); setReceiptUnknown(false); void confirm(hash); }}>Check transaction status</button>}
    {error && <p role="alert"><Wrap text={error} /></p>}
    {live && <details><summary>Verification details</summary>
      <p>Block {live.block.toString()}. Token code, distributor binding, allocation proofs, round root, balances and sweep logs checked.</p>
      <p>Launch service root comparison: {live.serviceVerified ? 'verified' : 'unavailable; claims disabled'}.</p>
      <p>Round funding: {units(live.funded)}. Remaining distributor balance: {units(live.distributorBalance)}.</p>
      <p>Earliest round-0 sweep: {date(live.sweepableAt)}. This is not an automatic claim expiry.</p>
      <p>Positive sweep recorded: {live.positiveSweep ? 'yes' : 'no'}. A funded claim is simulated again before signing.</p>
      <p>Read provider: <Wrap text={live.rpc} /></p>
    </details>}
  </section>;
}
