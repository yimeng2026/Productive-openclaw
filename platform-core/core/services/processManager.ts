import { spawn, ChildProcess, SpawnOptions } from "child_process";
import { logger } from "../server";

export interface ManagedProcess {
  id: string;
  pid: number;
  command: string;
  args: string[];
  status: "running" | "exited" | "error";
  startedAt: Date;
  exitedAt?: Date;
  exitCode?: number;
  stdout: string[];
  stderr: string[];
}

export interface SpawnOptionsExtended {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class ProcessManager {
  private processes = new Map<string, ChildProcess>();
  private processMetadata = new Map<string, ManagedProcess>();
  private killTimers = new Map<string, NodeJS.Timeout>();

  spawn(
    id: string,
    command: string,
    args: string[],
    options: SpawnOptionsExtended = {}
  ): ManagedProcess {
    if (this.processes.has(id)) {
      logger.warn({ id }, "Process already exists, killing old instance");
      this.kill(id);
    }

    logger.info({ id, command, args, cwd: options.cwd }, "Spawning process");

    const spawnOpts: SpawnOptions = {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (options.cwd) spawnOpts.cwd = options.cwd;
    if (options.env) spawnOpts.env = options.env;

    const child = spawn(command, args, spawnOpts);

    const meta: ManagedProcess = {
      id,
      pid: child.pid ?? -1,
      command,
      args,
      status: "running",
      startedAt: new Date(),
      stdout: [],
      stderr: [],
    };

    this.processes.set(id, child);
    this.processMetadata.set(id, meta);

    // Handle spawn failure immediately
    if (!child.pid) {
      meta.status = "error";
      logger.error({ id }, "Failed to spawn process (no pid)");
      return meta;
    }

    child.stdout?.on("data", (data: Buffer) => {
      const line = data.toString("utf-8").trimEnd();
      meta.stdout.push(line);
      if (meta.stdout.length > 1000) meta.stdout.shift();
      logger.debug({ id, pid: meta.pid, line }, "stdout");
    });

    child.stderr?.on("data", (data: Buffer) => {
      const line = data.toString("utf-8").trimEnd();
      meta.stderr.push(line);
      if (meta.stderr.length > 1000) meta.stderr.shift();
      logger.debug({ id, pid: meta.pid, line }, "stderr");
    });

    child.on("error", (err: Error) => {
      meta.status = "error";
      logger.error({ id, err: err.message }, "Process error");
      this.cleanup(id);
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      meta.status = code === 0 ? "exited" : "error";
      meta.exitedAt = new Date();
      meta.exitCode = code ?? undefined;
      logger.info(
        { id, code, signal },
        code === 0 ? "Process exited" : "Process exited with error"
      );
      this.clearKillTimer(id);
    });

    child.on("close", (code: number | null, signal: string | null) => {
      logger.debug({ id, code, signal }, "Process stdio closed");
      this.cleanup(id);
    });

    // Optional timeout kill
    if (options.timeoutMs && options.timeoutMs > 0) {
      setTimeout(() => {
        if (this.processes.has(id) && meta.status === "running") {
          logger.warn({ id, timeoutMs: options.timeoutMs }, "Process timeout, killing");
          this.kill(id);
        }
      }, options.timeoutMs);
    }

    return meta;
  }

  kill(id: string): boolean {
    const child = this.processes.get(id);
    if (!child) {
      logger.warn({ id }, "Kill requested for unknown process");
      return false;
    }

    if (child.killed || child.exitCode !== null) {
      logger.info({ id }, "Process already exited or killed");
      this.cleanup(id);
      return true;
    }

    logger.info({ id, pid: child.pid }, "Killing process (SIGTERM)");

    try {
      child.kill("SIGTERM");

      // Force kill after 5s if still running
      const forceKillTimeout = setTimeout(() => {
        const stillChild = this.processes.get(id);
        if (stillChild && !stillChild.killed && stillChild.exitCode === null) {
          logger.warn({ id, pid: stillChild.pid }, "Force killing with SIGKILL");
          stillChild.kill("SIGKILL");
        }
      }, 5000);
      this.killTimers.set(id, forceKillTimeout);
    } catch (err) {
      logger.error({ id, err: (err as Error).message }, "Failed to kill process");
      return false;
    }

    return true;
  }

  restart(
    id: string,
    command: string,
    args: string[],
    options?: SpawnOptionsExtended
  ): ManagedProcess | undefined {
    const meta = this.processMetadata.get(id);
    const wasRunning = meta?.status === "running";

    this.kill(id);
    // Wait a brief moment for cleanup, then respawn
    const newMeta = this.spawn(id, command, args, options);
    if (wasRunning) {
      logger.info({ id }, "Process restarted");
    }
    return newMeta;
  }

  list(): string[] {
    return Array.from(this.processMetadata.keys());
  }

  listRunning(): string[] {
    return Array.from(this.processMetadata.entries())
      .filter(([, meta]) => meta.status === "running")
      .map(([id]) => id);
  }

  getStatus(id: string): ManagedProcess | undefined {
    const meta = this.processMetadata.get(id);
    if (!meta) return undefined;

    const child = this.processes.get(id);
    if (child) {
      meta.pid = child.pid ?? meta.pid;
      // More accurate state: if exitCode is set, process has finished
      if (child.exitCode !== null && meta.status === "running") {
        meta.status = child.exitCode === 0 ? "exited" : "error";
        meta.exitCode = child.exitCode ?? undefined;
      }
    }

    return meta;
  }

  getLogs(id: string): { stdout: string[]; stderr: string[] } | undefined {
    const meta = this.processMetadata.get(id);
    if (!meta) return undefined;
    return {
      stdout: [...meta.stdout],
      stderr: [...meta.stderr],
    };
  }

  waitForExit(id: string, timeoutMs: number = 30000): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const meta = this.processMetadata.get(id);
      if (!meta) {
        reject(new Error(`Process ${id} not found`));
        return;
      }
      if (meta.status !== "running") {
        resolve(meta.exitCode ?? null);
        return;
      }

      const child = this.processes.get(id);
      if (!child) {
        resolve(meta.exitCode ?? null);
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for process ${id} to exit`));
      }, timeoutMs);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  pruneMetadata(maxAgeMs: number = 3600_000): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, meta] of this.processMetadata) {
      if (meta.status !== "running" && meta.exitedAt) {
        if (now - meta.exitedAt.getTime() > maxAgeMs) {
          this.processMetadata.delete(id);
          removed++;
        }
      }
    }
    logger.info({ removed }, "Pruned stale process metadata");
    return removed;
  }

  /** Kill all running processes. Used for shutdown. */
  killAll(): { killed: number; failed: number } {
    let killed = 0;
    let failed = 0;
    for (const [id, meta] of this.processMetadata) {
      if (meta.status === "running") {
        const ok = this.kill(id);
        ok ? killed++ : failed++;
      }
    }
    logger.info({ killed, failed }, "Killed all processes");
    return { killed, failed };
  }

  private cleanup(id: string): void {
    this.processes.delete(id);
    this.clearKillTimer(id);
  }

  private clearKillTimer(id: string): void {
    const timer = this.killTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.killTimers.delete(id);
    }
  }
}
