import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";
import * as envelope from "./allocation-envelope.js";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import { deviceId, saleId } from "@waitron/shared";
import { altaFor } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "emergency-restore-1",
  sourceId: "sha256:selected-old-backup",
  targetNodeId: node.nodeId,
};
const operator = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const approval = {
  version: 1,
  eventId: binding.eventId,
  operatorId: operator,
  sourceId: binding.sourceId,
  targetNodeId: node.nodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-14T18:20:00.000Z",
  incidentEvidence: "outside/emergency-restore-1",
};
const confirmation = {
  version: 1,
  priorActivation: "none",
  binding,
  operatorId: operator,
  taxpayerNif: "89890001K",
  environment: "preproduction",
  requiredBases: bases,
  incidentEvidence: approval.incidentEvidence,
  knownIdentities: null,
  uncertaintyRecorded: true,
};
let outside: string;
let confirmationPath: string;
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
  outside = await mkdtemp(join(tmpdir(), "emergency-outside-"));
  confirmationPath = join(outside, "current.json");
  await writeFile(confirmationPath, JSON.stringify(confirmation));
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FILE", undefined);
  vi.stubEnv("WAITRON_FISCAL_CUSTODIAN_FINGERPRINT", undefined);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_EMERGENCY_DIRECTORY", outside);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (outside) await rm(outside, { recursive: true, force: true });
});
function attempt(
  input: unknown = { emergency: { version: 1 }, approval },
  run = (operation: ModuleOperationInput) =>
    withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, operation)),
) {
  return withOperationAuthority(binding, operator, (authority) =>
    FISCAL_OPERATIONS.prepare({ binding, authority, input }, run),
  );
}
async function incident() {
  const files = await readdir(outside);
  const names = files.filter((name) => name !== "current.json" && name.endsWith(".json"));
  expect(names).toHaveLength(1);
  expect(files.sort()).toEqual(["current.json", names[0]!, `${names[0]!}.txt`].sort());
  const path = join(outside, names[0]!);
  return { path, data: JSON.parse(await readFile(path, "utf8")) };
}

it("records a fresh emergency identity outside the backup before activating all series", async () => {
  const result = await attempt(undefined, async (operation) => {
    const { path, data } = await incident();
    expect(data).toMatchObject({ version: 1, binding, operatorId: operator, approval });
    expect(data.allocation.source).toBe("emergency");
    expect(data.allocation.installationIdentity).toMatch(/^E[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    const activated = await withTransaction(suite.db, (tx) =>
      activatePreparedModuleAllocation(tx, node, operation),
    );
    expect(activated.series.map(({ code }) => code)).toEqual([
      `A-${data.allocation.installationIdentity}`,
      `FF-${data.allocation.installationIdentity}`,
      `R-${data.allocation.installationIdentity}`,
    ]);
    return activated;
  });
  expect(result.series.map(({ purpose }) => purpose)).toEqual([
    "standard",
    "full",
    "rectificative",
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  const saved = (await incident()).data;
  const template = altaFor(
    { deviceId: deviceId("10000000-0000-4000-8000-000000000001") },
    saleId("10000000-0000-4000-8000-000000000002"),
    1,
    1,
    "preproduction",
  ).input;
  for (const series of result.series) {
    expect(
      validate(
        buildAltaRecord({
          ...template,
          NumSerieFactura: `${series.code}/9999999999`,
          SistemaInformatico: {
            ...template.SistemaInformatico,
            NumeroInstalacion: saved.allocation.installationIdentity,
          },
          Encadenamiento: { PrimerRegistro: "S" },
        }),
      ),
    ).toEqual([]);
  }
});

it("keeps the outside record burned after local rollback and refuses the same event", async () => {
  await expect(
    attempt(undefined, (operation) =>
      withTransaction(suite.db, async (tx) => {
        await activatePreparedModuleAllocation(tx, node, operation);
        throw new Error("injected interruption before commit");
      }),
    ),
  ).rejects.toThrow("injected interruption before commit");
  const before = await incident();
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  await expect(attempt()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "allocation_consumed" },
  });
  expect((await incident()).data).toEqual(before.data);
});

it.each([
  ["outside source absent", null, "outside_confirmation_missing"],
  [
    "missing uncertainty",
    { ...confirmation, uncertaintyRecorded: false },
    "emergency_uncertainty_missing",
  ],
  [
    "another event",
    { ...confirmation, binding: { ...binding, eventId: "another-event" } },
    "event_mismatch",
  ],
])("refuses %s without creating an outside incident", async (_label, current, reason) => {
  await writeFile(confirmationPath, JSON.stringify(current));
  await expect(attempt()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason },
  });
  expect(await readdir(outside)).toEqual(["current.json"]);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("redraws an identity already named in current outside evidence", async () => {
  const known = envelope.drawEmergencyIdentity();
  await writeFile(
    confirmationPath,
    JSON.stringify({
      ...confirmation,
      knownIdentities: [known.identity],
      uncertaintyRecorded: false,
    }),
  );
  vi.spyOn(envelope, "drawEmergencyIdentity").mockReturnValueOnce(known);
  await attempt();
  expect((await incident()).data.allocation.installationIdentity).not.toBe(known.identity);
});

it.each([undefined, "", "  "])(
  "requires an independently configured incident directory: %j",
  async (directory) => {
    vi.stubEnv("WAITRON_FISCAL_EMERGENCY_DIRECTORY", directory);
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await readdir(outside)).toEqual(["current.json"]);
  },
);

it("refuses an unavailable incident directory without activating", async () => {
  vi.stubEnv("WAITRON_FISCAL_EMERGENCY_DIRECTORY", join(outside, "not-mounted"));
  await expect(attempt()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["invalid-json", "oversized", "directory"])(
  "refuses a %s outside confirmation",
  async (kind) => {
    if (kind === "directory") vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", outside);
    else await writeFile(confirmationPath, kind === "invalid-json" ? "{" : " ".repeat(65537));
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await readdir(outside)).toEqual(["current.json"]);
  },
);

it.each([
  ["operatorId", "forged-person"],
  ["binding", { ...binding, sourceId: "other-backup" }],
  ["approval", { ...approval, confirmedAt: "2026-10-14T18:20:01.000Z" }],
])(
  "refuses changed retained %s even when a local committed result exists",
  async (field, value) => {
    await attempt();
    const kept = await incident();
    await writeFile(kept.path, JSON.stringify({ ...kept.data, [field]: value }));
    await writeFile(
      confirmationPath,
      JSON.stringify({ ...confirmation, priorActivation: "committed" }),
    );
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "event_mismatch" },
    });
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  },
);

