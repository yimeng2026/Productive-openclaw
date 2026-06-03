"""
hardware.py - SRIA-SMIM 硬件检测模块

提供系统硬件自动检测功能，包括 CPU、内存和 GPU 信息获取。
"""

from __future__ import annotations

from typing import Optional, Tuple

import psutil

from .core import HardwareProfile


class HardwareDetector:
    """自动检测系统硬件能力。

    通过 psutil 和可选的 GPU 库检测当前系统的 CPU、内存和 GPU 配置。
    """

    @staticmethod
    def detect() -> HardwareProfile:
        """检测硬件配置并返回 HardwareProfile。

        Returns:
            HardwareProfile: 包含 CPU、内存和 GPU 信息的硬件配置对象
        """
        cpu_cores = psutil.cpu_count(logical=False) or 1
        cpu_threads = psutil.cpu_count(logical=True) or 1
        ram_bytes = psutil.virtual_memory().total
        ram_gb = round(ram_bytes / (1024**3), 2)
        gpu_available, gpu_name, gpu_vram_gb = HardwareDetector._detect_gpu()
        return HardwareProfile(
            cpu_cores=cpu_cores,
            cpu_threads=cpu_threads,
            ram_gb=ram_gb,
            gpu_available=gpu_available,
            gpu_name=gpu_name,
            gpu_vram_gb=gpu_vram_gb,
        )

    @staticmethod
    def _detect_gpu() -> Tuple[bool, Optional[str], Optional[float]]:
        """尝试通过常用库检测 GPU。

        依次尝试 PyTorch、TensorFlow 和 pynvml 进行 GPU 检测。

        Returns:
            Tuple[bool, Optional[str], Optional[float]]: (GPU 是否可用, GPU 名称, 显存 GB)
        """
        # 尝试 PyTorch
        try:
            import torch
            if torch.cuda.is_available():
                idx = torch.cuda.current_device()
                name = torch.cuda.get_device_name(idx)
                mem = torch.cuda.get_device_properties(idx).total_memory / (1024**3)
                return True, name, round(mem, 2)
        except Exception:
            pass

        # 尝试 TensorFlow
        try:
            import tensorflow as tf
            gpus = tf.config.list_physical_devices("GPU")
            if gpus:
                return True, str(gpus[0].name), None
        except Exception:
            pass

        # 尝试 nvidia-ml-py3 / pynvml
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            name = pynvml.nvmlDeviceGetName(handle).decode("utf-8")
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            mem_gb = round(mem_info.total / (1024**3), 2)
            return True, name, mem_gb
        except Exception:
            pass

        return False, None, None
