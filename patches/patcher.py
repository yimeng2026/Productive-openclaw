#!/usr/bin/env python3
"""
OpenClaw Patcher Engine
将 productive-openclaw 作为扩展架构应用到 OpenClaw 实例

Core Features:
- 检测当前环境中的 OpenClaw 安装路径
- 备份原始配置文件
- 注入 productive-openclaw 的扩展配置
- 提供 apply() 和 revert() 方法
- 验证补丁应用后的完整性
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from patches.config_patcher import ConfigPatcher


# ═══════════════════════════════════════════════════════════
# Extension configuration to be injected
# ═══════════════════════════════════════════════════════════

DEFAULT_SYLVA_PROVIDER = {
    "name": "sylva-provider",
    "type": "custom",
    "module": "productive_openclaw.providers.sylva_provider",
    "version": "2.0.0",
    "priority": 100,
    "endpoints": {
        "base": "/api/v2/sylva",
        "health": "/api/v2/sylva/health",
        "inference": "/api/v2/sylva/inference",
        "agents": "/api/v2/sylva/agents",
    },
    "features": ["recursive-inference", "multi-agent-orchestration", "context-window-optimization"],
}

DEFAULT_OLLAMA_BRIDGE = {
    "name": "ollama-bridge",
    "type": "bridge",
    "target": "ollama",
    "endpoint": "http://localhost:11434",
    "routes": {
        "models": "/api/tags",
        "generate": "/api/generate",
        "chat": "/api/chat",
        "embeddings": "/api/embeddings",
    },
    "fallback_enabled": True,
    "timeout_seconds": 120,
}

DEFAULT_UNIFIED_API_ROUTES = [
    {
        "path": "/api/v2/unified/chat",
        "method": "POST",
        "handler": "productive_openclaw.handlers.unified_chat_handler",
        "description": "多Provider统一聊天接口，自动路由到最佳后端",
    },
    {
        "path": "/api/v2/unified/models",
        "method": "GET",
        "handler": "productive_openclaw.handlers.unified_models_handler",
        "description": "聚合所有Provider的可用模型列表",
    },
    {
        "path": "/api/v2/unified/agents",
        "method": "GET|POST",
        "handler": "productive_openclaw.handlers.agent_orchestrator_handler",
        "description": "Agent编排与状态管理",
    },
]

DEFAULT_3DACP_COORDINATOR = {
    "name": "3dacp-coordinator",
    "type": "coordinator",
    "enabled": True,
    "config": {
        "sria_engine_url": "http://localhost:8500",
        "context_window_size": 128000,
        "max_recursion_depth": 5,
        "enable_self_correction": True,
        "model_routing": {
            "default": "ollama/llama3",
            "code": "ollama/codellama",
            "analysis": "ollama/llama3",
            "creative": "ollama/mistral",
        },
    },
}


@dataclass
class PatchManifest:
    """补丁清单，记录所有修改的文件和元数据"""

    version: str = "2.0.0"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    target_dir: str = ""
    backup_dir: str = ""
    files_modified: List[str] = field(default_factory=list)
    files_created: List[str] = field(default_factory=list)
    checksums: Dict[str, str] = field(default_factory=dict)
    status: str = "pending"  # pending | applied | reverted

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "created_at": self.created_at,
            "target_dir": self.target_dir,
            "backup_dir": self.backup_dir,
            "files_modified": self.files_modified,
            "files_created": self.files_created,
            "checksums": self.checksums,
            "status": self.status,
        }

    def save(self, path: Path) -> None:
        path.write_text(json.dumps(self.to_dict(), indent=2, ensure_ascii=False))

    @classmethod
    def load(cls, path: Path) -> "PatchManifest":
        data = json.loads(path.read_text())
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


class PatcherEngine:
    """
    OpenClaw 扩展补丁引擎

    负责检测、备份、注入配置、验证和回滚整个补丁流程。

    Usage:
        engine = PatcherEngine()
        engine.apply()
        # ... 或 ...
        engine.revert()
    """

    PATCH_MANIFEST_NAME = ".productive_openclaw_patch.json"
    BACKUP_DIR_PREFIX = ".backup_openclaw"

    def __init__(self, target_dir: Optional[str] = None) -> None:
        self.target_dir = Path(target_dir or self._detect_openclaw_installation())
        self.backup_dir: Optional[Path] = None
        self.manifest: PatchManifest = PatchManifest(target_dir=str(self.target_dir))
        self.config_patcher = ConfigPatcher()
        self._console_color = {
            "green": "\033[92m",
            "red": "\033[91m",
            "yellow": "\033[93m",
            "blue": "\033[94m",
            "reset": "\033[0m",
            "bold": "\033[1m",
        }

    # ─── Detection ───────────────────────────────────────

    def _detect_openclaw_installation(self) -> str:
        """自动检测 OpenClaw 安装路径"""
        candidates = [
            os.environ.get("OPENCLAW_HOME"),
            os.environ.get("OPENCLAW_DIR"),
            "/opt/openclaw",
            "/usr/local/openclaw",
            os.path.expanduser("~/openclaw"),
            os.path.expanduser("~/.openclaw"),
            os.path.join(os.getcwd(), "openclaw"),
            os.getcwd(),
        ]
        for candidate in candidates:
            if not candidate:
                continue
            candidate_path = Path(candidate).resolve()
            if self._is_openclaw_root(candidate_path):
                return str(candidate_path)
        # 如果未找到，使用当前目录并发出警告
        self._log("warning", "未检测到标准 OpenClaw 安装路径，将使用当前目录")
        return os.getcwd()

    def _is_openclaw_root(self, path: Path) -> bool:
        """判断路径是否为 OpenClaw 安装根目录"""
        indicators = ["package.json", "src", "config", "node_modules"]
        return path.exists() and all((path / ind).exists() for ind in indicators[:2])

    # ─── Logging ─────────────────────────────────────────

    def _log(self, level: str, message: str) -> None:
        """带颜色日志输出"""
        colors = {
            "info": self._console_color["blue"],
            "success": self._console_color["green"],
            "warning": self._console_color["yellow"],
            "error": self._console_color["red"],
        }
        prefix = {"info": "[INFO]", "success": "[OK]", "warning": "[WARN]", "error": "[ERR]"}
        color = colors.get(level, "")
        pre = prefix.get(level, "[?]")
        reset = self._console_color["reset"]
        print(f"{color}{pre}{reset} {message}")

    # ─── Backup ──────────────────────────────────────────

    def _create_backup(self) -> Path:
        """创建原始配置备份"""
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        backup_dir = self.target_dir / f"{self.BACKUP_DIR_PREFIX}_{timestamp}"
        backup_dir.mkdir(parents=True, exist_ok=True)

        files_to_backup = [
            "package.json",
            "config.yaml",
            "config.yml",
            "config.json",
            ".env",
            "src/config",
            "src/routes",
        ]

        for rel_path in files_to_backup:
            src = self.target_dir / rel_path
            if src.exists():
                dst = backup_dir / rel_path
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src.is_file():
                    shutil.copy2(src, dst)
                elif src.is_dir():
                    shutil.copytree(src, dst, dirs_exist_ok=True)

        self.backup_dir = backup_dir
        self.manifest.backup_dir = str(backup_dir)
        self._log("success", f"备份已创建: {backup_dir}")
        return backup_dir

    # ─── Configuration Injection ─────────────────────────

    def _inject_provider_config(self) -> None:
        """注入 sylva-provider 到 provider 列表"""
        config_files = ["config.yaml", "config.yml", "config.json", "package.json"]
        injected = False

        for config_name in config_files:
            config_path = self.target_dir / config_name
            if not config_path.exists():
                continue

            try:
                self.config_patcher.add_provider(
                    config_path, DEFAULT_SYLVA_PROVIDER
                )
                injected = True
                self.manifest.files_modified.append(str(config_path))
                self._log("success", f"已注入 sylva-provider 到 {config_name}")
            except Exception as e:
                self._log("warning", f"注入 {config_name} 失败: {e}")

        if not injected:
            self._log("warning", "未找到可注入的 provider 配置文件，将创建新配置")
            new_config = self.target_dir / "config.openclaw.json"
            new_config.write_text(
                json.dumps(
                    {"providers": [DEFAULT_SYLVA_PROVIDER]}, indent=2, ensure_ascii=False
                )
            )
            self.manifest.files_created.append(str(new_config))

    def _inject_ollama_bridge(self) -> None:
        """注入 Ollama 桥接端点配置"""
        env_path = self.target_dir / ".env"
        bridge_vars = {
            "OLLAMA_BRIDGE_ENABLED": "true",
            "OLLAMA_BRIDGE_ENDPOINT": DEFAULT_OLLAMA_BRIDGE["endpoint"],
            "OLLAMA_BRIDGE_TIMEOUT": str(DEFAULT_OLLAMA_BRIDGE["timeout_seconds"]),
            "OLLAMA_BRIDGE_FALLBACK": "true",
            "OLLAMA_HOST": "http://localhost:11434",
        }
        self.config_patcher.merge_env_file(env_path, bridge_vars)

        if env_path not in self.manifest.files_modified and env_path.exists():
            self.manifest.files_modified.append(str(env_path))

        self._log("success", "已注入 Ollama 桥接端点配置")

    def _inject_unified_api_routes(self) -> None:
        """添加统一API路由配置"""
        routes_config_path = self.target_dir / "config.unified-api.json"
        routes_config = {
            "unified_api": {
                "version": "v2",
                "routes": DEFAULT_UNIFIED_API_ROUTES,
                "middleware": [
                    "productive_openclaw.middleware.auth",
                    "productive_openclaw.middleware.rate_limit",
                    "productive_openclaw.middleware.provider_router",
                ],
            }
        }
        routes_config_path.write_text(
            json.dumps(routes_config, indent=2, ensure_ascii=False)
        )
        self.manifest.files_created.append(str(routes_config_path))
        self._log("success", f"已创建统一API路由配置: {routes_config_path}")

    def _inject_3dacp_coordinator(self) -> None:
        """注入 3DACP 协调器配置"""
        coordinator_path = self.target_dir / "config.3dacp.json"
        coordinator_config = {
            "coordinator": DEFAULT_3DACP_COORDINATOR,
            "sria": {
                "enabled": True,
                "engine_module": "sria_smim",
                "smim_version": "2.0",
                "recursion_limit": 5,
                "self_correction": True,
            },
        }
        coordinator_path.write_text(
            json.dumps(coordinator_config, indent=2, ensure_ascii=False)
        )
        self.manifest.files_created.append(str(coordinator_path))
        self._log("success", f"已注入 3DACP 协调器配置: {coordinator_path}")

    # ─── Checksum / Integrity ────────────────────────────

    def _compute_checksum(self, filepath: Path) -> str:
        """计算文件 SHA-256 校验和"""
        if not filepath.exists():
            return ""
        h = hashlib.sha256()
        h.update(filepath.read_bytes())
        return h.hexdigest()[:16]

    def _record_checksums(self) -> None:
        """记录所有修改/创建文件的校验和"""
        for fpath in self.manifest.files_modified + self.manifest.files_created:
            path = Path(fpath)
            self.manifest.checksums[fpath] = self._compute_checksum(path)

    # ─── Public API ──────────────────────────────────────

    def apply(self) -> bool:
        """
        应用补丁到 OpenClaw 实例。

        流程:
            1. 检测目标 OpenClaw 安装
            2. 创建原始配置备份
            3. 注入 sylva-provider
            4. 注入 Ollama 桥接端点
            5. 添加统一API路由
            6. 注入 3DACP 协调器配置
            7. 记录校验和并验证完整性
            8. 保存补丁清单
        """
        self._log("info", f"{'='*50}")
        self._log("info", "OpenClaw Extension Patcher v2.0.0")
        self._log("info", f"目标目录: {self.target_dir}")
        self._log("info", f"{'='*50}")

        if not self.target_dir.exists():
            self._log("error", f"目标目录不存在: {self.target_dir}")
            return False

        # 1. 创建备份
        self._log("info", "Step 1/6: 创建备份...")
        self._create_backup()

        # 2. 注入 provider
        self._log("info", "Step 2/6: 注入 sylva-provider...")
        self._inject_provider_config()

        # 3. 注入 Ollama 桥接
        self._log("info", "Step 3/6: 注入 Ollama 桥接端点...")
        self._inject_ollama_bridge()

        # 4. 注入统一API路由
        self._log("info", "Step 4/6: 添加统一API路由...")
        self._inject_unified_api_routes()

        # 5. 注入 3DACP 协调器
        self._log("info", "Step 5/6: 注入 3DACP 协调器配置...")
        self._inject_3dacp_coordinator()

        # 6. 验证 & 保存
        self._log("info", "Step 6/6: 验证完整性...")
        self._record_checksums()
        self.manifest.status = "applied"
        manifest_path = self.target_dir / self.PATCH_MANIFEST_NAME
        self.manifest.save(manifest_path)

        self._log("success", "补丁应用成功!")
        self._show_summary()
        return True

    def revert(self) -> bool:
        """
        回滚补丁，恢复到补丁前的状态。

        流程:
            1. 读取补丁清单
            2. 删除新增的文件
            3. 从备份恢复原始文件
            4. 更新清单状态
        """
        self._log("info", f"{'='*50}")
        self._log("info", "OpenClaw Extension Patcher - Revert Mode")
        self._log("info", f"{'='*50}")

        manifest_path = self.target_dir / self.PATCH_MANIFEST_NAME
        if not manifest_path.exists():
            self._log("error", "未找到补丁清单，无法回滚")
            self._log("info", "提示: 可以手动从 backup 目录恢复文件")
            return False

        self.manifest = PatchManifest.load(manifest_path)
        backup_dir = Path(self.manifest.backup_dir) if self.manifest.backup_dir else None

        if not backup_dir or not backup_dir.exists():
            self._log("error", f"备份目录不存在: {backup_dir}")
            return False

        # 1. 删除新增的文件
        for created in self.manifest.files_created:
            cpath = Path(created)
            if cpath.exists():
                cpath.unlink()
                self._log("success", f"已删除新增文件: {cpath.name}")

        # 2. 恢复修改的文件
        if backup_dir:
            for backed in backup_dir.rglob("*"):
                if backed.is_file():
                    rel = backed.relative_to(backup_dir)
                    original = self.target_dir / rel
                    original.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(backed, original)
                    self._log("success", f"已恢复: {rel}")

        # 3. 更新状态
        self.manifest.status = "reverted"
        self.manifest.save(manifest_path)
        self._log("success", "补丁已回滚!")
        return True

    def verify(self) -> bool:
        """验证当前补丁的完整性"""
        manifest_path = self.target_dir / self.PATCH_MANIFEST_NAME
        if not manifest_path.exists():
            self._log("warning", "未找到补丁清单")
            return False

        manifest = PatchManifest.load(manifest_path)
        all_ok = True
        for fpath, expected_checksum in manifest.checksums.items():
            current = self._compute_checksum(Path(fpath))
            if current != expected_checksum:
                self._log("error", f"校验和不匹配: {fpath}")
                all_ok = False

        if all_ok:
            self._log("success", "所有文件校验通过，补丁完整")
        return all_ok

    def _show_summary(self) -> None:
        """显示补丁应用摘要"""
        c = self._console_color
        print(f"\n{c['bold']}{'='*50}{c['reset']}")
        print(f"{c['green']}  补丁应用完成{c['reset']}")
        print(f"{c['bold']}{'='*50}{c['reset']}")
        print(f"  新增文件: {len(self.manifest.files_created)}")
        for f in self.manifest.files_created:
            print(f"    + {Path(f).name}")
        print(f"  修改文件: {len(self.manifest.files_modified)}")
        for f in self.manifest.files_modified:
            print(f"    ~ {Path(f).name}")
        print(f"  备份目录: {self.backup_dir}")
        print(f"{c['bold']}{'='*50}{c['reset']}\n")


# ─── CLI Entry Point ──────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="OpenClaw Extension Patcher")
    parser.add_argument(
        "action", choices=["apply", "revert", "verify"], help="操作类型"
    )
    parser.add_argument(
        "--target", "-t", default=None, help="OpenClaw 安装目录 (默认自动检测)"
    )
    args = parser.parse_args()

    engine = PatcherEngine(target_dir=args.target)

    if args.action == "apply":
        ok = engine.apply()
    elif args.action == "revert":
        ok = engine.revert()
    elif args.action == "verify":
        ok = engine.verify()
    else:
        ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
