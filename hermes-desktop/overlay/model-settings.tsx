import { useEffect, useState } from 'react'
import { getGlobalModelOptions, getGlobalModelInfo } from '@/hermes'
import { Button } from '@/components/ui/button'

interface Props { scopeProfile?: string; subpage?: string; onMainModelChanged?: (provider: string, model: string) => void }
export function BotGoModelSettings({ scopeProfile, onMainModelChanged }: Props) {
  const [models,setModels]=useState<{provider:string;id:string}[]>([])
  const [selected,setSelected]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{let live=true;setStatus('');Promise.all([getGlobalModelOptions(undefined,scopeProfile),getGlobalModelInfo(scopeProfile)]).then(([catalog,info])=>{
    if(!live)return
    const rows=catalog.providers.filter(p=>/^(custom:)?botgo-(chat|responses)$/.test(p.slug)).flatMap(p=>(p.models??[]).map(id=>({provider:p.slug,id})))
    setModels(rows);setSelected(rows.find(r=>r.id===info.model)?.id??rows[0]?.id??'')
  }).catch(()=>{if(live)setStatus('模型暂时无法加载')});return()=>{live=false}},[scopeProfile])
  const save=async()=>{const model=models.find(m=>m.id===selected);if(!model)return;setBusy(true);try{
    await window.hermesDesktop.api({path:'/api/model/set',method:'POST',profile:scopeProfile,body:{scope:'main',provider:model.provider,model:model.id}})
    onMainModelChanged?.(model.provider,model.id);setStatus('已保存')
  }catch{setStatus('保存失败，请重试')}finally{setBusy(false)}}
  return <section className="grid gap-4"><label htmlFor="botgo-model" className="text-sm font-medium">默认模型</label><select id="botgo-model" className="h-10 rounded border border-border bg-background px-3 text-sm" value={selected} onChange={e=>setSelected(e.target.value)}>{models.map(m=><option key={m.provider+':'+m.id} value={m.id}>{m.id}</option>)}</select><div><Button disabled={busy||!selected} onClick={()=>void save()}>保存</Button></div>{status&&<p role="status" className="text-xs text-muted-foreground">{status}</p>}</section>
}
