# BotGo deployment

The current desktop product is BotGo Desktop 1.3.1 from `opencode-desktop/`. It uses the existing Pages, Worker, D1 and private R2 release bucket. Do not reintroduce the retired `desktop/` build flow.

Create every upstream endpoint and API key through the Web admin. Keys are encrypted with the `UPSTREAM_CONFIG_KEY` Worker Secret; do not add upstream credentials to Wrangler vars, client packages, release metadata, build logs, or the repository.

Before any remote action, run:

```powershell
npm test
npm run check
npm run opencode:build
git diff --check
npm run opencode:verify
```

Build the signed Windows candidate only after those checks:

```powershell
powershell -File opencode-desktop/package.ps1
node scripts/verify-release-candidate.cjs
```

`package.ps1` requires the existing local certificate identity with thumbprint `104C109C454B26C3B5028EE66D8B225F447F953F`. Do not publish if it is absent, expired, or does not sign the candidate.

Publish the native release only after the verified installer has been uploaded to private R2 and a `desktop_releases` entry with exact version, file name, object key, size and SHA-256 is published. Validate `GET /api/desktop/releases/current` with a device token. Retire 1.2.x release objects and rows only after this check succeeds.

The Sol route must be saved disabled, pass the authorized two-request metered route probe, and then be enabled. It must remain unavailable when route verification, enablement or health requirements are absent.

`npm run deploy` may migrate and deploy production resources. Do not run it as a substitute for the signed-client publication sequence.
