import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  readModuleRecord,
  updateModulePrepared,
  replaceModuleRetained,
  clearModulePrepared,
  moduleRecordBytes,
  moduleRecordNames,
} from "./module-records.js";

vi.mock("node:fs/promises", { spy: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "module-records-"));
  roots.push(root);
  return root;
}
it("prepared and retained live in one file per module and neither update loses the other", async () => {
  const root = await fixture();
  await updateModulePrepared(root, "fiscal-verifactu", () => [{ selected: "AAAAA" }]);
  await replaceModuleRetained(root, "fiscal-verifactu", { archive: { names: ["BBBBB"] } });
  await updateModulePrepared(root, "fiscal-verifactu", (rows) => [...rows, { selected: "CCCCC" }]);
  expect(
    JSON.parse(await readFile(join(root, "module-records/fiscal-verifactu.json"), "utf8")),
  ).toEqual({
    version: 1,
    prepared: [{ selected: "AAAAA" }, { selected: "CCCCC" }],
    retained: { archive: { names: ["BBBBB"] } },
  });
});
it("clearing prepared keeps every module's retained history", async () => {
  const root = await fixture();
  for (const module of ["fiscal-verifactu", "payments"]) {
    await updateModulePrepared(root, module, () => [module]);
    await replaceModuleRetained(root, module, { archive: { names: [module] } });
  }
  await clearModulePrepared(root);
  for (const module of ["fiscal-verifactu", "payments"])
    expect(await readModuleRecord(root, module)).toEqual({
      version: 1,
      prepared: [],
      retained: { archive: { names: [module] } },
    });
});
it.each(["../other", "", "Fiscal", "fiscal.json", "a/b"])(
  "refuses a module name outside the pattern: %s",
  async (module) => {
    const root = await fixture();
    await expect(updateModulePrepared(root, module, () => [])).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  },
);
it("restore bytes keep prepared and overlay only the archive's retained sources without writing", async () => {
  const root = await fixture();
  await updateModulePrepared(root, "fiscal-verifactu", () => [{ selected: "AAAAA" }]);
  await replaceModuleRetained(root, "fiscal-verifactu", { archive: "old", other: "kept" });
  const path = join(root, "module-records/fiscal-verifactu.json");
  const before = await readFile(path);
  const bytes = await moduleRecordBytes(root, "fiscal-verifactu", { archive: "new" });
  expect(JSON.parse(Buffer.from(bytes).toString("utf8"))).toEqual({
    version: 1,
    prepared: [{ selected: "AAAAA" }],
    retained: { archive: "new", other: "kept" },
  });
  expect(await readFile(path)).toEqual(before);
});

it.each(["{damaged\r\n", JSON.stringify({ version: 1, prepared: [], retained: [] })])(
  "Start again sets an unreadable module record aside with its bytes intact: %s",
  async (contents) => {
    const root = await fixture();
    const path = join(root, "module-records/fiscal-verifactu.json");
    const { mkdir, writeFile, readdir } = await import("node:fs/promises");
    await mkdir(join(root, "module-records"));
    const damaged = Buffer.from(contents);
    await writeFile(path, damaged);
    await clearModulePrepared(root);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    const folder = join(root, "records/set-aside");
    const saved = (await readdir(folder, { recursive: true })).find((name) =>
      name.endsWith("fiscal-verifactu.json"),
    );
    expect(saved).toBeDefined();
    expect(await readFile(join(folder, saved!))).toEqual(damaged);
  },
);

it("Start again clears malformed prepared data while keeping a readable retained section", async () => {
  const root = await fixture();
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(root, "module-records"));
  await writeFile(
    join(root, "module-records/fiscal-verifactu.json"),
    JSON.stringify({
      version: 1,
      prepared: "damaged",
      retained: { archive: { names: ["AAAAA"] } },
    }),
  );
  await clearModulePrepared(root);
  expect(await readModuleRecord(root, "fiscal-verifactu")).toEqual({
    version: 1,
    prepared: [],
    retained: { archive: { names: ["AAAAA"] } },
  });
});

it("an oversized restored record names its file only in the log reason", async () => {
  const root = await fixture();
  const refusal = await moduleRecordBytes(root, "fiscal-verifactu", {
    archive: "x".repeat(1024 * 1024),
  }).catch((error: unknown) => error);
  expect(refusal).toMatchObject({
    code: "setup.attempt_invalid",
    params: {},
    reason: "module-records/fiscal-verifactu.json exceeds its size limit",
  });
  expect(JSON.stringify(refusal)).not.toContain("module-records/fiscal-verifactu.json");
});

it.each(["file", "symlink"])("refuses a %s at the module-records folder", async (kind) => {
  const root = await fixture();
  const directory = join(root, "module-records");
  if (kind === "file") await fs.writeFile(directory, "keep");
  else {
    const target = await fixture();
    await updateModulePrepared(target, "payments", () => ["keep"]);
    await fs.symlink(join(target, "module-records"), directory);
  }
  await expect(moduleRecordNames(root)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

it("Start again leaves a readable record in place when closing its read fails", async () => {
  const root = await fixture();
  await updateModulePrepared(root, "payments", () => ["keep"]);
  const path = join(root, "module-records/payments.json");
  const before = await readFile(path);
  const handle = await fs.open(path, "r");
  const close = handle.close.bind(handle);
  const failure = Object.assign(new Error("close failed"), { code: "EIO" });
  vi.spyOn(handle, "close").mockImplementationOnce(async () => {
    await close();
    throw failure;
  });
  vi.spyOn(fs, "open").mockResolvedValueOnce(handle);
  await expect(clearModulePrepared(root)).rejects.toBe(failure);
  expect(await readFile(path)).toEqual(before);
});
