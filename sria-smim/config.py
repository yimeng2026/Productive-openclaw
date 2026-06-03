"""
config.py - SRIA-SMIM 配置管理模块

提供基于硬件配置的自动化系统配置推导和持久化功能。
"""

from __future__ import annotations

import json
from typing import Optional

from .core import CONFIG_PATH, ConfigProfile, HardwareProfile, SystemConfig


class ConfigManager:
    """基于硬件管理系统配置。

    根据检测到的硬件自动推导最佳系统配置，支持配置的保存和加载。

    Attributes:
        hardware: 硬件配置信息
        config: 推导出的系统配置
    """

    def __init__(self, hardware: HardwareProfile) -> None:
        """初始化 ConfigManager 并推导配置。

        Args:
            hardware: 硬件配置信息对象
        """
        self.hardware = hardware
        self.config = self._derive_config()

    def _derive_config(self) -> SystemConfig:
        """根据硬件配置推导系统配置。

        按照以下规则推导：
        - GPU 可用且内存 >= 16GB：性能模式
        - 内存 >= 8GB：均衡模式
        - 其他：最小模式

        Returns:
            SystemConfig: 推导出的系统配置
        """
        hw = self.hardware
        if hw.gpu_available and hw.ram_gb >= 16:
            profile = ConfigProfile.PERFORMANCE
            max_workers = min(hw.cpu_threads, 8)
            model_primary = "llama3.1:70b" if hw.ram_gb >= 64 else "llama3.1:8b"
            model_fallback = "llama3.1:8b"
            timeout = 120
        elif hw.ram_gb >= 8:
            profile = ConfigProfile.BALANCED
            max_workers = min(hw.cpu_threads, 4)
            model_primary = "llama3.1:8b"
            model_fallback = "phi3:medium"
            timeout = 90
        else:
            profile = ConfigProfile.MINIMAL
            max_workers = min(hw.cpu_threads, 2)
            model_primary = "phi3:mini"
            model_fallback = "phi3:mini"
            timeout = 60

        return SystemConfig(
            profile=profile,
            max_workers=max_workers,
            model_primary=model_primary,
            model_fallback=model_fallback,
            timeout_seconds=timeout,
            enable_monitoring=True,
        )

    def save(self) -> None:
        """将当前配置保存到 JSON 文件。"""
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "profile": self.config.profile.value,
            "max_workers": self.config.max_workers,
            "model_primary": self.config.model_primary,
            "model_fallback": self.config.model_fallback,
            "timeout_seconds": self.config.timeout_seconds,
            "enable_monitoring": self.config.enable_monitoring,
            "specialty_mode": self.config.specialty_mode,
        }
        CONFIG_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")

    @staticmethod
    def load() -> Optional[SystemConfig]:
        """从 JSON 文件加载配置。

        Returns:
            Optional[SystemConfig]: 加载的配置对象，文件不存在或解析失败时返回 None
        """
        if not CONFIG_PATH.exists():
            return None
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            return SystemConfig(
                profile=ConfigProfile(data.get("profile", "balanced")),
                max_workers=data.get("max_workers", 4),
                model_primary=data.get("model_primary", "llama3.1:8b"),
                model_fallback=data.get("model_fallback", "phi3:medium"),
                timeout_seconds=data.get("timeout_seconds", 90),
                enable_monitoring=data.get("enable_monitoring", True),
                specialty_mode=data.get("specialty_mode"),
            )
        except Exception:
            return None
