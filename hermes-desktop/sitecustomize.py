"""Activate the packaged dependencies before Hermes' unchanged bootstrap."""
from pathlib import Path
import site
site.addsitedir(str(Path(__file__).resolve().parent.parent / 'venv' / 'Lib' / 'site-packages'))
