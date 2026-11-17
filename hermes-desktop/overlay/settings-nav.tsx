import { useState } from 'react'
import type { OverlayNavGroup } from '../overlays/overlay-split-layout'
const MAIN = ['billing', 'config:model', 'config:chat', 'config:appearance', 'config:memory', 'config:safety', 'about']
const labels: Record<string,string> = {'billing':'账户','config:model':'模型','config:chat':'对话','config:appearance':'外观','config:memory':'记忆','config:safety':'安全','about':'关于','config:browser':'浏览器','vault':'密码与登录','keybinds':'快捷键','config:workspace':'工作区','notifications':'通知'}
export function BotGoSettingsNav({groups}: {groups: OverlayNavGroup[]}) {
  const [advanced, setAdvanced] = useState(false)
  const render = (group: OverlayNavGroup) => <div key={group.id}><button type="button" className="botgo-nav-item" aria-current={group.active ? 'page' : undefined} onClick={group.onSelect}><group.icon className="size-4"/><span>{labels[group.id] || group.label}</span></button>{group.active && group.children && group.children.length > 1 && <div className="botgo-subnav">{group.children.map(child => <button type="button" key={child.id} aria-current={child.active ? 'page' : undefined} onClick={child.onSelect}>{child.label}</button>)}</div>}</div>
  const extra = groups.filter(g => !MAIN.includes(g.id))
  return <nav className="botgo-settings-nav" aria-label="设置分类"><div className="botgo-nav-heading">设置</div>{MAIN.flatMap(id => { const group = groups.find(g=>g.id===id); return group ? [render(group)] : [] })}<button type="button" className="botgo-nav-more" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>更多设置 <span aria-hidden="true">{advanced ? '−' : '+'}</span></button>{(advanced || extra.some(g=>g.active)) && extra.map(render)}</nav>
}
