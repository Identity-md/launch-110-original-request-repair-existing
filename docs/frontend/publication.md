# Publication results

The repaired source, lockfile, complete static export and local validation evidence were committed and pushed to the existing Identity-md frontend repository:

- Repository: https://github.com/Identity-md/launch-109-workflow-frontend-stage-context
- Branch: `main`
- Repair commit: [`462c163b648583b3127d58f435ba08b3595e93af`](https://github.com/Identity-md/launch-109-workflow-frontend-stage-context/commit/462c163b648583b3127d58f435ba08b3595e93af)
- GitHub's commit API independently returned the same SHA after the push.
- A complete-history Git bundle of that published commit was **1,092,342 bytes**, below the **8,388,608-byte** limit. The assignment's final conservative bundle bound is recorded separately in `submission-check.json`.

An isolated checkout in disposable `test/scratch/` was used because the assigned repository's Git metadata is read-only. Only `web/`, `dist/` and `docs/frontend/` were staged. No root configuration, contract source or dependency directories were changed. A subsequent documentation commit records the hosting outcome; it does not change the repaired export.

## Exact-label hosting attempt

Executed the authorized request:

```sh
imd site publish dist --name work
```

The CLI bundled `dist/` into **536,113 bytes**, uploaded that bundle, then the publication endpoint refused the naming request:

```text
publish refused (503 member_sites_closed): this plane names no member sites
```

The process exited **1**. The requested label was exactly `work`; no alternate label was attempted, and no contract or naming transaction was broadcast from a worker wallet. [CLI output](hosting-publish.log) and [structured publication evidence](publication-status.json) are included.

The existing site is launch-managed (`kind: launch`), site ID `51fac168-7222-4f59-a593-b9d430b0d97b`, named `work.site.identitymd.eth`. At the recorded check, https://work.site.identitymd.eth.limo still served the old export with `serviceRoot: null`, at CID `bafybeibuk2hgvxzzcmvcgjzbas2jz5qswl4elsx4qpm23tc76gouqhlz64`. Its manifest does not match the repaired export. **The repaired website has not been confirmed published.**

The assignment API for job `5592b20b-43d3-466a-84ab-15b16185201c` reports `deliver: true`, `host: true`, state `executing`, and no site result yet. Launch hosting must consume the accepted `dist/` and replace **work**, preserving `work.site.identitymd.eth`. This cannot be completed through the available member-site CLI on this plane. The ready export manifest SHA-256 is recorded in `publication-status.json`. No hosting configuration or service authorization was changed.

Local build, ABI, proof, DOM and live RPC results are in [validation.md](validation.md). They are worker evidence and do not certify browser behavior or publication of the repaired site.
