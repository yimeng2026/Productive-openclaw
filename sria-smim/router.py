"""
router.py - SRIA-SMIM 模型路由模块

根据任务意图和硬件配置将任务路由到合适的 AI 模型。
"""

from __future__ import annotations

from typing import List, Tuple

import requests

from .core import OLLAMA_HOST, SystemConfig, TaskIntent, TaskRequest, console


class ModelRouter:
    """根据意图和硬件配置将任务路由到合适的模型。

    自动检测本地 Ollama 可用的模型列表，并根据任务意图选择最佳模型。

    Attributes:
        config: 系统配置对象
        available_models: 本地可用的模型列表
    """

    def __init__(self, config: SystemConfig) -> None:
        """初始化 ModelRouter。

        Args:
            config: 系统配置对象
        """
        self.config = config
        self.available_models: List[str] = []
        self._check_ollama()

    def _check_ollama(self) -> None:
        """检查 Ollama 服务并获取可用模型列表。"""
        try:
            resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                self.available_models = [m["name"] for m in data.get("models", [])]
        except Exception:
            console.print("[yellow]⚠ Ollama not reachable. Will use fallback mode.[/yellow]")

    def select_model(self, intent: TaskIntent) -> str:
        """根据意图选择最合适的模型。

        优先选择本地已安装的模型，如果没有匹配的则返回备用模型。

        Args:
            intent: 任务意图类型

        Returns:
            str: 选择的模型名称
        """
        # 数学和物理任务的专用模型列表
        if intent in (TaskIntent.MATH, TaskIntent.PHYSICS):
            candidates = [
                "llama3.1:70b",
                "llama3.1:8b",
                "qwen2.5:72b",
                "qwen2.5:14b",
                "phi3:medium",
                "phi3:mini",
            ]
        elif intent == TaskIntent.CODE:
            candidates = [
                "codellama:70b",
                "codellama:34b",
                "codellama:13b",
                "llama3.1:8b",
                "phi3:medium",
            ]
        elif intent == TaskIntent.CREATIVE:
            candidates = [
                "llama3.1:70b",
                "llama3.1:8b",
                "mistral:7b",
                "phi3:medium",
            ]
        else:
            candidates = [
                self.config.model_primary,
                self.config.model_fallback,
                "llama3.1:8b",
                "phi3:medium",
            ]

        for model in candidates:
            if model in self.available_models:
                return model

        # 回退到任意可用模型
        if self.available_models:
            return self.available_models[0]
        return self.config.model_fallback

    def route(self, task: TaskRequest) -> Tuple[str, str]:
        """对任务进行路由，返回模型和系统提示词。

        Args:
            task: 任务请求对象

        Returns:
            Tuple[str, str]: (模型名称, 系统提示词)
        """
        model = self.select_model(task.intent)
        system_prompt = self._build_system_prompt(task.intent)
        return model, system_prompt

    @staticmethod
    def _build_system_prompt(intent: TaskIntent) -> str:
        """根据意图构建系统提示词。

        Args:
            intent: 任务意图类型

        Returns:
            str: 对应的系统提示词
        """
        base = "You are a helpful, accurate, and thorough AI assistant."
        if intent == TaskIntent.MATH:
            return (
                base + "\n\nYou are in ADVANCED MATHEMATICAL REASONING MODE.\n"
                "Core Principles:\n"
                "1. Hierarchical Decomposition: Break complex problems into layered sub-problems\n"
                "2. Emergent Property Analysis: Identify how local rules produce global patterns\n"
                "3. Connectivity-Based Reasoning: Use graph/network structures to model relationships\n"
                "4. Recursive Verification: Validate each step before proceeding\n"
                "5. Modular Abstraction: Build reusable mathematical components\n"
                "\nRules:\n"
                "1. Show all steps clearly and logically\n"
                "2. Define variables and state assumptions\n"
                "3. Verify intermediate results\n"
                "4. Use LaTeX-style formatting for equations when helpful\n"
                "5. If a problem is ambiguous, ask for clarification\n"
                "6. Double-check final answers for consistency\n"
                "7. For proofs: state strategy, execute steps, verify conclusion\n"
                "8. For computations: estimate order of magnitude first\n"
                "9. For constructions: build layer by layer, verify each layer\n"
                "10. For classifications: use invariant properties and symmetry"
            )
        elif intent == TaskIntent.PHYSICS:
            return (
                base + "\n\nYou are in PHYSICAL REASONING MODE.\n"
                "Core Principles:\n"
                "1. First Principles: Start from fundamental laws, not phenomenology\n"
                "2. Hierarchical Scales: Separate microscopic and macroscopic descriptions\n"
                "3. Emergent Phenomena: Explain how collective behavior arises from individual rules\n"
                "4. Conservation Laws: Track energy, momentum, charge, information\n"
                "5. Dimensional Analysis: Check units at every step\n"
                "\nRules:\n"
                "1. State relevant physical laws and principles\n"
                "2. Include units in all calculations\n"
                "3. Check dimensional consistency\n"
                "4. Consider edge cases and approximations\n"
                "5. Reference standard constants (c, G, h, k_B, etc.)\n"
                "6. Validate results against physical intuition"
            )
        elif intent == TaskIntent.CODE:
            return (
                base + "\n\nYou are in CODE GENERATION MODE.\n"
                "Core Principles:\n"
                "1. Modular Design: Functions should be composable\n"
                "2. Layered Architecture: Separate concerns into layers\n"
                "3. Recursive Patterns: Use recursion for hierarchical structures\n"
                "4. Connectivity Awareness: Consider data flow as a graph\n"
                "5. Emergent Behavior: Test how components interact\n"
                "\nRules:\n"
                "1. Write clean, documented, and efficient code\n"
                "2. Include error handling where appropriate\n"
                "3. Explain complex logic with comments\n"
                "4. Follow language-specific best practices\n"
                "5. Provide usage examples when helpful"
            )
        return base
