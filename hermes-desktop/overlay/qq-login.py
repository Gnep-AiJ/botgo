"""Expose the native QQ registration flow over the private Electron pipe."""
import contextlib
import json
import os
import sys
from plugins.platforms.qqbot import onboard

wire = sys.stdout
def emit(value):
    wire.write(json.dumps(value, ensure_ascii=False) + "\n")
    wire.flush()
def show_qr(url):
    emit({"event": "qr", "url": url})
    return True
onboard._render_qr = show_qr
try:
    with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):
        credentials = onboard.qr_register()
    if not credentials or not credentials.get("user_openid"):
        emit({"event": "error", "code": "LOGIN_NOT_COMPLETED"})
        raise SystemExit(1)
    emit({"event": "credentials", "credentials": credentials})
except Exception:
    emit({"event": "error", "code": "LOGIN_FAILED"})
    raise SystemExit(1)
