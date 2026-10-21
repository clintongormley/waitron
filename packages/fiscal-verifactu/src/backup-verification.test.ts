import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  BackupCheckUnavailable,
  validateBackupModuleResult,
  validateBackupVerificationContribution,
  withOperationAuthority,
  type BackupVerificationContext,
} from "@waitron/module";
import { openBackupQuery } from "@waitron/store";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { activateAllocation } from "./allocation.js";
import {
  withHourAdmission,
  type FiscalAllocation,
  type RecoveryApproval,
} from "./allocation-envelope.js";
import { encodeHourIdentity } from "./hour-identity.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import { fiscalBackupPublicEvidenceDigest } from "./backup-verification-trust.js";
import { FISCAL_CLASSIFICATION } from "./classification.js";
import { FISCAL_BACKUP_VERIFICATION } from "./index.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const time = "2026-10-16T11:00:00.000Z";
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "rectificative" },
];
const key = Buffer.alloc(32, 29).toString("base64");
const candidate = makeAuthority().issue();
const historyName = "secrets/module-evidence/fiscal-verifactu/hour-history.json";
let directory: string | undefined;
let entries: Record<string, Uint8Array | null>;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
  vi.restoreAllMocks();
});
async function activation(hour: number) {
  const issuedAt = new Date(Date.parse(time) + hour * 3600000).toISOString();
  const allocation: FiscalAllocation = {
    version: 1,
    allocationId: `hour-${hour}`,
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction",
    installationIdentity: encodeHourIdentity(Date.parse(issuedAt)),
    series: bases.map((b) => ({
      ...b,
      code: `${b.code}-${encodeHourIdentity(Date.parse(issuedAt))}`,
    })),
    source: "hour",
    reservationEvidence: null,
    issuedAt,
  };
  const approval: RecoveryApproval = {
    version: 1,
    eventId: `event-${hour}`,
    operatorId: "administrator",
    sourceId: hour === 0 ? "first-setup:original" : "backup:original",
    targetNodeId: node.nodeId,
    oldMachineOffline: hour !== 0,
    oldMachineAbsent: hour === 0,
    noParallelRecovery: true,
    confirmedAt: issuedAt,
    incidentEvidence: `incident-${hour}`,
  };
  const binding = {
    module: "fiscal-verifactu",
    action: hour === 0 ? "setup" : "re-register",
    eventId: approval.eventId,
    sourceId: approval.sourceId,
    targetNodeId: node.nodeId,
  };
  return withOperationAuthority(binding, approval.operatorId, (authority) =>
    withHourAdmission(
      { binding, authority, input: { allocation, approval } },
      { requiredBases: bases, priorActivation: "none" },
      (evidence) =>
        withTransaction(suite.db, (tx) =>
          activateAllocation(tx, node, allocation, approval, {
            ...binding,
            taxpayerNif: allocation.taxpayerNif,
            softwareId: allocation.softwareId,
            environment: allocation.environment,
            mode: hour === 0 ? "initial-setup" : "recovery",
            operatorId: approval.operatorId,
            incidentEvidence: approval.incidentEvidence,
            requiredBases: bases,
            reauthentication: { operatorId: approval.operatorId, eventId: approval.eventId },
            priorActivation: "none",
            authority: evidence.authority,
          }),
        ),
    ),
  );
}

