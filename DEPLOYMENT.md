# BotGo deployment

The current desktop product is BotGo Desktop 1.3.1 from `opencode-desktop/`. It uses the existing Pages, Worker, D1 and private R2 release bucket. Do not reintroduce the retired `desktop/` build flow.

Create every upstream endpoint and API key through the Web admin. Keys are encrypted with the `UPSTREAM_CONFIG_KEY` Worker Secret; do not add upstream credentials to Wrangler vars, client packages, release metadata, build logs, or the repository.

## OPCPay recharge

- For a read-only merchant check, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\opcpay-probe.ps1` from the repository and enter the key at the hidden prompt. The resulting `merchant.json` contains capability flags and SKU fields.
- Configure the production `opcpay_api_key` as a Cloudflare Worker Secret on `botgo-api`. Apply D1 migration `0033_opcpay_recharges.sql` before releasing the Worker and Pages changes together. The checkout return address is `https://botgo.win`.
- The current CNY plan converts whole points to BotGo usage balance at ￥1 per point. Verify the live purchase link, locked SKU snapshot, signed payment status, and original consumption receipt before accepting production checkout. Direct Alipay reconciliation remains available for historical orders. OPCPay refund and consumption-reversal APIs are unavailable for the configured merchant.

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

The committed Worker config and contact addresses are placeholders. `scripts/render-worker-config.mjs` and `scripts/build.mjs` fill them from environment variables at deploy time, and `BOTGO_REQUIRE_DEPLOY_CONFIG=1` fails the build if a placeholder survives. Do not commit real merchant ids, callback hosts, or a personal contact address.

## Automated deployment from GitHub

`main` is the only deployment branch. `.github/workflows/verify.yml` runs `npm ci`, `npm run check` and `npm test`; when it succeeds, `.github/workflows/deploy.yml` builds with the deployment values, applies pending D1 migrations, deploys `botgo-api`, deploys Pages project `botgo`, and smoke-checks `/api/health` and `/`.

The GPT store uses D1 migration `0034_shop_orders.sql`. Add `YUNSHU_SHOP_API_KEY` as a Worker Secret on `botgo-api` to enable the home page entry and store routes. `YUNSHU_REDEEM_API_KEY` is optional for new card verification. After publishing, check `/api/shop/config` and `/api/shop/catalog`. Until the required secret is set, the store stays unavailable.

Configure these once under GitHub → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `BOTGO_D1_DATABASE_ID` | D1 database UUID for `botgo` |
| Variable | `BOTGO_ALIPAY_APP_ID` | 16-digit production App ID |
| Variable | `BOTGO_PUBLIC_ORIGIN` | `https://botgo.win` |
| Variable | `BOTGO_SUPPORT_EMAIL` | public support address |
| Variable | `BOTGO_WECHAT_ID` | public WeChat id |
| Secret | `CLOUDFLARE_API_TOKEN` | token with Workers Scripts, Pages, D1 and R2 edit |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |
| Secret (optional) | `BOTGO_CONTACT_QR_BASE64` | base64 PNG, must stay under the 48 KB secret limit |

Until `CLOUDFLARE_API_TOKEN` exists the Deploy workflow skips every deployment step, so merging the workflow never publishes by itself. Standard GitHub-hosted runners are free for public repositories, so this path uses no GitHub Actions quota.

The contact QR is stored only as the `BOTGO_CONTACT_QR_BASE64` secret: a 17 KB 8-level grayscale PNG whose base64 form is 23 KB, below GitHub's 48 KB secret limit. Regenerate it after replacing the QR by converting to grayscale, mapping pixels to eight levels spanning 0-255, saving as an optimized PNG, confirming it still decodes at 140-718 px, and re-encoding the base64 secret. Without the secret the build hides the QR figure instead of requesting a missing asset.

Rollback: `npx wrangler rollback --config worker/wrangler.deploy.jsonc` for the Worker, and re-run Deploy BotGo on the previous commit for Pages. Manual deployment remains `npm run build`, `npm run deploy:worker`, `npm run deploy:pages`.

Publish the native release only after the verified installer has been uploaded to private R2 and a `desktop_releases` entry with exact version, file name, object key, size and SHA-256 is published. Validate `GET /api/desktop/releases/current` with a device token. Retire 1.2.x release objects and rows only after this check succeeds.

The Sol route must be saved disabled, pass the authorized two-request metered route probe, and then be enabled. It must remain unavailable when route verification, enablement or health requirements are absent.

`npm run deploy` may migrate and deploy production resources. Do not run it as a substitute for the signed-client publication sequence.
