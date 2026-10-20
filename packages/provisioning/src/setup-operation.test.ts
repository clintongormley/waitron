import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
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

  const validState = {
    version: 1,
    id: "operation-1",
    kind: "provision",
    requestHash: "request-a",
    phase: "started",
    data: {},
    updatedAt: "2026-09-23T00:00:00.000Z",
  };

  it("reads a well-formed saved operation back as it was written", async () => {
    const dir = await stateDir();
    await writeFile(join(dir, "setup-operation.json"), JSON.stringify(validState));
    await expect(createSetupOperationStore(dir).read()).resolves.toEqual(validState);
  });

  it.each([
    ["is not JSON", "not-json"],
    ["has another version", JSON.stringify({ ...validState, version: 2 })],
    ["has no id", JSON.stringify({ ...validState, id: undefined })],
    ["names an unknown kind", JSON.stringify({ ...validState, kind: "migrate" })],
    ["has no kind", JSON.stringify({ ...validState, kind: undefined })],
    ["has no request hash", JSON.stringify({ ...validState, requestHash: 7 })],
    ["names an unknown phase", JSON.stringify({ ...validState, phase: "finished" })],
    ["has no phase", JSON.stringify({ ...validState, phase: undefined })],
    ["has non-object data", JSON.stringify({ ...validState, data: "text" })],
    ["has null data", JSON.stringify({ ...validState, data: null })],
    ["has list data", JSON.stringify({ ...validState, data: [] })],
    ["has no update time", JSON.stringify({ ...validState, updatedAt: undefined })],
  ])("refuses a saved operation that %s", async (_label, raw) => {
    const dir = await stateDir();
    await writeFile(join(dir, "setup-operation.json"), raw);
    const store = createSetupOperationStore(dir);
    await expect(store.read()).rejects.toMatchObject({ code: "setup.operation_conflict" });
    await expect(store.run("provision", "request-a", async () => {})).rejects.toMatchObject({
      code: "setup.operation_conflict",
    });
  });

  it("refuses to take a lock this same process already holds", async () => {
    const dir = await stateDir();
    const lock = JSON.stringify({ ownerId: "current-container", token: "earlier-token" });
    await writeFile(join(dir, "setup-operation.lock"), lock);

    await expect(
      createSetupOperationStore(dir, "current-container").run(
        "provision",
        "request-a",
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "setup.already_provisioning" });
    await expect(readFile(join(dir, "setup-operation.lock"), "utf8")).resolves.toBe(lock);
  });

  it.each([
    ["no owner and no process id", { token: "t" }],
    ["a zero process id", { pid: 0 }],
    ["a negative process id", { pid: -5 }],
    ["a fractional process id", { pid: 1.5 }],
    ["a process id written as text", { pid: "123" }],
  ])("leaves alone a lock with %s", async (_label, owner) => {
    const dir = await stateDir();
    const lock = JSON.stringify(owner);
    await writeFile(join(dir, "setup-operation.lock"), lock);

    await expect(
      createSetupOperationStore(dir, "current-container").run(
        "provision",
        "request-a",
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "setup.already_provisioning" });
    await expect(readFile(join(dir, "setup-operation.lock"), "utf8")).resolves.toBe(lock);
  });

  it("does not release a lock that another run has taken over in the meantime", async () => {
    const dir = await stateDir();
    const lockPath = join(dir, "setup-operation.lock");
    const takenOver = JSON.stringify({ ownerId: "other-container", token: "other-token" });

    await createSetupOperationStore(dir).run("provision", "request-a", async () => {
      await writeFile(lockPath, takenOver);
    });

    await expect(readFile(lockPath, "utf8")).resolves.toBe(takenOver);
  });

  it("finishes normally when its lock has already disappeared", async () => {
    const dir = await stateDir();
    await expect(
      createSetupOperationStore(dir).run("provision", "request-a", async () => {
        await unlink(join(dir, "setup-operation.lock"));
        return "done";
      }),
    ).resolves.toBe("done");
  });

  it("surfaces a lock that became unreadable while it was held", async () => {
    const dir = await stateDir();
    const store = createSetupOperationStore(dir);
    await expect(
      store.run("provision", "request-a", async () => {
        await writeFile(join(dir, "setup-operation.lock"), "not-json");
      }),
    ).rejects.toThrow(SyntaxError);
    await expect(store.run("provision", "request-a", async () => {})).rejects.toMatchObject({
      code: "setup.already_provisioning",
    });
  });

  it("reports the handler's own failure when the unstarted operation's record is already gone", async () => {
    const dir = await stateDir();
    const store = createSetupOperationStore(dir);
    await expect(
      store.run("provision", "request-a", async () => {
        await unlink(join(dir, "setup-operation.json"));
        throw new AppError("person.email_invalid", {});
      }),
    ).rejects.toMatchObject({ code: "person.email_invalid" });
    await expect(store.read()).resolves.toBeNull();
  });
});
