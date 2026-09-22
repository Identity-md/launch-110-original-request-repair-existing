import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, fallback, http } from 'wagmi';
import { connectorsForWallets, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import '@rainbow-me/rainbowkit/styles.css';
import { loadRuntime } from './config';
import { chainFor } from './chain';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<p role="status">Loading deployment data…</p>);
loadRuntime().then(runtime => {
  const chain = chainFor(runtime);
  // Empty ID is intentional: the injected connector never uses WalletConnect.
  const connectors = connectorsForWallets([{ groupName: 'Browser wallets', wallets: [injectedWallet] }],
    { appName: 'Proof Of Work', projectId: '' });
  const config = createConfig({ chains: [chain], connectors,
    transports: { [chain.id]: fallback(runtime.config.rpcUrls.map(url => http(url))) } });
  root.render(<WagmiProvider config={config}><QueryClientProvider client={new QueryClient()}>
    <RainbowKitProvider><App runtime={runtime} /></RainbowKitProvider>
  </QueryClientProvider></WagmiProvider>);
}).catch(error => root.render(<main><h1>Proof Of Work</h1><p>$WORK</p>
  <p role="alert">Deployment data could not be verified. {error instanceof Error ? error.message : 'Loading failed.'}</p>
  <button onClick={() => location.reload()}>Reload deployment data</button><p><button disabled>Claim</button></p></main>));
