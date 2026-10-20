import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type BackupVerificationContext } from "@waitron/module";
import { openBackupQuery } from "@waitron/store";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, seedSoldRegistro, TENANT_A } from "../test/fixtures.js";
import { activateAllocation } from "./allocation.js";
import {
  withHourAdmission,
  type FiscalAllocation,
  type RecoveryApproval,
} from "./allocation-envelope.js";
import { encodeHourIdentity } from "./hour-identity.js";
import { installationChecksum } from "./allocation-identity.js";
import {
  signPaperBlock,
  signPaperConsumptionForBlock,
  signPaperReservationForBlock,
  paperCustodianFingerprint,
  type PaperCustodianTrust,
} from "./paper-evidence.js";
import type { ReceiptTrust } from "./cloud-evidence.js";
import { verifyBackupFiscalHistory } from "./backup-verification-history.js";

const pinned = vi.hoisted(() => ({
  cloud: null as ReceiptTrust | null,
  paper: [] as PaperCustodianTrust[],
}));
vi.mock("./backup-verification-trust.js", () => ({ FISCAL_BACKUP_PUBLIC_TRUST: pinned }));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "rectificative" },
];
const time = "2026-10-16T11:00:00.000Z";
const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const custodian = {
  custodianId: "reviewed-test-custodian",
  publicKey,
  fingerprint: paperCustodianFingerprint(publicKey)!,
};
let directory: string | undefined;

