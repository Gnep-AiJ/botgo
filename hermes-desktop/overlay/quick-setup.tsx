import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
interface State { status:string;qr?:string;message?:string }
interface Scan { state:()=>Promise<State>;start:()=>Promise<State>;cancel:()=>Promise<State>;disconnect:()=>Promise<State> }
export function BotGoQuickSetup({platformId,scopeProfile}:{platformId:string;scopeProfile?:string}) {
  const api=(window as unknown as {botgo:{weixinState:Scan['state'];weixinStart:Scan['start'];weixinCancel:Scan['cancel'];weixinDisconnect:Scan['disconnect'];qqState:Scan['state'];qqStart:Scan['start'];qqCancel:Scan['cancel'];qqDisconnect:Scan['disconnect']}}).botgo
  const weixin=platformId==='weixin',scan:Scan=weixin?{state:api.weixinState,start:api.weixinStart,cancel:api.weixinCancel,disconnect:api.weixinDisconnect}:{state:api.qqState,start:api.qqStart,cancel:api.qqCancel,disconnect:api.qqDisconnect}
  const [state,setState]=useState<State>({status:'disconnected'})
  useEffect(()=>{let live=true;setState({status:'disconnected'});const poll=()=>scan.state().then(s=>{if(live)setState(s)}).catch(()=>{});void poll();const timer=setInterval(poll,1500);return()=>{live=false;clearInterval(timer)}},[platformId])
  if(scopeProfile&&scopeProfile!=='default')return <p className="text-xs text-muted-foreground">请切换到默认机器人后连接</p>
  const action=(work:()=>Promise<State>)=>work().then(setState).catch(()=>setState({status:'error',message:'连接失败，请重试'}))
  return <section className="grid justify-items-start gap-4"><div className="flex gap-3"><Button disabled={['starting','qr'].includes(state.status)} onClick={()=>void action(scan.start)}>{state.status==='saved'?'重新连接':'扫码连接'}</Button>{state.status==='saved'&&<Button variant="outline" onClick={()=>void action(scan.disconnect)}>断开</Button>}</div>{state.qr&&<><img src={state.qr} width="216" height="216" alt={weixin?'使用微信扫码':'使用 QQ 扫码'} className="bg-white"/><Button variant="text" onClick={()=>void action(scan.cancel)}>取消</Button></>}{state.message&&<p role="status" className="text-xs text-muted-foreground">{state.message}</p>}</section>
}
