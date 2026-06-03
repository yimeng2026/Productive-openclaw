#!/usr/bin/env python3
"""
OpenClaw Configuration Injector (config-patcher)

功能:
- 读取并修改 OpenClaw 的配置文件
- 添加 productive-openclaw 相关的环境变量
- 注入 provider 配置（ollama桥接端点、多Provider API路由）
- 支持 JSON / YAML / DOTENV 格式配置
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


class ConfigPatcher:
    """
    配置注入工具，支持多种配置文件格式的读取与修改。

    Supported formats:
        - JSON (.json)
        - YAML  (.yaml, .yml) — requires PyYAML
        - DOTENV (.env)
    """

    def __init__(self) -> None:
        self._yaml_available = False
        try:
            import yaml

            self._yaml = yaml
            self._yaml_available = True
        except ImportError:
            pass

    # ─── Format Detection ────────────────────────────────

    def _detect_format(self, filepath: Union[str, Path]) -> str:
        """根据文件扩展名检测配置格式"""
        path = Path(filepath)
        suffix = path.suffix.lower()
        if suffix in (".yaml", ".yml"):
            return "yaml"
        elif suffix == ".json":
            return "json"
        elif suffix == ".env" or path.name.startswith("."):
            return "dotenv"
        return "unknown"

    # ─── Read / Write ────────────────────────────────────

    def _read(self, filepath: Path) -> Any:
        """读取配置文件，自动检测格式"""
        fmt = self._detect_format(filepath)
        content = filepath.read_text(encoding="utf-8")

        if fmt == "json":
            return json.loads(content)
        elif fmt == "yaml":
            if not self._yaml_available:
                raise ImportError("PyYAML is required for YAML support: pip install pyyaml")
            return self._yaml.safe_load(content) or {}
        elif fmt == "dotenv":
            return self._parse_dotenv(content)
        return content

    def _write(self, filepath: Path, data: Any) -> None:
        """写入配置文件，自动检测格式"""
        fmt = self._detect_format(filepath)

        if fmt == "json":
            filepath.write_text(
                json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        elif fmt == "yaml":
            if not self._yaml_available:
                raise ImportError("PyYAML is required for YAML support")
            filepath.write_text(
                self._yaml.dump(data, default_flow_style=False, allow_unicode=True),
                encoding="utf-8",
            )
        elif fmt == "dotenv":
            filepath.write_text(self._serialize_dotenv(data), encoding="utf-8")
        else:
            filepath.write_text(str(data), encoding="utf-8")

    # ─── DOTENV Helpers ──────────────────────────────────

    @staticmethod
    def _parse_dotenv(content: str) -> Dict[str, str]:
        """解析 .env 文件内容为字典"""
        result: Dict[str, str] = {}
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                result[key.strip()] = value.strip().strip('"\'')
        return result

    @staticmethod
    def _serialize_dotenv(data: Dict[str, str]) -> str:
        """将字典序列化为 .env 格式"""
        lines = []
        for key, value in sorted(data.items()):
            if " " in value or "#" in value:
                value = f'"{value}"'
            lines.append(f"{key}={value}")
        return "\n".join(lines) + "\n"

    # ─── Public Operations ───────────────────────────────

    def add_provider(
        self,
        filepath: Union[str, Path],
        provider_config: Dict[str, Any],
        key_path: Optional[str] = None,
    ) -> bool:
        """
        向配置文件中添加一个 provider。

        Args:
            filepath: 配置文件路径
            provider_config: Provider 配置字典
            key_path: 配置中 provider 列表的键路径 (默认自动检测)
        """
        path = Path(filepath)
        if not path.exists():
            return False

        data = self._read(path)
        fmt = self._detect_format(path)

        if fmt == "json":
            return self._inject_to_json(data, path, provider_config, key_path)
        elif fmt == "yaml":
            return self._inject_to_yaml(data, path, provider_config, key_path)
        elif fmt == "dotenv":
            # 对于 .env 文件，将 provider 序列化为 JSON 字符串
            env_key = f"PROVIDER_{provider_config.get('name', 'custom').upper()}_CONFIG"
            data[env_key] = json.dumps(provider_config, ensure_ascii=False)
            self._write(path, data)
            return True

        return False

    def merge_env_file(
        self, filepath: Union[str, Path], env_vars: Dict[str, str]
    ) -> bool:
        """
        向 .env 文件合并环境变量。

        Args:
            filepath: .env 文件路径（不存在则创建）
            env_vars: 要添加/更新的环境变量字典
        """
        path = Path(filepath)
        existing: Dict[str, str] = {}

        if path.exists():
            existing = self._read(path)
        else:
            # 创建新文件时添加头部注释
            header_lines = [
                "# OpenClaw Extension - Productive OpenClaw",
                f"# Generated: {__import__('datetime').datetime.utcnow().isoformat()}",
                "",
            ]
            path.write_text("\n".join(header_lines), encoding="utf-8")

        merged = {**existing, **env_vars}
        # 在新增变量前添加注释
        if path.exists():
            content = path.read_text(encoding="utf-8")
            if "OLLAMA_BRIDGE_ENABLED" not in content:
                content += "\n# --- Ollama Bridge Configuration ---\n"
                for key, value in env_vars.items():
                    content += f"{key}={value}\n"
                path.write_text(content, encoding="utf-8")
                return True

        self._write(path, merged)
        return True

    def set_nested_key(
        self,
        data: Dict[str, Any],
        key_path: str,
        value: Any,
        create: bool = True,
    ) -> Dict[str, Any]:
        """
        在嵌套字典中设置键值（支持点号路径）。

        Args:
            data: 嵌套字典
            key_path: 点号分隔的键路径，如 "config.providers.sylva"
            value: 要设置的值
            create: 是否自动创建中间层级
        """
        keys = key_path.split(".")
        current = data
        for key in keys[:-1]:
            if key not in current:
                if create:
                    current[key] = {}
                else:
                    raise KeyError(f"Key path segment not found: {key}")
            current = current[key]
        current[keys[-1]] = value
        return data

    # ─── Format-specific Injection ───────────────────────

    def _inject_to_json(
        self,
        data: Dict[str, Any],
        filepath: Path,
        provider: Dict[str, Any],
        key_path: Optional[str],
    ) -> bool:
        """向 JSON 配置文件注入 provider"""
        target_key = key_path or self._find_providers_key(data)

        if target_key:
            # 使用点号路径导航
            keys = target_key.split(".")
            current = data
            for key in keys[:-1]:
                current = current.setdefault(key, {})
            target_list = current.setdefault(keys[-1], [])
        else:
            target_list = data.setdefault("providers", [])

        if not isinstance(target_list, list):
            target_list = list(target_list) if target_list else []

        # 去重：检查是否已存在同名 provider
        provider_name = provider.get("name", "")
        for i, existing in enumerate(target_list):
            if isinstance(existing, dict) and existing.get("name") == provider_name:
                target_list[i] = provider
                break
        else:
            target_list.append(provider)

        if target_key:
            keys = target_key.split(".")
            current = data
            for key in keys[:-1]:
                current = current.setdefault(key, {})
            current[keys[-1]] = target_list
        else:
            data["providers"] = target_list

        self._write(filepath, data)
        return True

    def _inject_to_yaml(
        self,
        data: Dict[str, Any],
        filepath: Path,
        provider: Dict[str, Any],
        key_path: Optional[str],
    ) -> bool:
        """向 YAML 配置文件注入 provider"""
        return self._inject_to_json(data, filepath, provider, key_path)

    def _find_providers_key(self, data: Dict[str, Any]) -> Optional[str]:
        """自动探测配置中的 providers 键路径"""
        candidates = ["providers", "config.providers", "app.providers"]
        for candidate in candidates:
            keys = candidate.split(".")
            current = data
            found = True
            for key in keys:
                if isinstance(current, dict) and key in current:
                    current = current[key]
                else:
                    found = False
                    break
            if found:
                return candidate
        return None

    # ─── Route Injection ─────────────────────────────────

    def add_api_routes(
        self,
        filepath: Union[str, Path],
        routes: List[Dict[str, Any]],
    ) -> bool:
        """
        向配置文件添加 API 路由定义。

        Args:
            filepath: 配置文件路径
            routes: 路由定义列表
        """
        path = Path(filepath)
        if not path.exists():
            return False

        data = self._read(path)
        routes_config = data.setdefault("routes", [])
        if isinstance(routes_config, dict):
            routes_config = routes_config.setdefault("api", [])

        for route in routes:
            # 去重
            if not any(r.get("path") == route.get("path") for r in routes_config):
                routes_config.append(route)

        self._write(path, data)
        return True

    # ─── Utility ─────────────────────────────────────────

    def validate_config(self, filepath: Union[str, Path]) -> Dict[str, Any]:
        """
        验证配置文件的有效性和完整性。

        Returns:
            {"valid": bool, "errors": List[str], "format": str}
        """
        path = Path(filepath)
        result = {"valid": False, "errors": [], "format": "unknown"}

        if not path.exists():
            result["errors"].append("文件不存在")
            return result

        try:
            fmt = self._detect_format(path)
            result["format"] = fmt
            data = self._read(path)

            if not isinstance(data, dict):
                result["errors"].append(f"配置根应为对象，实际为 {type(data).__name__}")
                return result

            result["valid"] = len(result["errors"]) == 0
        except json.JSONDecodeError as e:
            result["errors"].append(f"JSON 解析失败: {e}")
        except Exception as e:
            result["errors"].append(f"读取失败: {e}")

        return result


# ─── CLI ──────────────────────────────────────────────────

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Configuration Patcher Tool")
    parser.add_argument("file", help="配置文件路径")
    parser.add_argument("--add-provider", dest="provider_json", help="要添加的Provider JSON")
    parser.add_argument("--merge-env", dest="env_json", help="要合并的环境变量JSON")
    parser.add_argument("--validate", action="store_true", help="验证配置文件")
    args = parser.parse_args()

    patcher = ConfigPatcher()
    path = Path(args.file)

    if args.validate:
        result = patcher.validate_config(path)
        print(f"Valid: {result['valid']}")
        print(f"Format: {result['format']}")
        if result["errors"]:
            for err in result["errors"]:
                print(f"  Error: {err}")

    if args.provider_json:
        import json as _json

        provider = _json.loads(args.provider_json)
        ok = patcher.add_provider(path, provider)
        print(f"Provider added: {ok}")

    if args.env_json:
        import json as _json

        env_vars = _json.loads(args.env_json)
        ok = patcher.merge_env_file(path, env_vars)
        print(f"Env merged: {ok}")


if __name__ == "__main__":
    main()
