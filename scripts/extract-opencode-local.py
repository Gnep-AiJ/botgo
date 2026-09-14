"""Extract the pinned local source archive without Windows symlink privileges.

Materialize archive links as copies; reject traversal, special files and cycles.
Never overwrite an existing destination. No network or system configuration.
"""
import argparse
import gzip
import hashlib
import json
import pathlib
import posixpath
import shutil
import tarfile
import tempfile

COMMIT = "3104c1428ec91f809e5ab86631300de41eb6952e"
PREFIX = "opencode-" + COMMIT
ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=pathlib.Path)
    parser.add_argument("--short", action="store_true", help="Use artifacts/opencode for Windows builds")
    args = parser.parse_args()
    dest = ROOT / ("artifacts/opencode" if args.short else "artifacts/verification/opencode-bootstrap/local-source")
    source_root = dest if args.short else dest / PREFIX
    if dest.exists():
        raise RuntimeError("Destination exists; refusing to overwrite: " + str(dest))
    with gzip.open(args.archive, "rb") as stream:
        while stream.read(1024 * 1024):
            pass  # Read through gzip trailer to verify CRC before writing.
    with args.archive.open("rb") as stream:
        archive_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    # Seek in an uncompressed temporary archive, avoiding repeated gzip inflation.
    with tempfile.TemporaryFile(dir=ROOT / "artifacts") as raw:
        with gzip.open(args.archive, "rb") as compressed:
            shutil.copyfileobj(compressed, raw)
        raw.seek(0)
        extract(raw, dest, source_root, archive_hash)


def extract(raw, dest, source_root, archive_hash):
    with tarfile.open(fileobj=raw, mode="r:") as bundle:
        members = {}
        for item in bundle.getmembers():
            name = item.name.rstrip("/")
            parts = pathlib.PurePosixPath(name).parts
            if (not parts or parts[0] != PREFIX or ".." in parts
                    or "\\" in name or ":" in name or name in members):
                raise RuntimeError("Unsafe or duplicate member: " + name)
            if not (item.isfile() or item.isdir() or item.issym() or item.islnk()):
                raise RuntimeError("Unsupported archive member: " + name)
            members[name] = item

        def resolve(name, chain=()):
            if name in chain or name not in members:
                raise RuntimeError("Missing/cyclic link: " + name)
            item = members[name]
            if not (item.issym() or item.islnk()):
                return name
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), item.linkname)
                                       if item.issym() else item.linkname)
            if not target.startswith(PREFIX + "/"):
                raise RuntimeError("Link escapes source: " + name)
            return resolve(target, chain + (name,))

        links = {name: resolve(name) for name, item in members.items()
                 if item.issym() or item.islnk()}
        hashes = {}

        def materialize(name, target, chain=()):
            resolved = resolve(name)
            if resolved in chain:
                raise RuntimeError("Directory link cycle: " + name)
            item = members[resolved]
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
                for child in members:
                    if posixpath.dirname(child) == resolved:
                        materialize(child, target / posixpath.basename(child), chain + (resolved,))
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                with bundle.extractfile(item) as source, target.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                        digest.update(chunk)
                expected = digest.hexdigest()
                with target.open("rb") as output:
                    actual = hashlib.file_digest(output, "sha256").hexdigest()
                if expected != actual:
                    raise RuntimeError("Extracted content mismatch: " + str(target))
                hashes[str(target.relative_to(dest)).replace("\\", "/")] = actual

        materialize(PREFIX, source_root)
    report = {"archiveSha256": archive_hash, "commitLabel": COMMIT,
              "archiveMembers": len(members), "materializedLinks": links,
              "verifiedFiles": len(hashes), "fileSha256": hashes,
              "limitation": "Links are copies and will not track later target edits. Archive label is not independent provenance verification."}
    (dest / "extraction-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"source": str(source_root), "members": len(members),
                      "linksCopied": len(links), "filesVerified": len(hashes),
                      "archiveSha256": archive_hash}))


if __name__ == "__main__":
    main()
