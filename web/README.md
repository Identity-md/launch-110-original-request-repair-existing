# Proof Of Work claim page

Plain React/Vite/TypeScript, wagmi/viem and stock RainbowKit. There is no application CSS. Only `claim(0, connectedWallet, allocationAmount, proof)` is offered, with zero ETH value. Gas requires Sepolia ETH. There is no approval, token transfer, swap, owner or sweep control.

## Repair status

Restored the accepted frontend from `Identity-md/launch-109-workflow-frontend-stage-context` at **1a024d2bf791b7fbc35630dc373d81146c1dde46**, then refreshed the corrected launch API. The service root, all 63 allocation proofs and Sepolia distributor round 0 now agree. Production builds require that agreement and the handoff token binding; missing roots, mismatches or unavailable RPC verification fail the build before Vite exports a new site.

The existing round is funded with **100,000,000 WORK**. Wallet `0x200e710acaa6a93bbc77146026328c40f1d60fb1` has **12,937,841.269841269841269842 WORK**, unlocking at **2026-09-22 04:56:12 UTC**. Claim eligibility follows the live block timestamp and claimed/funding reads; see the timestamped [live evidence](../docs/frontend/live-verification.json).

Nine unit/build checks and 17 DOM interactions pass. Both installed Chrome and Chromium Headless Shell fail at browser launch under this sandbox, so browser layout and real-wallet behavior remain unverified. No transaction was signed or broadcast. [Validation evidence](../docs/frontend/validation.md) and [publication status](../docs/frontend/publication.md) record the limits and delivery details.

## Install, build and serve

Use Node 22.12+ or Node 24 and npm. Run from `web/`:

```sh
npm ci
npm run refresh:launch
npm run typecheck
npm run build
npm run preview
```

The build recompiles the implementation ABIs from the pinned Git source, validates their content, checks the token's canonical Keccak hash against the deployment handoff, regenerates proofs and static data, performs mandatory read-only Sepolia verification, runs Vite with `base: './'`, then writes **root `dist/imd-deployment.json` last**. It inventories every other final file by SHA-256. The production build requires public RPC access and fails closed if verification is unavailable. Retain the handoff's source commit in Git history. The exact pinned protocol source archive already committed in `docs/protocol/` is used and every source digest checked before compilation. Serving/verifying the exported files needs no npm registry or build server; wallet reads still require network access.

`npm run dev` serves Vite's development app using the last built manifest. Build once first, and rebuild after changing saved deployment data. `node scripts/serve.mjs` serves only the production export at `http://127.0.0.1:4173/ipfs/work/` without a history fallback. The publisher must upload all files under `dist/`, including JSON, and use HTTPS. Web Crypto integrity checks and injected wallets need a secure context (localhost works). Double-clicking `index.html` with a `file:` URL is not supported.

## Configuration and provenance

- `data/handoff.json` is the supplied deployment handoff. It is the build input, not a second runtime address map. The browser loads `imd-deployment.json` for the actual chain, token address and token ABI path, and loads that ABI as JSON. Its attested contract list contains only `ProofOfWorkToken`.
- `data/network.json` is the sole editable public RPC/name/explorer configuration. The generated, inventoried `claim-config.json` combines this with the protocol distributor discovered from the launch's `artifacts` entry. It contains the distributor ABI path/hash, deployment block, round, snapshot paths and service root. The distributor is not added to the attested manifest contract list.
- `data/launch.json` preserves every service allocation and reward breakdown, launch identity, deployment artifacts, fetch URL/time and SHA-256 of the original response. Unrelated job/work/device history is omitted. No allocations were computed from policy or invented.
- `dist/allocation-snapshot.json`, `dist/claims.json` and `dist/merkle-tree.json` retain the complete allocations, exact decimal amounts, proofs and OpenZeppelin tree dump. A wallet subset cannot replace the full snapshot.
- `public/` contains deterministic generated data inputs to Vite. The final runtime deployment manifest exists in `dist/`; the app never imports the handoff into its JavaScript bundle.

Runtime checks SHA-256 for loaded data assets, canonical ABI hashes, snapshot identity, uniqueness and amounts, the independently rebuilt full root and every proof. Related chain reads use one block number and recheck its block hash. It verifies RPC chain ID, both code addresses, `token()`, round root/funding/accounting, token decimals, claimed status, balance, unlock time, distributor balance and sweep logs. It scans logs in bounded windows and shrinks failed windows. Public endpoints are tried in order; the connected wallet's provider is a final read fallback, with a chain check. Transaction signing uses only the connected wallet.

The pinned distributor has no `swept` flag. A positive sweep plus insufficient remaining balance is unavailable. Full funding restored after a sweep can qualify, subject to simulation. The earliest sweep time is not an expiry. Its shared balance across rounds cannot reserve funds for this round; the UI conservatively requires enough for this round's entire remaining allocation. A later sweep or competing transaction can still revert a pending claim.

Reads refresh every 20 seconds, on account/network changes, on demand, immediately before signing and after a successful receipt. Unlock is based on block timestamp. Signing rechecks wallet identity/network, and stale component responses are discarded. Unknown receipt status blocks duplicate submissions and offers a receipt retry. A successful replacement/cancellation receipt without `claimed(0,wallet)` does not report a successful claim.

Only the injected browser connector is configured. RainbowKit's connector-list API receives an empty project ID; no WalletConnect connector is constructed. No operator credentials are needed. WalletConnect is optional future work requiring an actual public project ID and an explicitly configured connector; no placeholder ID is used.

## Refreshing the frozen service data

Run `npm run refresh:launch`, then `npm run build`. Fetch rejects an absent, malformed or mismatched service root before replacing saved launch data. The build independently rebuilds the StandardMerkleTree, checks all generated proofs, and verifies live round 0 and `distributor.token()` before exporting. Never populate the service root from a chain read or the reconstructed tree; those are independent comparisons, not substitutes for the service response.

The live verifier also checks code, funding, decimals and sweep logs, confirms the verification block hash through a second public RPC, and records this user's allocation. It issues only read requests. No worker wallet or private key is used.

## Validation

```sh
npm run typecheck
npm test                   # negative production builds, proofs, ABI, path and live guards
npm run test:interaction   # jsdom interactions and real connector bootstrap with mock RPC
npm run verify:live        # read-only public RPC verification; writes evidence
npm run verify:export      # complete inventory and byte-limit checks
npm run check:submission   # scope, dependencies, submodules and 8 MiB bundle bound
```

For real-browser tests on a worker that permits browser execution:

```sh
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm exec -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm run test:browser
```

Alternatively set `CHROME_PATH` to a Chromium executable. The 17 Playwright cases serve the real export under `/ipfs/work/` and intercept external requests with wallet/RPC fixtures; no real funds are used. All successful-claim cases use the actual exported service root, snapshot and manifest without rewriting their hashes. The actual-export case expects Claim to enable once the mocked chain is unlocked; an intentional asset-tampering case verifies rejection. Screenshot/overflow checks target 1280×900 and 375×812. These cases are shipped but did not execute here due to the browser launch restriction.

All package versions are pinned in `package-lock.json`. Patched `tmp` and `ws` overrides remove the detected high-severity advisories without changing the pinned Solidity compiler. Dependency versions are retained from the accepted source; no new security audit is claimed for this repair. Dependencies, package caches and browser binaries are not submitted. `web/.gitignore` is explicitly in this assignment's path budget and ignores generated dependency/test directories at every nesting level. No other ignore file or root build configuration was changed.
