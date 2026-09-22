# WORK frontend repair validation

This is worker-generated evidence, not independent certification. The accepted frontend was restored from `Identity-md/launch-109-workflow-frontend-stage-context` at `1a024d2bf791b7fbc35630dc373d81146c1dde46`. The existing App, browser-default styling, RainbowKit connector and claim transaction flow are preserved. Contract source, libraries and root configuration are unchanged.

## Service, deployment and allocation checks

`web/data/launch.json` was refreshed from `https://api.imd.fun/launches/ee1f32a2-7f0e-48f1-88c2-1c591e0bdc66`. Its provenance records the response SHA-256 and fetch time. Every frozen allocation and reward breakdown is retained; unrelated work/job metadata is omitted. The restored handoff matches every field of the supplied `.imd/reads/deployment.json`.

The service root, OpenZeppelin StandardMerkleTree root, independently reconstructed tree and on-chain `roundOf(0).root` all equal:

```text
0xb2bfb078148d698e3f24ee75fdacfd7b067112bd2b8e14121b6cc9bae73aa32e
```

All **63 proofs** verify. Total allocation, round funding and observed distributor token balance are **100,000,000 WORK** (`100000000000000000000000000` minor units); observed total claimed is zero. Both deployed contracts have code, and `distributor.token()` matches the handoff token. No positive sweep event was observed. PublicNode and Tatum agree on the verification block hash. See [timestamped live results](live-verification.json) for exact block, funding, balances, binding and proof evidence.

- Chain: Sepolia, `11155111`.
- Token: `0xee85b80543c4f301b33505de4d9d0217ce26d8dd`.
- Existing distributor: `0xc3d6cec8cc8be44024c5dc60386099acbb0c1817`.
- Existing round: `0`; unlock `1790052972`, **2026-09-22 04:56:12 UTC** (September 21, 10:56:12 PM Costa Rica).
- Requested wallet: `0x200e710acaa6a93bbc77146026328c40f1d60fb1`.
- Allocation: **12,937,841.269841269841269842 WORK**, exactly `12937841269841269841269842` minor units. Proof verifies; unclaimed and time-locked at the recorded verification block. The live UI enables it after unlock, subject to fresh funding and claimed checks.

No new token, LP, distributor or round is created. Only the connected visitor wallet can sign `claim(0, connectedWallet, amount, proof)`, with zero ETH. No worker transaction was signed, simulated with funds, or broadcast.

## Production build protection and ABI provenance

Fetch rejects absent/malformed/mismatched API roots before replacing saved data. `npm run build` runs prepare, mandatory live verification, Vite and the inventory writer in sequence. It exits nonzero for missing/mismatched roots, wrong token binding, insufficient funding or unavailable chain verification. Vite never generates a new export after failed preflight; callers must honor the nonzero exit and must not publish an older export as a successful rebuild.

Preparation compiles implementation ABIs with solc 0.8.26 from pinned source `f6b17dac020709c2fa2c20d169aa7d3a16cc0a37`. The protocol source archive pins `a94632d6ea40fbd2d1bcd8a0aafe53a1619956c6` and each source SHA-256 is verified. Complete ABI entries are compared with compiled output.

| ABI | Canonical Keccak-256 |
| --- | --- |
| ProofOfWorkToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| MerkleDistributor | `706b029ebc8f6212022d2591216914eccc03ebc6afda53a016c1a58bf10528d7` |

`dist/imd-deployment.json` matches the handoff's complete one-contract set and is the runtime deployment configuration. The protocol distributor is a separately inventoried ABI/config asset. All 80 other exported files are listed with SHA-256 digests. Vite uses relative base `./`; all required runtime assets are retained.

## Checks run

| Check | Result / evidence |
| --- | --- |
| `npm ci` | Passed from the accepted lockfile; versions retained |
| `npm run typecheck` | Passed; [log](typecheck.log) |
| `npm test` | 9 passed; [log](unit-tests.log) |
| `npm run test:interaction` | 17 passed; [report](interaction-results.json) |
| `npm run build` | Passed; mandatory live gate included; [log](build.log) |
| `npm run verify:live` | Passed; [report](live-verification.json) |
| `npm run verify:export` | Passed; [log](export-verification.log) |
| `npm run check:submission` | Passed; [report](submission-check.json) |
| `npm run test:browser -- --max-failures=1` | Browser launch blocked; [report](browser-results.json), [log](browser-tests.log) |

The new negative checks invoke the actual production build with omitted, null, malformed and mismatched service roots and require failure before Vite. Mocked live reads reject wrong distributor tokens and on-chain roots. Existing tests verify all proofs, exact amounts, malformed allocations, ABI hashes, paths and eligibility.

DOM interactions cover disconnected/wrong-chain, rejected switching, ineligible, locked, claimed, unverified, swept/underfunded, RPC recovery, exact claim arguments/zero ETH, pending/receipt refresh, signing rejection, reverted receipts, simulation failure, unknown receipts, account changes and cancelled replacements. The real RainbowKit bootstrap now loads the actual repaired export with mock RPC and enables Claim without injecting a service root. Browser fixtures likewise no longer rewrite roots or manifest hashes for success cases.

## Browser and live-transaction limitations

Both installed Chrome and installed Playwright Chromium Headless Shell exited before any page opened. Chromium reported `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied (1100)`. Both attempts stopped at the first launcher failure; 16 remaining cases did not execute. [Chrome evidence](browser-chrome-results.json) is separate from the final Headless Shell report.

No browser screenshot, layout/overflow, browser console/resource, real wallet signing, gas estimation/inclusion or live claim success is claimed. The 17-case Playwright suite remains runnable on a host permitted to start Chromium, including 1280×900 and 375×812 checks. Read-only RPC evidence and DOM mocks do not establish those behaviors.

## Packaging and publication

Only `web/**`, `dist/**`, `docs/frontend/**` and explicitly budgeted `web/.gitignore` are changed. Dependencies, caches, downloaded browser binaries and scratch fixtures are excluded at every nesting level; no npm registry archives or submodules are submitted. Root contract/build files remain unchanged. Production export assets total 2,642,544 bytes excluding the manifest. The complete submission has a conservative bound below 8 MiB; the current figures are in `submission-check.json`.

Vite reports its existing large-chunk and third-party annotation warnings. The accepted pinned dependencies were installed without changing versions; npm reports peer/deprecation warnings. No fresh dependency security audit is claimed.

The assigned repository's `.git` metadata is read-only. An isolated scratch checkout is used to commit and publish only the permitted paths to the existing Identity-md frontend repository. [Publication evidence](publication.md) records source and exact `work` hosting results separately from local validation.
