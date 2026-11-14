import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hashPassword, hashPin } from "@waitron/identity";
import { request, PASSWORD } from "../test/first-setup-request.js";
import { type FirstSetupState } from "./first-setup-state.js";
import {
  endFinishedSetup,
  readSetupFlowRecord,
  updateSetupFlowSection,
} from "./setup-flow-record.js";
vi.mock("node:fs/promises", { spy: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "setup-flow-record-"));
  roots.push(stateDir);
  const attemptId = randomUUID();
  const attempt: FirstSetupState = {
    version: 1,
    stateDir,
    venueDir: join(stateDir, "venue"),
    previous: [],
    frozen: {
      attemptId,
      nodeId: randomUUID(),
      administratorId: randomUUID(),
      sourceId: `first-setup:${attemptId}`,
      environment: "preproduction",
      modules: [],
      request: {
        ...request,
        admin: {
          displayName: "Elena",
          email: "elena@example.test",
          passwordHash: hashPassword(PASSWORD),
          pinHash: hashPin("4826"),
        },
      },
    },
    frozenDigest: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
    ownerVerifier: hashPassword(PASSWORD),
    capabilityHash: "b".repeat(64),
    status: "claimed",
    consumptionIntent: false,
    inputs: {},
    result: null,
    history: [{ kind: "claim", revision: 1, ownerGeneration: 1 }],
  };
  return { stateDir, attempt, path: join(stateDir, "flows/setup/record.json") };
}
it("updating one section keeps the others", async () => {
  const f = await fixture();
  expect(await readSetupFlowRecord(f.stateDir)).toBeNull();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  await updateSetupFlowSection(f.stateDir, "nodeKey", () => ({ verifier: "stored-verifier" }));
  await updateSetupFlowSection(f.stateDir, "publicEvidence", () => ({ modules: {} }));
  expect(await readSetupFlowRecord(f.stateDir)).toEqual({
    version: 1,
    attempt: f.attempt,
    nodeKey: { verifier: "stored-verifier" },
    publicEvidence: { modules: {} },
  });
});
it("two updates started together both land", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  await Promise.all([
    updateSetupFlowSection(f.stateDir, "nodeKey", () => ({ stageId: "one" })),
    updateSetupFlowSection(f.stateDir, "recoveryManifests", () => ({ probe: { digest: "two" } })),
  ]);
  expect(await readSetupFlowRecord(f.stateDir)).toEqual({
    version: 1,
    attempt: f.attempt,
    nodeKey: { stageId: "one" },
    recoveryManifests: { probe: { digest: "two" } },
  });
});
it("a section with no attempt is refused", async () => {
  const f = await fixture();
  await expect(updateSetupFlowSection(f.stateDir, "nodeKey", () => ({}))).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readSetupFlowRecord(f.stateDir)).toBeNull();
});
it("an attempt update cannot remove the required section or change the saved record", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  const before = await readFile(f.path);

  await expect(
    updateSetupFlowSection(f.stateDir, "attempt", () => undefined as never),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });

  expect(await readFile(f.path)).toEqual(before);
});

it("a failed write leaves the previous record", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  const before = await readFile(f.path);
  vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("injected-rename-failure"));
  await expect(updateSetupFlowSection(f.stateDir, "nodeKey", () => ({}))).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(f.path)).toEqual(before);
  expect(await readSetupFlowRecord(f.stateDir)).toEqual({ version: 1, attempt: f.attempt });
});

it("refuses a linked record without changing its target", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  const bytes = await readFile(f.path);
  const target = join(f.stateDir, "target.json");
  await writeFile(target, bytes);
  await rm(f.path);
  await symlink(target, f.path);
  await expect(readSetupFlowRecord(f.stateDir)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(updateSetupFlowSection(f.stateDir, "nodeKey", () => ({}))).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(target)).toEqual(bytes);
});

it.each([
  ["nodeKey", 4096],
  ["publicEvidence", 64 * 1024],
  ["recoveryManifests", 16 * 1024],
] as const)("an oversized %s write keeps the previous record", async (section, bytes) => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  const before = await readFile(f.path);
  const value = { padding: "x".repeat(bytes) };
  await expect(
    updateSetupFlowSection(f.stateDir, section, () =>
      section === "recoveryManifests" ? { probe: value } : value,
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await readFile(f.path)).toEqual(before);
});

it("recovery manifests are bounded individually", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  const manifests = { first: { padding: "x".repeat(9000) }, second: { padding: "y".repeat(9000) } };
  await updateSetupFlowSection(f.stateDir, "recoveryManifests", () => manifests);
  expect((await readSetupFlowRecord(f.stateDir))?.recoveryManifests).toEqual(manifests);
});

it("two spellings of one folder share the section turn", async () => {
  const f = await fixture();
  const aliasRoot = await mkdtemp(join(tmpdir(), "setup-flow-alias-"));
  roots.push(aliasRoot);
  await symlink(dirname(f.stateDir), join(aliasRoot, "parent"), "dir");
  const alias = join(aliasRoot, "parent", basename(f.stateDir));
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  await Promise.all([
    updateSetupFlowSection(f.stateDir, "nodeKey", () => ({ stageId: "one" })),
    updateSetupFlowSection(alias, "publicEvidence", () => ({ modules: {} })),
  ]);
  const record = await readSetupFlowRecord(f.stateDir);
  expect(record?.nodeKey).toEqual({ stageId: "one" });
  expect(record?.publicEvidence).toEqual({ modules: {} });
});

