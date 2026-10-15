import { mkdtemp, readFile, rm, stat, symlink, writeFile, mkdir } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";

const dirs: string[] = [];
async function target() {
  const dir = await mkdtemp(join(tmpdir(), "first-json-"));
  dirs.push(dir);
  return join(dir, "private", "state.json");
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("writes a bounded private file and reads absence separately from corruption", async () => {
  const path = await target();
  expect(await readDurableHostJson(path, 100)).toBeNull();
  await writeDurableHostJson(path, { version: 1 }, 100);
  expect(await readDurableHostJson(path, 100)).toEqual({ version: 1 });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
  await writeFile(path, "{");
  await expect(readDurableHostJson(path, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
    params: {},
  });
});

it("refuses oversized reads and writes without replacing the last state", async () => {
  const path = await target();
  await writeDurableHostJson(path, { version: 1 }, 100);
  await expect(writeDurableHostJson(path, { value: "界".repeat(100) }, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readDurableHostJson(path, 100)).toEqual({ version: 1 });
  await writeFile(path, " ".repeat(101));
  await expect(readDurableHostJson(path, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("rejects links and directories instead of following them", async () => {
  const path = await target();
  await mkdir(join(path, ".."));
  const other = join(path, "..", "other.json");
  await writeFile(other, "{}");
  await symlink(other, path);
  await expect(readDurableHostJson(path, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(writeDurableHostJson(path, {}, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(other, "utf8")).toBe("{}");
  await rm(path);
  await mkdir(path);
  await expect(readDurableHostJson(path, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each(["write", "file-sync", "rename", "directory-sync"])(
  "never reports success after %s fails",
  async (failure) => {
    const path = await target();
    await writeDurableHostJson(path, { version: 1 }, 100);
    const order: string[] = [];
    const fault = () => {
      throw new Error("injected IO fault");
    };
    const io = {
      ...fs,
      async rename(from: string, to: string) {
        order.push("rename");
        if (failure === "rename") fault();
        return fs.rename(from, to);
      },
      async open(...args: Parameters<typeof fs.open>) {
        const handle = await fs.open(...args);
        const directory = (await handle.stat()).isDirectory();
        return {
          stat: () => handle.stat(),
          close: () => handle.close(),
          readFile: () => handle.readFile(),
          async writeFile(data: string) {
            order.push("write");
            if (failure === "write") fault();
            return handle.writeFile(data);
          },
          async sync() {
            const step = directory ? "directory-sync" : "file-sync";
            order.push(step);
            if (failure === step) fault();
            return handle.sync();
          },
        };
      },
    };
    await expect(writeDurableHostJson(path, { version: 2 }, 100, io)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    expect(order).toEqual(
      ["write", "file-sync", "rename", "directory-sync"].slice(
        0,
        ["write", "file-sync", "rename", "directory-sync"].indexOf(failure) + 1,
      ),
    );
    expect(await readDurableHostJson(path, 100)).toEqual({
      version: failure === "directory-sync" ? 2 : 1,
    });
  },
);

it.each(["null", "false", "[]", "42"])(
  "refuses a non-envelope %s instead of treating it as absence",
  async (raw) => {
    const path = await target();
    await mkdir(join(path, ".."));
    await writeFile(path, raw);
    await expect(readDurableHostJson(path, 100)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  },
);
it("does not follow a replaced state directory", async () => {
  const path = await target();
  const outside = join(path, "..", "..", "outside");
  await mkdir(outside);
  await writeFile(join(outside, "state.json"), "{}");
  await symlink(outside, join(path, ".."));
  await expect(readDurableHostJson(path, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(writeDurableHostJson(path, {}, 100)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});
