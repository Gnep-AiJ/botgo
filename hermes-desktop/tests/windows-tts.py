"""Real Unicode/quoting boundary test; no speaker playback or network."""
import importlib.util
import json
from pathlib import Path
import unittest
import wave

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('windows_tts', root / 'artifacts/hermes/plugins/tts/botgo-windows/__init__.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WindowsSpeechTest(unittest.TestCase):
    def test_text_is_data_and_wav_extension_is_truthful(self):
        directory = root / 'artifacts/verification/hermes-capabilities-20261023/tts-quoting'
        directory.mkdir(parents=True, exist_ok=True)
        sentinel = directory / 'injection.txt'
        self.assertFalse(sentinel.exists())
        text = '你好。' + '$(Set-Content -LiteralPath "' + str(sentinel) + '" -Value injected); `中文`'
        output = Path(module.BotGoWindowsTTS().synthesize(text, str(directory / "中文 'quoted'.mp3")))
        self.assertEqual(output.suffix, '.wav')
        self.assertFalse(sentinel.exists(), 'Speech text was interpreted as shell code')
        with wave.open(str(output), 'rb') as audio:
            self.assertGreater(audio.getnframes(), audio.getframerate())

    def test_invalid_input_rejected(self):
        for text in ['', ' ' * 10, 'x' * 20001]:
            with self.assertRaises(ValueError):
                module.BotGoWindowsTTS().synthesize(text, 'unused.wav')


if __name__ == '__main__':
    unittest.main()
