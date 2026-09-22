import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, parseAbiItem, type Hex } from 'viem';

const read = (p: string) => JSON.parse(readFileSync(`../dist/${p}`, 'utf8'));
const manifest = read('imd-deployment.json');
const config = read('claim-config.json');
const claims = read('claims.json');
const tokenAbi = read(manifest.contracts[0].abiPath);
const distributorAbi = read(config.distributorAbiPath);
const wallet = claims.claims[0].wallet;
const absent = '0x000000000000000000000000000000000000dead';
const transaction = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const initialBalance = 7n * 10n ** 18n;
type Options = { state?: string; noWallet?: boolean; wrongChain?: boolean; reject?: boolean; revert?: boolean;
  rpcFailure?: boolean; tamper?: boolean; rootMismatch?: boolean; bindingMismatch?: boolean; noCode?: boolean;
  simulationRevert?: boolean; firstRpcFails?: boolean; logsFailure?: boolean; sweep?: boolean; receiptFailure?: boolean };

async function setup(page: Page, options: Options = {}) {
  let didClaim = options.state === 'claimed';
  const requests: {method:string;params:any[]}[] = [];
  const sent: any[] = [];
  const chosen = options.state === 'absent' ? absent : wallet;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const result = await rpc(body);
        return route.fulfill({ json: result });
      }
      return route.abort();
    }
    if (options.tamper && url.pathname.endsWith('claim-config.json')) {
      return route.fulfill({ json: {...config, round: 1} });
    }
    return route.continue();
  });
  async function rpc(body: any): Promise<any> {
    if (Array.isArray(body)) return Promise.all(body.map(rpc));
    const {method,params = []} = body;
    requests.push({method,params});
    const fail = (message:string, code = -32000) => ({jsonrpc:'2.0',id:body.id,error:{code,message}});
    if (options.rpcFailure || options.firstRpcFails && requests.length < 3) return fail('RPC unavailable');
    let result: any;
    if (method === 'eth_chainId') result = `0x${manifest.chainId.toString(16)}`;
    else if (method === 'eth_getCode') result = options.noCode ? '0x' : '0x6001600055';
    else if (method === 'eth_blockNumber') result = '0xc00000';
    else if (method === 'eth_getBlockByNumber') result = {
      number:'0xc00000', hash:blockHash, parentHash:blockHash, timestamp: options.state === 'locked' ? '0x64' : '0x1000',
      nonce:'0x0000000000000000', difficulty:'0x0', totalDifficulty:'0x0', gasLimit:'0x1c9c380',gasUsed:'0x0',
      miner:chosen,extraData:'0x',transactions:[],uncles:[],baseFeePerGas:'0x1',size:'0x100',
    };
    else if (method === 'eth_getLogs') {
      if (options.logsFailure) return fail('Log provider unavailable');
      result = options.sweep ? [{address:config.distributor,blockNumber:'0xc00000',blockHash,transactionHash:transaction,
        transactionIndex:'0x0',logIndex:'0x0',removed:false,
        topics:encodeEventTopics({abi:[parseAbiItem('event Swept(address indexed to, uint256 amount)')],eventName:'Swept',args:{to:chosen}}),
        data:encodeAbiParameters([{type:'uint256'}],[BigInt(claims.total)])}] : [];
    } else if (method === 'eth_call') {
      const isToken = params[0].to.toLowerCase() === manifest.contracts[0].address;
      const abi = isToken ? tokenAbi : distributorAbi;
      const {functionName,args} = decodeFunctionData({abi,data:params[0].data});
      let value: any;
      if (functionName === 'balanceOf') value = String(args![0]).toLowerCase() === config.distributor
        ? options.state === 'unavailable' ? 0n : BigInt(claims.total)
        : initialBalance + (didClaim ? BigInt(claims.claims[0].amount) : 0n);
      else if (functionName === 'decimals') value = 18;
      else if (functionName === 'token') value = options.bindingMismatch ? absent : manifest.contracts[0].address;
      else if (functionName === 'roundOf') value = {root:options.rootMismatch ? blockHash : claims.root,
        funded:BigInt(claims.total),claimed:didClaim ? BigInt(claims.claims[0].amount) : 0n,unlocksAt:1000n};
      else if (functionName === 'openedAt') value = 1n;
      else if (functionName === 'sweepDelay') value = 5000n;
      else if (functionName === 'claimed') value = didClaim;
      else if (functionName === 'claim') {
        if (options.simulationRevert) return fail('execution reverted: InvalidProof', 3);
        result = '0x';
      } else throw new Error(`Unexpected contract read ${functionName}`);
      if (result === undefined) result = encodeFunctionResult({abi,functionName,result:value});
    } else if (method === 'eth_getTransactionReceipt') {
      if (options.receiptFailure) return fail('Receipt unavailable');
      await new Promise(resolve => setTimeout(resolve, 800));
      didClaim = !options.revert;
      result = { transactionHash:transaction,transactionIndex:'0x0',blockHash,blockNumber:'0xc00000',from:chosen,
        to:config.distributor,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',contractAddress:null,logs:[],
        logsBloom:`0x${'00'.repeat(256)}`,status:options.revert ? '0x0' : '0x1',effectiveGasPrice:'0x1',type:'0x2' };
    } else if (method === 'eth_getTransactionByHash') result = { hash:transaction,blockHash,blockNumber:'0xc00000',transactionIndex:'0x0',from:chosen,to:config.distributor,nonce:'0x0',input:'0x',value:'0x0',gas:'0x5208',gasPrice:'0x1',type:'0x0',v:'0x1b',r:'0x1',s:'0x1' };
    else throw new Error(`Unexpected RPC method ${method}`);
    return {jsonrpc:'2.0',id:body.id,result};
  }
  await page.exposeFunction('testWalletRequest', async (args: any) => {
    if (args.method === 'eth_sendTransaction') {
      sent.push(args.params[0]);
      if (options.reject) throw new Error('User rejected request (4001)');
      return transaction;
    }
    const response = await rpc({id:1,...args});
    if (response.error) throw new Error(response.error.message);
    return response.result;
  });
  if (!options.noWallet) await page.addInitScript(({chosen, chain, wrong}) => {
    let connected = false;
    let chainId = wrong ? '0x1' : chain;
    const listeners: Record<string, Function[]> = {};
    const w = window as any;
    w.ethereum = {
      on: (event:string, fn:Function) => { (listeners[event] ||= []).push(fn); },
      removeListener: (event:string, fn:Function) => { listeners[event] = (listeners[event] || []).filter(x => x !== fn); },
      request: async ({method,params}:any) => {
        if (method === 'eth_accounts') return connected ? [chosen] : [];
        if (method === 'eth_requestAccounts') { connected = true; return [chosen]; }
        if (method === 'eth_chainId') return chainId;
        if (method === 'wallet_switchEthereumChain') { chainId = params[0].chainId; listeners.chainChanged?.forEach(fn => fn(chainId)); return null; }
        if (method === 'wallet_requestPermissions') return [{parentCapability:'eth_accounts'}];
        if (method === 'wallet_getCapabilities') return {};
        return w.testWalletRequest({method,params});
      },
    };
    w.testChangeAccount = (next:string) => listeners.accountsChanged?.forEach(fn => fn([next]));
  }, {chosen,chain:`0x${manifest.chainId.toString(16)}`,wrong:options.wrongChain});
  await page.goto('./');
  return {sent, requests};
}
async function connect(page: Page) {
  await page.getByRole('button', {name:'Connect Wallet',exact:true}).click();
  await page.getByRole('button', {name:'Browser Wallet',exact:true}).click();
}

