// Hermetic probes: simulate a failed CLI after global setup has already started PostgreSQL.
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileSync, inject } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  inject: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("vitest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vitest")>()),
  inject,
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

describe("Docker availability", () => {
  it("uses the container started by global setup even when the Docker CLI fails", async () => {
    inject.mockReturnValue({ uri: "postgres://localhost/test", templates: { core: "core" } });
    execFileSync.mockImplementation(() => {
      throw new Error("spawnSync docker ETIMEDOUT");
    });
    const { dockerAvailable } = await import("./harness.js");
    expect(dockerAvailable()).toBe(true);
    expect(inject).toHaveBeenCalledWith("sharedPg");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("probes and caches a successful CLI check without a shared container", async () => {
    const { dockerAvailable } = await import("./harness.js");
    expect(dockerAvailable()).toBe(true);
    expect(dockerAvailable()).toBe(true);
    expect(execFileSync).toHaveBeenCalledExactlyOnceWith("docker", ["info"], {
      stdio: "ignore",
      timeout: 10_000,
    });
  });

  it("keeps the required-Docker failure when neither a container nor the CLI is available", async () => {
    // A missing `docker` binary throws ENOENT (a `code`, not just a message) — fail fast, no retry.
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error("spawnSync docker ENOENT"), { code: "ENOENT" });
    });
    const { dockerAvailable, resolveTargets } = await import("./harness.js");
    expect(dockerAvailable()).toBe(false);
    expect(dockerAvailable()).toBe(false);
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(() =>
      resolveTargets({ dockerAvailable: dockerAvailable(), requireDocker: true }),
    ).toThrow(/REQUIRE_DOCKER/);
  });
});

describe("probeDockerCli — readiness retry", () => {
  const daemonNotReady = () => new Error("Cannot connect to the Docker daemon");

  it("returns true when the daemon becomes ready after a transient failure", async () => {
    const { probeDockerCli } = await import("./harness.js");
    let calls = 0;
    const run = () => {
      calls += 1;
      if (calls < 3) throw daemonNotReady();
    };
    const sleeps: number[] = [];
    const ok = probeDockerCli(run, { attempts: 5, delayMs: 40, sleep: (ms) => sleeps.push(ms) });
    expect(ok).toBe(true);
    expect(calls).toBe(3); // failed twice, succeeded on the third probe
    expect(sleeps).toEqual([40, 40]); // slept only BETWEEN the failed attempts
  });

  it("fails fast without retrying when the docker binary is missing (ENOENT)", async () => {
    const { probeDockerCli } = await import("./harness.js");
    let calls = 0;
    const run = () => {
      calls += 1;
      throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    };
    const sleeps: number[] = [];
    const ok = probeDockerCli(run, { attempts: 5, delayMs: 40, sleep: (ms) => sleeps.push(ms) });
    expect(ok).toBe(false);
    expect(calls).toBe(1); // a missing binary never appears on retry
    expect(sleeps).toEqual([]);
  });

  it("gives up loudly after the bounded attempts when the daemon never comes up", async () => {
    const { probeDockerCli } = await import("./harness.js");
    let calls = 0;
    const run = () => {
      calls += 1;
      throw daemonNotReady();
    };
    const sleeps: number[] = [];
    const ok = probeDockerCli(run, { attempts: 3, delayMs: 40, sleep: (ms) => sleeps.push(ms) });
    expect(ok).toBe(false);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([40, 40]); // no sleep after the final attempt
  });
});
