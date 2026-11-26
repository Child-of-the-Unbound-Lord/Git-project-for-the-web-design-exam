"""Copy the dependency-free browser experience into the static hosting build output."""
from pathlib import Path
import shutil
from package_release import create_release

ROOT = Path(__file__).resolve().parent
source = ROOT / "web"
target = ROOT / "dist"
required = ["index.html", "app.html", "guide.html", "download.html", "site.css", "site.js", "style.css", "app.js", "api.js", "browser-store.js", "seed-data.js"]
for name in required:
    if not (source / name).is_file():
        raise SystemExit(f"Missing source file: web/{name}")
release = create_release(source / "downloads")
target.mkdir(exist_ok=True)
for p in target.iterdir():
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
for p in source.iterdir():
    if p.is_dir():
        shutil.copytree(p, target / p.name)
    else:
        shutil.copy2(p, target / p.name)
print(f"Static build ready: {target}")
print(f"Website downloads ready: {release['file_count']} source entries, integrity {release['integrity']}")

