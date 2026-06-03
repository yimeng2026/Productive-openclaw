"""
cli.py - SRIA-SMIM 交互式命令行界面模块

提供基于 Rich 库的交互式 CLI，支持单任务处理、批量处理、
状态查询、数学模式和物理模式等功能。
"""

from __future__ import annotations

import json
import traceback
from typing import Optional

from rich.panel import Panel

from .core import TaskIntent, TaskRequest, console
from .engine import SRIAEngine


class CLI:
    """交互式命令行界面。

    提供丰富的交互体验，支持多种命令和专用模式。

    Attributes:
        engine: SRIA 引擎实例
    """

    def __init__(self) -> None:
        """初始化 CLI，创建并启动 SRIA 引擎。"""
        self.engine = SRIAEngine()

    def run(self) -> None:
        """运行交互式主循环。"""
        self.engine.status()
        console.print("\n[bold]Welcome to SRIA-SMIM![/bold] Type 'help' for commands, 'exit' to quit.\n")

        while True:
            try:
                user_input = console.input("[bold blue]>>>[/bold blue] ").strip()
                if not user_input:
                    continue
                if user_input.lower() in ("exit", "quit", "q"):
                    break
                if user_input.lower() == "help":
                    self._show_help()
                    continue
                if user_input.lower() == "status":
                    self.engine.status()
                    continue
                if user_input.lower() == "stats":
                    self.engine.stats()
                    continue
                if user_input.lower() == "diag":
                    diag = self.engine.diagnostics()
                    console.print_json(json.dumps(diag, indent=2, default=str))
                    continue
                if user_input.lower() == "math":
                    self._enter_math_mode()
                    continue
                if user_input.lower() == "physics":
                    self._enter_physics_mode()
                    continue
                if user_input.lower().startswith("batch "):
                    prompts = user_input[6:].split(";")
                    results = self.engine.process_batch([p.strip() for p in prompts if p.strip()])
                    for r in results:
                        self._display_result(r)
                    continue

                # 单条提示词处理
                result = self.engine.process(user_input)
                self._display_result(result)

            except KeyboardInterrupt:
                console.print("\n[yellow]Interrupted.[/yellow]")
                break
            except Exception as exc:
                console.print(f"[red]Error: {exc}[/red]")
                traceback.print_exc()

        self.engine.shutdown()

    def _enter_math_mode(self) -> None:
        """进入高级数学推理模式，支持层次分解。"""
        console.print(Panel(
            "[bold cyan]Advanced Mathematical Reasoning Mode[/bold cyan]\n\n"
            "Features:\n"
            "  • Hierarchical problem decomposition\n"
            "  • Emergent property analysis\n"
            "  • Connectivity-based reasoning\n"
            "  • Recursive verification\n"
            "  • Modular abstraction\n\n"
            "Type your mathematical problem (or 'back' to return):",
            title="Math Mode",
            border_style="cyan"
        ))
        while True:
            prompt = console.input("[bold cyan]math>>>[/bold cyan] ").strip()
            if prompt.lower() in ("back", "return", "exit"):
                break
            if not prompt:
                continue
            # 强制数学意图
            import uuid
            task = TaskRequest(
                task_id=str(uuid.uuid4()),
                prompt=prompt,
                intent=TaskIntent.MATH,
                context="Advanced mathematical reasoning with hierarchical decomposition and emergent analysis",
            )
            future = self.engine.cluster.submit(task)
            result = future.result()
            self._display_result(result)

    def _enter_physics_mode(self) -> None:
        """进入高级物理推理模式，基于第一性原理。"""
        console.print(Panel(
            "[bold green]Advanced Physical Reasoning Mode[/bold green]\n\n"
            "Features:\n"
            "  • First principles derivation\n"
            "  • Hierarchical scale separation\n"
            "  • Emergent phenomena analysis\n"
            "  • Conservation law tracking\n"
            "  • Dimensional analysis\n\n"
            "Type your physics problem (or 'back' to return):",
            title="Physics Mode",
            border_style="green"
        ))
        while True:
            prompt = console.input("[bold green]physics>>>[/bold green] ").strip()
            if prompt.lower() in ("back", "return", "exit"):
                break
            if not prompt:
                continue
            # 强制物理意图
            import uuid
            task = TaskRequest(
                task_id=str(uuid.uuid4()),
                prompt=prompt,
                intent=TaskIntent.PHYSICS,
                context="Advanced physical reasoning with first principles and emergent phenomena",
            )
            future = self.engine.cluster.submit(task)
            result = future.result()
            self._display_result(result)

    def _show_help(self) -> None:
        """显示帮助信息。"""
        help_text = """
[bold]Available Commands:[/bold]
  [cyan]<prompt>[/cyan]       Process a single prompt
  [cyan]batch <p1; p2>[/cyan] Process multiple prompts in parallel
  [cyan]status[/cyan]         Show system status
  [cyan]stats[/cyan]          Show monitoring statistics
  [cyan]diag[/cyan]           Run full diagnostics
  [cyan]math[/cyan]           Enter advanced math reasoning mode
  [cyan]physics[/cyan]        Enter advanced physics reasoning mode
  [cyan]help[/cyan]           Show this help message
  [cyan]exit[/cyan]           Quit the application

[bold]Advanced Math Mode Features:[/bold]
  - Hierarchical problem decomposition
  - Emergent property analysis
  - Connectivity-based reasoning
  - Recursive verification
  - Modular abstraction
        """
        console.print(help_text)

    def _display_result(self, result) -> None:
        """显示任务执行结果。

        Args:
            result: 任务结果对象
        """
        color = "green" if result.success else "red"
        console.print(Panel(
            result.content or "[No output]",
            title=f"[bold {color}]Result ({result.model_used}, {result.latency_ms}ms)[/bold {color}]",
            border_style=color,
        ))
        if result.error:
            console.print(f"[red]Error: {result.error}[/red]")


def main() -> int:
    """应用程序入口点。

    Returns:
        int: 退出码，0 表示成功
    """
    try:
        cli = CLI()
        cli.run()
        return 0
    except Exception as exc:
        console.print(f"[red]Fatal error: {exc}[/red]")
        traceback.print_exc()
        return 1
