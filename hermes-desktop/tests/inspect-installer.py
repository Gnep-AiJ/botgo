"""Read-only installer/ZIP inspection; extract the embedded archive as evidence."""
from collections import Counter
import json
from pathlib import Path
import struct
import zipfile

root = Path(__file__).resolve().parents[2]
directory = root / 'artifacts/verification/hermes-capabilities-20261023/zip-inspect'
directory.mkdir(parents=True, exist_ok=True)
source = root / 'artifacts/releases/hermes-preview-polish/BotGo-2.0.0-preview.5-win-x64.exe'
with source.open('rb') as handle:
    length = source.stat().st_size
    begin = max(0, length - 2 * 1024 * 1024)
    handle.seek(begin)
    tail = handle.read()
    position = begin + tail.rfind(b'PK\x05\x06')
    handle.seek(position)
    fields = struct.unpack('<4s4H2LH', handle.read(22))
    count, cd_size, cd_offset, comment = fields[4:]
    offset = position - cd_size - cd_offset
    size = position + 22 + comment - offset
    assert offset > 0 and size > 0
    handle.seek(offset)
    archive = directory / 'embedded.zip'
    remaining = size
    with archive.open('wb') as output:
        while remaining:
            chunk = handle.read(min(16 * 1024 * 1024, remaining))
            assert chunk
            output.write(chunk)
            remaining -= len(chunk)
with zipfile.ZipFile(archive) as archive:
    entries = archive.infolist()
    report = {'offset': offset, 'bytes': size, 'entries': len(entries),
              'methods': dict(Counter(item.compress_type for item in entries)),
              'encrypted': sum(bool(item.flag_bits & 1) for item in entries),
              'longest': max((len(item.filename), item.filename) for item in entries),
              'uncompressed': sum(item.file_size for item in entries)}
(directory / 'metadata.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
