"""Native keyless TTS probe, synthetic Chinese text, no playback or messaging."""
import faulthandler
import json
from pathlib import Path
from hermes_constants import get_hermes_home
from hermes_cli.config import load_config, save_config
faulthandler.dump_traceback_later(180, exit=True)
cfg = load_config()
cfg['tts'] = {'provider': 'edge', 'edge': {'voice': 'zh-CN-XiaoxiaoNeural'}}
save_config(cfg)
from tools.tts_tool import text_to_speech_tool
result = json.loads(text_to_speech_tool('你好，这是 BotGo 的语音测试。', output_path=str(get_hermes_home() / 'botgo-audio-test.mp3')))
if result.get('success'):
    file = Path(result['file_path'])
    assert file.is_file() and file.stat().st_size > 1000
    result['bytes'] = file.stat().st_size
(get_hermes_home() / 'tts-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
faulthandler.cancel_dump_traceback_later()
raise SystemExit(0 if result.get('success') else 1)
