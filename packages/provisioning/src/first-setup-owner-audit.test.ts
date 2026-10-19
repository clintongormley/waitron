import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  createFirstSetupStore,
  type FirstSetupFrozen,
} from "./index.js";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { createFirstSetupOwnerAudit } from "./first-setup-owner-audit.js";
import type { ResolutionInput } from "./first-setup-resolution.js";
import { request, PASSWORD } from "../test/first-setup-request.js";

vi.mock("node:fs/promises", { spy: true });
const database = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.rename).mockImplementation(actual.rename);
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});
async function fixture(phase: "active" | "claim" | "abandon" = "active") {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "owner-audit-")));
  directories.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...roots, coordinator });
  const options = {
    ...roots,
    store,
    coordinator,
    bootId: "synthetic-audit-boot",
    freeze: async (
      venue: FirstSetupFrozen["request"],
      environment: FirstSetupFrozen["environment"],
      ids: Pick<FirstSetupFrozen, "attemptId" | "nodeId" | "administratorId">,
    ) => ({
      ...ids,
      sourceId: `first-setup:${ids.attemptId}`,
      request: venue,
      environment,
      modules: [],
    }),
  };
  const original = createFirstSetupOwner(options);
  const claim = await original.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
  if (phase === "abandon") await store.update(claim.state.attemptId, 1, { kind: "abandoned" });
  const markerPath = join(roots.venueDir, "first-setup-claim.json");
  if (phase !== "active") {
    const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
    marker.status = phase === "claim" ? "claiming" : "active";
    await fs.writeFile(markerPath, JSON.stringify(marker));
  }
  await database.db.archiveTo(join(roots.venueDir, "venue.db"));
  const resolution = createFirstSetupResolutionInspection({ ...roots, store });
  const recover = async (password = PASSWORD) => {
    const inspection = await resolution.inspectFirstSetupResolution();
    const nonce = randomBytes(32).toString("base64url");
    const result = await createFirstSetupOwner({ ...options, resolution }).recoverFirstSetupOwner({
      inspectionId: inspection.inspectionId,
      revision: inspection.revision!,
      ownerGeneration: inspection.ownerGeneration!,
      clientClaimNonce: nonce,
      password,
    });
    return { ...result, nonce };
  };
  const records = createFirstSetupResolutionStore({
    ...roots,
    coordinator: createFirstSetupCoordinator(),
  });
  const ids = () =>
    fs
      .readdir(join(roots.stateDir, "first-setup-resolutions"))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
  return {
    ...roots,
    root,
    store,
    original,
    claim,
    markerPath,
    resolution,
    recover,
    recoverLegacy: () =>
      createFirstSetupOwner({ ...options, resolution }).recoverFirstSetup(
        randomBytes(32).toString("base64url"),
        { password: PASSWORD },
      ),
    records,
    ids,
  };
}
it.each(["active", "claim", "abandon"] as const)(
  "durably records %s marker/ownership changes with no fabricated register answer",
  async (phase) => {
    const f = await fixture(phase);
    const state = await fs.readFile(join(f.stateDir, "first-setup.json"));
    const marker = await fs.readFile(f.markerPath);
    const recovered = await f.recover();
    const ids = await f.ids();
    expect(ids).toHaveLength(1);
    const records = await f.records.read(ids[0]!);
    expect(records.map(({ action, phase }) => [action, phase])).toEqual(
      phase === "active"
        ? [
            ["ownership-rebind", "prepared"],
            ["ownership-rebind", "applied"],
          ]
        : [
            ["marker-repair", "prepared"],
            ["marker-repair", "applied"],
            ["ownership-rebind", "prepared"],
            ["ownership-rebind", "applied"],
          ],
    );
    expect(
      records.every(
        (record) => record.register === null && record.authority === "original-password",
      ),
    ).toBe(true);
    const originals = await f.records.readOriginals(ids[0]!);
    expect(originals.find((entry) => entry.name === "state/first-setup.json")?.bytes).toEqual(
      state,
    );
    expect(originals.find((entry) => entry.name === "venue/first-setup-claim.json")?.bytes).toEqual(
      marker,
    );
    for (const [index, record] of records.entries()) {
      expect(record.sequence).toBe(index + 1);
      expect(record.previousRecordDigest).toBe(
        index === 0
          ? null
          : createHash("sha256")
              .update(JSON.stringify(records[index - 1]))
              .digest("hex"),
      );
      for (const secret of [PASSWORD, recovered.nonce, recovered.capability])
        expect(JSON.stringify(record)).not.toContain(secret);
    }
    expect(recovered.ownerGeneration).toBe(2);
    expect((await f.store.read())?.frozen).toEqual(JSON.parse(state.toString()).frozen);
    expect(recovered.state.status).toBe(phase === "abandon" ? "abandoned" : "claimed");
    await expect(
      f.original.status({ ...f.claim.state, capability: f.claim.capability }),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
  },
);
it("does not create an audit or repair a marker for the wrong password", async () => {
  const f = await fixture("claim");
  const marker = await fs.readFile(f.markerPath);
  await expect(f.recover("wrong password")).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await f.ids()).toEqual([]);
  expect(await fs.readFile(f.markerPath)).toEqual(marker);
});
it("chains separate ownership recoveries and preserves the first evidence bytes", async () => {
  const f = await fixture("claim");
  await f.recover();
  const [id] = await f.ids();
  expect(id).toBeDefined();
  const first = await f.records.read(id!);
  const originals = await f.records.readOriginals(id!);
  const second = await f.recover();
  const after = await f.records.read(id!);
  expect(after.slice(0, 4)).toEqual(first);
  expect(after.slice(4).map(({ action, phase }) => [action, phase])).toEqual([
    ["ownership-rebind", "prepared"],
    ["ownership-rebind", "applied"],
  ]);
  expect(await f.records.readOriginals(id!)).toEqual(originals);
  expect(second.ownerGeneration).toBe(3);
});

