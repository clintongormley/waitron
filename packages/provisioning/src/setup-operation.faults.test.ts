import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { createSetupOperationStore } from "./setup-operation.js";

// Each case arms a one-shot hook around one real `open` or `unlink`, either to fail that call or to
// act as a second boot at exactly that moment.
type Hook = {
  op: "open" | "unlink";
  file: string;
  when: "before" | "after";
  run: () => Promise<void>;
};
const hooks = vi.hoisted(() => ({ armed: [] as Hook[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fire = async (op: Hook["op"], path: unknown, when: Hook["when"]) => {
    const index = hooks.armed.findIndex(
      (hook) => hook.op === op && hook.when === when && hook.file === basename(String(path)),
    );
    if (index === -1) return;
    const [hook] = hooks.armed.splice(index, 1);
    await hook!.run();
  };
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      await fire("open", args[0], "before");
      return actual.open(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      await fire("unlink", args[0], "before");
      await actual.unlink(...args);
      await fire("unlink", args[0], "after");
    },
  };
});

const failure = (code: string) => Object.assign(new Error(`simulated ${code}`), { code });
const STATE = "flows/setup/operation.json";

const dirs: string[] = [];
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-setup-operation-faults-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  hooks.armed.length = 0;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("setup operation store under filesystem faults", () => {
  it("discards an initial record whose folder sync failed before setup ran", async () => {
    const dir = await stateDir();
    const store = createSetupOperationStore(dir);
    hooks.armed.push({
      op: "open",
      file: basename(dir),
      when: "before",
      run: () => Promise.reject(failure("EIO")),
    });
    let ran = false;
    await expect(
      store.run("provision", "request-a", async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ code: "EIO" });
    expect(ran).toBe(false);
    expect(await store.read()).toBeNull();
    await expect(store.run("adopt", "request-b", async () => "corrected")).resolves.toBe(
      "corrected",
    );
  });

  it("keeps committed progress when its replacement failed at folder sync", async () => {
    const dir = await stateDir();
    const store = createSetupOperationStore(dir);
    await expect(
      store.run("provision", "request-a", async (operation) => {
        hooks.armed.push({
          op: "open",
          file: basename(dir),
          when: "before",
          run: () => Promise.reject(failure("EIO")),
        });
        await operation.advance("venue_committed", { tenantId: "tenant-1" });
      }),
    ).rejects.toMatchObject({ code: "EIO" });
    expect(await store.read()).toMatchObject({
      phase: "venue_committed",
      data: { tenantId: "tenant-1" },
    });
    await expect(store.run("adopt", "request-b", async () => {})).rejects.toMatchObject({
      code: "setup.operation_conflict",
    });
  });

  it("reports a failure to discard an unstarted operation's record ahead of the handler's own error", async () => {
    const dir = await stateDir();
    hooks.armed.push({
      op: "unlink",
      file: STATE,
      when: "before",
      run: () => Promise.reject(failure("EIO")),
    });

    await expect(
      createSetupOperationStore(dir).run("provision", "request-a", async () => {
        throw new AppError("person.email_invalid", {});
      }),
    ).rejects.toMatchObject({ code: "EIO" });
  });
});
