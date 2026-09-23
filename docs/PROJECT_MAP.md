---
type: moc
project: BotGo
status: active
updated: 2026-09-14
---

# BotGo project map

Inspect the working tree before edits. Generated content under `dist/` and `artifacts/opencode/` is never source of truth.

| Area | Source of truth | Verification |
| --- | --- | --- |
| Website, download and account UI | Root HTML/CSS/JS, `functions/`, `worker/src/` | `npm run build`, browser checks |
| Billing and model routing | `worker/src/metering.js`, `worker/src/opencode-gateway.js`, migrations | SQLite route and metering tests |
| Native BotGo client | `opencode-desktop/` overlay/runtime/package scripts | `npm run opencode:build`, isolated Electron check |
| Device authorization and releases | `worker/src/desktop-auth.js`, `worker/src/platform-admin.js` | device/release authorization tests |
| Historical CLI source | `agent/` | No longer part of website build or public release |

## Native client

`opencode-desktop/prepare.mjs` reproduces BotGo overlays in the ignored upstream build copy at `artifacts/opencode/`. Do not edit that copy by hand. The client candidate is BotGo Desktop 1.3.5: its visible brand is BotGo, its model list comes only from verified server routes, and its updater uses the signed BotGo release endpoint. Version 1.3.1 omitted its signature verifier from the package and requires one manual upgrade; 1.3.2 and later package the verifier outside ASAR and use the existing pinned signing identity.

The native client keeps project/session navigation, models, permissions, MCP, Skills, subagents, terminal and settings from the pinned upstream engine. Product copy, title bar, account controls, help targets and errors must not show OpenCode branding. MIT/legal attribution remains in license material only. The website is a product, download, account and recharge surface; web chat and CLI distribution have been removed from the candidate build.

## Evidence and release state

Write new screenshots, isolated profiles, test logs and release snapshots under `artifacts/verification/`. Do not inspect archived profiles or credentials. The current release record is [[notes/Release 2026-09-14]].

Required local checks are `npm test`, `npm run check`, `git diff --check`, native build, and an actual isolated Electron render. Local tests do not prove production deployment, model probe success, signature availability, upload, or remote release publication.
