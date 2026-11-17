"""Real local memory/identity behavior in an isolated home, no model requests."""
import json
from pathlib import Path
from hermes_constants import get_hermes_home
from hermes_cli.config import load_config, _ensure_default_soul_md
from hermes_cli.default_soul import DEFAULT_SOUL_MD, _LEGACY_TEMPLATE_SOULS
from tools.memory_tool import memory_tool, load_on_disk_store

cfg = load_config()
assert cfg['memory']['memory_enabled'] and cfg['memory']['user_profile_enabled']
assert cfg['auxiliary']['background_review']['enabled'] and cfg['compression']['enabled']
home = get_hermes_home()
home.mkdir(parents=True, exist_ok=True)
soul = home / 'SOUL.md'
soul.write_text(_LEGACY_TEMPLATE_SOULS[-1], encoding='utf-8')
_ensure_default_soul_md(home)
assert soul.read_text(encoding='utf-8') == DEFAULT_SOUL_MD
assert DEFAULT_SOUL_MD.startswith('You are BotGo')
soul.write_text('Custom synthetic identity: speaks briefly.', encoding='utf-8')
_ensure_default_soul_md(home)
assert soul.read_text(encoding='utf-8') == 'Custom synthetic identity: speaks briefly.'
store = load_on_disk_store()
for target, text in [('memory', 'Synthetic test project uses blue circles.'), ('user', 'Synthetic test preference: concise replies.')]:
    result = json.loads(memory_tool('add', target=target, content=text, store=store))
    assert result.get('success'), result
reloaded = load_on_disk_store()
assert any('blue circles' in x for x in reloaded.memory_entries)
assert any('concise replies' in x for x in reloaded.user_entries)
print('Native memory/user profile disk persistence, seed migration, custom SOUL preservation and enabled defaults passed')
