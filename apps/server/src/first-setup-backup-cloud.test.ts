import { key, clock } from "../test/hour-recovery-host.js";

import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as filesystem from "node:fs/promises";
import * as restore from "./restore.js";

import { expect, it, vi } from "vitest";
import { openVenueDatabase, invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";

import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import * as runtime from "./backup-verification-target.js";
import * as secrets from "./state-secrets.js";

import { readCloudRecoveryState } from "./cloud-recovery-v2.js";
import { recovery, selectedRepair } from "../test/first-setup-backup-cloud-fixture.js";

vi.mock("./backup-verification-target.js", { spy: true });
vi.mock("./state-secrets.js", { spy: true });
vi.mock("node:fs/promises", { spy: true });
vi.mock("./restore.js", { spy: true });
vi.mock("./first-setup-backup-source.js", { spy: true });

it("keeps Cloud approval outside the retained setup and selects the checked target without source backup.env", async () => {
  const f = await selectedRepair();
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.original);
  await expect(access(join(f.roots.stateDir, "cloud-recovery.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const state = await readCloudRecoveryState(f.record.target.target.stateDir);
  expect(state).toMatchObject({
    version: 2,
    requestId: f.approved.requestId,
    pointId: f.pointId,
    phase: "reported",
    target: f.target,
  });
  await expect(access(join(f.record.target.target.stateDir, "backup.env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(f.calls.filter((action) => action === "restored")).toHaveLength(1);
  expect(f.control.downloaded).toBe(2);
  const db = await openVenueDatabase(f.record.target.target.venueDir);
  try {
    expect(
      (await db.venue.select().from(invoiceSeries)).some(
        (row) => row.retiredAt === null && row.nextNumber === 1,
      ),
    ).toBe(true);
  } finally {
    await db.close();
  }
});

it.each(["secrets", "staged-save", "restored-record", "selection"] as const)(
  "resumes Cloud after %s interruption with new target proof and no second download",
  async (point) => {
    const f = await selectedRepair();
    if (point === "secrets")
      vi.spyOn(secrets, "unpackBundleToDir").mockRejectedValueOnce(
        new Error("interrupted secrets"),
      );
    else if (point === "staged-save") {
      const { rename } = await vi.importActual<typeof filesystem>("node:fs/promises");
      vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
        if (
          String(to).endsWith("/cloud-recovery.json") &&
          JSON.parse(await readFile(from, "utf8")).phase === "staged"
        )
          throw new Error("interrupted staged save");
        return rename(from, to);
      });
    } else if (point === "restored-record") {
      const append = f.workspace.append;
      vi.spyOn(f.workspace, "append").mockImplementation(async (record) => {
        if (record.phase === "restored") throw new Error("interrupted restored record");
        return append(record);
      });
    } else
      vi.spyOn(f.workspace, "select").mockRejectedValueOnce(new Error("interrupted selection"));
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow("interrupted");
    vi.restoreAllMocks();
    vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(f.target);
    await f.service.dispose();
    const before = f.control.downloaded;
    const db = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      await db.venue.update(invoiceSeries).set({ nextNumber: 147 });
    } finally {
      await db.close();
    }
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
    expect(resumed.input).toEqual(f.selected.input);
    expect(resumed.binding).toEqual(f.session.binding);
    const advanced = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      await advanced.venue.update(invoiceSeries).set({ nextNumber: 223 });
    } finally {
      await advanced.close();
    }
    await restarted.commit(resumed.sessionId, resumed.input, { onBox: false });
    expect(f.control.downloaded).toBe(before);
    expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
    expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
      requestId: f.approved.requestId,
      pointId: f.pointId,
      phase: "reported",
    });
    await expect(access(join(f.record.target.target.stateDir, "backup.env"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    const after = await openVenueDatabase(f.record.target.target.venueDir);
    try {
      expect(
        (await after.venue.select().from(invoiceSeries)).every((row) => row.nextNumber === 223),
      ).toBe(true);
    } finally {
      await after.close();
    }
  },
);

it.each(["target", "verification", "point", "expired", "revoked", "archive"] as const)(
  "refuses changed Cloud %s before any target database write",
  async (change) => {
    const f = await selectedRepair();
    if (change === "target")
      vi.spyOn(runtime, "currentBackupVerificationTarget").mockReturnValue(
        buildBackupVerificationTarget({
          modules: ALL_MODULES,
          migrationsRoot: null,
          runtime: { ...f.target.runtime, revision: "d".repeat(40) },
        }),
      );
    else if (change === "revoked") f.control.refuse = "read";
    else if (change === "archive") f.control.archive = Buffer.from("changed archive");
    else
      f.control.rewrite = (action, result) => {
        if (action !== "info") return result;
        if (change === "verification")
          return {
            ...result,
            verification: { ...(result.verification as object), requestDigest: "d".repeat(64) },
          };
        if (change === "point")
          return {
            ...result,
            point: { ...(result.point as object), id: "374cac38-cc58-46d5-8d3b-8443fc4343a4" },
          };
        return { ...result, operationExpiresAt: new Date(clock.wall() - 1).toISOString() };
      };
    await expect(
      f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
    ).rejects.toThrow("Cloud recovery is unavailable");
    await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await f.workspace.read()).at(-1)!.phase).toBe("placement-started");
    expect(f.calls).not.toContain("restored");
    expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.original);
  },
);

it("finishes local selection while a refused provider acknowledgement stays restored and pending", async () => {
  const f = await selectedRepair();
  f.control.refuse = "restored";
  await f.service.commit(f.session.sessionId, f.selected.input, { onBox: false });
  expect((await f.workspace.read()).at(-1)!.phase).toBe("selected");
  expect(await readCloudRecoveryState(f.record.target.target.stateDir)).toMatchObject({
    requestId: f.approved.requestId,
    phase: "restored",
  });
  expect(
    await readCloudRecoveryState(join(dirname(dirname(f.record.target.target.stateDir)), "cloud")),
  ).toMatchObject({ phase: "restored" });
});

it("does not replace Cloud approval changed at the placement lock", async () => {
  const f = await selectedRepair();
  const { restoreFromArtifact: actual } = await vi.importActual<typeof restore>("./restore.js");
  let injected: Buffer | undefined;
  vi.spyOn(restore, "restoreFromArtifact").mockImplementation(async (deps) => {
    const state = await readCloudRecoveryState(deps.stateDir);
    injected = Buffer.from(JSON.stringify({ ...state, code: "12345678" }));
    await writeFile(join(deps.stateDir, "cloud-recovery.json"), injected);
    return actual(deps);
  });
  await expect(
    f.service.commit(f.session.sessionId, f.selected.input, { onBox: false }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(join(f.record.target.target.stateDir, "cloud-recovery.json"))).toEqual(
    injected,
  );
  await expect(access(join(f.record.target.target.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
