---
type: module
updated: 2026-09-14
status: implementation
tags: [botgo, native-client, cli]
---

# BotGo native client and CLI

The Windows desktop product is the BotGo 1.3.1 native client built from `opencode-desktop/`. `prepare.mjs` applies the BotGo overlay to the pinned upstream engine in `artifacts/opencode/`; that generated directory is not maintained directly.

The client keeps local project/session work, prompt and server-provided model selection, permissions, MCP, Skills, subagents, terminal and settings. The renderer receives only a narrow IPC API. Device credentials use Electron safe storage, and upstream credentials never reach the renderer or package metadata.

The title bar presents the BotGo robot mark at left and a persistent account control at right. It exposes the email prefix and CNY balance, collapses to an accessible avatar on narrow windows, and opens a keyboard-accessible account dialog with refresh, billing, task charges and separate sign-out. `Ctrl+Shift+B` opens that dialog.

## Updates

After authenticated login, the client checks `GET /api/desktop/releases/current` with the stored device token. A newer 1.3.x release is downloaded in the background, bounded to 1 GiB, hash-checked, Authenticode-checked against the pinned BotGo signer, and revalidated against fresh release metadata immediately before installation. The user chooses **Restart and update**; no update auto-installs.

The existing 1.3.0-preview.1 client has upstream updating disabled, so it cannot acquire this updater. It must be manually replaced with a signed 1.3.1 installer once. Publication requires a local signed package, R2 upload, published `desktop_releases` metadata, and an authenticated endpoint readback.

## Models

`gpt-5.6-sol` is server-owned. It is returned only when the catalog and native route are enabled, the exact route has a successful `verified_at` probe, and no route health block exists. The client does not hard-code it.

The CLI remains under `agent/` and has its own tests and release process. Shared device-login routes retain their established API paths for compatibility.
