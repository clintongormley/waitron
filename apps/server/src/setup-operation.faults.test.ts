import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const LOCK = "setup-operation.lock";
const STATE = "setup-operation.json";
const staleLock = JSON.stringify({ ownerId: "previous-container", token: "old-token" });

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
  it("surfaces a lock that cannot be created for a reason other than an existing holder", async () => {
    const dir = await stateDir();
    hooks.armed.push({
      op: "open",
      file: LOCK,
      when: "before",
      run: () => Promise.reject(failure("EACCES")),
    });

    await expect(
      createSetupOperationStore(dir).run("provision", "request-a", async () => {}),
    ).rejects.toMatchObject({ code: "EACCES" });
    await expect(readFile(join(dir, STATE))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("proceeds when another boot removed the stale lock first", async () => {
    const dir = await stateDir();
    await writeFile(join(dir, LOCK), staleLock);
    hooks.armed.push({
      op: "unlink",
      file: LOCK,
      when: "before",
      run: () => rm(join(dir, LOCK)),
    });

    await expect(
      createSetupOperationStore(dir, "current-container").run(
        "provision",
        "request-a",
        async () => "ran",
      ),
    ).resolves.toBe("ran");
    expect(JSON.parse(await readFile(join(dir, STATE), "utf8"))).toMatchObject({
      requestHash: "request-a",
    });
  });

  it("surfaces a stale lock that cannot be removed", async () => {
    const dir = await stateDir();
    await writeFile(join(dir, LOCK), staleLock);
    hooks.armed.push({
      op: "unlink",
      file: LOCK,
      when: "before",
      run: () => Promise.reject(failure("EPERM")),
    });

    await expect(
      createSetupOperationStore(dir, "current-container").run(
        "provision",
        "request-a",
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "EPERM" });
    await expect(readFile(join(dir, LOCK), "utf8")).resolves.toBe(staleLock);
  });

  it("reports setup already in progress when another boot re-takes the lock after the stale one is removed", async () => {
    const dir = await stateDir();
    const rival = JSON.stringify({ ownerId: "rival-container", token: "rival-token" });
    await writeFile(join(dir, LOCK), staleLock);
    hooks.armed.push({
      op: "unlink",
      file: LOCK,
      when: "after",
      run: () => writeFile(join(dir, LOCK), rival),
    });

    await expect(
      createSetupOperationStore(dir, "current-container").run(
        "provision",
        "request-a",
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "setup.already_provisioning" });
    await expect(readFile(join(dir, LOCK), "utf8")).resolves.toBe(rival);
  });

  it("surfaces a failure to re-create the lock after removing a stale one", async () => {
    const dir = await stateDir();
    await writeFile(join(dir, LOCK), staleLock);
    hooks.armed.push({
      op: "unlink",
      file: LOCK,
      when: "after",
      run: async () => {
        hooks.armed.push({
          op: "open",
          file: LOCK,
          when: "before",
          run: () => Promise.reject(failure("ENOSPC")),
        });
      },
    });

    await expect(
      createSetupOperationStore(dir, "current-container").run(
        "provision",
        "request-a",
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "ENOSPC" });
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
    await expect(readFile(join(dir, LOCK))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
