import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { locationId } from "@waitron/shared";
import { deployment, invoiceSeries, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationPreparation } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { cloudReceiptFixture } from "../test/cloud-fixture.js";
import * as fiscal from "./index.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { fiscalAllocations } from "./schema/allocations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "cloud-restore",
  sourceId: "archive-digest",
  targetNodeId: TENANT_A.nodeId,
};
const operatorId = {
  kind: "recovery-key" as const,
  nodeId: TENANT_A.nodeId,
  eventId: binding.eventId,
};
let root: string;
let confirmationPath: string;
let receiptDirectory: string;
let current: Record<string, unknown>;
let fixture: ReturnType<typeof cloudReceiptFixture>;

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: node.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "WT",
      numeroInstalacion: "P000001",
    }),
  );
  root = await mkdtemp(join(tmpdir(), "cloud-preparation-"));
  receiptDirectory = join(root, "outside");
  await mkdir(receiptDirectory);
  confirmationPath = join(root, "current.json");
  fixture = cloudReceiptFixture((payload) => {
    Object.assign(payload.binding, {
      ...binding,
      incidentEvidence: "outside/incident",
      operatorId,
    });
    Reflect.deleteProperty(payload.binding, "module");
    Reflect.deleteProperty(payload.binding, "action");
    Object.assign(payload.approval!, payload.binding);
  });
  current = {
    version: 1,
    binding,
    operatorId,
    allocationId: fixture.receipt.payload.allocation.allocationId,
    receiptId: fixture.receipt.payload.receiptId,
    priorActivation: "none",
    incidentEvidence: "outside/incident",
    requiredBases: bases,
  };
  await saveCurrent();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
async function saveCurrent() {
  await writeFile(confirmationPath, JSON.stringify(current));
}
function preparation(trust = fixture.trust): ModuleOperationPreparation {
  const api = fiscal as unknown as {
    createCloudAllocationPreparation?: (config: unknown) => ModuleOperationPreparation;
  };
  expect(api.createCloudAllocationPreparation).toBeTypeOf("function");
  return api.createCloudAllocationPreparation!({ trust, confirmationPath, receiptDirectory });
}
function input() {
  return {
    allocation: fixture.receipt.payload.allocation,
    approval: fixture.receipt.payload.approval,
    receipt: fixture.packet,
  };
}
async function activate(held = input(), run?: () => void) {
  return withOperationAuthority(binding, operatorId, (authority) =>
    preparation().prepare({ binding, input: held, authority }, (ready) =>
      withTransaction(suite.db, async (tx) => {
        const result = await activatePreparedModuleAllocation(tx, node, ready);
        run?.();
        return result;
      }),
    ),
  );
}
function receiptPath() {
  return join(
    receiptDirectory,
    createHash("sha256").update(fixture.receipt.payload.allocation.allocationId).digest("hex") +
      ".json",
  );
}

it("activates the complete Cloud identity through collected local authority and retains the public signed receipt", async () => {
  const result = await activate();
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-C000042", purpose: "standard" },
    { code: "FF-C000042", purpose: "full" },
    { code: "R-C000042", purpose: "rectificative" },
  ]);
  const rows = await suite.db.select().from(fiscalAllocations);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.approval.operatorId).toEqual(operatorId);
  const retained = JSON.parse(await readFile(receiptPath(), "utf8"));
  expect(retained.receipt).toEqual(fixture.receipt);
  expect(retained.binding).toEqual(binding);
  expect(retained.reportOperationId).toMatch(/^[0-9a-f-]{36}$/);
});
it("replays only the exact locally committed activation", async () => {
  const first = await activate();
  current.priorActivation = "committed";
  await saveCurrent();
  expect(await activate()).toEqual(first);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});