it("refuses a submitted draw or outside authority instead of trusting restored input", async () => {
  await expect(
    attempt({ emergency: { version: 1, identity: "E00000000000000000000000000" }, approval }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "malformed_allocation" },
  });
  expect(await readdir(outside)).toEqual(["current.json"]);
});

it("refuses isolation answers before burning an identity", async () => {
  await expect(
    attempt({ emergency: { version: 1 }, approval: { ...approval, noParallelRecovery: false } }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "parallel_recovery" },
  });
  expect(await readdir(outside)).toEqual(["current.json"]);
});

it("cannot burn the same event again by reordering its binding or changing its source", async () => {
  await attempt();
  const retained = await incident();
  for (const changed of [
    {
      targetNodeId: binding.targetNodeId,
      sourceId: binding.sourceId,
      eventId: binding.eventId,
      action: binding.action,
      module: binding.module,
    },
    { ...binding, sourceId: "another-backup" },
  ]) {
    await writeFile(confirmationPath, JSON.stringify({ ...confirmation, binding: changed }));
    await expect(
      withOperationAuthority(changed, operator, (authority) =>
        FISCAL_OPERATIONS.prepare(
          {
            binding: changed,
            authority,
            input: {
              emergency: { version: 1 },
              approval: { ...approval, sourceId: changed.sourceId },
            },
          },
          async () => {
            throw new Error("repeated event admitted");
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "allocation_consumed" },
    });
  }
  expect((await incident()).data).toEqual(retained.data);
});

it("leaves a burned event behind and uses a new draw for the next fresh event", async () => {
  await expect(
    attempt(undefined, async () => {
      throw new Error("crash after outside consumption");
    }),
  ).rejects.toThrow("crash after outside consumption");
  const first = (await incident()).data;
  const nextBinding = { ...binding, eventId: "emergency-restore-2" };
  const nextOperator = { ...operator, eventId: nextBinding.eventId };
  const nextApproval = { ...approval, eventId: nextBinding.eventId, operatorId: nextOperator };
  await writeFile(
    confirmationPath,
    JSON.stringify({ ...confirmation, binding: nextBinding, operatorId: nextOperator }),
  );
  await withOperationAuthority(nextBinding, nextOperator, (authority) =>
    FISCAL_OPERATIONS.prepare(
      {
        binding: nextBinding,
        authority,
        input: {
          emergency: { version: 1 },
          approval: nextApproval,
        },
      },
      (operation) =>
        withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, operation)),
    ),
  );
  const [stored] = await suite.db.select().from(fiscalAllocations);
  expect(stored?.installationIdentity).not.toBe(first.allocation.installationIdentity);
  expect(stored?.eventKey).toBe("emergency-restore-2");
  expect((await readdir(outside)).filter((name) => name !== "current.json")).toHaveLength(4);
});

it("allows only one of two concurrent attempts to consume the same event", async () => {
  const outcomes = await Promise.allSettled([attempt(), attempt()]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toMatchObject([
    { reason: { code: "sif.allocation_invalid", params: { reason: "allocation_consumed" } } },
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  await incident();
});

it("returns the committed result only after a fresh outside confirmation and an exact local match", async () => {
  const first = await attempt();
  const before = await suite.db.select().from(fiscalAllocations);
  await writeFile(
    confirmationPath,
    JSON.stringify({ ...confirmation, priorActivation: "committed" }),
  );
  await expect(attempt()).resolves.toEqual(first);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual(before);
  await incident();
});

it("refuses a claimed committed attempt when the local activation was lost", async () => {
  await expect(
    attempt(undefined, async () => {
      throw new Error("interrupted after consumption");
    }),
  ).rejects.toThrow("interrupted after consumption");
  await writeFile(
    confirmationPath,
    JSON.stringify({ ...confirmation, priorActivation: "committed" }),
  );
  await expect(attempt()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  await incident();
});

it.each([
  ["uncertain", "uncertain_prior_activation"],
  ["committed", "outside_confirmation_missing"],
])(
  "refuses %s outside history without a retained consumption record",
  async (priorActivation, reason) => {
    await writeFile(confirmationPath, JSON.stringify({ ...confirmation, priorActivation }));
    await expect(attempt()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason },
    });
    expect(await readdir(outside)).toEqual(["current.json"]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  },
);
