import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface WeixinState { status: string; qr?: string; accountId?: string; message?: string }
interface BotGoApi { weixinState: () => Promise<WeixinState>; weixinStart: () => Promise<WeixinState>; weixinCancel: () => Promise<WeixinState>; weixinDisconnect: () => Promise<WeixinState>; open: (target: string) => Promise<void> }
export function BotGoWeixinPanel() {
  const [state, setState] = useState<WeixinState>({ status: 'disconnected' })
  const api = (window as unknown as { botgo: BotGoApi }).botgo
  const busy = ['starting', 'qr'].includes(state.status)
  useEffect(() => {
    let live = true
    const poll = () => api.weixinState().then(value => { if (live) setState(value) }).catch(() => undefined)
    void poll(); const timer = setInterval(() => { void poll() }, 1500)
    return () => { live = false; clearInterval(timer) }
  }, [api])
  const start = () => api.weixinStart().then(setState).catch(() => setState({ status: 'error', message: '微信连接未能启动，请重试。' }))
  return <section className="shrink-0 border-b border-(--ui-stroke-secondary) px-5 py-4" aria-label="微信 ClawBot">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-sm font-semibold">微信 ClawBot</h2><p className="mt-1 text-xs text-muted-foreground">微信发任务，电脑来执行。</p></div>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => { void start() }}>{state.status === 'saved' ? '重新扫码连接' : '扫码连接微信'}</Button>{state.status === 'saved' && <Button variant="outline" onClick={() => { void api.weixinDisconnect().then(setState) }}>断开微信</Button>}<Button variant="text" onClick={() => { void api.open('weixin-reference') }}>接入参考</Button></div>
    </div>
    {(state.message || state.status === 'starting') && <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">{state.message || '正在生成二维码…'}</p>}
    {state.qr && <div className="mt-3 flex flex-wrap items-center gap-5"><img src={state.qr} alt="使用微信扫描此二维码" width="200" height="200" className="bg-white"/><div className="space-y-3"><p className="text-xs text-muted-foreground">请使用微信扫码，并在手机确认。<br/>仅允许扫码者私聊使用；本机需保持运行。</p><Button variant="outline" onClick={() => { void api.weixinCancel().then(setState) }}>取消扫码</Button></div></div>}
  </section>
}
