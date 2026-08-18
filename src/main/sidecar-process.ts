import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { SidecarClient } from "./sidecar-client";

export type SidecarState = "starting" | "ready" | "error";

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type SidecarProcessOptions = {
  spawnFn: SpawnFn;
  client: SidecarClient;
  pythonExecutable: string;
  scriptArgs: readonly string[];
  healthPollIntervalMs?: number;
  maxHealthPollAttempts?: number;
};

const STDERR_TAIL_MAX_CHARS = 2000;

export class SidecarProcess {
  private readonly spawnFn: SpawnFn;
  private readonly client: SidecarClient;
  private readonly pythonExecutable: string;
  private readonly scriptArgs: readonly string[];
  private readonly healthPollIntervalMs: number;
  private readonly maxHealthPollAttempts: number;
  private state: SidecarState = "starting";
  private child: ChildProcess | undefined;
  private listeners: Array<(state: SidecarState, reason?: string) => void> = [];
  private stderrTail = "";

  constructor(options: SidecarProcessOptions) {
    this.spawnFn = options.spawnFn;
    this.client = options.client;
    this.pythonExecutable = options.pythonExecutable;
    this.scriptArgs = options.scriptArgs;
    this.healthPollIntervalMs = options.healthPollIntervalMs ?? 500;
    this.maxHealthPollAttempts = options.maxHealthPollAttempts ?? 40;
  }

  getState(): SidecarState {
    return this.state;
  }

  onStateChange(listener: (state: SidecarState, reason?: string) => void): void {
    this.listeners.push(listener);
  }

  private setState(state: SidecarState, reason?: string): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state, reason);
    }
  }

  async start(): Promise<void> {
    this.setState("starting");
    let spawned = false;
    let failureReason: string | undefined;

    for (let attempt = 0; attempt < this.maxHealthPollAttempts && !failureReason; attempt++) {
      try {
        await this.client.health();
        this.setState("ready");
        return;
      } catch {
        // Only spawn once: a healthy first check means a sidecar is already
        // running (e.g. started independently via an IntelliJ run config) —
        // reuse it instead of racing it for the same port.
        if (!spawned) {
          this.child = this.spawnFn(this.pythonExecutable, this.scriptArgs, {});
          this.child.stdout?.on("data", (chunk: Buffer | string) => {
            process.stdout.write(chunk);
          });
          this.child.stderr?.on("data", (chunk: Buffer | string) => {
            process.stderr.write(chunk);
            this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_CHARS);
          });
          // Without this listener, a spawn failure (e.g. ENOENT because the
          // resolved executable doesn't exist) throws an uncaught exception
          // instead of surfacing as a health-poll timeout.
          this.child.on("error", (err) => {
            failureReason = `Failed to start sidecar process: ${err.message}`;
          });
          // A spawn can succeed but the process still exit immediately (e.g. the
          // resolved interpreter is missing a dependency) — without this, that
          // looks identical to "still starting" until the poll budget runs out.
          this.child.on("exit", (code, signal) => {
            if (this.state === "ready") return;
            const detail = this.stderrTail.trim();
            failureReason =
              `Sidecar process exited before becoming healthy (code=${code}, signal=${signal})` +
              (detail ? `: ${detail}` : "");
          });
          spawned = true;
        }
        if (failureReason) break;
        await new Promise((resolve) => setTimeout(resolve, this.healthPollIntervalMs));
      }
    }
    this.setState(
      "error",
      failureReason ?? "Sidecar did not respond to health checks within the startup timeout",
    );
  }

  async stop(): Promise<void> {
    // Always request shutdown via HTTP — this reaches the sidecar whether
    // Electron spawned it itself or it was already running externally, so
    // e.g. an IntelliJ "Sidecar" run config actually stops when the app closes.
    await this.client.shutdown();
    this.child?.kill();
  }
}