it("keeps the name consumed after a rolled-back attempt and refuses reuse of its old receipt", async () => {
  await expect(
    activate(input(), () => {
      throw new Error("transaction interrupted");
    }),
  ).rejects.toThrow("transaction interrupted");
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "uncertain_prior_activation" },
  });
  current.priorActivation = "committed";
  await saveCurrent();
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it("refuses a forged packet without burning a local attempt", async () => {
  const held = input();
  held.receipt = held.receipt.slice(0, -2) + "AA";
  await expect(activate(held)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_untrusted" },
  });
  expect(await readdir(receiptDirectory)).toEqual([]);
});
it.each(["sourceId", "eventId", "targetNodeId", "operatorId", "receiptId"])(
  "refuses a changed outside %s before activation",
  async (field) => {
    if (field === "operatorId") current.operatorId = "Cloud-account-is-not-local-authority";
    else if (field === "receiptId") current.receiptId = "10000000-0000-4000-8000-000000000099";
    else current.binding = { ...binding, [field]: "changed" };
    await saveCurrent();
    await expect(activate()).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    expect(await readdir(receiptDirectory)).toEqual([]);
  },
);
it("refuses omission of the configured full purpose before spending a receipt", async () => {
  current.requiredBases = bases.filter((base) => base.purpose !== "full");
  await saveCurrent();
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "series_mismatch" },
  });
  expect(await readdir(receiptDirectory)).toEqual([]);
});
it("refuses an uncertain outside result without attempting local activation", async () => {
  current.priorActivation = "uncertain";
  await saveCurrent();
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "uncertain_prior_activation" },
  });
  expect(await readdir(receiptDirectory)).toEqual([]);
});
it("never replaces the original receipt when later evidence conflicts", async () => {
  await activate();
  const original = await readFile(receiptPath(), "utf8");
  current.priorActivation = "committed";
  await saveCurrent();
  const changed = input();
  changed.approval = { ...changed.approval!, incidentEvidence: "changed" };
  await expect(activate(changed)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(await readFile(receiptPath(), "utf8")).toBe(original);
});
it("refuses a replay without its independent retained receipt", async () => {
  await activate();
  current.priorActivation = "committed";
  await saveCurrent();
  await rm(receiptPath());
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
});

async function configure() {
  const keyPath = join(root, "trust.json");
  await writeFile(
    keyPath,
    JSON.stringify({
      issuer: fixture.trust.issuer,
      fingerprint: fixture.receipt.keyId,
      publicKey: fixture.trust.keys.get(fixture.receipt.keyId),
    }),
  );
  vi.stubEnv("WAITRON_FISCAL_CLOUD_TRUST_FILE", keyPath);
  vi.stubEnv("WAITRON_FISCAL_CLOUD_FINGERPRINT", fixture.receipt.keyId);
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY", receiptDirectory);
}
it("passes a Cloud manual packet through the default configured module preparation", async () => {
  await configure();
  const result = await withOperationAuthority(binding, operatorId, (authority) =>
    FISCAL_OPERATIONS.prepare({ binding, input: input(), authority }, (ready) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, ready)),
    ),
  );
  expect(result.series.map((series) => series.code)).toEqual([
    "A-C000042",
    "FF-C000042",
    "R-C000042",
  ]);
});
it.each([
  "WAITRON_FISCAL_CLOUD_TRUST_FILE",
  "WAITRON_FISCAL_CLOUD_FINGERPRINT",
  "WAITRON_FISCAL_CONFIRMATION_FILE",
  "WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY",
])("requires explicit %s outside submitted input", async (variable) => {
  await configure();
  vi.stubEnv(variable, "");
  await expect(
    withOperationAuthority(binding, operatorId, (authority) =>
      FISCAL_OPERATIONS.prepare({ binding, input: input(), authority }, async () => "unverified"),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await readdir(receiptDirectory)).toEqual([]);
});
it("requires the independently confirmed signer fingerprint", async () => {
  await configure();
  vi.stubEnv("WAITRON_FISCAL_CLOUD_FINGERPRINT", "0".repeat(64));
  await expect(
    withOperationAuthority(binding, operatorId, (authority) =>
      FISCAL_OPERATIONS.prepare({ binding, input: input(), authority }, async () => "unverified"),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_untrusted" },
  });
});

it("collects a stable signed report only from the matching locally committed activation", async () => {
  const result = await activate();
  const api = fiscal as unknown as {
    readCloudAllocationReport?: (
      db: unknown,
      node: unknown,
      configuration: unknown,
    ) => Promise<{ operationId: string; body: unknown }>;
  };
  expect(api.readCloudAllocationReport).toBeTypeOf("function");
  const report = await api.readCloudAllocationReport!(suite.db, node, {
    receiptPath: receiptPath(),
    trust: fixture.trust,
  });
  expect(report.body).toEqual({
    venueId: "10000000-0000-4000-8000-000000000002",
    scope: { taxpayerNif: "89890001K", softwareId: "WT", environment: "preproduction" },
    receipt: fixture.receipt,
    paperHistory: null,
    activationEvidence: { version: 1, eventId: binding.eventId, nodeId: node.nodeId, result },
  });
  expect(
    await api.readCloudAllocationReport!(suite.db, node, {
      receiptPath: receiptPath(),
      trust: fixture.trust,
    }),
  ).toEqual(report);
  const retained = JSON.parse(await readFile(receiptPath(), "utf8"));
  expect(report.operationId).toBe(retained.reportOperationId);
});
it("never reports activation from a consumed receipt when its local transaction rolled back", async () => {
  await expect(
    activate(input(), () => {
      throw new Error("transaction interrupted");
    }),
  ).rejects.toThrow("transaction interrupted");
  const api = fiscal as unknown as {
    readCloudAllocationReport?: (
      db: unknown,
      node: unknown,
      configuration: unknown,
    ) => Promise<unknown>;
  };
  expect(api.readCloudAllocationReport).toBeTypeOf("function");
  await expect(
    api.readCloudAllocationReport!(suite.db, node, {
      receiptPath: receiptPath(),
      trust: fixture.trust,
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "prior_activation_requires_replay" },
  });
});

it.each([null, {}, { extra: true }, "malformed"])(
  "refuses unavailable or malformed outside confirmation %#",
  async (value) => {
    await writeFile(confirmationPath, value === "malformed" ? "{" : JSON.stringify(value));
    await expect(activate()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    expect(await readdir(receiptDirectory)).toEqual([]);
  },
);
it("refuses absent outside confirmation", async () => {
  await rm(confirmationPath);
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
});
it("refuses a receipt signed by a key outside the enrolled trust", async () => {
  const other = cloudReceiptFixture();
  await expect(
    withOperationAuthority(binding, operatorId, (authority) =>
      preparation(other.trust).prepare(
        { binding, input: input(), authority },
        async () => "unverified",
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_untrusted" },
  });
  expect(await readdir(receiptDirectory)).toEqual([]);
});
it("does not accept the Cloud account as locally authenticated authority", async () => {
  await expect(
    withOperationAuthority(binding, "Cloud-account", (authority) =>
      preparation().prepare({ binding, input: input(), authority }, async () => "unverified"),
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "event_mismatch" } });
});
it("refuses an authority outside its live authenticated callback", async () => {
  let authority: unknown;
  await withOperationAuthority(binding, operatorId, async (held) => {
    authority = held;
  });
  await expect(
    preparation().prepare(
      { binding, input: input(), authority: authority as never },
      async () => "unverified",
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
});
it("refuses malformed manual input before reading outside facts", async () => {
  for (const supplied of [
    null,
    [],
    { receipt: fixture.packet },
    { ...input(), trust: fixture.trust },
  ]) {
    await expect(
      withOperationAuthority(binding, operatorId, (authority) =>
        preparation().prepare({ binding, input: supplied, authority }, async () => "unverified"),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "malformed_allocation" },
    });
  }
});

it("refuses a confirmation path that is a directory or exceeds its bounded read", async () => {
  await rm(confirmationPath);
  await mkdir(confirmationPath);
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  await rm(confirmationPath, { recursive: true });
  await writeFile(confirmationPath, " ".repeat(65537));
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
});
it("refuses activation without writable independent receipt storage", async () => {
  await rm(receiptDirectory, { recursive: true });
  await expect(activate()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it.each(["receipt", "reportOperationId"])(
  "refuses a changed retained %s on committed replay",
  async (field) => {
    await activate();
    current.priorActivation = "committed";
    await saveCurrent();
    const record = JSON.parse(await readFile(receiptPath(), "utf8"));
    record[field] = field === "receipt" ? {} : "not-a-UUID";
    await writeFile(receiptPath(), JSON.stringify(record));
    await expect(activate()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
  },
);
async function collectReport(
  configuration = { receiptPath: receiptPath(), trust: fixture.trust },
  target = node,
) {
  return fiscal.readCloudAllocationReport(suite.db, target, configuration);
}
it.each(["shape", "signature", "binding", "allocation"])(
  "refuses a changed retained report %s before a Cloud call",
  async (field) => {
    await activate();
    const record = JSON.parse(await readFile(receiptPath(), "utf8"));
    let trust = fixture.trust;
    let reason = "outside_confirmation_missing";
    if (field === "shape") record.reportOperationId = "invalid";
    if (field === "signature") {
      record.receipt.signature = "AA";
      reason = "reservation_untrusted";
    }
    if (field === "binding") {
      record.binding.eventId = "changed";
      reason = "event_mismatch";
    }
    if (field === "allocation") {
      const other = cloudReceiptFixture((payload) => {
        Object.assign(payload, fixture.receipt.payload);
        Object.assign(payload.allocation, { issuedAt: "2026-10-13T09:00:00.000Z" });
      });
      record.receipt = other.receipt;
      trust = other.trust;
      reason = "reservation_mismatch";
    }
    await writeFile(receiptPath(), JSON.stringify(record));
    await expect(collectReport({ receiptPath: receiptPath(), trust })).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason },
    });
  },
);
it("refuses reporting another location's retained allocation", async () => {
  await activate();
  await expect(
    collectReport(undefined, {
      ...node,
      locationId: locationId(TENANT_A.locationId.replace("a000", "b000")),
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "node_mismatch" } });
});
it("refuses a retained report for a different taxpayer or environment", async () => {
  await activate();
  await suite.db.update(tenants).set({ taxId: "B12345678" });
  await expect(collectReport()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "taxpayer_mismatch" },
  });
  await suite.db.update(tenants).set({ taxId: "89890001K" });
  await suite.db.update(deployment).set({ environment: "production" });
  await expect(collectReport()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "environment_mismatch" },
  });
});
it("accepts retained public verification keys after signing-key rotation", async () => {
  await activate();
  const other = cloudReceiptFixture();
  const rotated = {
    issuer: fixture.trust.issuer,
    keys: new Map([...fixture.trust.keys, ...other.trust.keys]),
  };
  expect(
    (await collectReport({ receiptPath: receiptPath(), trust: rotated })).body.receipt,
  ).toEqual(fixture.receipt);
});
