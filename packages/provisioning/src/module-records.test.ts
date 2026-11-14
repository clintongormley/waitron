import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  readModuleRecord,
  updateModulePrepared,
  replaceModuleRetained,
  clearModulePrepared,
  moduleRecordBytes,
} from "./module-records.js";

const roots: string[] = [];
afterEach(async () => {
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
