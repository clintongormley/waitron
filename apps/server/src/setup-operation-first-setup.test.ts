import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { Hono } from "hono";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { createSetupOperationStore } from "./setup-operation.js";
import { mountSetup } from "./setup-api.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
it("holds the common coordinator through a legacy callback, then checks a queued claim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "first-race-"));
  dirs.push(dir);
  const coordinator = createFirstSetupCoordinator();
  const operations = createSetupOperationStore(dir, "boot", { coordinator });
  const entered = barrier();
  const release = barrier();
  const effects: string[] = [];
  const legacy = operations.run("provision", "old", async (operation) => {
    effects.push("legacy");
    entered.release();
    await release.promise;
    await operation.advance("venue_committed");
  });
  await entered.promise;
  const claim = coordinator.run(async () => {
    if ((await operations.read()) !== null) throw new AppError("setup.attempt_conflict", {});
    effects.push("claim");
  });
  expect(effects).toEqual(["legacy"]);
  release.release();
  await legacy;
  await expect(claim).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(effects).toEqual(["legacy"]);
});
it.each(["provision", "adopt", "restore", "import"] as const)(
  "checks a claim inside the common coordinator before %s side effects",
  async (kind) => {
    const dir = await mkdtemp(join(tmpdir(), "first-race-"));
    dirs.push(dir);
    const coordinator = createFirstSetupCoordinator();
    let claimed = false;
    const operations = createSetupOperationStore(dir, "boot", {
      coordinator,
      guard: async () => {
        if (claimed) throw new AppError("setup.attempt_conflict", {});
      },
    });
    const entered = barrier();
    const release = barrier();
    const effects: string[] = [];
    const claim = coordinator.run(async () => {
      entered.release();
      await release.promise;
      claimed = true;
    });
    await entered.promise;
    const legacy = operations.run(kind, "legacy", async () => {
      effects.push("legacy");
    });
    release.release();
    await claim;
    await expect(legacy).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(effects).toEqual([]);
    expect(await operations.read()).toBeNull();
  },
);
it("covers callbacks outside the progress store and passes the held context without deadlock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "first-route-"));
  dirs.push(dir);
  const coordinator = createFirstSetupCoordinator();
  let claimed = true;
  const effects: string[] = [];
  const app = new Hono();
  const firstSetup = {
    coordinator,
    assertOtherAllowed: async () => {
      if (claimed) throw new AppError("setup.attempt_conflict", {});
    },
  };
  const operations = createSetupOperationStore(dir, "boot", {
    coordinator,
    guard: firstSetup.assertOtherAllowed,
  });
  mountSetup(app, { environment: "preproduction", firstSetup, operations }, () => {});
  app.post("/setup-api/test-callback", (c) => {
    effects.push("callback");
    return c.json({ ok: true });
  });
  const paths = [
    "test-callback",
    "fiscal-test",
    "email-test",
    "provision",
    "adopt",
    "reset",
    "configuration",
    "restore/preview",
    "restore",
    "restore-bucket/preview",
    "restore-bucket",
    "cloud-recovery/start",
    "cloud-recovery/start-again",
    "cloud-recovery/preview",
    "cloud-recovery/restore",
  ];
  for (const path of paths) {
    const response = await app.request(`/setup-api/${path}`, {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    expect(response.status, path).toBe(409);
    expect(await response.json(), path).toMatchObject({
      error: { code: "setup.attempt_conflict", params: {} },
    });
  }
  expect(effects).toEqual([]);
  claimed = false;
  expect((await app.request("/setup-api/test-callback", { method: "POST" })).status).toBe(200);
  await coordinator.run(async (hold) => {
    await operations.run(
      "import",
      "request",
      async () => {
        effects.push("held");
      },
      hold,
    );
  });
  expect(effects).toEqual(["callback", "held"]);
});
