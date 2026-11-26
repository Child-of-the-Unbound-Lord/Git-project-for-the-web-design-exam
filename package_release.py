"""Create versioned website downloads without runtime data or hosting identity."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import json
import re
import os

ROOT = Path(__file__).resolve().parent
VERSION = "0.2"
DEFAULT_PREFIX = "LabFlow_v0.2"
DOWNLOAD_DIR = ROOT / "web" / "downloads"


def standalone():
    text = (ROOT / "web/app.html").read_text(encoding="utf-8")
    text = text.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-standalone="true">', 1)
    css = (ROOT / "web/style.css").read_text(encoding="utf-8")
    text = text.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
    scripts = []
    for name in ("seed-data.js", "browser-store.js", "api.js", "app.js"):
        text = re.sub(r'<script\s+src="' + re.escape(name) + r'"\s+defer></script>', '', text)
        source = (ROOT / "web" / name).read_text(encoding="utf-8").replace('</script', '<\\/script')
        scripts.append('<script>\n' + source + '\n</script>')
    return text.replace('</body>', '\n'.join(scripts) + '\n</body>')


def create_release(output_dir, prefix=DEFAULT_PREFIX):
    """Return archive/standalone/readme paths; never include user databases.

    The only in-checkout output allowed is web/downloads, which is ignored by
    Git and explicitly excluded from the source archive to prevent recursion.
    """
    output = Path(output_dir).resolve()
    if (output == ROOT or ROOT in output.parents) and output != DOWNLOAD_DIR.resolve():
        raise ValueError("Use web/downloads or a directory outside the source checkout.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", str(prefix)):
        raise ValueError("Invalid release filename prefix.")
    output.mkdir(parents=True, exist_ok=True)
    html_path = output / f"{prefix}_offline.html"
    readme_path = output / f"{prefix}_readme.txt"
    archive = output / f"{prefix}_source.zip"
    html_path.write_text(standalone(), encoding="utf-8")
    readme_path.write_text((ROOT / "README.md").read_text(encoding="utf-8"), encoding="utf-8")
    excluded_dirs = {".git", ".openai", "dist", "data", "__pycache__", "node_modules", ".sites-runtime", ".sites-checkout", "test-artifacts"}
    excluded_files = {"BUILD_CONTRACT.md", "WEBSITE_CONTRACT.md"}
    root_sources = {".gitignore", "README.md", "build_static.py", "package_release.py", "seed.json", "server.py", "start_windows.bat", "start_macos_linux.sh", "打开小程序.html"}
    source_extensions = {"web": {".html", ".css", ".js", ".json", ".svg", ".png", ".ico"},
                         "docs": {".md", ".json", ".txt"}, "tests": {".py", ".js", ".json"}}
    temporary = output / f".{prefix}_source.zip.tmp"
    with ZipFile(temporary, "w", ZIP_DEFLATED) as z:
        for path in sorted(ROOT.rglob("*")):
            relative = path.relative_to(ROOT)
            if path.is_symlink() or not path.is_file() or any(part in excluded_dirs for part in relative.parts):
                continue
            if relative.parts[:2] == ("web", "downloads"):
                continue
            if len(relative.parts) == 1:
                if path.name not in root_sources:
                    continue
            elif relative.parts[0] not in source_extensions or path.suffix not in source_extensions[relative.parts[0]]:
                continue
            if path.name in excluded_files or path.suffix in {".pyc", ".db", ".sqlite", ".log"}:
                continue
            z.write(path, Path(f"LabFlow-v{VERSION}") / relative)
        z.write(html_path, f"LabFlow-v{VERSION}/直接打开_八个小程序.html")
    with ZipFile(temporary) as z:
        bad = z.testzip()
        if bad:
            raise ValueError(f"Archive integrity failure: {bad}")
        count = len(z.infolist())
    os.replace(temporary, archive)
    result = {"archive": str(archive), "standalone": str(html_path), "readme": str(readme_path),
              "version": VERSION, "file_count": count,
              "archive_size_bytes": archive.stat().st_size,
              "standalone_size_bytes": html_path.stat().st_size, "integrity": "ok"}
    metadata = {key: value for key, value in result.items() if key not in {"archive", "standalone", "readme"}}
    metadata["files"] = {"source": archive.name, "offline": html_path.name, "readme": readme_path.name}
    (output / "release.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", help="web/downloads or a directory outside the source checkout")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    args = parser.parse_args()
    print(json.dumps(create_release(args.output_dir, args.prefix), ensure_ascii=False))


if __name__ == "__main__":
    main()