async function capture(populate = true) {
  if (populate) {
    await seedTenants(suite.db);
    await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
    await activation(0);
    await activation(1);
    await sealAeatSecret(
      {
        db: suite.db,
        ring: loadKeyRing({ WAITRON_CREDENTIALS_KEY: key }),
        nodeId: node.nodeId,
        now: () => new Date(time),
      },
      {
        pfxBase64: candidate.pfx.toString("base64"),
        passphrase: candidate.passphrase,
        certKind: "sello",
      },
    );
  }
  entries = {
    "secrets/secrets.env": Buffer.from(`WAITRON_CREDENTIALS_KEY=${key}\n`),
    "secrets/trading.env": Buffer.alloc(0),
    "secrets/backup.env": null,
    [historyName]: null,
  };
  directory = await mkdtemp(join(tmpdir(), "waitron-backup-fiscal-owner-"));
  const file = suite.db
    .all<{ file: string }>(sql`pragma database_list`)
    .find((r) => r.file.endsWith("venue.db"))!.file;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    await backup(db, join(directory, "before.db"));
    await backup(db, join(directory, "after.db"));
  } finally {
    db.close();
  }
}
function edit(side: "before" | "after", run: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(join(directory!, `${side}.db`));
  try {
    db.exec("pragma foreign_keys=off; pragma ignore_check_constraints=on");
    const triggers = db
      .prepare("select name,sql,tbl_name from sqlite_schema where type='trigger'")
      .all() as { name: string; sql: string; tbl_name: string }[];
    for (const t of triggers) db.exec(`drop trigger "${t.name.replaceAll('"', '""')}"`);
    run(db);
    for (const t of triggers)
      if (db.prepare("select 1 from sqlite_schema where type='table' and name=?").get(t.tbl_name))
        db.exec(t.sql);
  } finally {
    db.close();
  }
}
function both(run: (db: DatabaseSync) => void) {
  edit("before", run);
  edit("after", run);
}
async function verify(sourceSchema: number | null = 1) {
  const before = await openBackupQuery(join(directory!, "before.db"));
  try {
    const after = await openBackupQuery(join(directory!, "after.db"));
    try {
      const context: BackupVerificationContext = {
        before: before.query,
        after: after.query,
        entries: {
          read: async (name) => {
            if (!(name in entries)) throw new Error("undeclared private entry");
            return entries[name]!;
          },
        },
        source: { ...node, environment: "preproduction", createdAt: time },
        sourceSchema,
        targetSchema: 1,
        signal: new AbortController().signal,
      };
      return await FISCAL_BACKUP_VERIFICATION.verifyRestoredData(context);
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
const passed = {
  status: "passed",
  checks: [
    { code: "chain", status: "passed" },
    { code: "history", status: "passed" },
    { code: "secret", status: "passed" },
    { code: "entries", status: "passed" },
  ],
};
const retainedRow = {
  reference: "intent/fiscal-verifactu/retained",
  kind: "intent",
  taxpayerNif: "89890001K",
  environment: "preproduction",
  softwareId: "retired-software",
  nodeId: "retired-node",
  identity: "06RC",
  recordedAtMs: 1792152060000,
};
function retained(records: unknown[] = [retainedRow], extra: Record<string, unknown> = {}) {
  entries[historyName] = Buffer.from(
    JSON.stringify({ reference: "prepared-hours", complete: true, records, ...extra }),
  );
}
function expectCheck(answer: Awaited<ReturnType<typeof verify>>, code: string, status: string) {
  expect(answer.checks.find((v) => v.code === code)?.status).toBe(status);
  expect(answer.status).toBe(status);
}

it("accepts a real complete fiscal owner with retired hour registrations and no activation", async () => {
  await capture();
  const lifecycle = await import("./allocated-lifecycle.js");
  const preparation = await import("./allocation-preparation.js");
  const admission = await import("./allocation-envelope.js");
  const forbidden = () => {
    throw new Error("verification attempted fiscal activation");
  };
  const spies = [
    vi.spyOn(lifecycle, "ALLOCATED_FISCAL_RESTORE").mockImplementation(forbidden),
    vi.spyOn(preparation, "activatePreparedModuleAllocation").mockImplementation(forbidden),
    vi.spyOn(admission, "withHourAdmission").mockImplementation(forbidden),
  ];
  const answer = await verify();
  expect(answer).toEqual(passed);
  expect(validateBackupModuleResult(answer, FISCAL_BACKUP_VERIFICATION, false)).toEqual(passed);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  expect(JSON.stringify(answer)).not.toMatch(/89890001K|retired-node|passphrase|private|06RC/);
});
it("binds public trust and every classified table to the fiscal owner", () => {
  const owner = validateBackupVerificationContribution(FISCAL_BACKUP_VERIFICATION);
  expect([...owner.data.tables].sort()).toEqual(FISCAL_CLASSIFICATION.map((v) => v.table).sort());
  expect(owner.publicEvidenceDigest).toBe(fiscalBackupPublicEvidenceDigest());
  expect(
    owner.effects
      .filter((e) => e.kind === "data")
      .every((e) => e.check !== null && owner.data.checks.includes(e.check)),
  ).toBe(true);
});
it("accepts genuinely omitted preparation history", async () => {
  await capture();
  expect(await verify()).toEqual(passed);
});
it("accepts preserved foreign-node and retired-software preparation", async () => {
  await capture();
  retained();
  expect(await verify()).toEqual(passed);
});
it("accepts an explicitly empty retained source", async () => {
  await capture();
  retained([]);
  expect(await verify()).toEqual(passed);
});
it.each([
  { ...retainedRow, taxpayerNif: "foreign-taxpayer", identity: "invalid" },
  { ...retainedRow, environment: "production", recordedAtMs: -1 },
  { ...retainedRow, nodeId: null },
  { ...retainedRow, privateKey: "private-field-sentinel" },
])("validates all retained rows before scope filtering %#", async (row) => {
  await capture();
  retained([row]);
  expectCheck(await verify(), "entries", "invalid");
});
it.each([
  { privateKey: "private-source-sentinel" },
  { complete: false },
  { reference: "unknown-source" },
  { records: null },
])("refuses malformed retained source %#", async (extra) => {
  await capture();
  retained([], extra);
  expectCheck(await verify(), "entries", "invalid");
});
it("refuses malformed retained JSON", async () => {
  await capture();
  entries[historyName] = Buffer.from("{");
  expectCheck(await verify(), "entries", "invalid");
});
it("detects conflicting retired references", async () => {
  await capture();
  retained([retainedRow, { ...retainedRow, identity: "06RD" }]);
  expectCheck(await verify(), "entries", "invalid");
});
it("detects conflicts in a different taxpayer's retained history", async () => {
  await capture();
  retained([
    { ...retainedRow, taxpayerNif: "other" },
    { ...retainedRow, taxpayerNif: "other", identity: "06RD" },
  ]);
  expectCheck(await verify(), "entries", "invalid");
});
it("does not accept module-owned history under a schema-zero claim", async () => {
  await capture(false);
  retained([]);
  expectCheck(await verify(0), "entries", "invalid");
});
it("accepts a genuinely empty zero-schema predecessor", async () => {
  await capture(false);
  expect(await verify(0)).toEqual(passed);
});
it.each(["before", "after"] as const)("checks every stored hour source in %s", async (side) => {
  await capture();
  edit(side, (db) =>
    db.exec("update registro_sif set numero_instalacion='06RA' where revocado_en is not null"),
  );
  expect((await verify()).status).toBe("invalid");
});
it("requires each stored series to resolve exactly one historical registration", async () => {
  await capture();
  both((db) =>
    db.exec(
      "update invoice_series set code='unmatched-06RA' where id=(select id from invoice_series where retired_at is not null limit 1)",
    ),
  );
  expectCheck(await verify(), "entries", "invalid");
});
it("does not skip missing application certificate material", async () => {
  await capture();
  both((db) => db.exec("delete from tenant_credentials where purpose='fiscal.aeat'"));
  await expect(verify()).rejects.toEqual(new BackupCheckUnavailable("secret_unavailable"));
});
it("propagates an unresolved required data check without invoking authority", async () => {
  await capture();
  const history = await import("./backup-verification-history.js");
  vi.spyOn(history, "verifyBackupFiscalHistory").mockResolvedValue({
    status: "needs_authority",
    checks: [{ code: "history", status: "needs_authority" }],
  });
  expectCheck(await verify(), "history", "needs_authority");
});
it("keeps unsupported public evidence unsupported", async () => {
  await capture();
  const history = await import("./backup-verification-history.js");
  vi.spyOn(history, "verifyBackupFiscalHistory").mockResolvedValue({
    status: "unsupported",
    checks: [{ code: "history", status: "unsupported" }],
  });
  expectCheck(await verify(), "history", "unsupported");
});
it("propagates unexpected private query failures", async () => {
  await capture();
  both((db) => db.exec("drop table nodes"));
  await expect(verify()).rejects.toThrow();
});
it("cannot use a zero-schema claim to hide stored fiscal history", async () => {
  await capture();
  expectCheck(await verify(0), "entries", "invalid");
});
it.each(["allocation", "approval"])(
  "rejects malformed stored %s while projecting all hours",
  async (column) => {
    await capture();
    both((db) => db.exec(`update fiscal_allocations set ${column}='null'`));
    expectCheck(await verify(), "entries", "invalid");
  },
);
it("rejects a malformed stored history time", async () => {
  await capture();
  both((db) =>
    db.exec("update invoice_series set retired_at='invalid-time' where retired_at is not null"),
  );
  expectCheck(await verify(), "entries", "invalid");
});
it("keeps a stored non-hour identity unsupported rather than certifying an hourly floor", async () => {
  await capture();
  both((db) =>
    db.exec("update registro_sif set numero_instalacion='S000001' where revocado_en is not null"),
  );
  expectCheck(await verify(), "entries", "unsupported");
});
it("admits absent predecessor tables only with an empty migrated target", async () => {
  await capture(false);
  edit("before", (db) => {
    for (const table of FISCAL_CLASSIFICATION)
      db.exec(`drop table "${table.table.replaceAll('"', '""')}"`);
  });
  expect(await verify(null)).toEqual(passed);
});
it("includes dormant reservation timestamps without executing the reservation", async () => {
  await capture();
  both((db) =>
    db
      .prepare("insert into fiscal_reservations values (?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        "retained-spare",
        "spare",
        TENANT_A.nodeId2,
        TENANT_A.nodeId,
        "89890001K",
        "old-software",
        "preproduction",
        "06RC",
        "{}",
        JSON.stringify(bases),
        "invalid-time",
      ),
  );
  expectCheck(await verify(), "entries", "invalid");
});

it("cannot omit the full-chain result from the aggregate", async () => {
  await capture();
  both((db) => db.exec("update cadenas set secuencia=1"));
  expectCheck(await verify(), "chain", "invalid");
});
it("cannot omit retained filing refusals from the aggregate", async () => {
  await capture();
  both((db) =>
    db
      .prepare(
        "insert into filing_cases (id,registro_id,cause,evidence,opened_at) values (?,?,?,?,?)",
      )
      .run(
        "10000000-0000-4000-8000-000000000010",
        "10000000-0000-4000-8000-000000000011",
        "fiscal.registro_rechazado",
        "{}",
        time,
      ),
  );
  expectCheck(await verify(), "history", "invalid");
});
it("checks the captured before-side hour projection", async () => {
  await capture();
  edit("before", (db) =>
    db.exec("update invoice_series set retired_at='invalid-time' where retired_at is not null"),
  );
  expectCheck(await verify(), "entries", "invalid");
});
it("checks the migrated after-side hour projection", async () => {
  await capture();
  edit("after", (db) =>
    db.exec("update invoice_series set retired_at='invalid-time' where retired_at is not null"),
  );
  expectCheck(await verify(), "entries", "invalid");
});
