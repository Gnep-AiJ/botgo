"""Transport the native Hermes QR workflow to the private Electron process."""
import asyncio
import contextlib
import json
import os
import sys
from plugins.platforms.weixin import adapter

wire = sys.stdout

def emit(value):
    wire.write(json.dumps(value, ensure_ascii=False) + '\n')
    wire.flush()

def show_qr(_value, url, **_kwargs):
    emit({'event': 'qr', 'url': url})

# Native qr_login normally saves a plaintext account JSON. Electron owns the
# encrypted account instead; the native adapter receives it through its normal env.
adapter._print_qr = show_qr
adapter.save_weixin_account = lambda *args, **kwargs: None

async def main():
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet):
        credentials = await adapter.qr_login(os.environ['HERMES_HOME'])
    if not credentials:
        emit({'event': 'error', 'code': 'LOGIN_NOT_COMPLETED'})
        return 1
    if not credentials.get('user_id'):
        emit({'event': 'error', 'code': 'SCANNER_ID_REQUIRED'})
        return 1
    emit({'event': 'credentials', 'credentials': credentials})
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception:
        emit({'event': 'error', 'code': 'LOGIN_FAILED'})
        raise SystemExit(1)
