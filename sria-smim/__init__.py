"""
SRIA-SMIM - SYLVA Recursive Inference Architecture + Multi-Agent Infrastructure Module

一个生产级的多配置自适应 AI 编排框架，提供硬件自动检测、
动态模型路由、多 Agent 并行执行和 SQLite 监控功能。

Usage:
    from sria_smim import SRIAEngine, CLI

    # 使用引擎 API
    engine = SRIAEngine()
    result = engine.process("你的问题")
    engine.shutdown()

    # 使用 CLI
    from sria_smim.cli import main
    main()
"""

from __future__ import annotations

import importlib
import os
import subprocess
import sys

# --- 依赖自动安装 ---
_REQUIRED_PACKAGES = ["requests", "rich", "psutil", "numpy"]


def _ensure_dependencies():
    """首次运行时静默安装缺失的包。"""
    missing = []
    for pkg in _REQUIRED_PACKAGES:
        try:
            importlib.import_module(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"[AUTO-INSTALL] Missing packages: {missing}. Installing now...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", *missing])
        print("[AUTO-INSTALL] Done. Restarting import...")


_ensure_dependencies()

# --- 包导出 ---
from .cli import CLI
from .engine import SRIAEngine

# 包版本
__version__ = "1.0.0"
__all__ = ["SRIAEngine", "CLI", "__version__"]
