# BotGo Agent entrypoint

Read `docs/PROJECT_MAP.md` first, then only the linked note for your task.

- Inspect current code and uncommitted changes before editing; preserve user work.
- Root HTML/CSS/JS is website source. `dist/` is generated; never edit it.
- `desktop/` is Electron. `agent/` owns the shared Codex runner and independent CLI.
- Local execution belongs to desktop/CLI; the website provides account, billing and installation guidance.
- Keep credentials in OS storage or Cloudflare Secrets. Never include secret values in logs, commits or release metadata.
- Run `npm test`, `npm run check`, and `git diff --check`. UI changes also require actual browser/Electron evidence.
- Preserve migration history, existing account data, Git history and stable download entrypoints.
- Record verified outcomes and limitations in the current release note linked by the map. Do not infer production success from contract tests.
