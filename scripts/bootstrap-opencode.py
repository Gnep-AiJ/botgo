"""Fetch the pinned upstream runtime into ignored verification artifacts.

Never installs globally or changes an existing BotGo installation.
"""
import hashlib
import base64
import pathlib
import shutil
import urllib.request
import zipfile
import tarfile
import sys

VERSION = "1.18.30"
SHA256 = "c8c0e0d05ac3dac544a0edfad8de9eb244bf46c6c7a131c38619d40fcf31bd1f"
ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "artifacts/verification/opencode-bootstrap"


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    if "--source" in sys.argv:
        commit = "3104c1428ec91f809e5ab86631300de41eb6952e"
        archive = DEST / f"source-{commit}.tar.gz"
        if not archive.exists():
            url = f"https://codeload.github.com/anomalyco/opencode/tar.gz/{commit}"
            partial = archive.with_suffix(".download")
            with urllib.request.urlopen(url, timeout=30) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output, length=64 * 1024)
            partial.replace(archive)
        source = DEST / "source"
        if not source.exists():
            with tarfile.open(archive) as bundle:
                bundle.extractall(source, filter="data")
        print(f"Pinned source: {source / ('opencode-' + commit)}")
        return
    if "--npm" in sys.argv:
        archive = DEST / "opencode-windows-x64.tgz"
        expected = "E00yRyUDQvdmf8AYQNYDYgZuLkWW0mBqBrACHPwfCCBZdyC8Sa4nUtQq27nAIOPAp2jfyrpH3WJBxT2GVpT42w=="
        if not archive.exists():
            url = f"https://registry.npmjs.org/opencode-windows-x64/-/opencode-windows-x64-{VERSION}.tgz"
            partial = archive.with_suffix(".download")
            with urllib.request.urlopen(url, timeout=30) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output, length=64 * 1024)
            partial.replace(archive)
        with archive.open("rb") as stream:
            digest = base64.b64encode(hashlib.file_digest(stream, "sha512").digest()).decode()
        if digest != expected:
            raise RuntimeError("npm archive integrity mismatch")
        with tarfile.open(archive) as bundle:
            member = bundle.getmember("package/bin/opencode.exe")
            if not member.isfile():
                raise RuntimeError("Runtime is not a regular file")
            runtime = DEST / "runtime"
            runtime.mkdir(exist_ok=True)
            with bundle.extractfile(member) as source, (runtime / "opencode.exe").open("wb") as output:
                shutil.copyfileobj(source, output)
        print(f"OpenCode {VERSION}: npm SHA-512 verified; runtime at {runtime}")
        return
    archive = DEST / "opencode-windows-x64.zip"
    if not archive.exists():
        url = f"https://github.com/anomalyco/opencode/releases/download/v{VERSION}/{archive.name}"
        partial = archive.with_suffix(".download")
        with urllib.request.urlopen(url, timeout=45) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output)
        partial.replace(archive)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SHA256:
        raise RuntimeError("Upstream archive hash mismatch; retained for diagnosis")
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            target = (DEST / "runtime" / entry.filename).resolve()
            if not target.is_relative_to((DEST / "runtime").resolve()):
                raise RuntimeError("Unsafe archive path")
        bundle.extractall(DEST / "runtime")
    print(f"OpenCode {VERSION}: SHA-256 verified; runtime at {DEST / 'runtime'}")


if __name__ == "__main__":
    main()
