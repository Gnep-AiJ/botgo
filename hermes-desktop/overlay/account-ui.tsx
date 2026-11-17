import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $desktopVersion, refreshDesktopVersion } from '@/store/updates'
import { SettingsContent } from './primitives'

interface Account { status?: string; email?: string; balanceMicros?: number; message?: string; models?: unknown[]; updates?: { message?: string; status?: string } }
interface Api { state: (force?: boolean) => Promise<Account>; account: () => Promise<void>; open: (target: string) => Promise<void>; checkUpdates: () => Promise<{message?: string; updateAvailable?: boolean}>; installUpdate: () => Promise<unknown>; onChanged: (fn: (a: Account) => void) => () => void }
const api = () => (window as unknown as {botgo: Api}).botgo
const money = (value?: number) => typeof value === 'number' ? `¥${(value / 1e6).toFixed(4)}` : '—'
function useAccount() {
  const [account, setAccount] = useState<Account>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async (force = false) => {
    setBusy(true)
    try { const next = await api().state(force); setAccount(next); setError(next.message || '') }
    catch { setError('余额暂时无法刷新') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => {
    void refresh()
    const unsubscribe = api().onChanged(setAccount)
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 60000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => { unsubscribe(); clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [refresh])
  return {account, busy, error, refresh}
}
export function BotGoAccountShortcut() {
  const {account, busy, error} = useAccount()
  return <button type="button" className="botgo-account-shortcut" aria-label="账户与余额" title={error || account.email || '账户与余额'} onClick={() => { window.location.hash = '#/settings?tab=billing' }}>
    <span className="botgo-avatar" aria-hidden="true"><img src="./botgo-mark.png" alt="" /></span><span className="botgo-shortcut-label">账户<span>{error ? '刷新失败 · 点击查看' : busy && account.balanceMicros === undefined ? '读取中…' : '可用余额'}</span></span><strong>{money(account.balanceMicros)}</strong><span aria-hidden="true">›</span>
  </button>
}
export const BILLING_VIEWS = ['overview', 'plans'] as const
export type BillingSubView = (typeof BILLING_VIEWS)[number]
export function BillingSettings() {
  const {account, busy, error, refresh} = useAccount()
  return <SettingsContent><div className="botgo-page-heading"><h2>账户</h2><p>{account.email || '正在读取账户…'}</p></div>
    <section className="botgo-balance-card"><span>可用余额</span><strong data-testid="account-balance">{money(account.balanceMicros)}</strong><div className="botgo-account-actions"><button className="botgo-primary" onClick={() => void api().open('recharge')}>充值</button><button className="botgo-secondary" onClick={() => void api().open('account')}>查看账单 ↗</button><button className="botgo-link" disabled={busy} onClick={() => void refresh(true)}>{busy ? '刷新中…' : '刷新余额'}</button></div></section>
    <p className="botgo-feedback" role="status">{error}</p>
    <div className="botgo-setting-card"><strong>登录管理</strong><button className="botgo-secondary" onClick={() => void api().account()}>管理账户</button></div>
  </SettingsContent>
}
export function BotGoAbout() {
  const version = useStore($desktopVersion)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => { void refreshDesktopVersion() }, [])
  const check = async () => { setBusy(true); try { const result = await api().checkUpdates(); setMessage(result.message || '检查完成'); setReady(!!result.updateAvailable) } catch { setMessage('暂时无法检查更新') } finally { setBusy(false) } }
  return <SettingsContent><div className="botgo-page-heading"><h2>BotGo</h2><p>版本 {version?.appVersion || '—'}</p></div><div className="botgo-setting-card"><div><strong>软件更新</strong>{message && <p role="status">{message}</p>}</div><button className="botgo-secondary" disabled={busy} onClick={() => void check()}>{busy ? '检查中…' : '检查更新'}</button></div>{ready && <button className="botgo-primary" onClick={() => void api().installUpdate().catch(() => setMessage('更新未完成，请重试'))}>重启并更新</button>}<button className="botgo-link" onClick={() => void api().open('website')}>botgo.win ↗</button></SettingsContent>
}
