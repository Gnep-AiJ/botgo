---
type: moc
updated: 2026-09-14
---

# Artifact locations

| Location | Purpose | Rule |
| --- | --- | --- |
| Root HTML/CSS/JS and `worker/` | Website, account, billing and API source | Do not edit `dist/` directly. |
| `opencode-desktop/` | Reproducible BotGo native client overlay, runtime and packaging | Modify this source, then run `node opencode-desktop/prepare.mjs`. |
| `artifacts/opencode/` | Ignored prepared upstream build copy | Generated input to build only; never hand-edit. |
| `artifacts/verification/` | Isolated profiles, screenshots, test outputs, build and release evidence | No credentials, production profile copies, or root `.tmp-*` outputs. |
| `artifacts/releases/client-1.3.1/` | Locally signed BotGo Desktop 1.3.1 candidate | Hash and signature-check before upload. |
| `agent/` | Historical CLI and shared runner source | Keep as source history; it is excluded from website and public release. |

The removed `desktop/` client and its 1.2.x evidence are retired. Device authorization endpoints retain their existing `/desktop/...` names for compatibility; they are shared service infrastructure, not a source directory or product name.
