import { key, clock } from "../test/hour-recovery-host.js";

import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, it, vi } from "vitest";

import { ALL_MODULES } from "@waitron/composition";
import { emptyAbandonedBackupRecovery, isEmptiedTombstone } from "@waitron/provisioning";

import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import * as runtime from "./backup-verification-target.js";

import { readCloudRecoveryState } from "./cloud-recovery-v2.js";
import { recovery, fixture, selectedRepair } from "../test/first-setup-backup-cloud-fixture.js";

vi.mock("./backup-verification-target.js", { spy: true });
vi.mock("./state-secrets.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("./restore.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });

it("reopens the same prepared Cloud source after restart with fresh node proof and clocks", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const restarted = recovery(f.options);
  expect((await restarted.cloudStatus()).requestId).toBe(f.approved.requestId);
  const resumed = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  expect(resumed.binding).toEqual(f.session.binding);
  expect(resumed.recoveryId).toBe(f.session.recoveryId);
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(resumed.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { input: unknown };
  await restarted.commit(resumed.sessionId, selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
    requestId: f.approved.requestId,
    phase: "reported",
  });
});

it("opens straight after a discarded Cloud recovery is emptied without reusing its id", async () => {
  const f = await fixture();
  const first = await f.service.open(f.request, { onBox: false });
  await f.service.prepare(first.sessionId, { action: "clock-challenge" }, { onBox: false });
  await f.service.close(first.sessionId);
  await f.workspace.abandon(first.recoveryId);
  await emptyAbandonedBackupRecovery(f.roots, first.recoveryId);
  const calls = f.calls.length;
  const inspect = vi.spyOn(f.workspace, "inspect");
  // The discarded approval is gone, so this answers as a box with no pending approval does.
  await expect(f.service.open(f.request, { onBox: false })).rejects.toThrow(
    "Cloud recovery is unavailable",
  );
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(inspect.mock.calls[0]![0]).not.toBe(first.recoveryId);
  expect(f.calls).toHaveLength(calls);
  expect(await isEmptiedTombstone(f.roots, first.recoveryId)).toBe(true);
  expect(await f.service.status()).toEqual({ phase: "unstarted", proofRequired: true });
  expect((await f.service.cloudStart()).state).toBe("awaiting_owner");
});

