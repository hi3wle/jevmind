"""Run the N1 filesystem probe without starting a model session."""

from pathlib import Path
import subprocess
import tempfile


def main():
    with tempfile.TemporaryDirectory(prefix="harness-permissions-") as directory:
        root = Path(directory)
        workspace = root / "workspace"
        workspace.mkdir()
        outside = root / "outside.txt"
        outside.write_text("original")
        probe = """
from pathlib import Path
import sys

Path("allowed.txt").write_text("inside")
try:
    Path(sys.argv[1]).write_text("unexpected")
except PermissionError:
    print("workspace write allowed; outside write denied")
else:
    raise SystemExit("outside write allowed")
"""
        result = subprocess.run(
            [
                "codex", "sandbox", "-P", "harness_probe",
                "-c", 'permissions.harness_probe.filesystem={ "/"="read", ":workspace_roots"="write" }',
                "-c", "permissions.harness_probe.network.enabled=false",
                "-C", str(workspace), "python3", "-c", probe, str(outside),
            ],
            text=True,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stdout + result.stderr)
        if (workspace / "allowed.txt").read_text() != "inside":
            raise RuntimeError("workspace write was not observed")
        if outside.read_text() != "original":
            raise RuntimeError("outside file changed")
        print(result.stdout.strip())


if __name__ == "__main__":
    main()
