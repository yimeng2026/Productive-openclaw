"""
client.py - SRIA-SMIM Ollama API 客户端模块

提供与 Ollama API 通信的功能，包括模型生成和可用性检测。
"""

from __future__ import annotations

import requests

from .core import OLLAMA_HOST


class OllamaClient:
    """处理与 Ollama API 的通信。

    Attributes:
        host: Ollama 服务的主机地址
    """

    def __init__(self, host: str = OLLAMA_HOST) -> None:
        """初始化 OllamaClient。

        Args:
            host: Ollama 服务地址，默认从环境变量或 localhost 获取
        """
        self.host = host

    def generate(self, model: str, prompt: str, system: str = "", timeout: int = 90) -> str:
        """调用 Ollama API 生成文本。

        Args:
            model: 模型名称
            prompt: 用户提示词
            system: 系统提示词
            timeout: 请求超时时间（秒）

        Returns:
            str: 模型生成的响应文本

        Raises:
            requests.HTTPError: 当 API 请求失败时
        """
        payload = {
            "model": model,
            "prompt": prompt,
            "system": system,
            "stream": False,
            "options": {"temperature": 0.7, "num_predict": 2048},
        }
        resp = requests.post(f"{self.host}/api/generate", json=payload, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")

    def is_available(self) -> bool:
        """检查 Ollama 服务是否可用。

        Returns:
            bool: Ollama 服务是否可达
        """
        try:
            requests.get(f"{self.host}/api/tags", timeout=3)
            return True
        except Exception:
            return False
