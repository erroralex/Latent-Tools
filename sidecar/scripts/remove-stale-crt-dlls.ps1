# Run after every `pyinstaller --onedir --name sidecar run.py`.
#
# PyInstaller auto-collects its own msvcp140.dll/vcruntime140*.dll into
# _internal/, older than the CRT torch's c10.dll was built against. The
# onedir bootloader searches _internal/ before System32, so the stale
# bundled copy shadows the correct one and c10.dll crashes with an access
# violation (0xc0000005) on load. Universal CRT DLLs ship with Windows
# 10/11 by default, so it's safe to delete the bundled copies and let the
# loader fall through to the system ones.
param(
    [string]$DistInternalDir = (Join-Path $PSScriptRoot "..\dist\sidecar\_internal")
)

$staleDlls = "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"
foreach ($dll in $staleDlls) {
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $DistInternalDir $dll)
}
