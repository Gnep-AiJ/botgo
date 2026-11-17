import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import credentialsModule from './botgo/shared/credential-store.cjs'
import authorizationModule from './botgo/shared/authorize.cjs'
import gatewayModule from './botgo/gateway.cjs'
import configModule from './botgo/config.cjs'
import { initializeBotGoUpdates, botGoUpdateState, checkBotGoUpdates, applyBotGoUpdate } from './botgo-updates'
import { initializeBotGoWeixin, restoreBotGoWeixin } from './botgo-weixin'
import { initializeBotGoQq, restoreBotGoQq } from './botgo-qq'

const fixtureMode = !app.isPackaged && process.env.BOTGO_HERMES_UI_FIXTURE === '1'
const fixtureOrigin = process.env.BOTGO_HERMES_FIXTURE_ORIGIN || ''
if (fixtureMode && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureOrigin)) throw Error('Invalid UI fixture origin')
const origin = fixtureMode ? fixtureOrigin : 'https://botgo.win'
const output = path.dirname(fileURLToPath(import.meta.url))
const accountPage = path.join(output, 'botgo-account.html')
const root = process.env.BOTGO_PROFILE_ROOT!
const bootHome = process.env.HERMES_HOME
const storage = credentialsModule.createCredentialStore({ filePath: path.join(root, 'device.enc'), safeStorage })
let gateway: Awaited<ReturnType<typeof gatewayModule.createGateway>> | undefined
let authorization: Awaited<ReturnType<typeof authorizationModule.beginAuthorization>> | undefined
let accountWindow: BrowserWindow | undefined
let status = 'signed-out'
let message = ''
let connecting = false
let accepted: (() => void) | undefined
let account: { email?: string; balanceMicros?: number } = {}
let accountRefreshedAt = 0
let accountRefresh: Promise<void> | undefined

