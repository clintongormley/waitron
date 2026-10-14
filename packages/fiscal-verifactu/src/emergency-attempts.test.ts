import * as fs from "node:fs/promises";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { AppError, locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { withEmergencyAttempt } from "./emergency-attempt.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "emergency-attempt-history",
  sourceId: "sha256:selected-backup",
  targetNodeId: node.nodeId,
};
const operatorId = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const approval = {
  version: 1,
  eventId: binding.eventId,
  operatorId,
  sourceId: binding.sourceId,
  targetNodeId: node.nodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-14T19:00:00.000Z",
  incidentEvidence: "outside/emergency-attempt-history",
};
const current = {
  version: 1,
  priorActivation: "none",
  binding,
  operatorId,
  taxpayerNif: "89890001K",
  environment: "preproduction",
  requiredBases: bases,
  incidentEvidence: approval.incidentEvidence,
  knownIdentities: null,
  uncertaintyRecorded: true,
};
let outside: string;
let confirmationPath: string;
let incidentPath: string;
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
  outside = await fs.mkdtemp(join(tmpdir(), "emergency-attempts-"));
  confirmationPath = join(outside, "current.json");
  incidentPath = join(
    outside,
    `${createHash("sha256").update(binding.eventId).digest("hex")}.json`,
  );
  await fs.writeFile(confirmationPath, JSON.stringify(current));
  vi.stubEnv("WAITRON_FISCAL_CONFIRMATION_FILE", confirmationPath);
  vi.stubEnv("WAITRON_FISCAL_EMERGENCY_DIRECTORY", outside);
});
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllEnvs();
  if (outside) await fs.rm(outside, { recursive: true, force: true });
});
const activate = (operation: ModuleOperationInput) =>
  withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, operation));
function attempt<T>(run: (operation: ModuleOperationInput) => Promise<T>) {
  return withOperationAuthority(binding, operatorId, (authority) =>
    FISCAL_OPERATIONS.prepare(
      { binding, authority, input: { emergency: { version: 1 }, approval } },
      run,
    ),
  );
}
const incident = async () => JSON.parse(await fs.readFile(incidentPath, "utf8"));
function consumptionOnly(record: Record<string, unknown>) {
  const copy = { ...record };
  delete copy.attempts;
  return copy;
}