it("an unfinished setup keeps its record and attachments", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => f.attempt);
  const attachment = join(f.stateDir, "flows/setup/readiness.json");
  await writeFile(attachment, "readiness evidence");
  const before = await readFile(f.path);
  await endFinishedSetup(f.stateDir);
  expect(await readFile(f.path)).toEqual(before);
  expect(await readFile(attachment, "utf8")).toBe("readiness evidence");
});

it("cleanup without a setup record leaves other state alone", async () => {
  const f = await fixture();
  const kept = join(f.stateDir, "keep.txt");
  await writeFile(kept, "other state");
  await endFinishedSetup(f.stateDir);
  expect(await readdir(f.stateDir)).toEqual(["keep.txt"]);
  expect(await readFile(kept, "utf8")).toBe("other state");
});

it("a finished setup removes its named files and ordinary attachments, keeping other state", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => ({ ...f.attempt, status: "complete" }));
  const setup = dirname(f.path);
  const kept = join(f.stateDir, "keep.txt");
  await writeFile(kept, "other state");
  for (const name of ["readiness.json", "operation.json", "start-again-guesses.json"])
    await writeFile(join(setup, name), name);
  for (const name of ["documents", "import"]) {
    await mkdir(join(setup, name));
    await writeFile(join(setup, name, "attachment.json"), name);
  }

  await endFinishedSetup(f.stateDir);

  await expect(lstat(setup)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readdir(f.stateDir)).sort()).toEqual(["flows", "keep.txt"]);
  expect(await readdir(join(f.stateDir, "flows"))).toEqual([]);
  expect(await readFile(kept, "utf8")).toBe("other state");
});

it("a finished setup tolerates absent optional files and attachment folders", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => ({ ...f.attempt, status: "complete" }));
  await endFinishedSetup(f.stateDir);
  await expect(lstat(dirname(f.path))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readSetupFlowRecord(f.stateDir)).toBeNull();
});

it("cleanup keeps unknown root files, linked folders and nested attachments", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => ({ ...f.attempt, status: "complete" }));
  const setup = dirname(f.path);
  const target = join(f.stateDir, "kept-documents");
  await mkdir(target);
  await writeFile(join(target, "private.txt"), "linked folder content");
  await symlink(target, join(setup, "documents"), "dir");
  const nested = join(setup, "import", "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "keep.txt"), "nested attachment");
  await writeFile(join(setup, "import", "ordinary.txt"), "ordinary attachment");
  const fileLink = join(setup, "import", "kept-link");
  await symlink(join(target, "private.txt"), fileLink);
  await writeFile(join(setup, "unknown.txt"), "unknown setup file");

  await expect(endFinishedSetup(f.stateDir)).rejects.toMatchObject({ code: "ENOTEMPTY" });

  await expect(lstat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(setup, "import", "ordinary.txt"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await lstat(join(setup, "documents"))).isSymbolicLink()).toBe(true);
  expect((await lstat(fileLink)).isSymbolicLink()).toBe(true);
  expect(await readFile(join(target, "private.txt"), "utf8")).toBe("linked folder content");
  expect(await readFile(join(nested, "keep.txt"), "utf8")).toBe("nested attachment");
  expect(await readFile(join(setup, "unknown.txt"), "utf8")).toBe("unknown setup file");
});

it("cleanup still removes later attachments when an earlier folder retains nested content", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => ({ ...f.attempt, status: "complete" }));
  const setup = dirname(f.path);
  const nested = join(setup, "documents", "nested");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "keep.txt"), "nested document");
  await mkdir(join(setup, "import"));
  await writeFile(join(setup, "import", "attachment.json"), "ordinary import");

  await expect(endFinishedSetup(f.stateDir)).rejects.toMatchObject({ code: "ENOTEMPTY" });

  await expect(lstat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(setup, "import"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(nested, "keep.txt"), "utf8")).toBe("nested document");
});

it("a refused record removal reports its error and keeps the setup files", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => ({ ...f.attempt, status: "complete" }));
  const before = await readFile(f.path);
  const readiness = join(dirname(f.path), "readiness.json");
  await writeFile(readiness, "readiness evidence");
  const refused = Object.assign(new Error("record removal refused"), { code: "EACCES" });
  vi.spyOn(fs, "unlink").mockClear().mockRejectedValueOnce(refused);

  await expect(endFinishedSetup(f.stateDir)).rejects.toBe(refused);

  expect(fs.unlink).toHaveBeenCalledExactlyOnceWith(f.path);
  expect(await readFile(f.path)).toEqual(before);
  expect(await readFile(readiness, "utf8")).toBe("readiness evidence");
});

it("a refused attachment-folder removal reports its error before removing later attachments", async () => {
  const f = await fixture();
  await updateSetupFlowSection(f.stateDir, "attempt", () => ({ ...f.attempt, status: "complete" }));
  const setup = dirname(f.path);
  await mkdir(join(setup, "documents"));
  await mkdir(join(setup, "import"));
  const later = join(setup, "import", "attachment.json");
  await writeFile(later, "later attachment");
  const refused = Object.assign(new Error("folder removal refused"), { code: "EACCES" });
  vi.spyOn(fs, "rmdir").mockRejectedValueOnce(refused);

  await expect(endFinishedSetup(f.stateDir)).rejects.toBe(refused);

  await expect(lstat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await lstat(join(setup, "documents"))).isDirectory()).toBe(true);
  expect(await readFile(later, "utf8")).toBe("later attachment");
});
