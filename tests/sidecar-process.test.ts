import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SidecarProcess } from "../src/main/sidecar-process";
import type { SidecarClient } from "../src/main/sidecar-client";

function fakeChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    kill: () => void;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  emitter.kill = vi.fn();
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  return emitter;
}

describe("SidecarProcess", () => {
  it("forwards child stdout and stderr data to process.stdout and process.stderr", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    let healthCallCount = 0;
    const client = {
      health: vi.fn().mockImplementation(() => {
        healthCallCount++;
        return healthCallCount < 2
          ? Promise.reject(new Error("not up yet"))
          : Promise.resolve({ status: "ok" });
      }),
    } as unknown as SidecarClient;

    const processSidecar = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await processSidecar.start();

    child.stdout.emit("data", Buffer.from("[Detect] Starting watermark detection..."));
    child.stderr.emit("data", Buffer.from("stderr message"));

    expect(stdoutSpy).toHaveBeenCalledWith(expect.anything());
    expect(stderrSpy).toHaveBeenCalledWith(expect.anything());

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("does not spawn a child if the sidecar is already reachable (started externally)", async () => {
    const spawnFn = vi.fn();
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
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("spawns a child and polls health until ready when no sidecar is already running", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    let healthCallCount = 0;
    const client = {
      health: vi.fn().mockImplementation(() => {
        healthCallCount++;
        return healthCallCount < 2
          ? Promise.reject(new Error("not up yet"))
          : Promise.resolve({ status: "ok" });
      }),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: ["-m", "uvicorn", "app.main:app"],
      healthPollIntervalMs: 1,
    });

    await process.start();

    expect(process.getState()).toBe("ready");
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith(
      "python",
      ["-m", "uvicorn", "app.main:app"],
      expect.anything(),
    );
  });

  it("reaches 'error' with a generic timeout reason if the health check never succeeds within the retry budget", async () => {
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

    const reasons: Array<string | undefined> = [];
    process.onStateChange((_state, reason) => reasons.push(reason));

    await process.start();

    expect(process.getState()).toBe("error");
    expect(client.health).toHaveBeenCalledTimes(3);
    expect(reasons.at(-1)).toMatch(/did not respond to health checks/i);
  });

  it("moves to 'error' as soon as spawning the child fails, without exhausting the retry budget", async () => {
    const spawnFn = vi.fn().mockImplementation(() => {
      const child = fakeChildProcess();
      queueMicrotask(() => child.emit("error", new Error("spawn python ENOENT")));
      return child;
    });
    const client = {
      health: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
      maxHealthPollAttempts: 40,
    });

    const reasons: Array<string | undefined> = [];
    process.onStateChange((_state, reason) => reasons.push(reason));

    await process.start();

    expect(process.getState()).toBe("error");
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(reasons.at(-1)).toMatch(/spawn python ENOENT/);
  });

  it("moves to 'error' as soon as the child exits before ever becoming healthy", async () => {
    const spawnFn = vi.fn().mockImplementation(() => {
      const child = fakeChildProcess();
      queueMicrotask(() => child.emit("exit", 1, null));
      return child;
    });
    const client = {
      health: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
      maxHealthPollAttempts: 40,
    });

    const reasons: Array<string | undefined> = [];
    process.onStateChange((_state, reason) => reasons.push(reason));

    await process.start();

    expect(process.getState()).toBe("error");
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(reasons.at(-1)).toMatch(/exited/i);
    expect(reasons.at(-1)).toMatch(/code=1/);
  });

  it("includes recent stderr output in the exit failure reason", async () => {
    const nodeProcess = process;
    const stderrSpy = vi.spyOn(nodeProcess.stderr, "write").mockImplementation(() => true);

    const spawnFn = vi.fn().mockImplementation(() => {
      const child = fakeChildProcess();
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("ModuleNotFoundError: No module named 'fastapi'"));
        child.emit("exit", 1, null);
      });
      return child;
    });
    const client = {
      health: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as SidecarClient;

    const sidecarProcess = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
      maxHealthPollAttempts: 40,
    });

    const reasons: Array<string | undefined> = [];
    sidecarProcess.onStateChange((_state, reason) => reasons.push(reason));

    await sidecarProcess.start();

    stderrSpy.mockRestore();

    expect(reasons.at(-1)).toContain("ModuleNotFoundError: No module named 'fastapi'");
  });

  it("stop() shuts down via HTTP and kills the child process it spawned", async () => {
    const child = fakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const client = {
      health: vi.fn().mockRejectedValueOnce(new Error("not up yet")).mockResolvedValue({ status: "ok" }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
    });
    await process.start();
    await process.stop();

    expect(client.shutdown).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalled();
  });

  it("stop() shuts down an externally running sidecar via HTTP even though Electron never spawned it", async () => {
    const spawnFn = vi.fn();
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as SidecarClient;

    const process = new SidecarProcess({
      spawnFn,
      client,
      pythonExecutable: "python",
      scriptArgs: [],
      healthPollIntervalMs: 1,
    });
    await process.start();
    expect(spawnFn).not.toHaveBeenCalled();

    await process.stop();

    expect(client.shutdown).toHaveBeenCalled();
  });
});
