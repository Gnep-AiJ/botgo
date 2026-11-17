import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsContent, SettingsSection } from '../primitives'
import { CreditCard } from '@/lib/icons'

interface Account { email?: string; balanceMicros?: number; message?: string }
export const BILLING_VIEWS = ['overview', 'plans'] as const
export type BillingSubView = (typeof BILLING_VIEWS)[number]
export function BillingSettings() {
  const [account, setAccount] = useState<Account>({})
  const [error, setError] = useState('')
  const api = (window as unknown as { botgo: { state: () => Promise<Account>; account: () => Promise<void>; open: (target: string) => Promise<void> } }).botgo
  const refresh = () => api.state().then(setAccount).catch(() => setError('账户暂时无法连接，请重试。'))
  useEffect(() => { void refresh() }, [])
  return <SettingsContent><SettingsSection title="BotGo 账户与计费" icon={CreditCard}>
    <p className="text-sm text-muted-foreground">{account.email || '正在读取账户…'}</p>
    <p className="text-2xl tabular-nums">{typeof account.balanceMicros === 'number' ? `¥${(account.balanceMicros / 1e6).toFixed(4)}` : '—'}</p>
    <p role="status">{error || account.message}</p>
    <div className="flex flex-wrap gap-4"><Button onClick={() => { void refresh() }}>刷新余额</Button><Button onClick={() => { void api.open('account') }}>充值与账单</Button><Button variant="outline" onClick={() => { void api.account() }}>管理登录</Button></div>
  </SettingsSection></SettingsContent>
}
