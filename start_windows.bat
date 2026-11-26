@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
    if not errorlevel 1 (
        py -3 server.py --open %*
        goto :done
    )
)
where python >nul 2>nul
if %errorlevel% equ 0 (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
    if not errorlevel 1 (
        python server.py --open %*
        goto :done
    )
)
echo 请先安装 Python 3.10 或更新版本，然后重新运行本脚本。
:done
pause
endlocal