function trusted(event: Electron.IpcMainInvokeEvent) {
  const value = event.senderFrame?.url
  if (!value?.startsWith('file:')) throw Error('Untrusted account request')
  const file = fileURLToPath(new URL(value).origin === 'null' ? value.split('?')[0].split('#')[0] : value)
  if (![accountPage, path.join(output, 'index.html')].includes(file)) throw Error('Untrusted account request')
}
function state() { return { status, message, ...account, updates: botGoUpdateState(), models: gateway?.catalog.map(m => ({ id: m.id, name: m.name })) || [] } }
function notify() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const url = win.webContents.getURL()
    if (!url.startsWith('file:')) continue
    try {
      const file = fileURLToPath(url.split('?')[0].split('#')[0])
      if ([accountPage, path.join(output, 'index.html')].includes(file)) win.webContents.send('botgo:changed', state())
    } catch { /* A window still navigating does not receive account data. */ }
  }
}
function safeError(error: unknown) {
  const code = (error as { status?: number; code?: string }).status
  return code === 401 ? '登录已失效，请重新登录。' : code === 402 ? '余额不足，请前往 BotGo 充值。' : '连接未完成，请检查网络后重试。'
}
export function showBotGoAccount() {
  if (accountWindow && !accountWindow.isDestroyed()) { accountWindow.show(); accountWindow.focus(); return }
  accountWindow = new BrowserWindow({ width: 580, height: 640, minWidth: 400, minHeight: 600,
    title: 'BotGo · 账户', autoHideMenuBar: true, backgroundColor: '#101114',
    icon: path.join(output, 'botgo.ico'),
    webPreferences: { preload: path.join(output, 'botgo-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  accountWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  accountWindow.webContents.on('will-navigate', event => event.preventDefault())
  accountWindow.on('closed', () => { accountWindow = undefined; if (status !== 'ready') app.quit() })
  void accountWindow.loadFile(accountPage)
}
async function connect(credential: { deviceToken: string; desktopKey?: string }) {
  status = 'connecting'; message = ''; notify()
  const localKey = /^[a-f0-9]{64}$/.test(credential.desktopKey || '') ? credential.desktopKey! : crypto.randomBytes(32).toString('hex')
  // Local capability survives a normal restart; upstream/device credentials stay encrypted.
  storage.save({ ...credential, desktopKey: localKey })
  const portFile = path.join(root, 'gateway-port.json')
  const port = fs.existsSync(portFile) ? JSON.parse(fs.readFileSync(portFile, 'utf8')).port : 0
  gateway = await gatewayModule.createGateway({ origin, deviceToken: credential.deviceToken, token: localKey, port })
  account = gateway.account()
  accountRefreshedAt = Date.now()
  const id = crypto.createHash('sha256').update(account.email!.toLowerCase()).digest('hex').slice(0, 24)
  const home = path.join(root, 'accounts', id)
  configModule.writeManagedConfig(home, gateway)
  fs.writeFileSync(portFile, JSON.stringify({ port: gateway.port }))
  process.env.HERMES_HOME = home
  fs.writeFileSync(path.join(root, 'active-account.json'), JSON.stringify({ id }))
  process.env.BOTGO_HERMES_API_KEY = localKey
  status = 'ready'; message = ''; notify()
}
export async function initializeBotGoAccount(lifecycle: { isBusy: () => boolean; restart: () => Promise<void>; install: () => Promise<unknown> }) {
  ipcMain.handle('botgo:state', async (event, force?: boolean) => {
    trusted(event)
    if (status === 'ready' && (force === true || Date.now() - accountRefreshedAt > 30000)) {
      accountRefresh ??= (async () => {
      try {
        const saved = storage.load()
        const result = await fetch(origin + '/api/desktop/account', { redirect: 'error',
          headers: { authorization: 'Bearer ' + saved.deviceToken }, signal: AbortSignal.timeout(20000) })
        if (!result.ok) throw Object.assign(Error('Account request failed'), { status: result.status })
        const value = await result.json()
        account = { email: value.account.email, balanceMicros: value.account.balanceMicros }
        accountRefreshedAt = Date.now(); message = ''; notify()
      } catch (error) { message = safeError(error) }
      })().finally(() => { accountRefresh = undefined })
      await accountRefresh
    }
    return state()
  })
  ipcMain.handle('botgo:open', async (event, target: string) => {
    trusted(event)
    const links: Record<string, string> = { account: '/account.html', recharge: '/recharge.html', help: '/', website: '/' }
    if (target === 'weixin-reference') { await shell.openExternal('https://docs.openclaw.ai/channels/wechat'); return }
    if (!(target in links)) throw Error('Unsupported destination')
    await shell.openExternal(origin + links[target])
  })
  ipcMain.handle('botgo:account', event => { trusted(event); showBotGoAccount() })
  ipcMain.handle('botgo:updates:check', async event => { trusted(event); return checkBotGoUpdates() })
  ipcMain.handle('botgo:updates:install', async event => { trusted(event); return lifecycle.install() })
  ipcMain.handle('botgo:login', async event => {
    trusted(event)
    if (connecting || authorization || status === 'ready') return state()
    connecting = true
    try {
      const saved = storage.load()
      if (saved) {
        try { await connect(saved); accepted?.(); return state() }
        catch (error) { if ((error as { status?: number }).status !== 401) throw error; storage.clear() }
      }
      status = 'connecting'; notify()
      authorization = await authorizationModule.beginAuthorization({ origin, save: (value: { deviceToken: string }) => storage.save(value) })
      status = 'waiting'; notify()
      await shell.openExternal(authorization.url)
      void authorization.done.then(async () => {
        await connect(storage.load()); accepted?.()
      }).catch(error => { status = 'error'; message = safeError(error); notify() }).finally(() => { authorization = undefined })
    } catch (error) { status = 'error'; message = safeError(error); notify() }
    finally { connecting = false }
    return state()
  })
  ipcMain.handle('botgo:logout', async event => {
    trusted(event)
    const saved = storage.load()
    if (saved) {
      const result = await fetch(origin + '/api/desktop/revoke', { method: 'POST', redirect: 'error', headers: { authorization: 'Bearer ' + saved.deviceToken }, signal: AbortSignal.timeout(20000) })
      if (!result.ok && result.status !== 401) throw Error('退出失败，请重试。')
    }
    await gateway?.close(); gateway = undefined
    storage.clear(); app.relaunch(); app.quit()
  })
  app.once('before-quit', () => { authorization?.cancel(); void gateway?.close() })
  try {
    if (fixtureMode && !storage.load()) storage.save({ deviceToken: 'bgdt_fixture' })
    const saved = storage.load()
    if (saved) await connect(saved)
  } catch (error) { status = 'error'; message = safeError(error); if ((error as { status?: number }).status === 401) storage.clear() }
  if (status !== 'ready') {
    await new Promise<void>(resolve => { accepted = resolve; showBotGoAccount() })
    accountWindow?.hide()
    app.once('browser-window-created', (_event, win) => { if (win !== accountWindow) setImmediate(() => accountWindow?.close()) })
  }
  if (bootHome !== process.env.HERMES_HOME) {
    await gateway?.close(); gateway = undefined
    app.relaunch(); app.exit(0)
    await new Promise<void>(() => {})
  }
  restoreBotGoWeixin()
  restoreBotGoQq()
  initializeBotGoQq(trusted, lifecycle.isBusy, lifecycle.restart)
  initializeBotGoWeixin(trusted, lifecycle.isBusy, lifecycle.restart)
  if (!fixtureMode) initializeBotGoUpdates(() => storage.load()?.deviceToken, lifecycle.isBusy, async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)(process.env.HERMES_DESKTOP_PYTHON!, ['-m', 'hermes_cli.main', 'gateway', 'stop'], { cwd: process.env.HERMES_DESKTOP_HERMES_ROOT, env: process.env, windowsHide: true, timeout: 60000 })
  }, lifecycle.install)
  // The account shortcut does not replace Hermes' native application menu.
  app.on('browser-window-created', (_event, win) => win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'b' && input.type === 'keyDown') { event.preventDefault(); showBotGoAccount() }
  }))
}
