"""
types.py - SRIA-SMIM 类型定义模块

包含所有枚举类型、数据类和全局常量，为整个包提供基础类型支持。
"""

from __future__ import annotations

import dataclasses
import enum
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from rich.console import Console

# --- 全局常量 ---
APP_NAME = "SRIA-SMIM"
VERSION = "1.0.0"
DEFAULT_DB_PATH = Path.home() / ".sria_smim" / "monitoring.db"
CONFIG_PATH = Path.home() / ".sria_smim" / "config.json"
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

# --- Rich 控制台实例（全局共享） ---
console = Console()


# --- 枚举类型 ---

class ConfigProfile(enum.Enum):
    """系统配置档次枚举。"""
    MINIMAL = "minimal"
    BALANCED = "balanced"
    PERFORMANCE = "performance"


class TaskIntent(enum.Enum):
    """任务意图类型枚举。"""
    GENERAL = "general"
    MATH = "math"
    PHYSICS = "physics"
    CODE = "code"
    CREATIVE = "creative"
    ANALYSIS = "analysis"


class AgentStatus(enum.Enum):
    """Agent 状态枚举。"""
    IDLE = "idle"
    BUSY = "busy"
    ERROR = "error"
    OFFLINE = "offline"


# --- 数据类 ---

@dataclass
class HardwareProfile:
    """硬件配置信息数据类。

    Attributes:
        cpu_cores: CPU 物理核心数
        cpu_threads: CPU 逻辑线程数
        ram_gb: 内存大小（GB）
        gpu_available: 是否有可用 GPU
        gpu_name: GPU 名称（如果有）
        gpu_vram_gb: GPU 显存大小（GB）（如果有）
    """
    cpu_cores: int
    cpu_threads: int
    ram_gb: float
    gpu_available: bool
    gpu_name: Optional[str] = None
    gpu_vram_gb: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return dataclasses.asdict(self)


@dataclass
class SystemConfig:
    """系统配置数据类。

    Attributes:
        profile: 配置档次
        max_workers: 最大并行工作线程数
        model_primary: 主模型名称
        model_fallback: 备用模型名称
        timeout_seconds: 请求超时时间（秒）
        enable_monitoring: 是否启用监控
        specialty_mode: 专用模式（可选）
    """
    profile: ConfigProfile
    max_workers: int
    model_primary: str
    model_fallback: str
    timeout_seconds: int
    enable_monitoring: bool
    specialty_mode: Optional[str] = None


@dataclass
class TaskRequest:
    """任务请求数据类。

    Attributes:
        task_id: 任务唯一标识
        prompt: 用户输入的提示词
        intent: 任务意图类型
        priority: 优先级（1-10，越小越优先）
        context: 上下文信息（可选）
        timestamp: 任务创建时间戳
    """
    task_id: str
    prompt: str
    intent: TaskIntent
    priority: int = 5
    context: Optional[str] = None
    timestamp: float = field(default_factory=time.time)


@dataclass
class TaskResult:
    """任务结果数据类。

    Attributes:
        task_id: 任务唯一标识
        success: 是否执行成功
        content: 返回内容
        model_used: 使用的模型名称
        latency_ms: 延迟时间（毫秒）
        tokens_used: 使用的 token 数量（可选）
        error: 错误信息（可选）
    """
    task_id: str
    success: bool
    content: str
    model_used: str
    latency_ms: float
    tokens_used: Optional[int] = None
    error: Optional[str] = None


@dataclass
class AgentState:
    """Agent 状态数据类。

    Attributes:
        agent_id: Agent 唯一标识
        status: 当前状态
        current_task: 当前执行的任务 ID（可选）
        total_tasks_completed: 已完成任务总数
        last_heartbeat: 最后心跳时间戳
    """
    agent_id: str
    status: AgentStatus
    current_task: Optional[str] = None
    total_tasks_completed: int = 0
    last_heartbeat: float = 0.0
