---
type: moc
updated: 2026-10-10
---

# Artifact locations

| Location | Purpose | Rule |
| --- | --- | --- |
| Root HTML/CSS/JS and `worker/` | Website, account, billing and API source | Do not edit `dist/` directly. |
| `opencode-desktop/` | Reproducible BotGo native client overlay, runtime and packaging | Modify this source, then run `node opencode-desktop/prepare.mjs`. |
| `artifacts/opencode-1.18.35/` | Ignored prepared upstream build copy, resolved by `opencode-desktop/upstream.json` | Generated input to build only; never hand-edit. Older prepared trees are historical artifacts. |
| `artifacts/verification/` | Isolated profiles, screenshots, test outputs, build and release evidence | No credentials, production profile copies, or root `.tmp-*` outputs. |
| `artifacts/verification/opencode-1.18.35-upgrade/` | Pristine archive snapshot, frozen dependency/model metadata, PDF fixtures, native tests and production release readback | Keep paid upstream evidence separate from Worker fixture billing and installed-client acceptance. |
| `artifacts/releases/client-1.3.9/` | Published signed Windows 1.3.9 installer and generated packaging files | Retain the installer for release verification and rollback. |
| `artifacts/releases/client-1.3.7/` | Verified signed rollback installer and blockmap | Retain alongside the current release. Earlier local installer copies were removed by the authorized 2026-10-10 cleanup; remote historical objects/records remain. |
| `artifacts/releases/hermes-preview-polish/` | Published BotGo Agent 2.0.0-preview.5 installer and matching unpacked payload | Retain the signed installer and complete unpacked directory. Current installed acceptance copy: `artifacts/verification/botgo-installed-v5/`; its BotGo shortcut is active. The signed preview.4 installer is also retained; failed binary copies and extraction intermediates were removed by the 2026-10-24/25 cleanup, with logs and hashes preserved. |
| `artifacts/verification/cleanup-20261024/` | User-authorized project cache and obsolete test-copy cleanup, completed 2026-10-25 | Exact file manifest, deletion receipt, protected-file hashes and independent verification. 88,745 files removed, 9.60 GiB logical / 9.47 GiB observed free-space increase. Active old/new runtimes, registered clients, source, account data and published/rollback installers remain protected. |
| `artifacts/verification/cleanup-20261023/` | Size inventory, approved exact targets, hashes and deletion receipt | The user explicitly approved removal of `hermes-preview/` and `hermes-preview-fixed/`; retired `desktop/node_modules`, `agent/node_modules` and obsolete builder cache were also cleared. All verification records and production rollback installers remain. |
| `artifacts/verification/cleanup-20261010/` | Cleanup inventory, exact target plan, old packaging metadata, hashes, deletion receipt and checks | The legacy 1.18.30 build/pristine dependency copies, old unpacked outputs, unused Bun cache and duplicate R2 downloads are removed. Current pinned build inputs, profiles and release evidence remain protected. |
| `agent/` | Historical CLI and shared runner source | Keep as source history; it is excluded from website and public release. |

The removed `desktop/` client and its 1.2.x evidence are retired. Device authorization endpoints retain their existing `/desktop/...` names for compatibility; they are shared service infrastructure, not a source directory or product name.
