"""Stage Hermes' independently locked PM graph for the native payload."""
import os
import sys
import subprocess
import tomllib
import importlib.metadata
from pathlib import Path
root = Path(__file__).resolve().parent.parent
repo = root / 'artifacts/hermes'
sys.path.insert(0, str(repo))
os.environ['HERMES_RUNTIME_DIR'] = str(root / 'artifacts/hermes-tools')
os.environ['HERMES_HOME'] = str(root / 'artifacts/verification/hermes-capabilities-20261023/pm-build')
from pm import stage_manager_runtime
from pm.runtime import _validate
destination = root / 'artifacts/hermes-pm-runtime'
python = next((root / 'artifacts/hermes-tools').glob('python-*/python.exe'))
# Edge is the native keyless default. Bundle its tiny SDK closure so a first
# audio request does not replace the running application's dependency graph.
locked = {p['name']: p['version'] for p in tomllib.loads((repo / 'uv.lock').read_text(encoding='utf-8'))['package']}
requirements = []
for name in ('edge-tts', 'tabulate'):
    try:
        installed = importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        installed = None
    if installed != locked[name]:
        requirements.append(name + '==' + locked[name])
if requirements:
    uv = next((root / 'artifacts/hermes-tools').glob('uv-*/uv.exe'))
    subprocess.run([str(uv), 'pip', 'install', '--python', sys.executable, '--no-deps',
                    '--cache-dir', str(root / 'artifacts/cache/uv'), *requirements], check=True)
if destination.exists():
    error = _validate(destination / 'Scripts/python.exe', os.environ.copy())
    if error:
        raise RuntimeError('Existing prepared PM runtime failed validation: ' + error)
else:
    stage_manager_runtime(python=python, destination=destination, project=repo / 'pm', cache=root / 'artifacts/cache/uv')
print('Prepared independently locked Hermes PM runtime')
