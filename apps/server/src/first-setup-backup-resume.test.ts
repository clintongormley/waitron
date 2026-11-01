import { key, node, clock } from "../test/hour-recovery-host.js";

import { access, copyFile, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";

import { AppError } from "@waitron/shared";

import * as stateSecrets from "./state-secrets.js";
import * as sources from "./first-setup-backup-source.js";

import { encryptArtifact, decryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import { recoverySelectPastWaits } from "./testing/hour-test-clock.js";

import {
  recovery,
  fixture,
  selectedRepair,
  interruptedRepair,
} from "../test/first-setup-backup-resume-fixture.js";

vi.mock("./state-secrets.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });

it.each(["secrets", "restored-record", "selection"] as const)(
  "reauthenticates the committed target after %s interruption and finishes the same event without replacing counters",
  async (point) => {
    const f = await selectedRepair();
    if (point === "secrets") {
      vi.spyOn(stateSecrets, "unpackBundleToDir").mockRejectedValueOnce(
        new Error("interrupted before secret publication"),
      );
    } else if (point === "restored-record") {
      const append = f.workspace.append;
      vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
        if (record.phase === "restored") throw new AppError("setup.attempt_invalid", {});
        return append(record);
      });
    } else
      vi.spyOn(f.workspace, "select").mockRejectedValue(new AppError("setup.attempt_invalid", {}));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow();
    vi.restoreAllMocks();
    f.options.log = () => {};
    await f.service.dispose();
    const target = f.record.target.target;
    const database = await openVenueDatabase(target.venueDir);
    let before;
    try {
      await database.venue.update(invoiceSeries).set({ nextNumber: 147 });
      before = await database.venue.select().from(invoiceSeries);
    } finally {
      await database.close();
    }
    const restarted = recovery(f.options);
    const resumed = await restarted.resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      { onBox: false },
    );
    expect(resumed.input).toEqual(f.selected.input);
    expect(resumed.binding).toEqual(f.session.binding);
    expect(resumed.recoveryId).toBe(f.session.recoveryId);
    expect(resumed.sessionId).not.toBe(f.session.sessionId);
    const advanced = await openVenueDatabase(target.venueDir);
    try {
      await advanced.venue.update(invoiceSeries).set({ nextNumber: 223 });
      before = await advanced.venue.select().from(invoiceSeries);
    } finally {
      await advanced.close();
    }
    await restarted.commit(resumed.sessionId, resumed.input, { onBox: false });
    expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
    expect(
      (await f.workspace.read()).every(
        (record) => record.binding.eventId === f.session.binding.eventId,
      ),
    ).toBe(true);
    const after = await openVenueDatabase(target.venueDir);
    try {
      expect(await after.venue.select().from(invoiceSeries)).toEqual(before);
    } finally {
      await after.close();
    }
    expect(await readFile(join(target.stateDir, "trading.env"), "utf8")).toContain(node.nodeId);
    expect(
      JSON.parse(
        await readFile(
          join(target.stateDir, "module-evidence/fiscal-verifactu/hour-history.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      records: expect.arrayContaining([expect.objectContaining({ identity: "0CNQT" })]),
    });
  },
);

it("a resumed recovery's staged folder holds the backup's node copy", async () => {
  const f = await interruptedRepair(async (entries) => {
    const index = entries.findIndex((entry) => entry.name === "node.dump");
    expect(index).toBeGreaterThanOrEqual(0);
    const scratch = await mkdtemp(join(tmpdir(), "waitron-resume-marker-"));
    try {
      const file = join(scratch, "node.db");
      await writeFile(file, entries[index]!.bytes);
      const copy = new DatabaseSync(file);
      copy.exec("create table backup_marker (v text); insert into backup_marker values ('backup')");
      copy.close();
      entries[index] = { name: "node.dump", bytes: await readFile(file) };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
  vi.mocked(sources.authenticatedFirstSetupBackupPreview).mockClear();
  await recovery(f.options).resume(f.resumeRequest, { onBox: false });
  const staged = vi.mocked(sources.authenticatedFirstSetupBackupPreview).mock.calls.at(-1)![0];
  const copy = new DatabaseSync(join(dirname(staged.copy.databasePath), "node.db"), {
    readOnly: true,
  });
  try {
    const marked = copy
      .prepare("select name from sqlite_master where name = 'backup_marker'")
      .all();
    expect(
      marked.length === 0
        ? []
        : copy
            .prepare("select v from backup_marker")
            .all()
            .map((row) => row.v),
    ).toEqual(["backup"]);
  } finally {
    copy.close();
  }
});

it("retains encrypted publication material without saving the node proof, archive key or private plaintext", async () => {
  const f = await interruptedRepair();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const bytes = await readFile(path, "utf8");
  expect(bytes).not.toContain(key.secret);
  expect(bytes).not.toContain(f.restore.recoveryKey);
  expect(bytes).not.toContain("secrets.env");
  expect(bytes).not.toContain("trading.env");
  expect((await import("node:fs/promises").then((fs) => fs.stat(path))).mode & 0o777).toBe(0o600);
  await expect(access(join(f.record.target.target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["", "wrong node key"])(
  "resume refuses target proof %j without changing the journal or target",
  async (secret) => {
    const f = await interruptedRepair();
    const journal = await f.workspace.read();
    const target = join(f.record.target.target.venueDir, "venue.db");
    const before = await readFile(target);
    await expect(
      recovery(f.options).resume(
        { ...f.resumeRequest, nodeRecoverySecret: secret },
        { onBox: false },
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(await f.workspace.read()).toEqual(journal);
    expect(await readFile(target)).toEqual(before);
  },
);

it("a placement-started record cannot authenticate a copied target whose module event never committed", async () => {
  const f = await selectedRepair();
  f.options.log = (...args: unknown[]) => {
    if (args[1] === "restore.migrated") throw new Error("interrupted before module commit");
  };
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toThrow("interrupted before module commit");
  await f.service.dispose();
  const journal = await f.workspace.read();
  const target = join(f.record.target.target.venueDir, "venue.db");
  const before = await readFile(target);
  await expect(
    recovery(f.options).resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      { onBox: false },
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await f.workspace.read()).toEqual(journal);
  expect(await readFile(target)).toEqual(before);
  await expect(access(join(f.record.target.target.stateDir, "trading.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it.each(["remove", "replace", "symlink"] as const)(
  "resume refuses %s of its encrypted private material",
  async (change) => {
    const f = await interruptedRepair();
    const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
    if (change === "replace")
      await writeFile(path, JSON.stringify({ version: 1, ciphertext: "AAAA" }));
    else {
      await unlink(path);
      if (change === "symlink")
        await import("node:fs/promises").then((fs) =>
          fs.symlink(join(f.roots.stateDir, "first-setup.json"), path),
        );
    }
    const journal = await f.workspace.read();
    await expect(
      recovery(f.options).resume(f.resumeRequest, { onBox: false }),
    ).rejects.toMatchObject({
      code:
        change === "replace"
          ? "promotion.break_glass_invalid"
          : change === "symlink"
            ? "setup.attempt_invalid"
            : "setup.attempt_conflict",
    });
    expect(await f.workspace.read()).toEqual(journal);
  },
);

it("resume refuses private publication from a different recovery event even when its key is valid", async () => {
  const f = await interruptedRepair();
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const envelope = JSON.parse(await readFile(path, "utf8")) as {
    version: number;
    ciphertext: string;
  };
  const entries = unpackArchive(
    decryptArtifact(Buffer.from(envelope.ciphertext, "base64"), key.secret),
  );
  const entry = entries.find((entry) => entry.name === "repair-publication.json")!;
  const meta = JSON.parse(Buffer.from(entry.bytes).toString("utf8"));
  meta.binding.binding.eventId = "fe663c93-c1e6-4688-a294-8e11502d53ef";
  entry.bytes = Buffer.from(JSON.stringify(meta));
  envelope.ciphertext = encryptArtifact(packArchive(entries), key.secret).toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  await expect(recovery(f.options).resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject(
    { code: "setup.attempt_conflict" },
  );
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("a prepared target with no placement cannot be resumed as a committed target", async () => {
  const f = await selectedRepair();
  await f.service.dispose();
  await expect(
    recovery(f.options).resume(
      {
        observation: f.request.observation,
        recoveryId: f.session.recoveryId,
        nodeRecoverySecret: key.secret,
        context: { oldBoxGone: true, soleRecovery: true },
      },
      { onBox: false },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.workspace.read()).at(-1)).toEqual(f.record);
});

it("reuses its immutable publication material when interrupted before recording placement-started", async () => {
  const f = await selectedRepair();
  const append = f.workspace.append;
  const fail = vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
    if (record.phase === "placement-started") throw new AppError("setup.attempt_invalid", {});
    return append(record);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  const path = join(dirname(dirname(f.record.target.target.stateDir)), "publication.json");
  const retained = await readFile(path);
  fail.mockRestore();
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  expect(await readFile(path)).toEqual(retained);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
});

it("resume does not recreate a target database removed while its key proof was running", async () => {
  const f = await interruptedRepair();
  const path = join(f.record.target.target.venueDir, "venue.db");
  const original = f.host.resolution.withVenueExclusion;
  let turns = 0;
  f.host.resolution.withVenueExclusion = (run) =>
    original(async () => {
      if (++turns === 2)
        await import("node:fs/promises").then((fs) => fs.rename(path, path + ".retained"));
      return run();
    });
  await expect(recovery(f.options).resume(f.resumeRequest, { onBox: false })).rejects.toMatchObject(
    { code: "setup.attempt_conflict" },
  );
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("a target changed after resume proof is refused before rewriting its evidence", async () => {
  const f = await interruptedRepair();
  const service = recovery(f.options);
  const session = await service.resume(f.resumeRequest, { onBox: false });
  const target = f.record.target.target;
  await copyFile(f.database, join(target.venueDir, "venue.db"));
  const path = join(target.stateDir, "module-evidence/fiscal-verifactu/hour-history.json");
  const before = Buffer.from(
    JSON.stringify({ reference: "unexplained target evidence", complete: true, records: [] }),
  );
  await writeFile(path, before);
  await expect(
    service.commit(session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await readFile(path)).toEqual(before);
  expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
});

it("can resume publication of a valid backup containing a 256 KiB private state entry", async () => {
  const f = await fixture(true);
  const entries = unpackArchive(decryptArtifact(f.request.source.artifact, f.restore.recoveryKey));
  const privateBytes = Buffer.alloc(256 * 1024, "x");
  entries.push({ name: "secrets/large-private.txt", bytes: privateBytes });
  f.request.source.artifact = Uint8Array.from(
    encryptArtifact(packArchive(entries), f.restore.recoveryKey),
  );
  const service = recovery(f.options);
  const session = await service.open(f.request, { onBox: false });
  const selected = (await recoverySelectPastWaits(
    clock,
    { prepare: (proposal, client) => service.prepare(session.sessionId, proposal, client) },
    { onBox: false },
  )) as { input: unknown };
  vi.spyOn(stateSecrets, "unpackBundleToDir").mockRejectedValueOnce(
    new Error("interrupted secrets"),
  );
  await expect(service.commit(session.sessionId, selected.input, { onBox: false })).rejects.toThrow(
    "interrupted secrets",
  );
  await service.dispose();
  const restarted = recovery(f.options);
  const resumed = await restarted.resume(
    {
      observation: f.request.observation,
      recoveryId: session.recoveryId,
      nodeRecoverySecret: key.secret,
      context: { oldBoxGone: true, soleRecovery: true },
    },
    { onBox: false },
  );
  await restarted.commit(resumed.sessionId, selected.input, { onBox: false });
  const target = (await f.workspace.read()).at(-1)!.target.target;
  expect(await readFile(join(target.stateDir, "large-private.txt"))).toEqual(privateBytes);
});
