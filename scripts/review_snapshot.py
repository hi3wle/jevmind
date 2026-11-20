#!/usr/bin/env python3
"""Capture and verify authorized, quiescent ordinary Git worktrees without filters."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile


class SnapshotError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise SnapshotError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()


def git(repo, *args, data=None, index=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_OPTIONAL_LOCKS="0", GIT_NO_REPLACE_OBJECTS="1", GIT_NO_LAZY_FETCH="1")
    if index:
        env["GIT_INDEX_FILE"] = str(index)
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=" + os.devnull,
         "-c", "core.attributesFile=" + os.devnull, "-c", "core.untrackedCache=false",
         "-C", str(repo), *args], input=data, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise SnapshotError("git " + args[0] + ": " + result.stderr.decode(errors="replace").strip())
    return result.stdout


def safe_path(path):
    require(isinstance(path, str) and path and "\x00" not in path and
            "\\" not in path and not PurePosixPath(path).is_absolute() and
            all(p not in ("", ".", "..") and p.lower() != ".git" for p in path.split("/")),
            "unsupported or unsafe path: " + repr(path))
    return path


def paths(raw):
    return [safe_path(os.fsdecode(p)) for p in raw.split(b"\x00") if p]


def tree_entries(repo, tree):
    entries = []
    for row in git(repo, "ls-tree", "-rz", "--full-tree", tree).split(b"\x00"):
        if not row:
            continue
        header, name = row.split(b"\t", 1)
        mode, kind, oid = header.decode().split()
        require(kind == "blob" and mode in ("100644", "100755"),
                "unsupported tree mode (symlink/submodule): " + os.fsdecode(name))
        entries.append({"path": safe_path(os.fsdecode(name)), "mode": mode, "blob": oid})
    return sorted(entries, key=lambda e: e["path"])


def regular_file(root, name):
    current = root
    pieces = safe_path(name).split("/")
    for offset, part in enumerate(pieces):
        current = current / part
        require(not current.is_symlink(), "symlink is unsupported: " + name)
        if offset < len(pieces) - 1:
            require(not (current / ".git").exists() and not (current / ".git").is_symlink(),
                    "nested repository is unsupported: " + name)
    try:
        before = current.stat()
    except FileNotFoundError:
        return None
    require(stat.S_ISREG(before.st_mode), "not a regular file: " + name)
    content = current.read_bytes()
    after = current.stat()
    require((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_mode) ==
            (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_mode),
            "concurrent file change: " + name)
    return ("100755" if before.st_mode & 0o111 else "100644", content)


def preflight(repo):
    repo = repo.resolve(strict=True)
    require(os.fsdecode(git(repo, "rev-parse", "--show-toplevel")).strip() == str(repo),
            "--repo must name the repository root")
    baseline = git(repo, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    config = git(repo, "config", "--local", "--null", "--list").decode(errors="replace").lower()
    require(not any(row.startswith(("include.", "includeif.", "extensions.partialclone\n")) or
                    row.split("\n", 1)[0].endswith(".promisor") for row in config.split("\x00")),
            "included configuration and partial clones are unsupported")
    for key in ("core.sparsecheckout", "extensions.worktreeconfig", "core.autocrlf"):
        require(not any(row.split("\n", 1)[0] == key and row.split("\n", 1)[-1] not in
                        ("false", "0", "no", "off", "") for row in config.split("\x00")),
                "unsupported Git configuration: " + key)
    sparse = Path(os.fsdecode(git(repo, "rev-parse", "--git-path", "info/sparse-checkout")).strip())
    if not sparse.is_absolute():
        sparse = repo / sparse
    require(not sparse.exists(), "sparse checkout is unsupported")
    return repo, baseline


def collect(repo, approved):
    repo, baseline = preflight(repo)
    tracked = {e["path"] for e in tree_entries(repo, baseline)}
    for row in git(repo, "ls-files", "--stage", "-z").split(b"\x00"):
        if row:
            header, name = row.split(b"\t", 1)
            mode, _, stage = header.decode().split()
            require(stage == "0" and mode in ("100644", "100755"),
                    "unmerged index, symlink or submodule is unsupported")
            tracked.add(safe_path(os.fsdecode(name)))
    tags = git(repo, "ls-files", "-v", "-z").split(b"\x00")
    require(all(not row or row[:1] == b"H" for row in tags),
            "skip-worktree/assume-unchanged index entries are unsupported")
    others = set(paths(git(repo, "ls-files", "--others", "--exclude-standard", "-z")))
    others.update(paths(git(repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")))
    # A staged deletion can appear in --others; it is still tracked scope.
    others -= tracked
    require(others == set(approved), "untracked/ignored paths require exact approval; unapproved=" +
            repr(sorted(others - set(approved))) + "; absent/not-untracked=" + repr(sorted(set(approved) - others)))
    names = sorted(tracked | others)
    attrs = git(repo, "check-attr", "--all", "-z", "--stdin", data=b"".join(os.fsencode(n) + b"\x00" for n in names))
    parts = attrs.split(b"\x00")[:-1]
    for i in range(0, len(parts), 3):
        require(parts[i + 1] not in (b"filter", b"text", b"eol", b"crlf", b"ident", b"working-tree-encoding"),
                "working-tree transformation attribute unsupported: " + os.fsdecode(parts[i]))
    files = []
    for name in names:
        value = regular_file(repo, name)
        if value is not None:
            mode, content = value
            files.append({"path": name, "mode": mode, "sha256": digest(content), "content": content})
    index_path = Path(os.fsdecode(git(repo, "rev-parse", "--git-path", "index")).strip())
    if not index_path.is_absolute():
        index_path = repo / index_path
    identity = {"baseline": baseline, "indexSha256": digest(index_path.read_bytes()) if index_path.exists() else None,
                "trackedPaths": sorted(tracked), "approvedUntracked": sorted(approved),
                "files": [{k: v for k, v in f.items() if k != "content"} for f in files]}
    return identity, files


def make_tree(repo, files):
    with tempfile.TemporaryDirectory(prefix="harness-index-") as temporary:
        index = Path(temporary) / "index"
        git(repo, "read-tree", "--empty", index=index)
        rows = []
        for f in files:
            oid = git(repo, "hash-object", "-w", "--no-filters", "--stdin", data=f["content"]).decode().strip()
            rows.append(f["mode"].encode() + b" " + oid.encode() + b"\t" + os.fsencode(f["path"]) + b"\x00")
        git(repo, "update-index", "-z", "--index-info", data=b"".join(rows), index=index)
        return git(repo, "write-tree", index=index).decode().strip()


def diff_bytes(repo, baseline, tree):
    return git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--binary", baseline, tree, "--")


def snapshot_inventory(source):
    inventory = []
    for directory, dirs, files in os.walk(source, followlinks=False):
        for name in dirs:
            require(not (Path(directory) / name).is_symlink(), "snapshot directory symlink")
        for name in files:
            relative = (Path(directory) / name).relative_to(source).as_posix()
            mode, content = regular_file(source, relative)
            inventory.append({"path": relative, "mode": mode, "sha256": digest(content)})
    return sorted(inventory, key=lambda f: f["path"])


def verify(repo, destination, expected_id=None):
    require(destination.is_dir() and not destination.is_symlink(), "snapshot must be a real directory")
    require({p.name for p in destination.iterdir()} == {"snapshot.json", "source", "diff.patch"},
            "unexpected/missing snapshot artifacts")
    for name in ("snapshot.json", "diff.patch", "source"):
        require(not (destination / name).is_symlink(), "snapshot artifact symlink")
    metadata = json.loads((destination / "snapshot.json").read_text())
    snapshot_id = metadata.pop("snapshotId")
    require(snapshot_id == digest(canonical(metadata)), "snapshot metadata identity mismatch")
    require(expected_id is None or snapshot_id == expected_id, "unexpected snapshot ID")
    require(metadata["schemaVersion"] == 1 and metadata["sourceRepo"] == str(repo), "snapshot source/schema mismatch")
    require((destination / "source").is_dir(), "snapshot source missing")
    expected_dirs = {str(parent) for f in metadata["sourceIdentity"]["files"]
                     for parent in PurePosixPath(safe_path(f["path"])).parents if str(parent) != "."}
    actual_dirs = {p.relative_to(destination / "source").as_posix()
                   for p in (destination / "source").rglob("*") if p.is_dir()}
    require(actual_dirs == expected_dirs, "snapshot directory inventory mismatch")
    inventory = snapshot_inventory(destination / "source")
    require(inventory == metadata["sourceIdentity"]["files"], "snapshot content/path/mode mismatch")
    require(tree_entries(repo, metadata["tree"]) == metadata["inventory"], "snapshot tree inventory mismatch")
    for f in metadata["inventory"]:
        require(git(repo, "cat-file", "blob", f["blob"]) == (destination / "source" / safe_path(f["path"])).read_bytes(),
                "snapshot blob mismatch: " + f["path"])
    expected_diff = diff_bytes(repo, metadata["baseline"], metadata["tree"])
    require((destination / "diff.patch").read_bytes() == expected_diff, "snapshot diff mismatch")
    require(digest(expected_diff) == metadata["diffSha256"], "snapshot diff identity mismatch")
    before, _ = collect(repo, metadata["approvedUntracked"])
    require(before == metadata["sourceIdentity"], "stale snapshot: current target changed")
    after, _ = collect(repo, metadata["approvedUntracked"])
    require(before == after, "concurrent target change during verification")
    return snapshot_id


def capture(repo, destination, approved):
    require(not destination.exists() and not destination.is_symlink(), "destination must not exist")
    require(not destination.is_relative_to(repo), "snapshot destination must be outside target")
    before, files = collect(repo, approved)
    tree = make_tree(repo, files)
    patch = diff_bytes(repo, before["baseline"], tree)
    metadata = {"schemaVersion": 1, "sourceRepo": str(repo), "baseline": before["baseline"],
                "tree": tree, "approvedUntracked": sorted(approved), "sourceIdentity": before,
                "inventory": tree_entries(repo, tree), "diffSha256": digest(patch)}
    metadata["snapshotId"] = digest(canonical(metadata))
    destination.mkdir(mode=0o700)
    try:
        source = destination / "source"
        source.mkdir()
        for entry in metadata["inventory"]:
            path = source / entry["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(git(repo, "cat-file", "blob", entry["blob"]))
            path.chmod(0o755 if entry["mode"] == "100755" else 0o644)
        (destination / "diff.patch").write_bytes(patch)
        (destination / "snapshot.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=True) + "\n")
        after, _ = collect(repo, approved)
        require(before == after, "concurrent target change during capture")
        verify(repo, destination, metadata["snapshotId"])
    except BaseException:
        shutil.rmtree(destination)
        raise
    return metadata["snapshotId"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("capture", "verify"):
        sub = commands.add_parser(command)
        sub.add_argument("--repo", type=Path, required=True, help="authorized repository root")
        sub.add_argument("--snapshot", type=Path, required=True, help="external snapshot directory")
        if command == "capture":
            sub.add_argument("--approve-tracked", action="store_true", required=True,
                             help="confirm whole tracked repository is approved")
            sub.add_argument("--include-untracked", action="append", default=[], metavar="PATH",
                             help="exact repository-relative file; repeat for every untracked/ignored file")
        else:
            sub.add_argument("--snapshot-id", required=True, help="ID retained at capture/handoff")
    args = parser.parse_args()
    try:
        repo = args.repo.resolve(strict=True)
        destination = args.snapshot.absolute()
        destination = destination.parent.resolve(strict=True) / destination.name
        if args.command == "capture":
            approved = [safe_path(p) for p in args.include_untracked]
            require(len(set(approved)) == len(approved), "duplicate untracked approval")
            result = capture(repo, destination, approved)
        else:
            require(not destination.is_relative_to(repo), "snapshot must be outside target")
            result = verify(repo, destination, args.snapshot_id)
        print(json.dumps({"snapshotId": result, "snapshot": str(destination), "status": "verified"}))
        return 0
    except (SnapshotError, OSError, ValueError, KeyError, TypeError) as error:
        print("snapshot error: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
