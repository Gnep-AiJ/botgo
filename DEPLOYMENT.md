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

`package.ps1` signs with your own local certificate. Set `CODE_SIGN_THUMBPRINT` to that certificate's thumbprint, or point the gitignored `.secrets/desktop-preview-signing.json` at the same local identity. Do not commit a thumbprint. Do not publish if the identity is absent, expired, or does not sign the candidate.

The committed Worker config and contact addresses are placeholders. Replace the nil D1 `database_id` from the Cloudflare dashboard or `wrangler d1 create`, and replace `YOUR_ALIPAY_APP_ID` plus the `https://your-domain.example` callback URLs with your own App ID and HTTPS endpoints. Set `BOTGO_SUPPORT_EMAIL` when preparing the desktop client, and replace `support@example.com` in the website before you deploy. Do not commit real merchant ids, callback hosts, or a personal contact address.

Publish the native release only after the verified installer has been uploaded to private R2 and a `desktop_releases` entry with exact version, file name, object key, size and SHA-256 is published. Validate `GET /api/desktop/releases/current` with a device token. Retire 1.2.x release objects and rows only after this check succeeds.

The Sol route must be saved disabled, pass the authorized two-request metered route probe, and then be enabled. It must remain unavailable when route verification, enablement or health requirements are absent.

`npm run deploy` may migrate and deploy production resources. Do not run it as a substitute for the signed-client publication sequence.
