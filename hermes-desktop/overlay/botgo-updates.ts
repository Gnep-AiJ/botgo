import { app, dialog } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import updaterModule from './botgo/shared/updater.cjs'
import channelModule from './botgo/update-channel.cjs'
const exec = promisify(execFile)
let updater: ReturnType<typeof updaterModule.createUpdater> | undefined
let guard = () => false
export function initializeBotGoUpdates(deviceToken: () => string, isBusy: () => boolean, stop: () => Promise<void>, install: () => Promise<unknown>) {
  guard = isBusy
  updater = updaterModule.createUpdater({
    currentVersion: app.getVersion(), origin: 'https://botgo.win',
    directory: path.join(process.env.BOTGO_PROFILE_ROOT!, 'updates'), deviceToken,
    fetchImpl: channelModule.updateFetch(),
    verifySignature: async file => {
      const verifier = app.isPackaged ? path.join(process.resourcesPath, 'botgo', 'verify-signature.ps1') : path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-signature.ps1')
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', verifier, '-FilePath', file], { windowsHide: true, timeout: 30000 })
    },
    stop: async () => { if (guard()) throw Error('请等待当前任务结束后再更新。'); await stop() },
    launch: async file => {
      const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true })
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      child.unref(); app.quit()
    },
  })
  const check = async () => {
    if (guard()) return
    const result = await updater!.check()
    if (result.status === 'ready') {
      const choice = await dialog.showMessageBox({ type: 'info', title: 'BotGo 更新', message: `BotGo ${result.version} 已下载并通过签名校验。`, buttons: ['稍后', '重启并更新'], defaultId: 0, cancelId: 0 })
      if (choice.response === 1 && !guard()) await install()
    }
  }
  void check().catch(() => undefined)
  const timer = setInterval(() => { void check().catch(() => undefined) }, 6 * 60 * 60 * 1000)
  timer.unref(); app.once('before-quit', () => { clearInterval(timer); updater?.cancel() })
}
export function botGoUpdateState() { return updater?.getState() || { status: 'idle' } }
export async function checkBotGoUpdates() {
  if (!updater) return { supported: false, mechanism: 'external' as const, message: '登录 BotGo 后可检查更新。' }
  const state = await updater.check()
  return { supported: true, mechanism: 'external' as const, updateAvailable: state.status === 'ready', currentVersion: app.getVersion(), latestTag: state.version || null, message: state.message || (state.status === 'up-to-date' ? '当前已是最新版本。' : state.status === 'ready' ? '已下载并通过签名校验。' : '正在检查更新。'), ...(state.status === 'error' ? { error: 'BOTGO_UPDATE_UNAVAILABLE' } : {}) }
}
export async function applyBotGoUpdate() {
  if (!updater || guard()) return { ok: false, message: '请等待当前任务结束后再更新。' }
  try { await updater.install(); return { ok: true, handedOff: true } }
  catch { return { ok: false, message: '更新未完成，请重新检查。' } }
}
