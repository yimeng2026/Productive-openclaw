"""
monitor.py - SRIA-SMIM 监控模块

提供基于 SQLite 的任务监控、健康检查和诊断功能。
"""

from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import psutil

from .core import (
    DEFAULT_DB_PATH,
    AgentStatus,
    TaskIntent,
    TaskResult,
    console,
)
from .client import OllamaClient
from .hardware import HardwareDetector


class MonitoringDB:
    """基于 SQLite 的监控和指标存储。

    自动创建所需的数据表，支持任务日志、健康检查和 Agent 事件的记录与查询。

    Attributes:
        db_path: SQLite 数据库文件路径
    """

    def __init__(self, db_path: Path = DEFAULT_DB_PATH) -> None:
        """初始化 MonitoringDB。

        Args:
            db_path: 数据库文件路径，默认使用 ~/.sria_smim/monitoring.db
        """
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        """初始化数据库表结构。"""
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    timestamp REAL,
                    intent TEXT,
                    model_used TEXT,
                    latency_ms REAL,
                    tokens_used INTEGER,
                    success INTEGER,
                    error TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS health_checks (
                    check_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL,
                    cpu_percent REAL,
                    ram_percent REAL,
                    gpu_available INTEGER,
                    ollama_reachable INTEGER
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_events (
                    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL,
                    agent_id TEXT,
                    event_type TEXT,
                    details TEXT
                )
                """
            )
            conn.commit()

    def log_task(self, result: TaskResult, intent: TaskIntent) -> None:
        """记录任务执行结果。

        Args:
            result: 任务结果对象
            intent: 任务意图类型
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO tasks
                (task_id, timestamp, intent, model_used, latency_ms, tokens_used, success, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result.task_id,
                    time.time(),
                    intent.value,
                    result.model_used,
                    result.latency_ms,
                    result.tokens_used,
                    1 if result.success else 0,
                    result.error,
                ),
            )
            conn.commit()

    def log_health(self, cpu: float, ram: float, gpu: bool, ollama: bool) -> None:
        """记录健康检查数据。

        Args:
            cpu: CPU 使用率百分比
            ram: 内存使用率百分比
            gpu: GPU 是否可用
            ollama: Ollama 是否可达
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                INSERT INTO health_checks (timestamp, cpu_percent, ram_percent, gpu_available, ollama_reachable)
                VALUES (?, ?, ?, ?, ?)
                """,
                (time.time(), cpu, ram, 1 if gpu else 0, 1 if ollama else 0),
            )
            conn.commit()

    def log_agent_event(self, agent_id: str, event_type: str, details: str = "") -> None:
        """记录 Agent 事件。

        Args:
            agent_id: Agent 标识
            event_type: 事件类型
            details: 事件详情
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            conn.execute(
                """
                INSERT INTO agent_events (timestamp, agent_id, event_type, details)
                VALUES (?, ?, ?, ?)
                """,
                (time.time(), agent_id, event_type, details),
            )
            conn.commit()

    def get_stats(self) -> Dict[str, Any]:
        """获取监控统计信息。

        Returns:
            Dict[str, Any]: 包含总任务数、平均延迟、成功率和健康检查次数的字典
        """
        with sqlite3.connect(str(self.db_path)) as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*), AVG(latency_ms), SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) FROM tasks")
            total, avg_latency, successes = cur.fetchone()
            cur.execute("SELECT COUNT(*) FROM health_checks")
            health_checks = cur.fetchone()[0]
            return {
                "total_tasks": total or 0,
                "avg_latency_ms": round(avg_latency or 0, 2),
                "success_rate": round((successes / total * 100) if total else 0, 2),
                "health_checks": health_checks,
            }


class HealthMonitor:
    """定期执行健康检查和自我诊断。

    在后台线程中定期收集系统健康指标并存储到数据库。

    Attributes:
        db: 监控数据库对象
        client: Ollama 客户端对象
        interval: 健康检查间隔（秒）
    """

    def __init__(self, db: MonitoringDB, client: OllamaClient, interval: int = 30) -> None:
        """初始化 HealthMonitor。

        Args:
            db: MonitoringDB 实例
            client: OllamaClient 实例
            interval: 健康检查间隔（秒），默认 30 秒
        """
        self.db = db
        self.client = client
        self.interval = interval
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        """启动健康检查后台线程。"""
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        """健康检查主循环。"""
        while not self._stop_event.is_set():
            try:
                cpu = psutil.cpu_percent(interval=1)
                ram = psutil.virtual_memory().percent
                gpu = HardwareDetector._detect_gpu()[0]
                ollama = self.client.is_available()
                self.db.log_health(cpu, ram, gpu, ollama)
            except Exception as exc:
                console.print(f"[red]Health check error: {exc}[/red]")
            self._stop_event.wait(self.interval)

    def stop(self) -> None:
        """停止健康检查线程。"""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def diagnostics(self) -> Dict[str, Any]:
        """运行全面的诊断报告。

        Returns:
            Dict[str, Any]: 包含硬件信息、数据库统计和 Ollama 状态的诊断报告
        """
        hw = HardwareDetector.detect()
        stats = self.db.get_stats()
        return {
            "hardware": hw.to_dict(),
            "database_stats": stats,
            "ollama_reachable": self.client.is_available(),
            "timestamp": datetime.now().isoformat(),
        }
