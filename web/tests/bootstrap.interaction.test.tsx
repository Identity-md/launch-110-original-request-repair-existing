import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { decodeFunctionData, encodeFunctionResult } from 'viem';

afterEach(() => vi.unstubAllGlobals());
it('boots exported data, opens stock RainbowKit, connects an injected provider and reads live state (mock RPC)', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  Object.defineProperty(globalThis.crypto, 'subtle', {value:webcrypto.subtle, configurable:true});
  Object.defineProperty(window, 'matchMedia', {value: () => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}),configurable:true});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom AbortSignal and Node's Request belong to different realms.
  const NativeRequest = globalThis.Request;
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, {...init, signal: undefined}); }
  });
  const read = (path: string) => JSON.parse(readFileSync(`../dist/${path}`, 'utf8'));
  const manifest = read('imd-deployment.json'); const config = read('claim-config.json'); const claims = read('claims.json');
  const tokenAbi = read(manifest.contracts[0].abiPath); const distributorAbi = read(config.distributorAbiPath);
  const wallet = claims.claims[0].wallet;
  let connected = false;
  const provider = { on() {}, removeListener() {}, request: vi.fn(async ({method}: {method:string}) => {
    if (method === 'eth_accounts') return connected ? [wallet] : [];
    if (method === 'eth_requestAccounts') { connected=true; return [wallet]; }
    if (method === 'eth_chainId') return `0x${manifest.chainId.toString(16)}`;
    if (method === 'wallet_requestPermissions') return [{parentCapability:'eth_accounts'}];
    throw new Error(`Unexpected wallet request ${method}`);
  }) };
  Object.defineProperty(window, 'ethereum', {value:provider,configurable:true});
  vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
    if (url.startsWith('./')) return new Response(readFileSync(`../dist/${url.slice(2)}`), {status:200});
    const body = JSON.parse(String(options?.body));
    const handle = ({id,method,params}: any) => {
      let result: unknown;
      if (method === 'eth_chainId') result=`0x${manifest.chainId.toString(16)}`;
      else if (method === 'eth_getCode') result='0x6001600055';
      else if (method === 'eth_getLogs') result=[];
      else if (method === 'eth_getBlockByNumber') result={number:`0x${(Number(config.deploymentBlock)+1).toString(16)}`,
        hash:`0x${'01'.repeat(32)}`,timestamp:'0x1000',transactions:[]};
      else if (method === 'eth_call') {
        const abi = params[0].to.toLowerCase() === manifest.contracts[0].address ? tokenAbi : distributorAbi;
        const {functionName,args} = decodeFunctionData({abi,data:params[0].data});
        const values: Record<string,unknown> = {token:manifest.contracts[0].address,
          roundOf:{root:claims.root,funded:BigInt(claims.total),claimed:0n,unlocksAt:1000n},openedAt:1n,sweepDelay:5000n,
          decimals:18,claimed:false,balanceOf:String(args?.[0]).toLowerCase() === config.distributor ? BigInt(claims.total) : 7n*10n**18n};
        result=encodeFunctionResult({abi,functionName,result:values[functionName]});
      } else throw new Error(`Unexpected RPC ${method}`);
      return {jsonrpc:'2.0',id,result};
    };
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(handle) : handle(body)), {status:200,headers:{'content-type':'application/json'}});
  });
  await import('../src/main');
  await screen.findByRole('heading',{name:'Proof Of Work'});
  expect(screen.getByRole('button',{name:'Claim'})).toBeDisabled();
  fireEvent.click(await screen.findByRole('button',{name:'Connect Wallet'}));
  expect(await screen.findByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Browser Wallet'}));
  expect(await screen.findByText('Eligible. Your rewards are ready to claim.')).toBeVisible();
  expect(screen.getByTestId('balance')).toHaveTextContent('7 WORK');
  expect(provider.request).toHaveBeenCalledWith(expect.objectContaining({method:'eth_requestAccounts'}));
  expect(screen.getByRole('button',{name:'Claim'})).toBeEnabled();
});
