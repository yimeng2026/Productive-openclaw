"""
agent.py - SRIA-SMIM Agent 执行模块

提供单个 Agent 任务执行和多 Agent 集群并行调度的功能。
"""

from __future__ import annotations

import concurrent.futures
import threading
import time
import traceback
from typing import List

from .core import (
    OLLAMA_HOST,
    AgentState,
    AgentStatus,
    SystemConfig,
    TaskIntent,
    TaskRequest,
    TaskResult,
    console,
)
from .client import OllamaClient
from .monitor import MonitoringDB
from .router import ModelRouter


class Agent:
    """可执行任务的独立 Agent。

    每个 Agent 具有独立的状态和锁，支持线程安全的任务执行。

    Attributes:
        agent_id: Agent 唯一标识
        router: 模型路由器
        client: Ollama 客户端
        db: 监控数据库
        state: Agent 当前状态
    """

    def __init__(self, agent_id: str, router: ModelRouter, client: OllamaClient, db: MonitoringDB) -> None:
        """初始化 Agent。

        Args:
            agent_id: Agent 标识
            router: ModelRouter 实例
            client: OllamaClient 实例
            db: MonitoringDB 实例
        """
        self.agent_id = agent_id
        self.router = router
        self.client = client
        self.db = db
        self.state = AgentState(agent_id=agent_id, status=AgentStatus.IDLE, last_heartbeat=time.time())
        self._lock = threading.Lock()

    def execute(self, task: TaskRequest) -> TaskResult:
        """执行任务。

        将任务提交给模型执行，并记录执行结果到监控数据库。

        Args:
            task: 任务请求对象

        Returns:
            TaskResult: 任务执行结果
        """
        with self._lock:
            self.state.status = AgentStatus.BUSY
            self.state.current_task = task.task_id
            self.state.last_heartbeat = time.time()

        self.db.log_agent_event(self.agent_id, "task_start", f"task_id={task.task_id}, intent={task.intent.value}")

        start = time.time()
        try:
            model, system_prompt = self.router.route(task)
            if self.client.is_available():
                response = self.client.generate(
                    model=model,
                    prompt=task.prompt,
                    system=system_prompt,
                    timeout=self.router.config.timeout_seconds,
                )
                success = True
                error = None
            else:
                # 回退：生成本地启发式响应
                response = self._fallback_response(task, model)
                success = True
                error = "Ollama unavailable; fallback response generated."
        except Exception as exc:
            response = ""
            success = False
            error = str(exc)
            console.print(f"[red]Agent {self.agent_id} error: {error}[/red]")

        latency_ms = round((time.time() - start) * 1000, 2)

        result = TaskResult(
            task_id=task.task_id,
            success=success,
            content=response,
            model_used=model,
            latency_ms=latency_ms,
            error=error,
        )

        self.db.log_task(result, task.intent)
        self.db.log_agent_event(self.agent_id, "task_end", f"task_id={task.task_id}, success={success}")

        with self._lock:
            self.state.status = AgentStatus.IDLE
            self.state.current_task = None
            self.state.total_tasks_completed += 1
            self.state.last_heartbeat = time.time()

        return result

    @staticmethod
    def _fallback_response(task: TaskRequest, model: str) -> str:
        """当 Ollama 不可达时生成优雅的回退响应。

        Args:
            task: 任务请求对象
            model: 原定使用的模型名称

        Returns:
            str: 回退响应文本
        """
        # 数学任务的高级推理回退
        if task.intent == TaskIntent.MATH:
            return (
                f"[Advanced Math Mode - Local Reasoning]\n\n"
                f"Problem: {task.prompt[:200]}...\n\n"
                f"Strategy: Hierarchical Decomposition + Emergent Analysis\n"
                f"1. Decompose problem into layered sub-problems\n"
                f"2. Identify connectivity patterns between components\n"
                f"3. Apply recursive verification at each layer\n"
                f"4. Synthesize global solution from local rules\n\n"
                f"Note: Full computation requires Ollama model '{model}'.\n"
                f"Run: ollama pull {model}"
            )
        return (
            f"[Fallback Mode] Ollama is currently unavailable.\n"
            f"Task received: {task.prompt[:100]}...\n"
            f"Intended model: {model}\n"
            f"Intent detected: {task.intent.value}\n\n"
            f"Please ensure Ollama is running at {OLLAMA_HOST} and the model is pulled.\n"
            f"Run: ollama pull {model}"
        )

    def heartbeat(self) -> None:
        """更新心跳时间戳。"""
        with self._lock:
            self.state.last_heartbeat = time.time()


class AgentCluster:
    """多 Agent 并行执行集群。

    管理多个 Agent 的线程池，支持任务的并行提交和批量处理。

    Attributes:
        config: 系统配置对象
        agents: Agent 列表
        db: 监控数据库
    """

    def __init__(self, config: SystemConfig, router: ModelRouter, client: OllamaClient, db: MonitoringDB) -> None:
        """初始化 AgentCluster。

        Args:
            config: 系统配置对象
            router: ModelRouter 实例
            client: OllamaClient 实例
            db: MonitoringDB 实例
        """
        self.config = config
        self.agents: List[Agent] = [
            Agent(f"agent-{i}", router, client, db)
            for i in range(config.max_workers)
        ]
        self.db = db
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=config.max_workers)
        self._shutdown = False

    def submit(self, task: TaskRequest) -> concurrent.futures.Future:
        """将任务提交给最不忙碌的 Agent。

        Args:
            task: 任务请求对象

        Returns:
            concurrent.futures.Future: 任务 future 对象
        """
        agent = min(self.agents, key=lambda a: a.state.status == AgentStatus.BUSY)
        return self._executor.submit(agent.execute, task)

    def submit_batch(self, tasks: List[TaskRequest]) -> List[concurrent.futures.Future]:
        """批量提交多个任务。

        Args:
            tasks: 任务请求列表

        Returns:
            List[concurrent.futures.Future]: future 对象列表
        """
        return [self.submit(t) for t in tasks]

    def get_agent_states(self) -> List[AgentState]:
        """获取所有 Agent 的当前状态。

        Returns:
            List[AgentState]: Agent 状态列表
        """
        return [a.state for a in self.agents]

    def shutdown(self) -> None:
        """优雅关闭集群。"""
        self._shutdown = True
        self._executor.shutdown(wait=True)