it("retains an unfinished attempt before activation and its returned result afterwards", async () => {
  await attempt(async (operation) => {
    expect((await incident()).attempts).toEqual([
      {
        id: expect.any(String),
        startedAt: expect.any(String),
        finishedAt: null,
        outcome: "started",
      },
    ]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    return activate(operation);
  });
  const record = await incident();
  expect(record.attempts).toEqual([
    {
      id: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      outcome: "returned",
    },
  ]);
  expect(record.attempts[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number.isNaN(Date.parse(record.attempts[0].startedAt))).toBe(false);
  expect(Number.isNaN(Date.parse(record.attempts[0].finishedAt))).toBe(false);
  expect(record.allocation).toEqual(
    (await suite.db.select().from(fiscalAllocations))[0]?.allocation,
  );
  expect((await fs.stat(incidentPath)).mode & 0o777).toBe(0o600);
  expect(await fs.readdir(outside)).toHaveLength(3);
});

it("records a thrown attempt without storing its message or claiming local rollback", async () => {
  const secret = "synthetic-node-secret-must-not-be-recorded";
  await expect(
    attempt(async (operation) => {
      await activate(operation);
      throw new AppError("sif.allocation_invalid", { reason: secret });
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: secret } });
  expect((await incident()).attempts).toEqual([
    {
      id: expect.any(String),
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      outcome: "threw",
    },
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  expect(await fs.readFile(incidentPath, "utf8")).not.toContain(secret);
});

it("appends a confirmed replay result while keeping the consumed allocation and earlier attempt", async () => {
  const first = await attempt(activate);
  const before = await incident();
  await fs.writeFile(
    confirmationPath,
    JSON.stringify({ ...current, priorActivation: "committed" }),
  );
  await expect(attempt(activate)).resolves.toEqual(first);
  const after = await incident();
  expect(after.attempts).toHaveLength(2);
  expect(after.attempts[0]).toEqual(before.attempts[0]);
  expect(after.attempts[1]).toEqual({
    id: expect.any(String),
    startedAt: expect.any(String),
    finishedAt: expect.any(String),
    outcome: "returned",
  });
  expect(after.attempts[1].id).not.toBe(after.attempts[0].id);
  expect(consumptionOnly(after)).toEqual(consumptionOnly(before));
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("refuses activation if the started attempt cannot be published, leaving the name consumed", async () => {
  await fs.mkdir(`${incidentPath}.next`);
  await expect(attempt(activate)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect((await incident()).allocation.source).toBe("emergency");
  await fs.rmdir(`${incidentPath}.next`);
  await expect(attempt(activate)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "allocation_consumed" },
  });
});

it("keeps an unfinished record and refuses success when the result cannot be retained", async () => {
  await expect(
    attempt(async (operation) => {
      const result = await activate(operation);
      await fs.mkdir(`${incidentPath}.next`);
      return result;
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  expect((await incident()).attempts).toEqual([
    { id: expect.any(String), startedAt: expect.any(String), finishedAt: null, outcome: "started" },
  ]);
});

it("keeps both overlapping replay attempts when their callbacks finish in reverse order", async () => {
  await attempt(activate);
  const consumption = consumptionOnly(await incident());
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = withEmergencyAttempt(outside, incidentPath, consumption, async () => {
    firstStarted();
    await hold;
    return "first callback result";
  });
  try {
    await Promise.race([started, first]);
    await expect(
      withEmergencyAttempt(
        outside,
        incidentPath,
        consumption,
        async () => "second callback result",
      ),
    ).resolves.toBe("second callback result");
  } finally {
    releaseFirst();
    await first;
  }
  const record = await incident();
  expect(record.attempts).toHaveLength(3);
  expect(record.attempts.map((entry: { outcome: string }) => entry.outcome)).toEqual([
    "returned",
    "returned",
    "returned",
  ]);
  expect(new Set(record.attempts.map((entry: { id: string }) => entry.id)).size).toBe(3);
  expect(record.allocation).toEqual(consumption.allocation);
});

it("removes only its own replacement file if publishing it fails", async () => {
  vi.spyOn(nativeFs, "rename").mockRejectedValueOnce(new Error("injected outside rename refusal"));
  syncBuiltinESMExports();
  await expect(attempt(activate)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect((await incident()).attempts).toEqual([]);
  expect(await fs.readdir(outside)).toHaveLength(2);
});

it.each(["oversized", "directory", "duplicate-attempt"])(
  "refuses %s incident storage without changing it",
  async (kind) => {
    await attempt(activate);
    const { attempts, ...consumption } = await incident();
    if (kind === "directory") {
      await fs.rm(incidentPath);
      await fs.mkdir(incidentPath);
    } else if (kind === "oversized") {
      await fs.writeFile(incidentPath, " ".repeat(65537));
    } else {
      await fs.writeFile(
        incidentPath,
        JSON.stringify({ ...consumption, attempts: [attempts[0], attempts[0]] }),
      );
    }
    await expect(
      withEmergencyAttempt(outside, incidentPath, consumption, async () => "must not be admitted"),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
    if (kind === "directory") expect((await fs.stat(incidentPath)).isDirectory()).toBe(true);
    else if (kind === "oversized")
      expect(await fs.readFile(incidentPath, "utf8")).toBe(" ".repeat(65537));
    else expect((await incident()).attempts).toEqual([attempts[0], attempts[0]]);
    expect(await fs.readdir(outside)).toHaveLength(3);
  },
);

it("refuses an attempt that would exceed the outside record budget instead of truncating history", async () => {
  const consumption = { entry: "x".repeat(65460) };
  const original = JSON.stringify({ ...consumption, attempts: [] });
  await fs.writeFile(incidentPath, original);
  await expect(
    withEmergencyAttempt(outside, incidentPath, consumption, async () => "must not be admitted"),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await fs.readFile(incidentPath, "utf8")).toBe(original);
  expect(await fs.readdir(outside)).toHaveLength(2);
});

it("does not invent a result when the unfinished attempt was removed during its callback", async () => {
  await expect(
    attempt(async (operation) => {
      await activate(operation);
      const record = await incident();
      await fs.writeFile(incidentPath, JSON.stringify({ ...record, attempts: [] }));
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect((await incident()).attempts).toEqual([]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("leaves another holder's lock and the complete consumed record intact", async () => {
  await attempt(activate);
  const before = await fs.readFile(incidentPath, "utf8");
  await fs.writeFile(`${incidentPath}.lock`, "another holder");
  await fs.writeFile(
    confirmationPath,
    JSON.stringify({ ...current, priorActivation: "committed" }),
  );
  await expect(attempt(activate)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await fs.readFile(`${incidentPath}.lock`, "utf8")).toBe("another holder");
  expect(await fs.readFile(incidentPath, "utf8")).toBe(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it.each([
  null,
  "missing history",
  [null],
  [
    {
      id: "not-a-uuid",
      startedAt: "2026-10-14T19:00:00.000Z",
      finishedAt: null,
      outcome: "started",
    },
  ],
  [
    {
      id: "10000000-0000-4000-8000-000000000001",
      startedAt: "bad date",
      finishedAt: null,
      outcome: "started",
    },
  ],
  [
    {
      id: "10000000-0000-4000-8000-000000000001",
      startedAt: "2026-10-14T19:00:00.000Z",
      finishedAt: null,
      outcome: "returned",
    },
  ],
])("refuses corrupt attempt history without overwriting it: %j", async (history) => {
  await attempt(activate);
  const record = await incident();
  await fs.writeFile(incidentPath, JSON.stringify({ ...record, attempts: history }));
  const before = await fs.readFile(incidentPath, "utf8");
  await fs.writeFile(
    confirmationPath,
    JSON.stringify({ ...current, priorActivation: "committed" }),
  );
  await expect(attempt(activate)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(await fs.readFile(incidentPath, "utf8")).toBe(before);
  expect(await fs.readdir(outside)).toHaveLength(3);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("refuses a changed consumed identity after the callback without overwriting the outside change", async () => {
  await expect(
    attempt(async (operation) => {
      await activate(operation);
      const record = await incident();
      record.allocation.installationIdentity = "E00000000000000000000000000";
      await fs.writeFile(incidentPath, JSON.stringify(record));
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect((await incident()).allocation.installationIdentity).toBe("E00000000000000000000000000");
  expect((await incident()).attempts[0].outcome).toBe("started");
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});
