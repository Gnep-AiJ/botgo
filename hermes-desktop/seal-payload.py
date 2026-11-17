"""Publish the bundled dependency selection using Hermes' sealed-payload contract."""
import json
import sys
from pathlib import Path

payload = Path(sys.argv[1]).resolve()
runtime = json.loads((payload / "runtime.json").read_text(encoding="utf-8"))
repo = payload / "hermes-agent"
environment = payload / "venv"
site = environment / "Lib" / "site-packages"
if not site.is_dir():
    raise RuntimeError("Packaged dependency environment is missing")
sys.path.insert(0, str(repo))
from scripts.build.inputs import project_entries
from scripts.build.launchers import write_launchers
from scripts.bundles.payload import seal_pm_runtime
from pm.features import installed_extras, write_features

# Optional SDKs/plugins need the native independent PM, even when the agent
# itself already starts from the sealed dependency environment.
seal_pm_runtime(payload, payload / runtime['python'])
write_features(installed_extras(repo, environment, python_exe=payload / runtime['python']), payload)

# Native launchers stay relocatable and use the payload's own store Python.
commands = write_launchers(payload, project_entries(repo / "pyproject.toml"),
    python=runtime["python"], repo="hermes-agent", site="venv/Lib/site-packages", target="win32-x64")
(environment / "pyvenv.cfg").write_text("version = " + sys.version.split()[0] + "\n", encoding="utf-8")
(site / "hermes-agent.pth").write_text("../../../hermes-agent\n", encoding="utf-8")
manifest = {"schema": 1, "target": "win32-x64", "repo": "hermes-agent", "venv": "venv", "store": "tools",
    "runtime": {"repoDir": "hermes-agent", "toolsDir": "tools", "storePython": runtime["python"],
        "sitePackages": "venv/Lib/site-packages", "commands": commands}}
# Publish last: a consumer must never select an unfinished dependency layout.
(payload / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("Published native sealed Hermes dependency environment")
