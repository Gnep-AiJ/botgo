import { app, ipcMain, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import QRCode from 'qrcode'
import configModule from './botgo/config.cjs'

interface WeixinCredential { account_id: string; token: string; base_url: string; user_id: string }
interface WeixinState { status: string; qr?: string; accountId?: string; message?: string }
let state: WeixinState = { status: 'disconnected' }
let worker: ChildProcess | undefined
function credentialFile() { return path.join(process.env.HERMES_HOME!, 'botgo-weixin.enc') }
function inject(value: WeixinCredential) {
  process.env.WEIXIN_ACCOUNT_ID = value.account_id; process.env.WEIXIN_TOKEN = value.token
  process.env.WEIXIN_BASE_URL = value.base_url; process.env.WEIXIN_DM_POLICY = 'allowlist'
  process.env.WEIXIN_ALLOWED_USERS = value.user_id; process.env.WEIXIN_ALLOW_ALL_USERS = 'false'
  process.env.WEIXIN_GROUP_POLICY = 'disabled'; process.env.WEIXIN_HOME_CHANNEL = value.user_id
}
export function restoreBotGoWeixin() {
  const file = credentialFile()
  if (!fs.existsSync(file)) return
  const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as WeixinCredential
  inject(value); state = { status: 'saved', accountId: value.account_id, message: '凭证已保存；渠道状态请在下方刷新确认。' }
}
export function initializeBotGoWeixin(trusted: (event: Electron.IpcMainInvokeEvent) => void, isBusy: () => boolean, restart: () => Promise<void>) {
  ipcMain.handle('botgo:weixin:state', event => { trusted(event); return state })
  ipcMain.handle('botgo:weixin:cancel', event => { trusted(event); worker?.kill(); worker = undefined; state = { status: 'cancelled' }; return state })
  ipcMain.handle('botgo:weixin:disconnect', async event => {
    trusted(event)
    if (isBusy()) return { status: 'busy', message: '请等待当前任务结束后再断开微信。' }
    worker?.kill(); worker = undefined
    if (fs.existsSync(credentialFile())) fs.unlinkSync(credentialFile())
    for (const key of ['WEIXIN_ACCOUNT_ID', 'WEIXIN_TOKEN', 'WEIXIN_BASE_URL', 'WEIXIN_DM_POLICY', 'WEIXIN_ALLOWED_USERS', 'WEIXIN_ALLOW_ALL_USERS', 'WEIXIN_GROUP_POLICY', 'WEIXIN_HOME_CHANNEL']) delete process.env[key]
    configModule.setPlatformEnabled(process.env.HERMES_HOME!,'weixin',false)
    await restart(); state = { status: 'disconnected', message: '已断开' }; return state
  })
  ipcMain.handle('botgo:weixin:start', event => {
    trusted(event)
    if (worker) return state
    if (isBusy()) return { status: 'busy', message: '请等待当前任务结束后再连接微信。' }
    state = { status: 'starting' }
    const code = app.isPackaged ? path.join(process.resourcesPath, 'botgo', 'weixin-login.py') : path.join(path.dirname(fileURLToPath(import.meta.url)), 'weixin-login.py')
    const child = spawn(process.env.HERMES_DESKTOP_PYTHON!, [code], { cwd: process.env.HERMES_DESKTOP_HERMES_ROOT, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    worker = child; let buffer = ''; let completed = false
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', async chunk => {
      buffer += chunk
      if (buffer.length > 65536) { child.kill(); state = { status: 'error', message: '微信响应异常，请重试。' }; return }
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        try {
          const value = JSON.parse(line)
          if (value.event === 'qr' && worker === child) {
            const url = new URL(value.url)
            if (url.protocol !== 'https:' || !/(^|\.)weixin\.qq\.com$/.test(url.hostname)) throw Error('Invalid QR URL')
            state = { status: 'qr', qr: await QRCode.toDataURL(value.url, { width: 240, margin: 2 }), message: '二维码已生成，请用微信扫码并确认。' }
          } else if (value.event === 'credentials' && worker === child) {
            const c = value.credentials as WeixinCredential
            if (!c.token || !c.user_id || !c.account_id || c.account_id.length > 256) throw Error('Missing QR identity')
            const url = new URL(c.base_url)
            if (url.protocol !== 'https:' || !/(^|\.)weixin\.qq\.com$/.test(url.hostname)) throw Error('Invalid Weixin endpoint')
            if (!safeStorage.isEncryptionAvailable()) throw Error('OS encryption unavailable')
            fs.writeFileSync(credentialFile(), safeStorage.encryptString(JSON.stringify(c)))
            inject(c); configModule.setPlatformEnabled(process.env.HERMES_HOME!,'weixin',true); completed = true
            state = { status: 'saved', accountId: c.account_id, message: '凭证已保存，正在重启本机渠道。' }
            if (isBusy()) { state.message = '凭证已保存，请在任务结束后从渠道页面重启。'; continue }
            await restart()
            state = { status: 'saved', accountId: c.account_id, message: '凭证已保存。请刷新下方微信渠道状态，再发送一条消息验收。' }
          } else if (value.event === 'error') state = { status: 'error', message: '微信登录未完成，请重新生成二维码。' }
        } catch { state = { status: 'error', message: '微信连接未完成，请重试。' } }
      }
    })
    child.once('error', () => { state = { status: 'error', message: '微信组件未能启动。' }; if (worker === child) worker = undefined })
    child.once('exit', () => { if (!completed && !['cancelled', 'error'].includes(state.status)) state = { status: 'error', message: '二维码已失效或登录已取消，请重试。' }; if (worker === child) worker = undefined })
    return state
  })
  app.once('before-quit', () => worker?.kill())
}
