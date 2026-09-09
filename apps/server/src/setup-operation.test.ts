import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { createSetupOperationStore } from "./setup-operation.js";

const dirs: string[] = [];
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-setup-operation-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("setup operation store", () => {
  it("persists progress and resumes the same request after constructing a new store", async () => {
    const dir = await stateDir();
    const first = createSetupOperationStore(dir);

    await first.run("provision", "request-a", async (operation) => {
      expect(operation.phase).toBe("started");
      await operation.advance("venue_committed", { tenantId: "tenant-1" });
    });

    const resumed = createSetupOperationStore(dir);
    await resumed.run("provision", "request-a", async (operation) => {
      expect(operation.phase).toBe("venue_committed");
      expect(operation.data).toEqual({ tenantId: "tenant-1" });
      await operation.complete({ tenantId: "tenant-1" });
    });

    await expect(resumed.read()).resolves.toMatchObject({
      kind: "provision",
      requestHash: "request-a",
      phase: "complete",
      data: { tenantId: "tenant-1" },
    });
  });

  it("refuses a different operation while incomplete", async () => {
    const store = createSetupOperationStore(await stateDir());
    await store.run("provision", "request-a", async () => {});

    await expect(store.run("adopt", "request-b", async () => {})).rejects.toMatchObject({
      code: "setup.operation_conflict",
    });
  });

  it("serializes concurrent handlers", async () => {
    const store = createSetupOperationStore(await stateDir());
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = store.run("provision", "request-a", async () => held);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(store.run("provision", "request-a", async () => {})).rejects.toMatchObject({
      code: "setup.already_provisioning",
    });
    release();
    await first;
  });

  it("reclaims a lock left by a dead process", async () => {
    const dir = await stateDir();
    await writeFile(
      join(dir, "setup-operation.lock"),
      JSON.stringify({ ownerId: "previous-container", token: "old-token" }),
    );
    const store = createSetupOperationStore(dir, "current-container");

    await store.run("provision", "request-a", async () => {});

    expect(JSON.parse(await readFile(join(dir, "setup-operation.json"), "utf8"))).toMatchObject({
      phase: "started",
    });
  });

  it("does not mistake an invalid lock for authorization to proceed", async () => {
    const dir = await stateDir();
    await writeFile(join(dir, "setup-operation.lock"), "not-json");

    await expect(
      createSetupOperationStore(dir).run("provision", "request-a", async () => {}),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("does not mistake a reused container PID for a live setup lock", async () => {
    const dir = await stateDir();
    await writeFile(
      join(dir, "setup-operation.lock"),
      JSON.stringify({ pid: process.pid, token: "previous-container" }),
    );

    await createSetupOperationStore(dir, "current-container").run(
      "provision",
      "request-a",
      async () => {},
    );

    await expect(readFile(join(dir, "setup-operation.json"), "utf8")).resolves.toContain(
      '"requestHash":"request-a"',
    );
  });

  it("discards validation failures so a corrected request can proceed", async () => {
    const store = createSetupOperationStore(await stateDir());

    await expect(
      store.run("provision", "invalid-request", async () => {
        throw new AppError("person.email_invalid", {});
      }),
    ).rejects.toMatchObject({ code: "person.email_invalid" });

    await expect(
      store.run("provision", "corrected-request", async (operation) => {
        await operation.advance("venue_committed");
      }),
    ).resolves.toBeUndefined();
  });
});
