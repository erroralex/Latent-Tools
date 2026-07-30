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

export class SidecarProcess {
  private readonly spawnFn: SpawnFn;
  private readonly client: SidecarClient;
  private readonly pythonExecutable: string;
  private readonly scriptArgs: readonly string[];
  private readonly healthPollIntervalMs: number;
  private readonly maxHealthPollAttempts: number;
  private state: SidecarState = "starting";
  private child: ChildProcess | undefined;
  private listeners: Array<(state: SidecarState) => void> = [];

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

  onStateChange(listener: (state: SidecarState) => void): void {
    this.listeners.push(listener);
  }

  private setState(state: SidecarState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  async start(): Promise<void> {
    this.setState("starting");
    this.child = this.spawnFn(this.pythonExecutable, this.scriptArgs, {});

    for (let attempt = 0; attempt < this.maxHealthPollAttempts; attempt++) {
      try {
        await this.client.health();
        this.setState("ready");
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, this.healthPollIntervalMs));
      }
    }
    this.setState("error");
  }

  async stop(): Promise<void> {
    this.child?.kill();
  }
}
