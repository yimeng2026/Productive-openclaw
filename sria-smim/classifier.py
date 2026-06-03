"""
classifier.py - SRIA-SMIM 意图分类模块

基于关键词匹配的用户输入意图分类器，用于后续模型路由决策。
"""

from __future__ import annotations

from typing import Dict, List

from .core import TaskIntent


class IntentClassifier:
    """将用户提示词分类为任务意图，用于模型路由。

    基于关键词匹配进行意图识别，支持数学、物理、编程、创意和分析五类意图。
    """

    KEYWORDS: Dict[TaskIntent, List[str]] = {
        TaskIntent.MATH: [
            "calculate", "solve", "equation", "integral", "derivative",
            "algebra", "geometry", "theorem", "proof", "number theory",
            "linear algebra", "calculus", "differential", "matrix",
            "eigenvalue", "vector", "probability", "statistics", "optimization",
            "stratified", "layered", "causal", "emergent", "connectivity",
            "recursive", "hierarchical", "modular", "fiber bundle",
        ],
        TaskIntent.PHYSICS: [
            "physics", "quantum", "thermodynamics", "electromagnetism",
            "mechanics", "relativity", "newton", "maxwell", "schrodinger",
            "particle", "wave", "energy", "momentum", "force", "field",
            "gravity", "entropy", "temperature", "pressure", "velocity",
        ],
        TaskIntent.CODE: [
            "code", "program", "function", "class", "debug", "algorithm",
            "python", "javascript", "java", "c++", "rust", "go", "sql",
            "api", "database", "json", "xml", "html", "css",
        ],
        TaskIntent.CREATIVE: [
            "story", "poem", "write", "creative", "imagine", "fiction",
            "novel", "character", "plot", "dialogue", "script", "song",
        ],
        TaskIntent.ANALYSIS: [
            "analyze", "compare", "evaluate", "assess", "review", "report",
            "summary", "synthesize", "critique", "examine", "study",
        ],
    }

    @classmethod
    def classify(cls, prompt: str) -> TaskIntent:
        """对提示词进行意图分类。

        通过统计各类关键词在提示词中的出现次数来确定意图。
        如果没有匹配到任何关键词，返回 GENERAL。

        Args:
            prompt: 用户输入的提示词

        Returns:
            TaskIntent: 检测到的任务意图
        """
        prompt_lower = prompt.lower()
        scores: Dict[TaskIntent, int] = {intent: 0 for intent in TaskIntent}
        for intent, keywords in cls.KEYWORDS.items():
            for kw in keywords:
                scores[intent] += prompt_lower.count(kw)
        if max(scores.values()) == 0:
            return TaskIntent.GENERAL
        return max(scores, key=scores.get)
