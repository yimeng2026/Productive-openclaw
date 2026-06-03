"""
engine.py - SRIA-SMIM 引擎主模块

SRIA（SYLVA Recursive Inference Architecture）引擎，核心编排器，
整合所有组件提供统一的 AI 任务处理能力。
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from .agent import AgentCluster
from .classifier import IntentClassifier
from .client import OllamaClient
from .config import ConfigManager
from .hardware import HardwareDetector
from .monitor import HealthMonitor, MonitoringDB
from .router import ModelRouter
from .core import (
    APP_NAME,
    DEFAULT_DB_PATH,
    VERSION,
    HardwareProfile,
    SystemConfig,
    TaskRequest,
    TaskResult,
    console,
)


class SRIAEngine:
    """SRIA 引擎 - 核心编排器。

    将所有组件（硬件检测、配置管理、意图分类、模型路由、Agent 集群、监控）
    整合在一起，提供统一的 AI 任务处理接口。

    Attributes:
        hardware: 硬件配置信息
        config: 系统配置
        router: 模型路由器
        client: Ollama 客户端
        db: 监控数据库
        cluster: Agent 集群
        monitor: 健康监控器
    """

    def __init__(self) -> None:
        """初始化 SRIA 引擎，检测硬件并组装所有组件。"""
        console.print(Panel.fit(f"[bold cyan]{APP_NAME} v{VERSION}[/bold cyan]", title="Initializing", border_style="green"))

        # 硬件检测
        with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), console=console) as progress:
            progress.add_task("Detecting hardware...", total=None)
            self.hardware: HardwareProfile = HardwareDetector.detect()

        console.print(f"[green]✓ Hardware:[/green] {self.hardware.cpu_cores} cores, {self.hardware.ram_gb} GB RAM, GPU={'Yes' if self.hardware.gpu_available else 'No'}")

        # 配置加载或推导
        saved_config = ConfigManager.load()
        if saved_config:
            self.config: SystemConfig = saved_config
            console.print("[green]✓ Loaded saved configuration.[/green]")
        else:
            self.config_manager = ConfigManager(self.hardware)
            self.config = self.config_manager.config
            self.config_manager.save()
            console.print(f"[green]✓ Auto-configured profile:[/green] {self.config.profile.value}")

        # 初始化各组件
        self.router = ModelRouter(self.config)
        self.client = OllamaClient()
        self.db = MonitoringDB()
        self.cluster = AgentCluster(self.config, self.router, self.client, self.db)
        self.monitor = HealthMonitor(self.db, self.client)
        self.monitor.start()

        console.print("[green]✓ All systems operational.[/green]\n")

    def process(self, prompt: str, context: Optional[str] = None) -> TaskResult:
        """通过完整流水线处理单个提示词。

        流程：意图分类 → 创建任务 → 提交 Agent 执行 → 返回结果

        Args:
            prompt: 用户输入的提示词
            context: 上下文信息（可选）

        Returns:
            TaskResult: 任务执行结果
        """
        intent = IntentClassifier.classify(prompt)
        task = TaskRequest(
            task_id=str(uuid.uuid4()),
            prompt=prompt,
            intent=intent,
            context=context,
        )
        console.print(f"[dim]Intent detected: {intent.value}[/dim]")
        future = self.cluster.submit(task)
        return future.result()

    def process_batch(self, prompts: List[str]) -> List[TaskResult]:
        """并行处理多个提示词。

        Args:
            prompts: 提示词列表

        Returns:
            List[TaskResult]: 各任务的执行结果
        """
        tasks = [
            TaskRequest(
                task_id=str(uuid.uuid4()),
                prompt=p,
                intent=IntentClassifier.classify(p),
            )
            for p in prompts
        ]
        futures = self.cluster.submit_batch(tasks)
        return [f.result() for f in futures]

    def status(self) -> None:
        """显示当前系统状态。"""
        table = Table(title="System Status")
        table.add_column("Component", style="cyan")
        table.add_column("Status", style="green")
        table.add_row("Hardware", f"{self.hardware.cpu_cores}C/{self.hardware.cpu_threads}T, {self.hardware.ram_gb}GB RAM")
        table.add_row("GPU", self.hardware.gpu_name or "N/A")
        table.add_row("Profile", self.config.profile.value)
        table.add_row("Primary Model", self.config.model_primary)
        table.add_row("Fallback Model", self.config.model_fallback)
        table.add_row("Max Workers", str(self.config.max_workers))
        table.add_row("Ollama Reachable", "Yes" if self.client.is_available() else "No")
        table.add_row("Monitoring DB", str(DEFAULT_DB_PATH))
        console.print(table)

    def stats(self) -> None:
        """显示监控统计信息。"""
        stats = self.db.get_stats()
        table = Table(title="Monitoring Statistics")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="magenta")
        table.add_row("Total Tasks", str(stats["total_tasks"]))
        table.add_row("Avg Latency", f"{stats['avg_latency_ms']} ms")
        table.add_row("Success Rate", f"{stats['success_rate']}%")
        table.add_row("Health Checks", str(stats["health_checks"]))
        console.print(table)

    def diagnostics(self) -> Dict[str, Any]:
        """运行全面诊断。

        Returns:
            Dict[str, Any]: 诊断报告字典
        """
        return self.monitor.diagnostics()

    def shutdown(self) -> None:
        """优雅关闭引擎，释放所有资源。"""
        console.print("[yellow]Shutting down...[/yellow]")
        self.monitor.stop()
        self.cluster.shutdown()
        console.print("[green]Goodbye.[/green]")
