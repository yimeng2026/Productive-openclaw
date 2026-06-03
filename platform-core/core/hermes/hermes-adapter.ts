import {
  PlatformAdapter,
  ChatParams,
  ChatResponse,
  ChatMessage,
  AgentConfig,
  PlatformStatus,
  ModelInfo,
  Tool,
} from '../unified-adapter';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

// ═══════════════════════════════════════════════════════════════
// Hermes Agent 适配器 — 实现统一接口
// 源代码路径: platforms/hermes/
// ═══════════════════════════════════════════════════════════════

export class HermesAdapter extends PlatformAdapter {
  readonly id = 'hermes';
  readonly name = 'Hermes Agent';
  readonly version = '1.0.0';
  readonly sourcePath = 'platforms/hermes';

  private process?: ReturnType<typeof spawn>;
  private baseDir: string;
  private isRunning = false;

  constructor() {
    super();
    this.baseDir = path.resolve(process.cwd(), this.sourcePath);
    this.status.id = this.id;
    this.status.name = this.name;
    this.status.version = this.version;
  }

  // ── 生命周期 ────────────────────────────────────────────────

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;

    // 检查源代码是否存在
    if (!fs.existsSync(this.baseDir)) {
      throw new Error(`Hermes source not found at ${this.baseDir}. Run download-platforms.ps1 first.`);
    }

    // 检查 Python 环境
    const hasUv = await this.commandExists('uv');
    const hasPython = await this.commandExists('python3') || await this.commandExists('python');

    if (!hasUv && !hasPython) {
      throw new Error('Python 3 or uv is required to run Hermes');
    }

    // 安装依赖（如果未安装）
    const venvPath = path.join(this.baseDir, '.venv');
    if (!fs.existsSync(venvPath)) {
      console.log('[Hermes] Setting up virtual environment...');
      await this.runCommand('uv sync || pip install -r requirements.txt');
    }

    this.status.status = 'offline';
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('[Hermes] Starting Hermes agent...');

    // 启动 Hermes Gateway 或 CLI
    const hermesCmd = process.platform === 'win32' ? 'hermes.cmd' : 'hermes';
    const hermesPath = path.join(this.baseDir, '.venv', 'Scripts', hermesCmd);

    this.process = spawn(hermesPath, ['gateway'], {
      cwd: this.baseDir,
      env: {
        ...process.env,
        PYTHONPATH: this.baseDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.isRunning = true;
    this.status.status = 'online';
    this.status.pid = this.process.pid;
    this.status.uptime = Date.now();

    // 监听输出
    this.process.stdout?.on('data', (data) => {
      const msg = data.toString();
      console.log('[Hermes]', msg.trim());
      if (msg.includes('Gateway ready')) {
        this.status.status = 'online';
      }
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[Hermes Error]', data.toString().trim());
    });

    this.process.on('exit', (code) => {
      console.log(`[Hermes] Process exited with code ${code}`);
      this.isRunning = false;
      this.status.status = 'offline';
      this.status.pid = undefined;
    });

    // 等待启动
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
    this.isRunning = false;
    this.status.status = 'offline';
  }

  // ── 核心功能 ────────────────────────────────────────────────

  async chat(params: ChatParams): Promise<ChatResponse> {
    // 调用 Hermes 的 CLI 或 API
    const prompt = params.messages.map(m => m.content).join('\n');
    const result = await this.runCommand(`hermes chat "${prompt.replace(/"/g, '\\"')}"`);

    return {
      content: result,
      model: this.config.model as string || 'hermes-default',
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: result.length / 4,
        totalTokens: (prompt.length + result.length) / 4,
      },
      finishReason: 'stop',
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatResponse> {
    // Hermes 流式输出
    const prompt = params.messages.map(m => m.content).join('\n');
    const proc = spawn('hermes', ['chat', '--stream', prompt], {
      cwd: this.baseDir,
      env: { ...process.env, PYTHONPATH: this.baseDir },
    });

    let buffer = '';
    for await (const chunk of proc.stdout) {
      buffer += chunk.toString();
      yield {
        content: buffer,
        model: this.config.model as string || 'hermes-default',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'streaming',
      };
    }
  }

  async execute(command: string, args?: string[]): Promise<string> {
    const cmd = args ? `${command} ${args.join(' ')}` : command;
    return this.runCommand(cmd);
  }

  async createAgent(config: AgentConfig): Promise<AgentConfig> {
    // 通过 Hermes 创建子 Agent
    const result = await this.runCommand(
      `hermes agent create --name "${config.name}" --model ${config.model || 'default'}`
    );
    return {
      ...config,
      id: `hermes-${Date.now()}`,
      platform: 'hermes',
    };
  }

  async listAgents(): Promise<AgentConfig[]> {
    const result = await this.runCommand('hermes agent list --json');
    try {
      const agents = JSON.parse(result);
      return agents.map((a: any) => ({
        id: a.id,
        name: a.name,
        platform: 'hermes',
        model: a.model,
        status: a.status,
        enabled: true,
      }));
    } catch {
      return [];
    }
  }

  async deleteAgent(id: string): Promise<void> {
    await this.runCommand(`hermes agent delete ${id}`);
  }

  // ── 工具与模型 ──────────────────────────────────────────────

  async getTools(): Promise<Tool[]> {
    return [
      { name: 'memory_search', description: '搜索记忆', parameters: {} },
      { name: 'skill_create', description: '创建技能', parameters: {} },
      { name: 'curator_run', description: '运行策展', parameters: {} },
    ];
  }

  async getModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'hermes-default',
        name: 'Hermes Default',
        provider: 'hermes',
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
        costPer1kTokens: { input: 0, output: 0 },
      },
    ];
  }

  // ── 状态监控 ──────────────────────────────────────────────

  async getLogs(lines = 50): Promise<string[]> {
    const logPath = path.join(this.baseDir, 'logs', 'hermes.log');
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.split('\n').slice(-lines);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.runCommand('hermes status');
      return true;
    } catch {
      return false;
    }
  }

  // ── 私有方法 ──────────────────────────────────────────────

  private async runCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd: this.baseDir }, (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve(stdout.trim());
      });
    });
  }

  private async commandExists(cmd: string): Promise<boolean> {
    return new Promise(resolve => {
      exec(`which ${cmd} || where ${cmd}`, (error) => {
        resolve(!error);
      });
    });
  }
}
