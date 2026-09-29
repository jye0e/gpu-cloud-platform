# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 打包配置 — GPU 算力托管平台

产物（onedir 模式，服务类应用启动快、便于排错）:
  - Windows: dist/gpu-cloud-platform/gpu-cloud-platform.exe
  - Linux:   dist/gpu-cloud-platform/gpu-cloud-platform   (ELF)

前置条件:
  1. pip install -r requirements.txt pyinstaller
  2. cd web && npm install && npm run build   （web/dist 必须存在）

注意: data/、logs/、.env 不打包，运行时基于工作目录（exe 同级）生成/读取。
"""

import os

from PyInstaller.utils.hooks import collect_submodules

PROJECT_ROOT = os.path.abspath(SPECPATH)

hiddenimports = (
    # uvicorn 运行时通过 importlib 动态加载的子模块
    collect_submodules("uvicorn")
    # SQLAlchemy 异步 SQLite 方言（字符串动态导入）
    + [
        "aiosqlite",
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.dialects.sqlite.aiosqlite",
        "sqlalchemy.dialects.sqlite.pysqlite",
    ]
    # FastAPI 表单/分片上传支持（python-multipart 新旧包名）
    + ["python_multipart", "multipart"]
    # 应用内存在函数级延迟导入的模块，全量收集兜底
    + collect_submodules("app")
)

a = Analysis(
    ["run.py"],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=[
        # 前端构建产物 -> 冻结后位于 _MEIPASS/web/dist
        (os.path.join(PROJECT_ROOT, "web", "dist"), os.path.join("web", "dist")),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # requirements 中声明但代码未引用的依赖，剔除以减小体积/规避原生 DLL 依赖
        "alembic",
        "passlib",
        "slowapi",
        "magic",
        # 与本服务无关的大件
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
        "pytest",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="gpu-cloud-platform",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # 服务端程序，保留控制台日志输出
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="gpu-cloud-platform",
)
