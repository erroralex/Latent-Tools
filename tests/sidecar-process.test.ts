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