test('disconnected and missing wallet: plain page, no claim', async ({page}) => {
  const errors:string[] = []; page.on('pageerror', e => errors.push(e.message));
  await setup(page,{noWallet:true});
  await expect(page.getByRole('heading',{name:'Proof Of Work'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Connect Wallet',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
test('wrong chain offers an explicit switch', async ({page}) => {
  await setup(page,{wrongChain:true}); await connect(page);
  await expect(page.getByText('Wrong network.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Switch to Sepolia',exact:true}).click();
  await expect(page.getByText('Eligible. Your rewards are ready to claim.')).toBeVisible();
});
for (const [state, text] of [['absent','Not eligible:'],['locked','Your rewards are locked.'],['claimed','Already claimed.'],['unavailable','Rewards unavailable:']]) {
  test(`${state} state disables claim`, async ({page}) => {
    await setup(page,{state,sweep:state==='unavailable'}); await connect(page);
    await expect(page.getByRole('status').filter({hasText:text})).toBeVisible();
    await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeDisabled();
    if (state==='locked') await expect(page.getByText('Unlock time:',{exact:false})).toBeVisible();
  });
}
test('eligible claim is exactly round 0 to connected wallet, zero ETH, then refreshes', async ({page}) => {
  const {sent,requests} = await setup(page); await connect(page);
  await expect(page.getByTestId('balance')).toHaveText('7 WORK');
  await page.getByRole('button',{name:'Claim',exact:true}).click();
  await expect(page.getByText('Transaction pending.',{exact:false})).toBeVisible();
  await expect(page.getByText('Transaction confirmed. Balance and claim status refreshed.')).toBeVisible();
  await expect(page.getByText('Already claimed.',{exact:true})).toBeVisible();
  await expect(page.getByTestId('balance')).not.toHaveText('7 WORK');
  expect(sent).toHaveLength(1);
  expect(sent[0].to.toLowerCase()).toBe(config.distributor);
  expect(BigInt(sent[0].value)).toBe(0n);
  expect(sent[0].from.toLowerCase()).toBe(wallet);
  const decoded = decodeFunctionData({abi:distributorAbi,data:sent[0].data});
  expect(decoded.functionName).toBe('claim');
  expect(decoded.args).toEqual([0n,expect.stringMatching(new RegExp(wallet,'i')),BigInt(claims.claims[0].amount),claims.claims[0].proof]);
  expect(requests.filter(r=>r.method==='eth_call' && r.params[0].data===sent[0].data).length).toBeGreaterThan(0);
});
for (const [name, options, text] of [
  ['rejected',{reject:true},'Wallet request rejected'],['reverted',{revert:true},'Transaction reverted.'],
  ['simulation reverted',{simulationRevert:true},'Transaction reverted or simulation failed.'],
] as [string,Options,string][]) test(name, async ({page}) => {
  const {sent} = await setup(page, options); await connect(page);
  await page.getByRole('button',{name:'Claim',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(text);
  if (options.simulationRevert) expect(sent).toHaveLength(0);
});
test('RPC failure leaves amounts unknown and exposes retry', async ({page}) => {
  await setup(page,{rpcFailure:true}); await connect(page);
  await expect(page.getByRole('alert')).toContainText('RPC verification failed');
  await expect(page.getByTestId('balance')).toHaveText('Unknown');
  await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Refresh rewards'})).toBeEnabled();
});
for (const option of ['rootMismatch','bindingMismatch','noCode','logsFailure'] as const) test(`${option} blocks claims`, async ({page}) => {
  await setup(page,{[option]:true}); await connect(page);
  await expect(page.getByRole('alert')).toContainText('RPC verification failed');
  await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeDisabled();
});
test('tampered deployment asset fails integrity validation', async ({page}) => {
  await setup(page,{tamper:true});
  await expect(page.getByRole('alert')).toContainText('Asset integrity failure');
  await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeDisabled();
});
test('actual export enables verified claims and remains plain at desktop/mobile widths', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await setup(page); await connect(page);
  await expect(page.getByText('Eligible. Your rewards are ready to claim.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Claim',exact:true})).toBeEnabled();
  for (const [name,width,height] of [['desktop',1280,900],['mobile',375,812]] as const) {
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`../docs/frontend/${name}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});
