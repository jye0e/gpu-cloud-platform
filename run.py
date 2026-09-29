"""
PyInstaller 打包入口（Windows exe / Linux ELF）

- 源码运行:  python run.py
- 打包命令:  pyinstaller gpu_cloud_platform.spec --noconfirm
  （PyInstaller 不支持交叉编译：exe 需在 Windows 上打包，ELF 需在 Linux 上打包）

打包前置条件:
  1. pip install -r requirements.txt pyinstaller
  2. cd web && npm install && npm run build   （生成 web/dist）
"""

import uvicorn

from app.config import settings
from app.main import app

if __name__ == "__main__":
    uvicorn.run(
        app,  # 冻结环境下直接传 app 对象，避免 import string 二次导入模块
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        log_level=settings.LOG_LEVEL.lower(),
    )
