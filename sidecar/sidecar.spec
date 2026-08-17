# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

# PyInstaller collects an outdated msvcp140.dll/vcruntime140*.dll (pulled in as a
# dependency of some other bundled extension module) that is older than the CRT
# torch's c10.dll was built against. Its onedir bootloader puts _internal ahead of
# System32 in the DLL search order, so the stale bundled copy shadows the correct
# one and c10.dll crashes with an access violation inside msvcp140.dll on load.
# Universal CRT DLLs ship with Windows 10/11 by default, so exclude the bundled
# copies and let the loader fall through to the system ones.
#
# a.binaries is a TOC, not a plain list — it dedupes DLLs pulled in redundantly
# by multiple hooks (torch/scipy/iopaint all reference shared CUDA libs). Filter
# it in place with TOC's own methods so that dedup behavior survives; rebinding
# a.binaries to a bare list comprehension silently drops it, which let every
# hook's duplicate contributions through uncollapsed and ballooned the onedir
# output roughly 6x (208MB -> 1.2GB) in the build that first tried this.
_stale_crt_dlls = {"msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"}
for _entry in list(a.binaries):
    if _entry[0].lower() in _stale_crt_dlls:
        a.binaries.remove(_entry)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='sidecar',
)
