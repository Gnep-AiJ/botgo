"""Validate sealed PM through its native launch contract, then native TTS."""
import json
from pathlib import Path
import subprocess
from hermes_constants import get_hermes_home
from pm.runtime import runtime_command, runtime_environment, _resident_runtime
from hermes_cli.config import load_config, save_config

home = get_hermes_home()
home.mkdir(parents=True, exist_ok=True)
resident = _resident_runtime()
assert resident and resident[0].is_file() and resident[1].is_dir()
probe = home / 'pm-probe.py'
probe.write_text('import packaging, tomli_w, truststore; from ruamel.yaml import YAML\nprint("PM_IMPORTS_OK")\n', encoding='utf-8')
checked = subprocess.run(runtime_command(probe, bootstrap=False), env=runtime_environment(),
    capture_output=True, text=True, timeout=30, check=True)
assert 'PM_IMPORTS_OK' in checked.stdout
cfg = load_config()
cfg['tts'] = {'provider': 'botgo-windows'}
save_config(cfg)
from tools.tts_tool import text_to_speech_tool
result = json.loads(text_to_speech_tool('你好，这是 BotGo 安装包语音测试。', output_path=str(home / 'packaged.wav')))
assert result.get('success'), result
(home / 'result.json').write_text(json.dumps({'passed': True, 'nativePmLaunchValidated': True, **result}, ensure_ascii=False), encoding='utf-8')
print('PACKAGED_TTS_AND_NATIVE_PM_PASSED')
