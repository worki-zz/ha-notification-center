"""Check that every version number in the repository is the same.

Usage: python scripts/check_version.py [expected-version]

With an argument (for example a release tag such as ``v0.0.1``), the
versions must also match it.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parent.parent


def _versions() -> dict[str, str]:
    manifest = json.loads(
        (ROOT / "custom_components/notification_center/manifest.json").read_text()
    )
    package = json.loads((ROOT / "frontend/package.json").read_text())
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    version_ts = (ROOT / "frontend/src/shared/version.ts").read_text()
    match = re.search(r'VERSION = "([^"]+)"', version_ts)
    return {
        "manifest.json": manifest["version"],
        "frontend/package.json": package["version"],
        "pyproject.toml": pyproject["project"]["version"],
        "frontend/src/shared/version.ts": match.group(1) if match else "missing",
    }


def main() -> int:
    """Print the versions and return 1 if they differ."""
    versions = _versions()
    expected = sys.argv[1].removeprefix("v") if len(sys.argv) > 1 else None
    found = set(versions.values())
    for name, version in versions.items():
        print(f"{name}: {version}")
    if len(found) != 1 or (expected is not None and found != {expected}):
        print(f"Version mismatch (expected {expected or 'one version'})")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
