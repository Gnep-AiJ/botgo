"""Bounded real model -> native offline TTS; no delivery or playback."""
import json
import os
from pathlib import Path
import wave
from hermes_cli.config import load_config
from hermes_constants import get_hermes_home
from run_agent import AIAgent

cfg = load_config()
output = get_hermes_home() / 'model-audio-test.wav'
agent = AIAgent(model=cfg['model']['default'], provider=cfg['model']['provider'],
    api_key=os.environ['BOTGO_HERMES_API_KEY'], base_url=cfg['model']['base_url'],
    api_mode=cfg['model']['api_mode'], enabled_toolsets=['tts'],
    session_id='capabilities-native-tts-20261024', quiet_mode=True,
    skip_context_files=True, skip_memory=True, skip_background_review=True,
    max_iterations=3, cwd=str(get_hermes_home()))
result = agent.run_conversation('Call text_to_speech once to synthesize exactly: '
    '你好，这是 BotGo 的语音测试。 Save it to ' + str(output) +
    '. Do not play it, do not send it to anyone. Report the generated path.')
assert output.is_file(), 'Model did not produce the requested audio file'
with wave.open(str(output), 'rb') as audio:
    seconds = audio.getnframes() / audio.getframerate()
    assert seconds > 1
report = {'success': True, 'model': cfg['model']['default'], 'provider': cfg['tts']['provider'],
          'file': str(output), 'bytes': output.stat().st_size, 'seconds': seconds,
          'sentToExternalRecipient': False}
(get_hermes_home() / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
