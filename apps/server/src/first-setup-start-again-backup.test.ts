import { createHash, randomBytes } from "node:crypto";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { readStartAgainMarker, readStartAgainNote } from "@waitron/provisioning";
import "../test/hour-recovery-host.js";
import { selectedRepair } from "../test/first-setup-backup-recovery-fixture.js";
import { PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = await readdir(join(dir, prefix));
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    // The anchor's own lock pair is rewritten by every exclusive turn; a nested lock is compared.
    if (prefix === "" && /^venue\.(lock|holder)/.test(name)) continue;
    if ((await lstat(join(dir, relative))).isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else
      result[relative] = createHash("sha256")
        .update(await readFile(join(dir, relative)))
        .digest("hex");
  }
  return result;
}

async function confirmedStartAgain(f: Awaited<ReturnType<typeof selectedRepair>>) {
  const inspected = await f.host.resolution.inspectFirstSetupResolution();
  const recovered = await f.host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await f.host.resolution.inspectFirstSetupResolution();
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...f.roots, host: f.host });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  return () =>
    actions.startAgainFirstSetup({
      ...ids,
      owner,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    });
}

async function expectNothingWritten(
  f: Awaited<ReturnType<typeof selectedRepair>>,
  before: { venue: Record<string, string>; state: Record<string, string> },
) {
  expect({ venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) }).toEqual(
    before,
  );
  expect(await readStartAgainMarker(f.roots.venueDir)).toBeNull();
  await expect(
    access(join(f.roots.stateDir, "first-setup-start-again-confirmations")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readStartAgainNote(f.roots.stateDir)).toBeNull();
}

it("a backup recovery prepared and given up refuses Start again, and nothing is written or deleted", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  const startAgain = await confirmedStartAgain(f);
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  const journal = Object.keys(before.state).filter((name) =>
    name.startsWith("first-setup-resolutions/backup-recovery/"),
  );
  expect(journal.some((name) => name.endsWith("/target/venue/venue.lock"))).toBe(true);
  expect(before.state["first-setup.json"]).toBeDefined();
  await expect(startAgain()).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectNothingWritten(f, before);
});

it("a recovery at placement-started refuses Start again, and nothing is deleted", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    const saved = await append(record);
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return saved;
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  vi.mocked(f.workspace.append).mockRestore();
  await f.service.dispose();
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
  const startAgain = await confirmedStartAgain(f);
  const before = { venue: await tree(f.roots.venueDir), state: await tree(f.roots.stateDir) };
  await expect(startAgain()).rejects.toMatchObject({ code: "setup.not_ready" });
  await expectNothingWritten(f, before);
});
