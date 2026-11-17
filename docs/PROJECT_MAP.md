---
type: moc
project: BotGo
status: active
updated: 2026-10-10
---

# BotGo project map

Inspect the working tree before edits. Generated content under `dist/` and `artifacts/opencode*/` is never source of truth.

| Area | Source of truth | Verification |
| --- | --- | --- |
| Website, download and account UI | Root HTML/CSS/JS, `functions/`, `worker/src/` | `npm run build`, browser checks |
| Web specialty chat (published 2026-10-08) | `chat.html`, `chat.css`, `chat.js`, `worker/src/web-chat.js`, `worker/src/web-chat-images.js`, `worker/src/web-chat-tools.js`, `worker/src/web-specialties.js`, `worker/src/specialty-rules.js`, `worker/src/web-search.js`, `worker/src/conversations.js`; local API bridge: `scripts/dev-api.mjs`; policies: `docs/WEB_SPECIALTY_RULES.md`, search: `docs/WEB_CHAT_SEARCH_PLAN.md`, images/cancel: `docs/WEB_CHAT_IMAGES.md` | `tests/web-chat.test.mjs`, `tests/web-chat-cancel.test.mjs`, `tests/web-chat-images.test.mjs`, `tests/web-chat-tools.test.mjs`, `tests/web-search.test.mjs`, `tests/web-search-ui.mjs`, `tests/web-chat-entry.test.mjs`, `tests/dev-api.test.mjs`, `npm run test:web-ui`; local setup: `README.md`; latest automatic-image/search/stop release: `artifacts/verification/web-chat/auto-images/`; rollback baseline: `artifacts/verification/web-chat/images/`; native-search probes: `artifacts/verification/web-chat/native-search/`; UI/rules baseline: `artifacts/verification/web-chat/refinement-v3/` |
| Billing and model routing | `worker/src/metering.js`, `worker/src/opencode-gateway.js`, migrations | SQLite route and metering tests |
| Native BotGo client | `opencode-desktop/` overlay/runtime/package scripts | `npm run opencode:build`, isolated Electron check |
| BotGo Agent client | `hermes-desktop/` overlay/runtime/package scripts; manual acceptance: `hermes-desktop/README.md` | Published 2.0.0-preview.5; installed Gateway/UI, real update download/hash/signature and website readback verified |
| Device authorization and releases | `worker/src/desktop-auth.js`, `worker/src/platform-admin.js` | device/release authorization tests |
| Automated deployment | `.github/workflows/verify.yml`, `.github/workflows/deploy.yml`, `scripts/deploy-overrides.mjs`, `scripts/render-worker-config.mjs`, `DEPLOYMENT.md` | Push to `main` → Verify → Deploy; smoke checks `/api/health` and `/` |
| Historical CLI source | `agent/` | No longer part of website build or public release |

## Native client

The website now downloads BotGo Agent 2.0.0-preview.5, built from the fixed native snapshot in `hermes-desktop/upstream.json`. Its independent update channel preserves the legacy client channel. Installed UI/Gateway, native local file/terminal tools, built-in image/TTS, full online installer download, hash and pinned signature were verified; actual WeChat/QQ recipient delivery and Live remain outside accepted scope. The original website hero is preserved; Bot logo, real client screenshots and mobile layouts are verified. Evidence: `artifacts/verification/hermes-capabilities-20261023/` and `artifacts/verification/botgo-web-refresh-20261024/`.

`opencode-desktop/upstream.json` pins OpenCode 1.18.35 and its exact commit; `paths.cjs` resolves the pristine snapshot, models catalog and ignored build copy at `artifacts/opencode-1.18.35/`. `prepare.mjs` reproduces the overlay. Do not edit the generated copy by hand. The legacy published client remains BotGo Desktop 1.3.9: its visible brand is BotGo, its model list comes only from verified server routes, and its updater uses the signed BotGo release endpoint. Version 1.3.1 omitted its signature verifier from the package and requires one manual upgrade; 1.3.2 and later package the verifier outside ASAR and use the existing pinned signing identity.

The native client keeps project/session navigation, models, permissions, MCP, Skills, subagents, terminal and settings from the pinned upstream engine. Product copy, title bar, account controls, help targets and errors must not show OpenCode branding. MIT/legal attribution remains in license material only. The website provides product, download, account and recharge pages. The 2026-10-08 published website adds Web specialty chat at `chat.html`; it reuses verified Admin model routes and the existing account ledger. Local project execution remains native. CLI distribution remains retired.

Only BotGo model providers and the managed local server are enabled. Project permissions, MCP and agents remain native; project/provider configuration cannot reopen an external model provider. Native PDF input uses negotiated session capabilities, while old clients receive their supported text/image fields. Upstream upgrades remain manual; raw upstream automatic updating and client migration are paused. Audit and regression evidence for 1.3.9 is under `artifacts/verification/opencode-1.18.35-upgrade/`.

## Evidence and release state

Write new screenshots, isolated profiles, test logs and release snapshots under `artifacts/verification/`. Do not inspect archived profiles or credentials. The current release record is [[notes/Release 2026-09-14]].

The public repository stores placeholders for merchant and personal values. Real deployment values live in GitHub Actions variables/secrets and are injected at build time; never commit them.

Required local checks are `npm test`, `npm run check`, `git diff --check`, native build, and an actual isolated Electron render. Local tests do not prove production deployment, model probe success, signature availability, upload, or remote release publication.
