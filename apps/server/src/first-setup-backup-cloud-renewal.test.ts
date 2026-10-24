import { key, clock } from "../test/hour-recovery-host.js";

import { access, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import * as sourceProof from "./first-setup-backup-source.js";
import { expect, it, vi } from "vitest";

import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

import * as runtime from "./backup-verification-target.js";
import * as secrets from "./state-secrets.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { readCloudRecoveryState } from "./cloud-recovery-v2.js";
import {
  recovery,
  fixture,
  selectedRepair,
  interruptedCloudTransfer,
} from "../test/first-setup-backup-cloud-fixture.js";

vi.mock("./backup-verification-target.js", { spy: true });
vi.mock("./state-secrets.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("./restore.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });

it("does not place changed sealed source secrets after prepared Cloud reauthentication", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new Error("interrupted placement journal");
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted placement journal");
  vi.restoreAllMocks();
  vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(f.target);
  await f.service.dispose();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const entries = unpackArchive(
    decryptArtifact(Buffer.from(saved.ciphertext, "base64"), key.secret),
  );
  entries.find((entry) => entry.name === "secrets/node-key.enc")!.bytes = Buffer.from(
    "different sealed node key",
  );
  saved.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
  await writeFile(path, JSON.stringify(saved));
  const restarted = recovery(f.options);
  const opened = await restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(opened.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { input: unknown };
  await expect(
    restarted.commit(opened.sessionId, selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("checks the client's target protocol before resumed secret publication", async () => {
  const f = await selectedRepair();
  vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("interrupted selection"));
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted selection");
  await f.service.dispose();
  const restarted = recovery({
    ...f.options,
    cloud: { ...f.options.cloud, snapshotProtocol: undefined, target: undefined },
  });
  const resumed = await restarted.resume(
    {
      observation: f.request.observation,
      recoveryId: f.session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: f.request.context,
    },
    { onBox: false },
  );
  const path = join(f.record.target.target.stateDir, "node-key.enc");
  await writeFile(path, "later retained key");
  await expect(
    restarted.commit(resumed.sessionId, resumed.input, { onBox: false }),
  ).rejects.toThrow("Cloud recovery is unavailable");
  expect(await readFile(path, "utf8")).toBe("later retained key");
  expect((await f.workspace.read()).at(-1)!.phase).toBe("restored");
});

it("can obtain new approval for the same journal after interrupted initial Cloud-state transfer", async () => {
  const f = await interruptedCloudTransfer();
  const { restarted, session, record } = f;
  const opened = await restarted.open(
    { ...f.request, recoveryId: session.recoveryId },
    { onBox: false },
  );
  expect(opened.binding).toEqual(session.binding);
  const selected = (await recoverySelectPastWaits(
    clock,
    {
      prepare: (proposal, client) => restarted.prepare(opened.sessionId, proposal, client),
    },
    { onBox: false },
  )) as { input: unknown };
  await restarted.commit(opened.sessionId, selected.input, { onBox: false });
  const final = (await f.workspace.read()).at(-1)!;
  expect(final.phase).toBe("selected");
  expect(final.binding).toEqual(record.binding);
  expect(final.target).toEqual(record.target);
});

it("a newer Cloud approval fences an earlier proof still downloading", async () => {
  const f = await interruptedCloudTransfer();
  let start!: () => void, release!: () => void;
  const downloading = new Promise<void>((resolve) => {
    start = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.control.beforeDownload = async () => {
    start();
    await ready;
  };
  const pending = f.restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const refused = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await downloading;
  expect((await f.restarted.cloudStart()).state).toBe("awaiting_owner");
  release();
  await refused;
  expect((await f.workspace.read()).at(-1)!.binding).toEqual(f.record.binding);
  expect((await f.workspace.read()).at(-1)!.input).toBeNull();
});

it("missing Cloud state cannot replace approval once an input has been selected", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  await unlink(
    join(dirname(dirname(f.record.target.target.stateDir)), "cloud", "cloud-recovery.json"),
  );
  await expect(recovery(f.options).cloudStart()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});

it("retains an unexplained sealed publication instead of starting another Cloud approval", async () => {
  const f = await interruptedCloudTransfer();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const bytes = Buffer.from(
    JSON.stringify({ version: 1, ciphertext: "retained unknown material" }),
  );
  await writeFile(path, bytes, { mode: 0o600 });
  await expect(f.restarted.cloudStart()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(path)).toEqual(bytes);
  expect((await f.workspace.read()).at(-1)!.input).toBeNull();
});

it("never uses a supplied Cloud client that can write the retained source state", async () => {
  const f = await fixture();
  const direct = createCloudRecoveryClient({ ...f.options.cloud, stateDir: f.roots.stateDir });
  await direct.start();
  const path = join(f.roots.stateDir, "cloud-recovery.json");
  const original = await readFile(path);
  const service = recovery({
    ...f.options,
    cloud: undefined,
    sources: { ...f.options.sources, cloudRecovery: direct },
  });
  await expect(service.open(f.request, { onBox: false })).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await readFile(path)).toEqual(original);
  expect(await f.workspace.read()).toEqual([]);
});

it.each([false, true])(
  "keeps the existing preproduction protocol usable with interrupted=%s",
  async (interrupted) => {
    const f = await selectedRepair(1);
    if (interrupted) {
      vi.spyOn(secrets, "unpackBundleToDir").mockRejectedValueOnce(
        new Error("interrupted legacy publication"),
      );
      await expect(
        f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
      ).rejects.toThrow("interrupted legacy publication");
      await f.service.dispose();
      const restarted = recovery(f.options);
      const resumed = await restarted.resume(
        {
          observation: f.request.observation,
          recoveryId: f.session.recoveryId,
          nodeRecoverySecret: key.secret,
          context: f.request.context,
        },
        { onBox: false },
      );
      await restarted.commit(resumed.sessionId, resumed.input, { onBox: false });
    } else await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
    expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
    expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
      version: 1,
      phase: "reported",
      requestId: f.approved.requestId,
    });
    await expect(access(join(f.record.target.target.stateDir, "backup.env"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    expect(f.control.downloaded).toBe(2);
  },
);

it("cannot start an expired Cloud approval again after its publication is sealed", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new Error("interrupted sealed publication");
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted sealed publication");

  const path = join(
    dirname(dirname(f.record.target.target.stateDir)),
    "cloud",
    "cloud-recovery.json",
  );
  const original = await readFile(path);
  await f.service.close(f.session.sessionId);
  f.control.expired = true;
  await expect(f.service.cloudStartAgain()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(path)).toEqual(original);
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});

it("can renew an expired prepared Cloud approval before publication without changing its selected input", async () => {
  const f = await selectedRepair();
  await f.service.close(f.session.sessionId);
  f.control.expired = true;
  const next = await f.service.cloudStartAgain();
  expect(next.requestId).not.toBe(f.approved.requestId);
  expect(next.state).toBe("awaiting_owner");
  const record = (await f.workspace.read()).at(-1)!;
  expect(record.input).toEqual(f.selected.input);
  expect(record.binding).toEqual(f.record.binding);
  expect(record.target).toEqual(f.record.target);
});

it("a renewed Cloud approval fences earlier proof after its real key check", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  const restarted = recovery(f.options);
  await restarted.cloudStatus();
  let checked!: () => void, release!: () => void;
  const proofChecked = new Promise<void>((resolve) => {
    checked = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actual = await vi.importActual<typeof sourceProof>("./first-setup-backup-source.js");
  vi.spyOn(sourceProof, "authenticatedFirstSetupBackupPreview").mockImplementation(
    async (...args) => {
      const preview = await actual.authenticatedFirstSetupBackupPreview(...args);
      checked();
      await ready;
      return preview;
    },
  );
  const pending = restarted.open(
    { ...f.request, recoveryId: f.session.recoveryId },
    { onBox: false },
  );
  const refused = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await proofChecked;
  f.control.expired = true;
  expect((await restarted.cloudStartAgain()).state).toBe("awaiting_owner");
  release();
  await refused;
  expect((await f.workspace.read()).at(-1)!.input).toEqual(f.selected.input);
});
