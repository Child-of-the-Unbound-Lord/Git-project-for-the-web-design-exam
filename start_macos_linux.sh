#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if command -v python3 >/dev/null 2>&1; then
    LAB_PYTHON=python3
elif command -v python >/dev/null 2>&1; then
    LAB_PYTHON=python
else
    echo '请先安装 Python 3.10 或更新版本，然后重新运行本脚本。'
    exit 1
fi
"$LAB_PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || {
    echo '需要 Python 3.10 或更新版本。'
    exit 1
}
exec "$LAB_PYTHON" server.py --open "$@"
