import { createPublicClient, http, custom, defineChain, parseAbiItem, type Address, type EIP1193Provider, type PublicClient, type Transport } from 'viem';
import { requireThat } from './integrity';
import type { Claim, LiveState, Runtime } from './model';

export function chainFor(runtime: Runtime) {
  const c = runtime.config;
  return defineChain({ id: runtime.deployment.chainId, name: c.name, nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: c.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: c.explorerUrl } } });
}
export async function readWithFallback<T>(runtime: Runtime, action: (client: PublicClient, label: string) => Promise<T>, provider?: EIP1193Provider): Promise<T> {
  const failures: string[] = [];
  const sources: {label: string; transport: Transport}[] = runtime.config.rpcUrls.map(url => ({ label: url, transport: http(url, { timeout: 10000, retryCount: 1 }) }));
  if (provider) sources.push({ label: 'Connected wallet RPC', transport: custom(provider, { retryCount: 0 }) });
  for (const source of sources) {
    try {
      const client = createPublicClient({ transport: source.transport });
      requireThat(await client.getChainId() === runtime.deployment.chainId, 'RPC chain ID mismatch');
      return await action(client, source.label);
    } catch (error) { failures.push(`${source.label}: ${error instanceof Error ? error.message.slice(0, 240) : 'request failed'}`); }
  }
  throw new Error(`RPC verification failed. Retry when connectivity recovers. ${failures.join(' | ')}`);
}
const sweptEvent = parseAbiItem('event Swept(address indexed to, uint256 amount)');
export async function sweepLogs(client: PublicClient, runtime: Runtime, end: bigint) {
  let from = BigInt(runtime.config.deploymentBlock);
  let span = 10000n;
  let positive = false;
  while (from <= end) {
    const to = from + span - 1n > end ? end : from + span - 1n;
    try {
      const logs = await client.getLogs({ address: runtime.config.distributor, event: sweptEvent,
        fromBlock: from, toBlock: to, strict: true });
      requireThat(logs.length < 1000, 'Possibly truncated sweep logs');
      positive ||= logs.some(log => (log.args.amount ?? 0n) > 0n);
      from = to + 1n;
    } catch (error) {
      // Only shrink range/size refusals. A dead endpoint should fail over promptly.
      if (span <= 1n || !/limit|range|too many|truncat|too large|exceed/i.test(String(error))) throw error;
      span /= 2n;
    }
  }
  return positive;
}
export async function readState(client: PublicClient, runtime: Runtime, account: Address, rpc: string): Promise<LiveState> {
  const block = await client.getBlock({ blockTag: 'latest' });
  requireThat(block.number !== null && block.hash !== null, 'Missing chain block');
  requireThat(block.number >= BigInt(runtime.config.deploymentBlock), 'RPC is behind deployment');
  const blockNumber = block.number;
  const d = runtime.config.distributor;
  const tokenRead = (functionName: string, args: readonly unknown[] = []) => client.readContract({ address: runtime.token, abi: runtime.tokenAbi, functionName, args, blockNumber });
  const read = (functionName: string, args: readonly unknown[] = []) => client.readContract({ address: d, abi: runtime.distributorAbi, functionName, args, blockNumber });
  const [tokenCode, distributorCode, binding, round, opened, delay, balance, distributorBalance, claimed, decimals, positiveSweep] = await Promise.all([
    client.getCode({ address: runtime.token, blockNumber }), client.getCode({ address: d, blockNumber }),
    read('token'), read('roundOf', [0n]), read('openedAt', [0n]), read('sweepDelay'),
    tokenRead('balanceOf', [account]), tokenRead('balanceOf', [d]), read('claimed', [0n, account]), tokenRead('decimals'),
    sweepLogs(client, runtime, blockNumber),
  ]);
  requireThat(tokenCode && tokenCode !== '0x' && distributorCode && distributorCode !== '0x', 'Contract code missing');
  requireThat(typeof binding === 'string' && binding.toLowerCase() === runtime.token.toLowerCase(), 'Distributor token binding mismatch');
  const r = round as { root: `0x${string}`; funded: bigint; claimed: bigint; unlocksAt: bigint };
  requireThat(r.root === runtime.claims.root && r.funded === BigInt(runtime.claims.total) && r.claimed <= r.funded, 'On-chain round does not match frozen allocations');
  requireThat(decimals === 18 && typeof claimed === 'boolean' && typeof balance === 'bigint'
    && typeof distributorBalance === 'bigint' && typeof opened === 'bigint' && typeof delay === 'bigint', 'Unexpected contract response');
  // Check the same block again after related reads to reject a reorganization mid-refresh.
  requireThat((await client.getBlock({ blockNumber })).hash === block.hash, 'Chain reorganized during verification; retry');
  return { block: blockNumber, blockHash: block.hash, timestamp: block.timestamp, root: r.root,
    funded: r.funded, totalClaimed: r.claimed, unlocksAt: r.unlocksAt,
    sweepableAt: opened + delay > r.unlocksAt ? opened + delay : r.unlocksAt,
    distributorBalance, balance, claimed, decimals, positiveSweep,
    serviceVerified: runtime.config.serviceRoot === r.root, rpc };
}
export function claimState(runtime: Runtime, live: LiveState, claim?: Claim) {
  if (!claim) return 'ineligible';
  if (live.claimed) return 'claimed';
  if (!live.serviceVerified) return 'unverified';
  if (live.timestamp < live.unlocksAt) return 'locked';
  if (live.distributorBalance < live.funded - live.totalClaimed || live.distributorBalance < BigInt(claim.amount)) return 'unavailable';
  return 'eligible';
}
