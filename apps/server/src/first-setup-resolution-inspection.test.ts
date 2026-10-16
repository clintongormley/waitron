import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
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
  const root = await mkdtemp(join(tmpdir(), "first-resolution-"));
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
it.each(["claim", "abandon"] as const)(
  "describes an interrupted %s without repairing it or weakening strict admission",
  async (phase) => {
    const f = await fixture(phase);
    const before = await readFile(join(f.stateDir, "first-setup.json"));
    const marker = await readFile(f.markerPath);
    const db = await readFile(join(f.venueDir, "venue.db"));
    const entries = await readdir(f.venueDir);
    await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    const inspected = await f.service.inspectFirstSetupResolution();
    expect(inspected).toMatchObject({
      version: 2,
      pair: "repairable",
      database: "no-venue-rows",
      repairEligible: true,
      password: "checkable",
      revision: phase === "claim" ? 1 : 2,
      ownerGeneration: 1,
    });
    expect(inspected.inspectionId).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
    expect(await readFile(f.markerPath)).toEqual(marker);
    expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(db);
    expect(await readdir(f.venueDir)).toEqual(entries);
    await expect(f.store.read()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(JSON.stringify(inspected)).not.toContain(PASSWORD);
    expect(JSON.stringify(inspected)).not.toContain("scrypt$");
  },
);
it.each(["missing", "corrupt", "partial", "symlink"] as const)(
  "keeps %s databases unavailable without creating or repairing them",
  async (kind) => {
    const f = await fixture();
    const path = join(f.venueDir, "venue.db");
    await rm(path);
    if (kind === "corrupt") await writeFile(path, "not a SQLite file");
    if (kind === "partial") await writeFile(path, Buffer.alloc(0));
    if (kind === "symlink") await symlink(join(f.root, "missing.db"), path);
    const before = await readdir(f.venueDir);
    const result = await f.service.inspectFirstSetupResolution();
    expect(result.database).toBe(kind === "symlink" ? "unreadable" : kind);
    expect(result.repairEligible).toBe(false);
    expect(await readdir(f.venueDir)).toEqual(before);
    if (kind === "missing") await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it.each([
  "restore-request.json",
  "reset-request.json",
  "setup-operation.json",
  "first-setup-node-key.json",
  "module-operation-public.json",
])("does not call %s evidence empty", async (name) => {
  const f = await fixture();
  await writeFile(join(f.stateDir, name), "{incomplete");
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(inspected.repairEligible).toBe(false);
  expect(inspected.artifacts).toContainEqual(expect.objectContaining({ name, status: "invalid" }));
});
it("binds exact delivery chunks and retained outside evidence into the inspection ID", async () => {
  const f = await fixture("active");
  const root = join(f.stateDir, "first-fiscal-documents");
  await mkdir(root);
  const first = await f.service.inspectFirstSetupResolution();
  await writeFile(join(root, "orphan-0.json"), JSON.stringify({ data: "YQ==" }));
  const second = await f.service.inspectFirstSetupResolution();
  expect(second.inspectionId).not.toBe(first.inspectionId);
  expect(second.repairEligible).toBe(false);
  expect(second.artifacts).toContainEqual(
    expect.objectContaining({ name: "first-fiscal-documents/orphan-0.json", status: "present" }),
  );
  await writeFile(join(root, "orphan-0.json"), '{"data":"Yg=="}');
  expect((await f.service.inspectFirstSetupResolution()).inspectionId).not.toBe(
    second.inspectionId,
  );
});
it.each(["missing", "corrupt", "wrong-root"] as const)(
  "reports %s retained ownership as uncheckable",
  async (why) => {
    const f = await fixture();
    const path = join(f.stateDir, "first-setup.json");
    if (why === "missing") await rm(path);
    else if (why === "corrupt") await writeFile(path, "{broken");
    else {
      const state = JSON.parse(await readFile(path, "utf8"));
      state.venueDir = join(f.root, "other");
      await writeFile(path, JSON.stringify(state));
    }
    const inspected = await f.service.inspectFirstSetupResolution();
    expect(inspected.pair).toBe(why === "missing" ? "partial" : "invalid");
    expect(inspected.password).toBe("uncheckable");
    expect(inspected.repairEligible).toBe(false);
  },
);

it.each(["claim", "abandon", "active"] as const)(
  "recovers %s ownership only from a fresh exact inspection",
  async (phase) => {
    const f = await fixture(phase);
    const before = JSON.parse(await readFile(join(f.stateDir, "first-setup.json"), "utf8"));
    const inspected = await f.service.inspectFirstSetupResolution();
    const nonce = randomBytes(32).toString("base64url");
    const recovered = await f.recovering.recoverFirstSetupOwner({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
      clientClaimNonce: nonce,
      password: PASSWORD,
    });
    const after = (await f.store.read())!;
    expect(after).toEqual({
      ...before,
      revision: before.revision + 1,
      ownerGeneration: before.ownerGeneration + 1,
      claimNonceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      capabilityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      history: [
        ...before.history,
        {
          kind: "recover",
          revision: before.revision + 1,
          ownerGeneration: before.ownerGeneration + 1,
        },
      ],
    });
    expect(recovered.state.status).toBe(phase === "abandon" ? "abandoned" : "claimed");
    await expect(
      f.owner.status({ ...f.claim.state, capability: f.claim.capability }),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
    const bytes = await readFile(join(f.stateDir, "first-setup.json"), "utf8");
    for (const secret of [nonce, PASSWORD, recovered.capability])
      expect(bytes).not.toContain(secret);
  },
);
it.each(["password", "inspectionId", "revision", "ownerGeneration", "nonce", "artifact"])(
  "refuses a wrong or changed %s without modifying retained state",
  async (why) => {
    const f = await fixture();
    const inspected = await f.service.inspectFirstSetupResolution();
    const body = {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
      clientClaimNonce: randomBytes(32).toString("base64url"),
      password: PASSWORD,
    };
    if (why === "password") body.password = "wrong-password";
    if (why === "inspectionId") body.inspectionId = "0".repeat(64);
    if (why === "revision") body.revision++;
    if (why === "ownerGeneration") body.ownerGeneration++;
    if (why === "nonce") body.clientClaimNonce = "bad";
    if (why === "artifact")
      await writeFile(join(f.stateDir, "first-setup-node-key.json"), "{broken");
    const state = await readFile(join(f.stateDir, "first-setup.json"));
    const marker = await readFile(f.markerPath);
    await expect(f.recovering.recoverFirstSetupOwner(body)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(state);
    expect(await readFile(f.markerPath)).toEqual(marker);
  },
);
it("lets only one of two recoveries with the same snapshot succeed", async () => {
  const f = await fixture("active");
  const inspected = await f.service.inspectFirstSetupResolution();
  const body = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    password: PASSWORD,
  };
  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      f.recovering.recoverFirstSetupOwner({
        ...body,
        clientClaimNonce: randomBytes(32).toString("base64url"),
      }),
    ),
  );
  expect(attempts.map((a) => a.status)).toEqual(["fulfilled", "rejected"]);
  expect(attempts[1]).toMatchObject({ reason: { code: "setup.owner_required" } });
  expect((await f.store.read())!.ownerGeneration).toBe(2);
});
it("binds an independently configured outside file and receipt directory without publishing its paths or granting trust", async () => {
  const f = await fixture("active");
  const outside = join(f.root, "outside.json");
  const receipts = join(f.root, "receipts");
  await mkdir(receipts);
  await writeFile(outside, '{"position":42}');
  await writeFile(join(receipts, "receipt.json"), '{"signed":"original"}');
  const service = createFirstSetupResolutionInspection({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    publicEvidencePaths: [outside],
    publicEvidenceDirectories: [receipts],
  });
  const first = await service.inspectFirstSetupResolution();
  await writeFile(join(receipts, "receipt.json"), '{"signed":"changed"}');
  const second = await service.inspectFirstSetupResolution();
  expect(second.inspectionId).not.toBe(first.inspectionId);
  expect(JSON.stringify(second)).not.toContain(receipts);
  expect(JSON.stringify(second)).not.toContain("original");
  await rm(outside);
  const missing = await service.inspectFirstSetupResolution();
  expect(missing.artifacts).toContainEqual({ name: "outside-evidence-0", status: "missing" });
  expect(missing.repairEligible).toBe(false);
});
it("throttles repeated wrong-password recovery across fresh nonces", async () => {
  const f = await fixture("active");
  const inspected = await f.service.inspectFirstSetupResolution();
  const body = {
    inspectionId: inspected.inspectionId,
    revision: 1,
    ownerGeneration: 1,
    password: "wrong-password",
  };
  for (let i = 0; i < 4; i++)
    await expect(
      f.recovering.recoverFirstSetupOwner({
        ...body,
        clientClaimNonce: randomBytes(32).toString("base64url"),
      }),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(
    f.recovering.recoverFirstSetupOwner({
      ...body,
      clientClaimNonce: randomBytes(32).toString("base64url"),
    }),
  ).rejects.toMatchObject({ code: "password.throttled" });
  expect((await f.store.read())!.ownerGeneration).toBe(1);
});
it("does not treat an absent independently configured register as proof of no register", async () => {
  const f = await fixture();
  const service = createFirstSetupResolutionInspection({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    publicEvidencePaths: [join(f.root, "lost-register.json")],
  });
  const result = await service.inspectFirstSetupResolution();
  expect(result.artifacts).toContainEqual({ name: "outside-evidence-0", status: "missing" });
  expect(result.repairEligible).toBe(false);
});
it("rereads auxiliary evidence after password checking under venue exclusion", async () => {
  const f = await fixture("active");
  const inspected = await f.service.inspectFirstSetupResolution();
  const locked = f.service.withVenueExclusion.bind(f.service);
  f.service.withVenueExclusion = async (body) => {
    await writeFile(join(f.stateDir, "module-operation-public.json"), '{"changed":true}');
    return locked(body);
  };
  const before = await readFile(join(f.stateDir, "first-setup.json"));
  await expect(
    f.recovering.recoverFirstSetupOwner({
      inspectionId: inspected.inspectionId,
      revision: 1,
      ownerGeneration: 1,
      clientClaimNonce: randomBytes(32).toString("base64url"),
      password: PASSWORD,
    }),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
});
it("shares the recovery password throttle with the retained password-only endpoint", async () => {
  const f = await fixture("active");
  const inspected = await f.service.inspectFirstSetupResolution();
  for (let i = 0; i < 4; i++)
    await expect(
      f.recovering.recoverFirstSetup(randomBytes(32).toString("base64url"), {
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({ code: "setup.owner_required" });
  await expect(
    f.recovering.recoverFirstSetupOwner({
      inspectionId: inspected.inspectionId,
      revision: 1,
      ownerGeneration: 1,
      clientClaimNonce: randomBytes(32).toString("base64url"),
      password: PASSWORD,
    }),
  ).rejects.toMatchObject({ code: "password.throttled" });
});
it("does not repair a supposedly preactivation pair alongside trading configuration", async () => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "trading.env"), "WAITRON_TILL_NODE_ID=synthetic\n");
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(inspected.repairEligible).toBe(false);
  expect(inspected.artifacts).toContainEqual(
    expect.objectContaining({ name: "trading.env", status: "present" }),
  );
});
it("retains outside receipt filename identity when the same bytes move to a different record", async () => {
  const f = await fixture("active");
  const receipts = join(f.root, "receipts");
  await mkdir(receipts);
  await writeFile(join(receipts, "first.json"), '{"signed":"same"}');
  const service = createFirstSetupResolutionInspection({
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    publicEvidenceDirectories: [receipts],
  });
  const first = await service.inspectFirstSetupResolution();
  await rm(join(receipts, "first.json"));
  await writeFile(join(receipts, "second.json"), '{"signed":"same"}');
  expect((await service.inspectFirstSetupResolution()).inspectionId).not.toBe(first.inspectionId);
});
it("retains an empty delivery directory as incomplete evidence", async () => {
  const f = await fixture();
  await mkdir(join(f.stateDir, "first-fiscal-documents"));
  const result = await f.service.inspectFirstSetupResolution();
  expect(result.artifacts).toContainEqual({ name: "first-fiscal-documents", status: "present" });
  expect(result.repairEligible).toBe(false);
});
it("describes absent roots without creating a workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "first-resolution-empty-"));
  dirs.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const store = createFirstSetupStore({ ...roots, coordinator: createFirstSetupCoordinator() });
  expect(
    await createFirstSetupResolutionInspection({ ...roots, store }).inspectFirstSetupResolution(),
  ).toMatchObject({
    pair: "missing",
    database: "missing",
    password: "uncheckable",
    revision: null,
    ownerGeneration: null,
    repairEligible: false,
  });
  expect(await readdir(root)).toEqual([]);
});
it("refuses marker repair when the existing database carries a taxpayer", async () => {
  const { seedTenant } = await import("@waitron/db/testing/seed.js");
  await seedTenant(suite.db);
  const f = await fixture();
  const result = await f.service.inspectFirstSetupResolution();
  expect(result.database).toBe("occupied");
  expect(result.repairEligible).toBe(false);
  const before = await readFile(f.markerPath);
  await expect(
    f.recovering.recoverFirstSetupOwner({
      inspectionId: result.inspectionId,
      revision: 1,
      ownerGeneration: 1,
      clientClaimNonce: randomBytes(32).toString("base64url"),
      password: PASSWORD,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready" });
  expect(await readFile(f.markerPath)).toEqual(before);
});
it.each(["symlink", "directory", "oversize", "array"] as const)(
  "retains an unreadable or invalid %s artifact as evidence",
  async (kind) => {
    const f = await fixture();
    const path = join(f.stateDir, "first-setup-node-key.json");
    if (kind === "symlink") await symlink(join(f.root, "lost.json"), path);
    if (kind === "directory") await mkdir(path);
    if (kind === "oversize") await writeFile(path, "x".repeat(1024 * 1024 + 1));
    if (kind === "array") await writeFile(path, "[]");
    const inspected = await f.service.inspectFirstSetupResolution();
    expect(inspected.artifacts).toContainEqual(
      expect.objectContaining({
        name: "first-setup-node-key.json",
        status: kind === "array" ? "invalid" : "unreadable",
      }),
    );
    expect(inspected.repairEligible).toBe(false);
  },
);
it("does not follow a symlinked delivery directory", async () => {
  const f = await fixture();
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "hidden.json"), "{}");
  await symlink(outside, join(f.stateDir, "first-fiscal-documents"));
  const result = await f.service.inspectFirstSetupResolution();
  expect(result.artifacts).toContainEqual({ name: "first-fiscal-documents", status: "unreadable" });
  expect(JSON.stringify(result)).not.toContain("hidden.json");
  expect(result.repairEligible).toBe(false);
});
it.each(["missing", "symlink", "invalid-file"] as const)(
  "retains %s independently configured receipt evidence",
  async (kind) => {
    const f = await fixture();
    const directory = join(f.root, "receipts");
    if (kind === "symlink") await symlink(f.stateDir, directory);
    if (kind === "invalid-file") {
      await mkdir(directory);
      await writeFile(join(directory, "invalid.json"), "{incomplete");
    }
    const service = createFirstSetupResolutionInspection({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      store: f.store,
      publicEvidenceDirectories: [directory],
    });
    const result = await service.inspectFirstSetupResolution();
    expect(result.artifacts).toContainEqual(
      expect.objectContaining({
        name:
          kind === "invalid-file"
            ? expect.stringMatching(/^outside-receipts-0\//)
            : "outside-receipts-0",
        status: kind === "missing" ? "missing" : kind === "symlink" ? "unreadable" : "invalid",
      }),
    );
    expect(result.repairEligible).toBe(false);
  },
);
it("keeps an unreadable database result unknown instead of calling it empty", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = await fixture();
  const connection = new DatabaseSync(join(f.venueDir, "venue.db"));
  try {
    connection.exec("begin exclusive");
    const result = await f.service.inspectFirstSetupResolution();
    expect(result.database).toBe("unknown");
    expect(result.repairEligible).toBe(false);
  } finally {
    connection.exec("rollback");
    connection.close();
  }
});
it.each(["delivery", "outside"] as const)(
  "bounds the number of %s evidence entries without dropping the overflow into emptiness",
  async (kind) => {
    const f = await fixture();
    const directory =
      kind === "delivery" ? join(f.stateDir, "first-fiscal-documents") : join(f.root, "receipts");
    await mkdir(directory);
    await Promise.all(
      Array.from({ length: 1025 }, (_, i) => writeFile(join(directory, `${i}.json`), "{}")),
    );
    const service = createFirstSetupResolutionInspection({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      store: f.store,
      ...(kind === "outside" ? { publicEvidenceDirectories: [directory] } : {}),
    });
    const result = await service.inspectFirstSetupResolution();
    expect(result.artifacts).toContainEqual({
      name: kind === "delivery" ? "first-fiscal-documents" : "outside-receipts-0",
      status: "unreadable",
    });
    expect(result.repairEligible).toBe(false);
  },
);

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
