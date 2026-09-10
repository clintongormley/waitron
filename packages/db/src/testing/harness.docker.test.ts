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
    execFileSync.mockImplementation(() => {
      throw new Error("spawnSync docker ENOENT");
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
