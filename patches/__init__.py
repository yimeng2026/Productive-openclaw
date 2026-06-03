#!/usr/bin/env python3
"""
OpenClaw Patcher Extension - Package Entry Point
导出补丁引擎主类 PatcherEngine，用于将 productive-openclaw
作为扩展架构安全应用到 OpenClaw 实例中。

Usage:
    from patches import PatcherEngine
    engine = PatcherEngine()
    engine.apply()
    engine.revert()
"""

from patches.patcher import PatcherEngine
from patches.config_patcher import ConfigPatcher

__version__ = "2.0.0"
__all__ = ["PatcherEngine", "ConfigPatcher"]
