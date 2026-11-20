import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/review_snapshot.py"


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.dest = self.root / "snapshot"
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.write("tracked", "baseline\n")
        self.write("deleted", "delete me\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def write(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)
        return path

    def cli(self, command, *extra, dest=None):
        return subprocess.run([sys.executable, str(SCRIPT), command, "--repo", str(self.repo),
                               "--snapshot", str(dest or self.dest), *extra],
                              text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def capture(self, *extra):
        result = self.cli("capture", "--approve-tracked", *extra)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)["snapshotId"]

    def verify(self, identity):
        return self.cli("verify", "--snapshot-id", identity)

    def test_full_union_and_index_preservation(self):
        self.write("tracked", "staged\n")
        self.git("add", "tracked")
        self.write("tracked", "working\n")
        self.git("rm", "-q", "deleted")
        self.write("index-new", "index then worktree\n")
        self.git("add", "index-new")
        self.write("index-new", "current\n").chmod(0o755)
        self.write(".gitignore", "ignored\n")
        self.git("add", ".gitignore")
        self.write("extra", "extra\n")
        self.write("ignored", "ignored\n")
        index = (self.repo / ".git/index").read_bytes()
        identity = self.capture("--include-untracked", "extra", "--include-untracked", "ignored")
        source = self.dest / "source"
        self.assertEqual((source / "tracked").read_text(), "working\n")
        self.assertEqual((source / "index-new").read_text(), "current\n")
        self.assertTrue((source / "index-new").stat().st_mode & 0o111)
        self.assertFalse((source / "deleted").exists())
        self.assertEqual((source / "extra").read_text(), "extra\n")
        self.assertEqual((source / "ignored").read_text(), "ignored\n")
        patch = (self.dest / "diff.patch").read_text()
        for name in ("tracked", "deleted", "index-new", "extra", "ignored"):
            self.assertIn(name, patch)
        self.assertEqual(self.verify(identity).returncode, 0)
        self.assertEqual((self.repo / ".git/index").read_bytes(), index)

    def test_export_ignore_retains_raw_file(self):
        self.write(".gitattributes", "tracked export-ignore\n")
        self.git("add", ".gitattributes")
        self.git("commit", "-qm", "attributes")
        identity = self.capture()
        self.assertEqual((self.dest / "source/tracked").read_text(), "baseline\n")
        self.assertEqual(self.verify(identity).returncode, 0)

    def test_rejects_unapproved_extras_and_cleans_destination(self):
        self.write("extra", "unapproved")
        result = self.cli("capture", "--approve-tracked")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unapproved", result.stderr)
        self.assertFalse(self.dest.exists())

    def test_stale_source_index_baseline_and_extra(self):
        for change in ("tracked", "index", "baseline", "extra"):
            with self.subTest(change=change):
                self.setUp()
                self.write("extra", "approved")
                identity = self.capture("--include-untracked", "extra")
                if change == "tracked":
                    self.write("tracked", "changed")
                elif change == "index":
                    self.write("tracked", "changed")
                    self.git("add", "tracked")
                    self.write("tracked", "baseline\n")
                elif change == "baseline":
                    self.git("commit", "--allow-empty", "-qm", "new baseline")
                else:
                    self.write("extra", "changed")
                self.assertNotEqual(self.verify(identity).returncode, 0)

    def test_snapshot_tampering_rejected(self):
        for change in ("missing", "extra", "content", "mode", "metadata", "diff", "id"):
            with self.subTest(change=change):
                self.setUp()
                identity = self.capture()
                source = self.dest / "source/tracked"
                if change == "missing":
                    source.unlink()
                elif change == "extra":
                    (self.dest / "source/extra").write_text("extra")
                elif change == "content":
                    source.write_text("tampered")
                elif change == "mode":
                    source.chmod(0o755)
                elif change == "metadata":
                    metadata = json.loads((self.dest / "snapshot.json").read_text())
                    metadata["baseline"] = "tampered"
                    (self.dest / "snapshot.json").write_text(json.dumps(metadata))
                elif change == "diff":
                    (self.dest / "diff.patch").write_text("tampered")
                else:
                    identity = "0" * 64
                self.assertNotEqual(self.verify(identity).returncode, 0)

    def test_unsupported_layouts(self):
        for layout in ("symlink", "submodule", "sparse", "filter", "unborn"):
            with self.subTest(layout=layout):
                self.setUp()
                if layout == "symlink":
                    (self.repo / "link").symlink_to("tracked")
                    self.git("add", "link")
                elif layout == "submodule":
                    self.git("update-index", "--add", "--cacheinfo", "160000," +
                             self.git("rev-parse", "HEAD").decode().strip() + ",sub")
                elif layout == "sparse":
                    self.git("config", "core.sparseCheckout", "true")
                elif layout == "filter":
                    self.write(".gitattributes", "tracked filter=example\n")
                    self.git("add", ".gitattributes")
                else:
                    self.git("checkout", "--orphan", "unborn")
                result = self.cli("capture", "--approve-tracked")
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse(self.dest.exists())

    def test_destination_containment_and_existing_destination(self):
        inside = self.repo / "snapshot"
        result = self.cli("capture", "--approve-tracked", dest=inside)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(inside.exists())
        self.dest.mkdir()
        marker = self.dest / "marker"
        marker.write_text("preserve")
        result = self.cli("capture", "--approve-tracked")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(marker.read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
