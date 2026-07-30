import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SidecarProcess } from "../src/main/sidecar-process";
import type { SidecarClient } from "../src/main/sidecar-client";

function fakeChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & { kill: () => void };
  emitter.kill = vi.fn();
  return emitter;
}

describe("SidecarProcess", () => {
  it("reaches 'ready' once the client's health check succeeds", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
    } as unknown as SidecarClient;

    const states: string[] = [];
    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: ["-m", "uvicorn", "app.main:app"],
      healthPollIntervalMs: 1,
    });
    process.onStateChange((state) => states.push(state));

    await process.start();

    expect(process.getState()).toBe("ready");
    expect(states).toEqual(["starting", "ready"]);
    expect(spawnFn).toHaveBeenCalledWith(
      "python",
      ["-m", "uvicorn", "app.main:app"],
      expect.anything(),
    );
  });

  it("reaches 'error' if the health check never succeeds within the retry budget", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = {
      health: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
      maxHealthPollAttempts: 3,
    });

    await process.start();

    expect(process.getState()).toBe("error");
    expect(client.health).toHaveBeenCalledTimes(3);
  });

  it("stop() kills the child process", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = { health: vi.fn().mockResolvedValue({ status: "ok" }) } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
    });
    await process.start();
    await process.stop();

    expect(child.kill).toHaveBeenCalled();
  });
});