it("requires a pending approval and an available Cloud client before polling or restarting", async () => {
  const f = await fixture();
  const unopened = recovery(f.options);
  await expect(unopened.cloudStatus()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(unopened.cloudStartAgain()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await expect(recovery({ ...f.options, cloud: undefined }).cloudStart()).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  await expect(f.service.cloudStartAgain()).rejects.toThrow("Cloud recovery is unavailable");
});

it("does not change Cloud approval while a backup session or durable preparation owns it", async () => {
  const f = await fixture();
  const session = await f.service.open(f.request, { onBox: false });
  const calls = f.calls.length;
  for (const action of [
    () => f.service.cloudStart(),
    () => f.service.cloudStatus(),
    () => f.service.cloudStartAgain(),
  ])
    await expect(action()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.calls).toHaveLength(calls);
  await f.service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
  await f.service.close(session.sessionId);
  await expect(f.service.cloudStart()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("prepared");
});

it("disposes Cloud authority with the repair service", async () => {
  const f = await fixture();
  await f.service.dispose();
  for (const action of [
    () => f.service.cloudStart(),
    () => f.service.cloudStatus(),
    () => f.service.cloudStartAgain(),
  ])
    await expect(action()).rejects.toMatchObject({ code: "setup.owner_required" });
});

it.each([
  "control",
  "target",
  "sealed",
  "runtime",
  "origin",
  "request-binding",
  "archive-binding",
] as const)(
  "refuses %s Cloud identity changes after a committed-target interruption",
  async (change) => {
    const f = await selectedRepair();
    vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("interrupted selection"));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow("interrupted selection");
    await f.service.dispose();
    const directory = dirname(dirname(f.record.target.target.stateDir));
    let tamperedPath: string | undefined;
    let tampered: Buffer | undefined;
    if (change === "origin") f.options.cloud.origin = "https://other-cloud.example.test";
    else if (change === "runtime")
      vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(
        buildBackupVerificationTarget({
          modules: ALL_MODULES,
          migrationsRoot: null,
          runtime: { ...f.target.runtime, revision: "d".repeat(40) },
        }),
      );
    else if (["sealed", "request-binding", "archive-binding"].includes(change)) {
      const path = join(directory, "publication.json");
      const saved = JSON.parse(await readFile(path, "utf8"));
      const entries = unpackArchive(
        decryptArtifact(Buffer.from(saved.ciphertext, "base64"), key.secret),
      );
      const meta = entries.find((entry) => entry.name === "repair-publication.json")!;
      const value = JSON.parse(Buffer.from(meta.bytes).toString());
      if (change === "request-binding")
        value.cloudState.requestId = "374cac38-cc58-46d5-8d3b-8443fc4343a4";
      else if (change === "archive-binding") {
        value.cloudState.snapshotVerification.archiveSha256 = "d".repeat(64);
        for (const stateDir of [join(directory, "cloud"), f.record.target.target.stateDir]) {
          const path = join(stateDir, "cloud-recovery.json");
          const state = JSON.parse(await readFile(path, "utf8"));
          state.snapshotVerification.archiveSha256 = "d".repeat(64);
          await writeFile(path, JSON.stringify(state));
        }
      } else value.cloudState.code = "12345678";
      meta.bytes = Buffer.from(JSON.stringify(value));
      saved.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
      await writeFile(path, JSON.stringify(saved));
    } else {
      tamperedPath = join(
        change === "control" ? join(directory, "cloud") : f.record.target.target.stateDir,
        "cloud-recovery.json",
      );
      const current = JSON.parse(await readFile(tamperedPath, "utf8"));
      tampered = Buffer.from(JSON.stringify({ ...current, code: "12345678" }));
      await writeFile(tamperedPath, tampered);
    }
    const before = await readFile(join(f.record.target.target.venueDir, "venue.db"));
    await expect(
      recovery(f.options).resume(
        {
          observation: f.request.observation,
          recoveryId: f.session.recoveryId,
          nodeRecoverySecret: key.secret,
          context: f.request.context,
        },
        { onBox: false },
      ),
    ).rejects.toMatchObject({
      code: ["runtime", "origin"].includes(change)
        ? "setup.attempt_uncertain"
        : "setup.attempt_conflict",
    });
    expect(await readFile(join(f.record.target.target.venueDir, "venue.db"))).toEqual(before);
    if (tamperedPath) expect(await readFile(tamperedPath)).toEqual(tampered);
    expect((await f.workspace.read()).at(-1)!.phase).toBe("restored");
  },
);

it("only replaces an expired approval and retains the original setup bytes", async () => {
  const f = await fixture();
  const previous = f.approved.requestId;
  f.control.expired = true;
  expect((await f.service.cloudStatus()).state).toBe("expired");
  const next = await f.service.cloudStartAgain();
  expect(next.requestId).not.toBe(previous);
  expect(next.state).toBe("awaiting_owner");
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.original);
  expect(await f.workspace.read()).toEqual([]);
});

it.each(["control", "target"] as const)(
  "refuses a %s approval replaced during a live backup session",
  async (change) => {
    const f = await selectedRepair();
    const path = join(
      change === "control"
        ? join(dirname(dirname(f.record.target.target.stateDir)), "cloud")
        : f.record.target.target.stateDir,
      "cloud-recovery.json",
    );
    const control = (await readCloudRecoveryState(
      join(dirname(dirname(f.record.target.target.stateDir)), "cloud"),
    ))!;
    const bytes = Buffer.from(JSON.stringify({ ...control, code: "12345678" }));
    await writeFile(path, bytes, { mode: 0o600 });
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await readFile(path)).toEqual(bytes);
    await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);

it("starts a new Cloud recovery beside a discarded one", async () => {
  const f = await fixture();
  const first = await f.service.open(f.request, { onBox: false });
  await f.service.prepare(first.sessionId, { action: "clock-challenge" }, { onBox: false });
  await f.service.close(first.sessionId);
  await f.workspace.abandon(first.recoveryId);
  expect(await f.service.status()).toEqual({ phase: "unstarted", proofRequired: true });
  const calls = f.calls.length;
  for (const action of [
    () => f.service.cloudStart(),
    () => f.service.cloudStatus(),
    () => f.service.cloudStartAgain(),
    () => f.service.open(f.request, { onBox: false }),
  ])
    await expect(action()).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  expect(f.calls).toHaveLength(calls);
  await emptyAbandonedBackupRecovery(f.roots, first.recoveryId);
  await expect(f.service.cloudStatus()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.service.cloudStart()).state).toBe("awaiting_owner");
  f.control.expired = true;
  expect((await f.service.cloudStatus()).state).toBe("expired");
  expect((await f.service.cloudStartAgain()).state).toBe("awaiting_owner");
  f.control.expired = false;
  expect((await f.service.cloudStatus()).state).toBe("approved");
  const second = await f.service.open(f.request, { onBox: false });
  expect(second.recoveryId).not.toBe(first.recoveryId);
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => f.service.prepare(second.sessionId, proposal, client) },
    { onBox: false },
  )) as { input: unknown };
  await f.service.commit(second.sessionId, selected.input, { onBox: false });
  const last = (await f.workspace.read()).at(-1)!;
  expect([last.target.recoveryId, last.phase]).toEqual([second.recoveryId, "selected"]);
  expect(await readCloudRecoveryState(last.target.target.stateDir)).toMatchObject({
    phase: "reported",
  });
});
