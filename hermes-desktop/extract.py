"""Extract the pinned upstream; keep the archive as the pristine source of truth."""
import json
from pathlib import Path, PurePosixPath
import zipfile

root = Path(__file__).resolve().parent.parent
pin = json.loads((root / 'hermes-desktop/upstream.json').read_text())
out = root / pin['source']
with zipfile.ZipFile(root / pin['archive']) as archive:
    for entry in archive.infolist():
        parts = PurePosixPath(entry.filename).parts
        if parts[0] != 'hermes-agent-' + pin['commit'] or '..' in parts:
            raise ValueError('Unexpected archive entry')
        parts = parts[1:]
        if not parts or parts[0] in ('website', '.github'):
            continue
        target = out.joinpath(*parts)
        # Extended paths are necessary for Hermes bundled skill names on Windows.
        target = Path('\\\\?\\' + str(target))
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_bytes(archive.read(entry))
print(out)