it.each(
  [
    "marker-prepared",
    "marker-write",
    "marker-applied",
    "owner-prepared",
    "owner-write",
    "owner-applied",
  ].flatMap((point) => [false, true].map((after) => ({ point, after }))),
)(
  "resumes $point interrupted after-rename=$after without dropping the audit or reusing old access",
  async ({ point, after }) => {
    const f = await fixture("claim");
    const before = (await f.store.readForRepair())!.state;
    const marker = await fs.readFile(f.markerPath);
    const names: Record<string, string> = {
      "marker-prepared": "000001.json",
      "marker-applied": "000002.json",
      "owner-prepared": "000003.json",
      "owner-applied": "000004.json",
      "marker-write": "first-setup-claim.json",
      "owner-write": "first-setup.json",
    };
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    let faults = 0;
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      const target = String(to).endsWith(`/${names[point]}`);
      if (target && faults === 0) {
        faults++;
        if (after) await actual.rename(from, to);
        throw new Error("synthetic ownership audit interruption");
      }
      await actual.rename(from, to);
    });
    await expect(f.recover()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(faults).toBe(1);
    vi.mocked(fs.rename).mockImplementation(actual.rename);
    const recovered = await f.recover();
    const ids = await f.ids();
    expect(ids).toHaveLength(1);
    const records = await f.records.read(ids[0]!);
    expect(records[records.length - 1]).toMatchObject({
      action: "ownership-rebind",
      phase: "applied",
    });
    expect(
      records.filter((record) => record.action === "marker-repair").map((record) => record.phase),
    ).toEqual(["prepared", "applied"]);
    expect(records.filter((record) => record.phase === "prepared").length * 2).toBe(records.length);
    expect(
      (await f.records.readOriginals(ids[0]!)).find(
        (entry) => entry.name === "venue/first-setup-claim.json",
      )?.bytes,
    ).toEqual(marker);
    expect((await f.store.read())?.frozen).toEqual(before.frozen);
    expect(recovered.state.status).toBe("claimed");
    await expect(
      f.original.status({ ...f.claim.state, capability: f.claim.capability }),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
  },
);

