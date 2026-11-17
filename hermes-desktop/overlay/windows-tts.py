"""Native offline Windows speech provider; produces a file, never speaker audio."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

from agent.tts_provider import TTSProvider


class BotGoWindowsTTS(TTSProvider):
    name = "botgo-windows"
    display_name = "BotGo"

    def is_available(self):
        return os.name == "nt" and self._powershell().is_file()

    @staticmethod
    def _powershell():
        return Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"

    def synthesize(self, text, output_path, *, voice=None, model=None, speed=None, format="wav", **extra):
        if not self.is_available():
            raise RuntimeError("本机语音合成仅支持 Windows。")
        if not isinstance(text, str) or not text.strip() or len(text) > 20000:
            raise ValueError("语音文本需要 1–20000 个字符。")
        output = Path(output_path).resolve().with_suffix(".wav")
        output.parent.mkdir(parents=True, exist_ok=True)
        # User text/voice/path are JSON data, never interpolated into shell code.
        request = {"text": text, "output": str(output), "voice": voice,
                   "rate": max(-5, min(5, round(((speed or 1) - 1) * 5)))}
        with tempfile.TemporaryDirectory(prefix="botgo-speech-") as directory:
            payload = Path(directory) / "request.json"
            payload.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
            result = subprocess.run([str(self._powershell()), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", str(Path(__file__).with_name("synthesize.ps1")), str(payload)],
                capture_output=True, timeout=90, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode:
            raise RuntimeError("本机语音生成失败，请检查 Windows 语音包及所选声音。")
        if not output.is_file() or output.stat().st_size <= 44:
            raise RuntimeError("本机未生成有效音频文件。")
        with output.open("rb") as audio:
            if audio.read(4) != b"RIFF":
                raise RuntimeError("本机未生成有效音频文件。")
        return str(output)


def register(ctx):
    ctx.register_tts_provider(BotGoWindowsTTS())