beforeEach(() => {
  pinned.cloud = null;
  pinned.paper = [];
});
afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
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
    const first = await activation(0);
    await activation(1);
    await seedSoldRegistro(suite.db, {
      locationId: node.locationId,
      entorno: "preproduction",
      nodeId: node.nodeId,
      sifId: first.sifId,
      nif: "89890001K",
      secuencia: 1,
      huella: "A".repeat(64),
    });
    await suite.db.execute(
      sql`insert into filing_cases (id, registro_id, cause, evidence, opened_at) select '10000000-0000-4000-8000-000000000001', id, 'fiscal.registro_rechazado', '{"codigo":1,"mensaje":"retained","csv":null}', ${time} from registros_facturacion limit 1`,
    );
    await suite.db.execute(
      sql`insert into filing_case_events (id, case_id, action_key, kind, person_id, action, remedy_registro_id, recorded_at) values ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','note-1','note','10000000-0000-4000-8000-000000000003','retained note',null,${time})`,
    );
    await suite.db.execute(
      sql`insert into envios (registro_id, estado, proximo_intento_en, csv) select id, 'aceptado', ${time}, 'retained-csv' from registros_facturacion`,
    );
    await suite.db.execute(
      sql`insert into acks (registro_id, submitted_at, csv, state) select id, ${time}, 'retained-csv', 'accepted' from registros_facturacion`,
    );
    await suite.db.execute(sql`insert into envio_flujo values (1,${time},60)`);
    await suite.db.execute(
      sql`insert into fiscal_certificate_installs (id,node_id,installed_at,source,kind,fingerprint,valid_from,valid_until) values ('10000000-0000-4000-8000-000000000004',${node.nodeId},${time},'setup','sello','retained-fingerprint',${time},'2027-10-16T11:00:00.000Z')`,
    );
    await suite.db.execute(
      sql`insert into fiscal_certificate_reminders (id,node_id,install_id,stage,person_id,status,claimed_at) values ('10000000-0000-4000-8000-000000000005',${node.nodeId},'10000000-0000-4000-8000-000000000004','warning','10000000-0000-4000-8000-000000000003','sent',${time})`,
    );
  }
  directory = await mkdtemp(join(tmpdir(), "waitron-backup-history-"));
  const [file] = suite.db.all<{ file: string }>(sql`pragma database_list`);
  const db = new DatabaseSync(file!.file, { readOnly: true });
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
    db.exec("pragma foreign_keys = off; pragma ignore_check_constraints = on");
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
type HistoryFixture = {
  series: { id: string; code: string; purpose: string }[];
  reservationEvidence: Record<string, { signature: string }> & { consumptionDigest: string };
  [key: string]: unknown;
};
function change(db: DatabaseSync, column: string, mutate: (value: HistoryFixture) => unknown) {
  const row = db
    .prepare(`select ${column} as value from fiscal_allocations where event_key='event-0'`)
    .get()!;
  db.prepare(`update fiscal_allocations set ${column}=? where event_key='event-0'`).run(
    JSON.stringify(mutate(JSON.parse(String(row.value)))),
  );
}
async function verify() {
  const a = await openBackupQuery(join(directory!, "before.db"));
  try {
    const b = await openBackupQuery(join(directory!, "after.db"));
    try {
      const context: BackupVerificationContext = {
        before: a.query,
        after: b.query,
        entries: {
          read: async () => {
            throw new Error("unexpected archive read");
          },
        },
        source: {
          nodeId: node.nodeId,
          locationId: node.locationId,
          environment: "preproduction",
          createdAt: time,
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      };
      return await verifyBackupFiscalHistory(context);
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}
const result = (status: "passed" | "invalid" | "unsupported") => ({
  status,
  checks: [{ code: "history", status }],
});

it("requires no new allocation to read every revoked registration and retained filing record", async () => {
  await capture();
  expect(await verify()).toEqual(result("passed"));
  expect(await verify()).toEqual(result("passed"));
});
it("accepts a genuinely empty fiscal owner", async () => {
  await capture(false);
  expect(await verify()).toEqual(result("passed"));
});

it.each([
  [
    "registration node",
    "update registro_sif set node_id='missing' where id=(select sif_id from fiscal_allocations where event_key='event-0')",
  ],
  [
    "registration scope",
    "update registro_sif set nif='B12345674' where id=(select sif_id from fiscal_allocations where event_key='event-0')",
  ],
  [
    "revoked registration instant",
    "update registro_sif set revocado_en='bad' where revocado_en is not null",
  ],
  ["allocation node", "update fiscal_allocations set node_id='missing' where event_key='event-0'"],
  [
    "allocation scope",
    "update fiscal_allocations set environment='production' where event_key='event-0'",
  ],
  [
    "activation timestamp",
    "update fiscal_allocations set activated_at='bad' where event_key='event-0'",
  ],
  [
    "missing historical SIF",
    "delete from registro_sif where id=(select sif_id from fiscal_allocations where event_key='event-0')",
  ],
  [
    "missing historical series",
    "delete from invoice_series where id=json_extract((select result from fiscal_allocations where event_key='event-0'),'$.series[0].id')",
  ],
  [
    "historical series node",
    "update invoice_series set node_id='missing' where retired_at is not null",
  ],
  ["filing case parent", "update filing_cases set registro_id='missing'"],
  ["filing event parent", "update filing_case_events set case_id='missing'"],
  ["filing remedy parent", "update filing_case_events set remedy_registro_id='missing'"],
  ["send parent", "update envios set registro_id='missing'"],
  ["ack parent", "update acks set registro_id='missing'"],
  ["certificate reminder parent", "update fiscal_certificate_reminders set install_id='missing'"],
])("rejects internally damaged %s even when both copies match", async (_name, statement) => {
  await capture();
  both((db) => db.exec(statement));
  expect(await verify()).toEqual(result("invalid"));
});

it.each([
  ["allocation", (v: HistoryFixture) => ({ ...v, allocationId: "changed" })],
  ["allocation", (v: HistoryFixture) => ({ ...v, version: 2 })],
  ["allocation", (v: HistoryFixture) => ({ ...v, source: "unknown" })],
  ["allocation", (v: HistoryFixture) => ({ ...v, issuedAt: "2020-01-01T00:00:00.000Z" })],
  [
    "allocation",
    (v: HistoryFixture) => ({ ...v, reservationEvidence: { path: "/outside/trust.json" } }),
  ],
  ["allocation", (v: HistoryFixture) => ({ ...v, series: v.series.slice(1) })],
  ["approval", (v: HistoryFixture) => ({ ...v, eventId: "changed" })],
  ["approval", (v: HistoryFixture) => ({ ...v, targetNodeId: TENANT_A.nodeId2 })],
  ["approval", (v: HistoryFixture) => ({ ...v, noParallelRecovery: false })],
  [
    "approval",
    (v: HistoryFixture) => ({ ...v, oldMachineAbsent: false, oldMachineOffline: false }),
  ],
  [
    "approval",
    (v: HistoryFixture) => ({
      ...v,
      operatorId: { kind: "recovery-key", nodeId: "wrong", eventId: v.eventId },
    }),
  ],
  ["bases", () => [{ code: "A", purpose: "full" }]],
  ["result", (v: HistoryFixture) => ({ ...v, sifId: "missing" })],
  ["result", (v: HistoryFixture) => ({ ...v, activationEventId: "changed" })],
  [
    "result",
    (v: HistoryFixture) => ({
      ...v,
      series: v.series.map((s: { id: string; code: string; purpose: string }) => ({
        ...s,
        purpose: "full",
      })),
    }),
  ],
])("rejects historical structured %s corruption %#", async (column, mutate) => {
  await capture();
  both((db) => change(db, column, mutate));
  expect(await verify()).toEqual(result("invalid"));
});

it.each([
  "registro_sif",
  "fiscal_allocations",
  "filing_cases",
  "filing_case_events",
  "envios",
  "envio_flujo",
  "acks",
  "fiscal_certificate_installs",
  "fiscal_certificate_reminders",
])("retains every captured %s row", async (table) => {
  await capture();
  edit("after", (db) => db.exec(`delete from "${table}"`));
  expect(await verify()).toEqual(result("invalid"));
});

function paper(db: DatabaseSync, declared = false, emergency = false) {
  const row = db
    .prepare("select allocation,approval,result from fiscal_allocations where event_key='event-0'")
    .get()!;
  const original = JSON.parse(String(row.allocation));
  const approval = JSON.parse(String(row.approval));
  const identity = emergency ? "E00000000000000000000000000" : "S000042";
  const candidate = {
    ...original,
    source: emergency ? "emergency" : "initial-paper",
    installationIdentity: identity,
    series: bases.map((b) => ({ ...b, code: `${b.code}-${identity}` })),
  };
  let evidence: unknown;
  if (emergency) {
    approval.oldMachineAbsent = false;
    approval.oldMachineOffline = true;
    evidence = { checksum: installationChecksum(identity) };
  } else if (declared) {
    const allocation = { ...candidate };
    Reflect.deleteProperty(allocation, "reservationEvidence");
    const reservation = {
      kind: "reserve",
      allocation,
      recipientVenueId: "venue",
      binding: {
        module: "fiscal-verifactu",
        action: "setup",
        eventId: approval.eventId,
        sourceId: approval.sourceId,
        targetNodeId: approval.targetNodeId,
      },
      reservedAt: time,
    };
    const digest = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
    const consumption = {
      kind: "consume",
      allocationId: allocation.allocationId,
      reservationDigest: digest(reservation),
      eventId: approval.eventId,
      operatorId: approval.operatorId,
      sourceId: approval.sourceId,
      targetNodeId: approval.targetNodeId,
      incidentEvidence: approval.incidentEvidence,
      consumedAt: time,
    };
    evidence = {
      kind: "paper-declared-evidence",
      version: 2,
      historyDigest: "a".repeat(64),
      reservation,
      consumption,
      reservationDigest: digest(reservation),
      consumptionDigest: digest(consumption),
    };
  } else {
    const allocation = { ...candidate };
    Reflect.deleteProperty(allocation, "reservationEvidence");
    const block = signPaperBlock(
      {
        version: 1,
        custodianId: custodian.custodianId,
        generationId: "generation",
        blockId: "block",
        packVersion: 1,
        recipientVenueId: "venue",
        allocations: [allocation],
      },
      privateKey,
    );
    evidence = {
      block,
      consumption: signPaperConsumptionForBlock(
        block,
        candidate.allocationId,
        {
          eventId: approval.eventId,
          operatorId: approval.operatorId,
          sourceId: approval.sourceId,
          targetNodeId: approval.targetNodeId,
          incidentEvidence: approval.incidentEvidence,
          consumedAt: time,
        },
        privateKey,
      ),
    };
  }
  candidate.reservationEvidence = evidence;
  const activation = JSON.parse(String(row.result));
  for (let i = 0; i < activation.series.length; i++) {
    activation.series[i] = { ...activation.series[i], ...candidate.series[i] };
    db.prepare("update invoice_series set code=? where id=?").run(
      activation.series[i].code,
      activation.series[i].id,
    );
  }
  db.prepare("update registro_sif set numero_instalacion=? where id=?").run(
    identity,
    activation.sifId,
  );
  db.prepare(
    "update fiscal_allocations set allocation=?,approval=?,installation_identity=?,result=? where event_key='event-0'",
  ).run(JSON.stringify(candidate), JSON.stringify(approval), identity, JSON.stringify(activation));
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

it("returns unsupported for historical signed evidence without release-pinned trust", async () => {
  await capture();
  both((db) => paper(db));
  expect(await verify()).toEqual(result("unsupported"));
});
it("checks historical block and consumption signatures with reviewed public trust only", async () => {
  await capture();
  both((db) => paper(db));
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("passed"));
});
it.each(["block", "consumption"])("rejects a changed historical %s signature", async (part) => {
  await capture();
  both((db) => {
    paper(db);
    change(db, "allocation", (v) => {
      v.reservationEvidence[part].signature = "A".repeat(86);
      return v;
    });
  });
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("invalid"));
});
it("checks declared paper structure without pretending it has a public signature", async () => {
  await capture();
  both((db) => paper(db, true));
  expect(await verify()).toEqual(result("passed"));
  both((db) =>
    change(db, "allocation", (v) => {
      v.reservationEvidence.consumptionDigest = "b".repeat(64);
      return v;
    }),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it("checks emergency checksum evidence without drawing a new identity", async () => {
  await capture();
  both((db) => paper(db, false, true));
  expect(await verify()).toEqual(result("passed"));
  both((db) =>
    change(db, "allocation", (v) => ({ ...v, reservationEvidence: { checksum: "bad" } })),
  );
  expect(await verify()).toEqual(result("invalid"));
});

function reservation(db: DatabaseSync) {
  const allocation = {
    version: 1 as const,
    allocationId: "spare-43",
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction" as const,
    installationIdentity: "P000043",
    series: bases.map((b) => ({ ...b, code: `${b.code}-P000043` })),
    source: "paper" as const,
    issuedAt: time,
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: custodian.custodianId,
      generationId: "generation",
      blockId: "spare-block",
      packVersion: 1,
      recipientVenueId: "venue",
      allocations: [allocation],
    },
    privateKey,
  );
  const signed = signPaperReservationForBlock(
    block,
    allocation.allocationId,
    {
      eventId: "reserve-43",
      operatorId: "administrator",
      sourceId: node.nodeId,
      targetNodeId: TENANT_A.nodeId2,
      incidentEvidence: "spare",
      reservedAt: time,
    },
    privateKey,
  );
  db.prepare("insert into fiscal_reservations values (?,?,?,?,?,?,?,?,?,?,?)").run(
    "reserve-43",
    allocation.allocationId,
    TENANT_A.nodeId2,
    node.nodeId,
    allocation.taxpayerNif,
    allocation.softwareId,
    allocation.environment,
    allocation.installationIdentity,
    JSON.stringify({ block, reservation: signed }),
    JSON.stringify(bases),
    time,
  );
}
it("checks dormant reservation signatures without current register confirmations", async () => {
  await capture();
  both(reservation);
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("passed"));
});
it.each(["source_node_id", "node_id", "allocation_key", "installation_identity"])(
  "binds each reservation's %s",
  async (column) => {
    await capture();
    both((db) => {
      reservation(db);
      db.exec(`update fiscal_reservations set ${column}='wrong'`);
    });
    pinned.paper = [custodian];
    expect(await verify()).toEqual(result("invalid"));
  },
);
it("retains reservations even when their signatures remain valid", async () => {
  await capture();
  both(reservation);
  pinned.paper = [custodian];
  edit("after", (db) => db.exec("delete from fiscal_reservations"));
  expect(await verify()).toEqual(result("invalid"));
});
it("does not swallow unavailable query failures into an integrity result", async () => {
  await capture();
  edit("before", (db) => db.exec("drop table nodes"));
  await expect(verify()).rejects.toThrow();
});

function declaredReservation(db: DatabaseSync, malformed = false) {
  reservation(db);
  const held = JSON.parse(
    String(db.prepare("select evidence from fiscal_reservations").get()!.evidence),
  ) as { block: { payload: { allocations: unknown[] } } };
  const entry = {
    kind: "reserve",
    allocation: held.block.payload.allocations[0],
    recipientVenueId: "venue",
    binding: {
      module: "fiscal-verifactu",
      action: "reserve",
      eventId: "reserve-43",
      sourceId: node.nodeId,
      targetNodeId: TENANT_A.nodeId2,
    },
    reservedAt: time,
  };
  const proof = {
    kind: "paper-declared-reservation",
    version: 2,
    reservation: malformed ? null : entry,
    reservationDigest: createHash("sha256")
      .update(canonical(malformed ? null : entry))
      .digest("hex"),
    historyDigest: "a".repeat(64),
  };
  db.prepare("update fiscal_reservations set evidence=?").run(JSON.stringify(proof));
}
it("checks captured declared reservations without a signer or new confirmation", async () => {
  await capture();
  both((db) => declaredReservation(db));
  expect(await verify()).toEqual(result("passed"));
});
it("rejects a malformed declared reservation even with a matching digest", async () => {
  await capture();
  both((db) => declaredReservation(db, true));
  expect(await verify()).toEqual(result("invalid"));
});

function cloud(db: DatabaseSync) {
  paper(db, true);
  const row = db
    .prepare("select allocation,result from fiscal_allocations where event_key='event-0'")
    .get()!;
  const a = JSON.parse(String(row.allocation)) as {
    source: string;
    installationIdentity: string;
    series: { code: string; purpose: string }[];
    reservationEvidence: unknown;
  };
  a.source = "cloud";
  a.installationIdentity = "C000042";
  a.series = bases.map((b) => ({ ...b, code: `${b.code}-C000042` }));
  a.reservationEvidence = {
    kind: "cloud",
    authorityId: "retained-cloud",
    reservationId: "10000000-0000-4000-8000-000000000042",
    reservationSequence: "42",
  };
  const r = JSON.parse(String(row.result)) as {
    sifId: string;
    series: { id: string; code: string; purpose: string }[];
  };
  for (let i = 0; i < r.series.length; i++) {
    r.series[i] = { ...r.series[i]!, ...a.series[i]! };
    db.prepare("update invoice_series set code=? where id=?").run(
      r.series[i]!.code,
      r.series[i]!.id,
    );
  }
  db.prepare("update registro_sif set numero_instalacion=? where id=?").run(
    a.installationIdentity,
    r.sifId,
  );
  db.prepare(
    "update fiscal_allocations set allocation=?,result=?,installation_identity=? where event_key='event-0'",
  ).run(JSON.stringify(a), JSON.stringify(r), a.installationIdentity);
}
it("keeps a retained Cloud reference unsupported even with a configured public key", async () => {
  await capture();
  both(cloud);
  expect(await verify()).toEqual(result("unsupported"));
  pinned.cloud = { issuer: "retained-cloud", keys: new Map([["key", "public-only"]]) };
  expect(await verify()).toEqual(result("unsupported"));
});
it.each([
  null,
  {},
  { kind: "cloud", authorityId: "retained-cloud", reservationId: "bad", reservationSequence: "42" },
])("rejects malformed Cloud reference %#", async (proof) => {
  await capture();
  both((db) => {
    cloud(db);
    change(db, "allocation", (v) => ({ ...v, reservationEvidence: proof }));
  });
  expect(await verify()).toEqual(result("invalid"));
});
it.each(["allocation", "approval", "bases", "result"])(
  "rejects malformed captured JSON in %s",
  async (column) => {
    await capture();
    both((db) => db.exec(`update fiscal_allocations set ${column}='{' where event_key='event-0'`));
    expect(await verify()).toEqual(result("invalid"));
  },
);
it.each(["allocation", "approval", "bases", "result"])(
  "rejects a non-object captured %s",
  async (column) => {
    await capture();
    both((db) =>
      db.exec(`update fiscal_allocations set ${column}='null' where event_key='event-0'`),
    );
    expect(await verify()).toEqual(result("invalid"));
  },
);
it.each(["not pem", "-----BEGIN PUBLIC KEY-----\nbad\n-----END PUBLIC KEY-----\n"])(
  "keeps malformed release trust unsupported %# without accepting the captured signer",
  async (publicKey) => {
    await capture();
    both((db) => paper(db));
    pinned.paper = [{ ...custodian, publicKey }];
    expect(await verify()).toEqual(result("unsupported"));
  },
);
it("keeps a mislabeled release fingerprint unsupported", async () => {
  await capture();
  both((db) => paper(db));
  pinned.paper = [{ ...custodian, fingerprint: "0".repeat(64) }];
  expect(await verify()).toEqual(result("unsupported"));
});
it("cannot use a captured self-asserted public root", async () => {
  await capture();
  both((db) => {
    paper(db);
    change(db, "allocation", (v) => ({
      ...v,
      reservationEvidence: { ...v.reservationEvidence, trust: custodian },
    }));
  });
  expect(await verify()).toEqual(result("invalid"));
});
it.each(["block", "consumption"])("rejects malformed signed %s envelopes", async (part) => {
  await capture();
  both((db) => {
    paper(db);
    change(db, "allocation", (v) => ({
      ...v,
      reservationEvidence: { ...v.reservationEvidence, [part]: null },
    }));
  });
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("invalid"));
});
it("retains every captured column even if both histories remain internally valid", async () => {
  await capture();
  edit("after", (db) => db.exec("update filing_case_events set action='different valid note'"));
  expect(await verify()).toEqual(result("invalid"));
});

it.each(["sourceId", "operatorId", "incidentEvidence"])(
  "binds a historical signed receipt's %s to its stored approval",
  async (field) => {
    await capture();
    both((db) => {
      paper(db);
      change(db, "approval", (v) => ({ ...v, [field]: "other" }));
    });
    pinned.paper = [custodian];
    expect(await verify()).toEqual(result("invalid"));
  },
);
it("refuses malformed declared reservation digests", async () => {
  await capture();
  both((db) => {
    declaredReservation(db);
    const row = db.prepare("select evidence from fiscal_reservations").get()!;
    const proof = JSON.parse(String(row.evidence)) as Record<string, unknown>;
    proof.reservationDigest = "b".repeat(64);
    db.prepare("update fiscal_reservations set evidence=?").run(JSON.stringify(proof));
  });
  expect(await verify()).toEqual(result("invalid"));
});
it("does not prepare activate draw or sign while verifying retained history", async () => {
  await capture();
  const writers = await import("./allocation.js");
  const admissions = await import("./allocation-envelope.js");
  const preparation = await import("./allocation-preparation.js");
  const signing = await import("./paper-evidence.js");
  const prohibited = () => {
    throw new Error("verification attempted operational authority");
  };
  const spies = [
    vi.spyOn(writers, "activateAllocation").mockImplementation(prohibited),
    vi.spyOn(admissions, "withHourAdmission").mockImplementation(prohibited),
    vi.spyOn(admissions, "drawEmergencyIdentity").mockImplementation(prohibited),
    vi.spyOn(preparation, "activatePreparedModuleAllocation").mockImplementation(prohibited),
    vi.spyOn(signing, "signPaperBlock").mockImplementation(prohibited),
    vi.spyOn(signing, "signPaperConsumption").mockImplementation(prohibited),
  ];
  try {
    expect(await verify()).toEqual(result("passed"));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it("keeps malformed release trust unsupported for dormant reservations", async () => {
  await capture();
  both(reservation);
  pinned.paper = [{ ...custodian, publicKey: "not pem" }];
  expect(await verify()).toEqual(result("unsupported"));
});

it("rejects a binary value where captured JSON is required", async () => {
  await capture();
  both((db) =>
    db.exec("update fiscal_allocations set allocation=x'7b7d' where event_key='event-0'"),
  );
  expect(await verify()).toEqual(result("invalid"));
});
it("rejects malformed signature bytes before treating a signer as trusted", async () => {
  await capture();
  both((db) => {
    paper(db);
    change(db, "allocation", (v) => {
      v.reservationEvidence.block!.signature = "bad";
      return v;
    });
  });
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("invalid"));
});
it("rejects an initial-paper identity paired with recovery-only approval", async () => {
  await capture();
  both((db) => {
    paper(db);
    change(db, "approval", (v) => ({ ...v, oldMachineAbsent: false, oldMachineOffline: true }));
  });
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("invalid"));
});
it("rejects incomplete activated series entries", async () => {
  await capture();
  both((db) => change(db, "result", (v) => ({ ...v, series: [{}] })));
  expect(await verify()).toEqual(result("invalid"));
});
it("rejects an activation result that omits a valid allocated series", async () => {
  await capture();
  both((db) => change(db, "result", (v) => ({ ...v, series: v.series.slice(1) })));
  expect(await verify()).toEqual(result("invalid"));
});
it.each([
  "update fiscal_reservations set evidence='null'",
  "update fiscal_reservations set source_node_id=node_id",
  "update fiscal_reservations set established_at='bad'",
])("rejects malformed dormant metadata %#", async (statement) => {
  await capture();
  both((db) => {
    reservation(db);
    db.exec(statement);
  });
  pinned.paper = [custodian];
  expect(await verify()).toEqual(result("invalid"));
});
it.each([{}, { block: { payload: {} }, reservation: { payload: {} } }])(
  "rejects malformed dormant evidence %#",
  async (evidence) => {
    await capture();
    both((db) => {
      reservation(db);
      db.prepare("update fiscal_reservations set evidence=?").run(JSON.stringify(evidence));
    });
    pinned.paper = [custodian];
    expect(await verify()).toEqual(result("invalid"));
  },
);
it("keeps a historical dormant signer without a pinned root unsupported", async () => {
  await capture();
  both(reservation);
  expect(await verify()).toEqual(result("unsupported"));
});
it("admits empty migrated fiscal tables when the captured predecessor has none", async () => {
  await capture(false);
  edit("before", (db) => {
    const tables = db
      .prepare(
        "select name from sqlite_schema where type='table' and name in ('registro_sif','fiscal_allocations','fiscal_reservations','filing_cases','filing_case_events','envios','envio_flujo','acks','fiscal_certificate_installs','fiscal_certificate_reminders')",
      )
      .all() as { name: string }[];
    for (const table of tables) db.exec(`drop table "${table.name.replaceAll('"', '""')}"`);
  });
  expect(await verify()).toEqual(result("passed"));
});