it.each(["state", "outside-evidence"] as const)(
  "refuses a pending recovery whose %s changed beyond its recorded action",
  async (changed) => {
    const f = await fixture("claim");
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(to).endsWith("/000004.json")) throw new Error("lost applied write");
      await actual.rename(from, to);
    });
    await expect(f.recover()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    vi.mocked(fs.rename).mockImplementation(actual.rename);
    const [id] = await f.ids();
    const beforeRecords = await f.records.read(id!);
    expect(beforeRecords[3 - 1]).toMatchObject({ action: "ownership-rebind", phase: "prepared" });
    if (changed === "state") {
      const state = (await f.store.read())!;
      await f.store.update(state.frozen.attemptId, state.revision, { kind: "consumption-intent" });
    } else await fs.writeFile(join(f.stateDir, "module-operation-public.json"), "{}");
    const before = await fs.readFile(join(f.stateDir, "first-setup.json"));
    await expect(f.recover()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(await fs.readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
    expect(await f.records.read(id!)).toEqual(beforeRecords);
  },
);

it("keeps legacy password recovery out of a venue held by another process", async () => {
  const f = await fixture("active");
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from "node:sqlite";
    const lock = new DatabaseSync(process.argv[1]);
    lock.exec("pragma busy_timeout=0; begin immediate");
    process.stdout.write("held");
    setInterval(() => lock, 1000);
  `,
      join(f.venueDir, "venue.lock"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const [chunk] = await Promise.race([
      once(child.stdout!, "data"),
      once(child, "exit").then(([code]) => {
        throw new Error(`lock holder exited ${String(code)}`);
      }),
    ]);
    expect(String(chunk)).toBe("held");
    const before = await fs.readFile(join(f.stateDir, "first-setup.json"));
    await expect(f.recoverLegacy()).rejects.toMatchObject({ code: "provisioning.database_in_use" });
    expect(await fs.readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
    expect(await f.ids()).toEqual([]);
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
});

async function pendingAudit(
  f: Awaited<ReturnType<typeof fixture>>,
  action: "marker-repair" | "ownership-rebind",
  mutate: (input: ResolutionInput, originals: { name: string; bytes: Buffer | null }[]) => void,
) {
  const before = (await f.store.readForRepair())!.state;
  const snapshot = await f.resolution.captureFirstSetupOriginals();
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        "waitron-owner-audit-v1",
        before.stateDir,
        before.venueDir,
        before.frozen.attemptId,
      ]),
    )
    .digest("hex");
  const resolutionId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const input: ResolutionInput = {
    resolutionId,
    attemptId: before.frozen.attemptId,
    observedRevision: before.revision,
    observedOwnerGeneration: before.ownerGeneration,
    database: "empty-preactivation",
    authority: "original-password",
    register: null,
    action,
    nextWorkspace: null,
  };
  mutate(input, snapshot.originals);
  const prepared = await f.records.prepare(input, snapshot.originals);
  return { before, prepared, audit: createFirstSetupOwnerAudit(before, f.resolution) };
}

it.each(["register", "authority", "attempt", "action", "revision", "generation", "missing-state"])(
  "does not complete a pending ownership audit with inconsistent %s evidence",
  async (fault) => {
    const f = await fixture("active");
    const { before, prepared, audit } = await pendingAudit(
      f,
      "ownership-rebind",
      (input, originals) => {
        if (fault === "register") input.register = { kind: "no-current-master", confirmed: true };
        if (fault === "authority") {
          input.authority = "local-empty-unused-assignment";
          input.action = "retire";
        }
        if (fault === "attempt") input.attemptId = "00000000-0000-4000-8000-000000000001";
        if (fault === "action") {
          input.action = "finish-publication";
          input.database = "committed-exact";
        }
        if (fault === "revision") input.observedRevision!++;
        if (fault === "generation") input.observedOwnerGeneration!++;
        if (fault === "missing-state")
          originals.splice(
            originals.findIndex((entry) => entry.name === "state/first-setup.json"),
            1,
          );
      },
    );
    const state = await fs.readFile(join(f.stateDir, "first-setup.json"));
    const marker = await fs.readFile(f.markerPath);
    await expect(audit.reconcile(before)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(await f.records.read(prepared.resolutionId)).toEqual([prepared]);
    expect(await fs.readFile(join(f.stateDir, "first-setup.json"))).toEqual(state);
    expect(await fs.readFile(f.markerPath)).toEqual(marker);
  },
);

it.each(["state", "missing-marker", "nonobject-marker", "unexpected-marker"])(
  "does not apply a pending marker audit after %s changes",
  async (fault) => {
    const f = await fixture("claim");
    const { before, prepared, audit } = await pendingAudit(
      f,
      "marker-repair",
      (_input, originals) => {
        if (fault === "nonobject-marker")
          originals.find((entry) => entry.name === "venue/first-setup-claim.json")!.bytes =
            Buffer.from("null");
      },
    );
    const current = structuredClone(before);
    if (fault === "state") current.revision++;
    if (fault === "missing-marker") await fs.unlink(f.markerPath);
    if (fault === "unexpected-marker") {
      const marker = JSON.parse(await fs.readFile(f.markerPath, "utf8"));
      marker.status = "complete";
      await fs.writeFile(f.markerPath, JSON.stringify(marker));
    }
    const state = await fs.readFile(join(f.stateDir, "first-setup.json"));
    await expect(audit.reconcile(current)).rejects.toMatchObject({
      code:
        fault === "missing-marker" || fault === "nonobject-marker"
          ? "setup.attempt_invalid"
          : "setup.attempt_conflict",
    });
    expect(await f.records.read(prepared.resolutionId)).toEqual([prepared]);
    expect(await fs.readFile(join(f.stateDir, "first-setup.json"))).toEqual(state);
  },
);

it.each(["revision", "ownerGeneration"] as const)(
  "does not call the ownership writer after the inspected %s changes",
  async (field) => {
    const f = await fixture("active");
    const before = (await f.store.read())!;
    const stale = { ...before, [field]: before[field] + 1 };
    const audit = createFirstSetupOwnerAudit(before, f.resolution);
    const body = vi.fn(async () => "must not run");
    await expect(audit.perform("ownership-rebind", stale, body)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(body).not.toHaveBeenCalled();
    expect(await f.ids()).toEqual([]);
    expect(await f.store.read()).toEqual(before);
  },
);

it.each(["marker-repair", "ownership-rebind"] as const)(
  "leaves an interrupted %s prepared while its source bytes are still unchanged",
  async (action) => {
    const f = await fixture(action === "marker-repair" ? "claim" : "active");
    const { before, prepared, audit } = await pendingAudit(f, action, () => {});
    await audit.reconcile(before);
    expect(await f.records.read(prepared.resolutionId)).toEqual([prepared]);
    expect((await f.store.readForRepair())!.state).toEqual(before);
  },
);
