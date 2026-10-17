import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, realpath, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFirstSetupCoordinator, createFirstSetupStore } from "@waitron/provisioning";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { request, PASSWORD } from "../test/first-fiscal.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture(phase: "claim" | "abandon" | "active" = "claim") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "first-resolution-")));
  dirs.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...roots, coordinator });
  const ownerOptions = {
    ...roots,
    store,
    coordinator,
    bootId: "boot-1",
    freeze: async (
      venue: import("@waitron/provisioning").VenueRequest,
      environment: "production" | "preproduction",
      ids: Pick<
        import("@waitron/provisioning").FirstSetupFrozen,
        "attemptId" | "nodeId" | "administratorId"
      >,
    ) => ({
      ...ids,
      sourceId: `first-setup:${ids.attemptId}`,
      request: venue,
      environment,
      modules: [],
    }),
  };
  const owner = createFirstSetupOwner(ownerOptions);
  const claim = await owner.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
  if (phase === "abandon") await store.update(claim.state.attemptId, 1, { kind: "abandoned" });
  const markerPath = join(roots.venueDir, "first-setup-claim.json");
  if (phase !== "active") {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.status = phase === "claim" ? "claiming" : "active";
    await writeFile(markerPath, JSON.stringify(marker));
  }
  await suite.db.archiveTo(join(roots.venueDir, "venue.db"));
  const service = createFirstSetupResolutionInspection({ ...roots, store });
  const recovering = createFirstSetupOwner({ ...ownerOptions, resolution: service });
  return {
    root,
    ...roots,
    store,
    coordinator,
    owner,
    ownerOptions,
    recovering,
    claim,
    markerPath,
    service,
  };
}
async function actionsFixture() {
  const f = await fixture("active");
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const service = createFirstSetupResolutionActions({
    ...f,
    host: {
      resolution: f.service,
      owner: f.recovering,
      store: f.store,
      coordinator: f.coordinator,
      evidence: { invalidate: () => {} },
      delivery: { invalidate: () => {} },
    },
  });
  const request = async () => {
    const inspection = await f.service.inspectFirstSetupResolution();
    return {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision!,
      ownerGeneration: inspection.ownerGeneration!,
      register: { kind: "no-current-master" as const, confirmed: true as const },
    };
  };
  return { ...f, actions: service, startRequest: request };
}
it("Start again retires a qualified unused workspace without a password and never changes its original claim", async () => {
  const f = await actionsFixture();
  const before = await readFile(join(f.stateDir, "first-setup.json"));
  const binding = await f.actions.startAgainFirstSetup(await f.startRequest());
  expect(binding.anchorVenueDir).toBe(
    await import("node:fs/promises").then((fs) => fs.realpath(f.venueDir)),
  );
  expect(binding.venueDir).not.toBe(f.venueDir);
  expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
  await expect(readFile(join(binding.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const { assertVenueFirstSetupAllowed } = await import("@waitron/provisioning");
  await expect(assertVenueFirstSetupAllowed(f.venueDir)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it.each(["module-operation-public.json", "first-setup-node-key.json", "modules.json"])(
  "absence of a paper signer does not make %s history eligible for password-free reset",
  async (name) => {
    const f = await actionsFixture();
    await writeFile(join(f.stateDir, name), "{}");
    const req = await f.startRequest();
    await expect(f.actions.startAgainFirstSetup(req)).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it("a no-master declaration cannot clear saved consumption intent", async () => {
  const f = await actionsFixture();
  await f.store.update(f.claim.state.attemptId, 1, { kind: "consumption-intent" });
  const req = await f.startRequest();
  await expect(f.actions.startAgainFirstSetup(req)).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect((await f.store.read())?.consumptionIntent).toBe(true);
});

it.each(["file", "directory"] as const)(
  "a missing configured outside %s is unknown register history for password-free Start again",
  async (kind) => {
    const f = await actionsFixture();
    const missing = join(f.root, "missing-outside-history");
    const resolution = createFirstSetupResolutionInspection({
      ...f,
      ...(kind === "file"
        ? { publicEvidencePaths: [missing] }
        : { publicEvidenceDirectories: [missing] }),
    });
    const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
    const actions = createFirstSetupResolutionActions({
      ...f,
      host: {
        resolution,
        store: f.store,
        coordinator: f.coordinator,
        owner: f.recovering,
        evidence: { invalidate: () => {} },
        delivery: { invalidate: () => {} },
      },
    });
    const inspection = await resolution.inspectFirstSetupResolution();
    const before = await readFile(join(f.stateDir, "first-setup.json"));
    await expect(
      actions.startAgainFirstSetup({
        inspectionId: inspection.inspectionId,
        revision: inspection.revision!,
        ownerGeneration: inspection.ownerGeneration!,
        register: { kind: "no-current-master", confirmed: true },
      }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
    await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it("an authenticated missing-database retirement preserves spent intent and all document bytes", async () => {
  const f = await actionsFixture();
  await f.store.update(f.claim.state.attemptId, 1, { kind: "consumption-intent" });
  const inspection = await f.service.inspectFirstSetupResolution();
  const recovered = await f.recovering.recoverFirstSetupOwner({
    inspectionId: inspection.inspectionId,
    revision: inspection.revision!,
    ownerGeneration: inspection.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.ownerGeneration,
    capability: recovered.capability,
  };
  await rm(join(f.venueDir, "venue.db"));
  await mkdir(join(f.stateDir, "first-fiscal-documents"));
  await writeFile(
    join(f.stateDir, "first-fiscal-documents", "orphan.json"),
    "retained malformed public chunk",
  );
  const before = await readFile(join(f.stateDir, "first-setup.json"));
  const binding = await f.actions.startAgainFirstSetup({
    ...(await f.startRequest()),
    owner,
    register: {
      kind: "current-master",
      status: "Unknown",
      custodian: "Elena",
      reference: "d".repeat(64),
      consultedAt: "2026-10-16T02:00:00.000Z",
    },
  });
  expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
  expect((JSON.parse(before.toString()) as { consumptionIntent: boolean }).consumptionIntent).toBe(
    true,
  );
  await expect(readFile(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(f.stateDir, "first-fiscal-documents", "orphan.json"), "utf8")).toBe(
    "retained malformed public chunk",
  );
  await expect(readFile(join(binding.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("Start again rejects a stale snapshot before recording retirement", async () => {
  const f = await actionsFixture();
  const request = await f.startRequest();
  await writeFile(join(f.stateDir, "trading.env"), "CHANGED");
  await expect(f.actions.startAgainFirstSetup(request)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("retirement snapshots retain configured public files, receipt directories and absent paths", async () => {
  const f = await fixture("active");
  const publicFile = join(f.root, "configured-history.json"),
    receipts = join(f.root, "receipts");
  await writeFile(publicFile, "original configured bytes");
  await mkdir(receipts);
  await writeFile(join(receipts, "one.json"), "original receipt");
  const service = createFirstSetupResolutionInspection({
    ...f,
    publicEvidencePaths: [publicFile, join(f.root, "missing.json")],
    publicEvidenceDirectories: [receipts],
  });
  const snapshot = await service.captureFirstSetupOriginals();
  expect(snapshot.originals).toContainEqual({
    name: `outside-file:${publicFile}`,
    bytes: Buffer.from("original configured bytes"),
  });
  expect(snapshot.originals).toContainEqual({
    name: `outside-file:${join(receipts, "one.json")}`,
    bytes: Buffer.from("original receipt"),
  });
  expect(snapshot.originals).toContainEqual({
    name: `directory:outside:${receipts}`,
    bytes: Buffer.from('["one.json"]'),
  });
  expect(snapshot.originals).toContainEqual({
    name: `outside-file:${join(f.root, "missing.json")}`,
    bytes: null,
  });
  expect(snapshot.inspection.inspectionId).toBe(
    (await service.inspectFirstSetupResolution()).inspectionId,
  );
});

it.each(["missing", "corrupt", "partial"] as const)(
  "password-free Start again refuses a %s database",
  async (kind) => {
    const f = await actionsFixture();
    const path = join(f.venueDir, "venue.db");
    await rm(path);
    if (kind === "corrupt") await writeFile(path, "not a database");
    if (kind === "partial") await writeFile(path, Buffer.alloc(0));
    await expect(f.actions.startAgainFirstSetup(await f.startRequest())).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
it("Start again serialises two browsers so an unchanged old claim is retired only once", async () => {
  const f = await actionsFixture(),
    request = await f.startRequest();
  const results = await Promise.allSettled([
    f.actions.startAgainFirstSetup(request),
    f.actions.startAgainFirstSetup(request),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const { resolveFirstSetupWorkspace } = await import("@waitron/provisioning");
  const target = await resolveFirstSetupWorkspace(f);
  expect(target.binding).not.toBeNull();
});

it("Start again can retire two fresh attempts while discovery stays at the original roots", async () => {
  const f = await actionsFixture();
  const first = await f.actions.startAgainFirstSetup(await f.startRequest());
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const host = createFirstSetupModuleHost({
    environment: {},
    stateDir: first.stateDir,
    venueDir: first.venueDir,
    modules: [],
  });
  const claim = await host.owner.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
  await suite.db.archiveTo(join(first.venueDir, "venue.db"));
  const inspection = await host.resolution.inspectFirstSetupResolution();
  const actions = createFirstSetupResolutionActions({ ...first, host });
  const next = await actions.startAgainFirstSetup({
    inspectionId: inspection.inspectionId,
    revision: claim.state.revision,
    ownerGeneration: claim.state.ownerGeneration,
    register: { kind: "no-current-master", confirmed: true },
  });
  expect(next.anchorStateDir).toBe(first.anchorStateDir);
  expect(next.anchorVenueDir).toBe(first.anchorVenueDir);
  expect(next.selectionGeneration).toBe(2);
  expect(next.venueDir.startsWith(join(first.anchorStateDir, "first-setup-workspaces"))).toBe(true);
  const { resolveFirstSetupWorkspace } = await import("@waitron/provisioning");
  expect(
    (
      await resolveFirstSetupWorkspace({
        stateDir: first.anchorStateDir,
        venueDir: first.anchorVenueDir,
      })
    ).binding,
  ).toEqual(next);
  expect((await host.resolution.inspectFirstSetupResolution()).database).toBe("no-venue-rows");
});

it("retirement captures stable physical paths for configured ancestor aliases and deduplicates the same original", async () => {
  const f = await fixture("active");
  const physical = join(f.root, "public");
  await mkdir(join(physical, "history"), { recursive: true });
  await mkdir(join(physical, "receipts"));
  await writeFile(join(physical, "history", "current.json"), '{"position":42}');
  await writeFile(join(physical, "receipts", "one.json"), '{"serial":42}');
  await symlink(physical, join(f.root, "alias"));
  const service = createFirstSetupResolutionInspection({
    ...f,
    publicEvidencePaths: [
      join(f.root, "alias", "history", "current.json"),
      join(physical, "history", "current.json"),
    ],
    publicEvidenceDirectories: [join(f.root, "alias", "receipts"), join(physical, "receipts")],
  });
  const { realpath } = await import("node:fs/promises");
  const canonical = await realpath(physical);
  const snapshot = await service.captureFirstSetupOriginals();
  expect(snapshot.originals.filter((entry) => entry.name.startsWith("outside-file:"))).toEqual([
    {
      name: `outside-file:${join(canonical, "history", "current.json")}`,
      bytes: Buffer.from('{"position":42}'),
    },
    {
      name: `outside-file:${join(canonical, "receipts", "one.json")}`,
      bytes: Buffer.from('{"serial":42}'),
    },
  ]);
  expect(snapshot.originals.filter((entry) => entry.name.startsWith("directory:outside:"))).toEqual(
    [
      {
        name: `directory:outside:${join(canonical, "receipts")}`,
        bytes: Buffer.from('["one.json"]'),
      },
    ],
  );
});

it.each(["file", "directory"])(
  "retargeting a configured %s ancestor invalidates inspection even with identical bytes",
  async (kind) => {
    const f = await fixture("active");
    for (const name of ["first", "second"]) {
      await mkdir(join(f.root, name, "history"), { recursive: true });
      await writeFile(join(f.root, name, "history", "current.json"), '{"position":42}');
    }
    const alias = join(f.root, "alias");
    await symlink(join(f.root, "first"), alias);
    const service = createFirstSetupResolutionInspection({
      ...f,
      ...(kind === "file"
        ? { publicEvidencePaths: [join(alias, "history", "current.json")] }
        : { publicEvidenceDirectories: [join(alias, "history")] }),
    });
    const before = await service.inspectFirstSetupResolution();
    const { unlink } = await import("node:fs/promises");
    await unlink(alias);
    await symlink(join(f.root, "second"), alias);
    const after = await service.inspectFirstSetupResolution();
    expect(after.artifacts).toEqual(before.artifacts);
    expect(after.inspectionId).not.toBe(before.inspectionId);
  },
);

it("refuses empty-only restart with retained catalogue rows and no taxpayer or location", async () => {
  const { catalogues } = await import("@waitron/db");
  await suite.db.insert(catalogues).values({ name: "Restaurant retained menu" });
  const f = await actionsFixture();
  const inspection = await f.service.inspectFirstSetupResolution();
  expect(inspection.database).toBe("no-venue-rows");
  const before = await readFile(join(f.stateDir, "first-setup.json"));
  await expect(f.actions.startAgainFirstSetup(await f.startRequest())).rejects.toMatchObject({
    code: "setup.not_ready",
  });
  expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
  await expect(readFile(join(f.venueDir, "first-setup-retirement.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("requires the configured module schema for empty-only restart", async () => {
  const f = await fixture("active");
  const { ALL_MODULES } = await import("@waitron/composition");
  const { createFirstSetupModuleHost } = await import("./module-operation-host.js");
  const { createFirstSetupResolutionActions } = await import("./first-setup-resolution.js");
  const host = createFirstSetupModuleHost({
    ...f,
    environment: {},
    modules: ALL_MODULES.filter((module) => module.name === "scheduler"),
  });
  const actions = createFirstSetupResolutionActions({ ...f, host });
  const inspection = await host.resolution.inspectFirstSetupResolution();
  expect(inspection.database).toBe("no-venue-rows");
  await expect(
    actions.startAgainFirstSetup({
      inspectionId: inspection.inspectionId,
      revision: inspection.revision!,
      ownerGeneration: inspection.ownerGeneration!,
      register: { kind: "no-current-master", confirmed: true },
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
});

it("refuses empty-only marker repair with retained catalogue rows", async () => {
  const { catalogues } = await import("@waitron/db");
  await suite.db.insert(catalogues).values({ name: "Restaurant retained menu" });
  const f = await fixture();
  const inspection = await f.service.inspectFirstSetupResolution();
  expect(inspection.database).toBe("no-venue-rows");
  expect(inspection.repairEligible).toBe(false);
  const before = await readFile(f.markerPath);
  await expect(
    f.recovering.recoverFirstSetupOwner({
      inspectionId: inspection.inspectionId,
      revision: inspection.revision!,
      ownerGeneration: inspection.ownerGeneration!,
      clientClaimNonce: randomBytes(32).toString("base64url"),
      password: PASSWORD,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(f.markerPath)).toEqual(before);
});

it.each(["missing-table", "missing-column", "short-journal", "foreign-journal"])(
  "refuses empty-only restart with %s despite intact taxpayer and location reads",
  async (kind) => {
    const { DatabaseSync } = await import("node:sqlite");
    const f = await actionsFixture();
    const connection = new DatabaseSync(join(f.venueDir, "venue.db"));
    try {
      if (kind === "missing-table") connection.exec('drop table "catalogues"');
      if (kind === "missing-column") connection.exec('alter table "catalogues" drop column "name"');
      if (kind === "short-journal")
        connection.exec('delete from "__drizzle_migrations_db" where rowid = 1');
      if (kind === "foreign-journal")
        connection.exec("update \"__drizzle_migrations_db\" set hash = 'unknown' where rowid = 1");
    } finally {
      connection.close();
    }
    expect((await f.service.inspectFirstSetupResolution()).database).toBe("no-venue-rows");
    await expect(f.actions.startAgainFirstSetup(await f.startRequest())).rejects.toMatchObject({
      code: "setup.not_ready",
    });
  },
);
