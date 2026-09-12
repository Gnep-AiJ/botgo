# BotGo Agent CLI

`botgo-agent-cli` is a Windows-first, thin wrapper around the current stable `@openai/codex` CLI. It keeps the Codex process and configuration isolated from the user's normal Codex installation and routes Responses requests through the BotGo relay.

## Install

Windows PowerShell:

```powershell
irm https://botgo.win/install.ps1 | iex
```

The installer checks Node/npm and installs a private Node 22 runtime if needed. It verifies the release SHA-256 before switching versions. Run again to update or repair. Inside your project, run `botgo`: browser login starts when needed, then the native Codex interface opens. No terminal password or API key is required. Noninteractive invocation prints help.

Choose an enabled model with `botgo --model gpt-5.6-luna`. Models and availability come from BotGo; the default is GPT-5.6 Sol. Escape or Ctrl+C cancels the relevant interactive step. Existing `auth`, `run`, `resume`, `sessions`, `account`, and `update` commands remain supported.

## Development install

From the repository root:

```powershell
Push-Location agent
npm install
Pop-Location
```

The package exposes the `botgo` command. During repository development invoke it as `node agent/bin/botgo.cjs`; an installed package can be added to `PATH` with `npm install --global .\agent`. It does not modify the repository root `package.json`.

## Sign in and run

```powershell
botgo auth login
botgo account
botgo update --check
botgo update
botgo run --project . --permission workspace-write "修复测试并运行它们"
botgo resume <session-id> "继续处理剩余问题"
botgo sessions list
```

The login flow opens `https://botgo.win/desktop-authorize.html` and returns through a loopback callback. The device token is stored with Windows Credential Manager through `keytar`; task history contains no API keys or device tokens.

Permission modes are `read-only`, `workspace-write` and `full-access`. Non-interactive `full-access` runs require `--yes`.

`botgo update --check` compares the installed Codex CLI with the npm `latest` stable tag. `botgo update` installs that exact stable version and verifies the result. Alpha and other prerelease tags are never selected. Dependabot monitors `agent/package.json`, and the Windows CI workflow must pass before an update is merged.

## Isolation

On Windows the managed files are stored below:

```text
%LOCALAPPDATA%\BotGo\Agent\codex   (CODEX_HOME)
%LOCALAPPDATA%\BotGo\Agent\state.json
```

The runner calls the local `agent/node_modules/.bin/codex` executable, removes direct OpenAI/Codex key variables, and injects a short-lived BotGo relay key for each task. The existing Desktop app, IPC contract and user's `%USERPROFILE%\.codex` are not changed by this package.
