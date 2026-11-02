#!/usr/bin/env python3
"""Build a small, reproducible Chrome Web Store upload ZIP."""

import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "manifest.json").read_text())
VERSION = MANIFEST["version"]
OUTPUT = ROOT / "release" / f"team-builder-unleashed-web-store-v{VERSION}.zip"

files = {"manifest.json", "LICENSE", "PRIVACY.md"}
files.update(MANIFEST["icons"].values())
files.update(MANIFEST["action"]["default_icon"].values())
files.add(MANIFEST["action"]["default_popup"])
files.add(MANIFEST["options_ui"]["page"])

for script in MANIFEST["content_scripts"]:
    files.update(script["js"])
for resource in MANIFEST["web_accessible_resources"]:
    files.update(resource["resources"])
web_accessible = {
    name for resource in MANIFEST["web_accessible_resources"] for name in resource["resources"]
}

# Include scripts loaded by extension pages and files opened with runtime.getURL().
for page in (MANIFEST["action"]["default_popup"], MANIFEST["options_ui"]["page"]):
    html = (ROOT / page).read_text()
    files.update(re.findall(r'<script\s+src="([^"]+)"', html))
for source in list(files):
    if source.endswith(".js"):
        code = (ROOT / source).read_text()
        extension_urls = set(re.findall(r"chrome\.runtime\.getURL\(['\"]([^'\"]+)['\"]\)", code))
        files.update(extension_urls)
        if extension_urls - web_accessible:
            raise SystemExit(f"Missing web_accessible_resources for {source}: {sorted(extension_urls - web_accessible)}")

for name in files:
    path = ROOT / name
    if Path(name).is_absolute() or ".." in Path(name).parts or not path.is_file():
        raise SystemExit(f"Invalid or missing package file: {name}")

if MANIFEST["manifest_version"] != 3:
    raise SystemExit("Chrome Web Store package requires Manifest V3")
if any("localhost" in str(script["matches"]) for script in MANIFEST["content_scripts"]):
    raise SystemExit("Production package must not inject into localhost")
if "host_permissions" in MANIFEST:
    raise SystemExit("Review host permissions before packaging")

OUTPUT.parent.mkdir(exist_ok=True)
with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name in sorted(files):
        info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (ROOT / name).read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)

print(f"Created {OUTPUT} ({OUTPUT.stat().st_size:,} bytes, {len(files)} files)")
