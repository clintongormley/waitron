import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hashPassword, hashPin } from "@waitron/identity";
import { request, PASSWORD } from "../test/first-setup-request.js";
import { type FirstSetupState } from "./first-setup-state.js";
import { readSetupFlowRecord, updateSetupFlowSection } from "./setup-flow-record.js";
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
