import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deployment, withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type BackupVerificationContext } from "@waitron/module";
import { openBackupQuery } from "@waitron/store";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayers, seedSoldRegistro, TAXPAYER_A } from "../test/fixtures.js";
import { activateAllocation } from "./allocation.js";
import { recordConflictEvidence } from "./conflict-evidence.js";
import { appendHistory } from "./history.js";
import { toAeatDate } from "./registro-row.js";
import {
  withHourAdmission,
  type FiscalAllocation,
  type RecoveryApproval,
} from "./allocation-envelope.js";
import { encodeMinuteIdentity } from "./hour-identity.js";
import { installationChecksum } from "./allocation-identity.js";
import {
  signPaperBlock,
  signPaperConsumptionForBlock,
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
const node = { nodeId: TAXPAYER_A.nodeId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "corrective" },
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
    installationIdentity: encodeMinuteIdentity(Date.parse(issuedAt)),
    series: bases.map((b) => ({
      ...b,
      code: `${b.code}-${encodeMinuteIdentity(Date.parse(issuedAt))}`,
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
    action: hour === 0 ? "setup" : "restore",
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
    await seedTaxpayers(suite.db);
    await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
    const first = await activation(0);
    await activation(1);
    await seedSoldRegistro(suite.db, {
      entorno: "preproduction",
      nodeId: node.nodeId,
      sifId: first.sifId,
      nif: "89890001K",
      secuencia: 1,
      huella: "A".repeat(64),
    });
    const original = suite.db.get<{
      id: string;
      id_emisor_factura: string;
      num_serie_factura: string;
      fecha_expedicion_factura: string;
    }>(sql`
      select id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura from verifactu_records limit 1
    `)!;
    await withTransaction(suite.db, (tx) =>
      recordConflictEvidence(tx, {
        registroId: original.id,
        attempt: 1,
        cause: "fiscal.huella_divergente",
        now: new Date(time),
        evidence: {
          line: {
            IDFactura: {
              IDEmisorFactura: original.id_emisor_factura,
              NumSerieFactura: original.num_serie_factura,
              FechaExpedicionFactura: toAeatDate(original.fecha_expedicion_factura),
            },
            RefExterna: original.id,
            Operacion: { TipoOperacion: "Alta" },
            EstadoRegistro: "Incorrecto",
            CodigoErrorRegistro: 3000,
            DescripcionErrorRegistro: "Conflicting duplicate",
          },
          csv: null,
          comparison: {
            kind: "lookup-mismatch",
            storedFingerprint: "D".repeat(64),
            storedSystem: null,
          },
        },
      }),
    );
    await suite.db.execute(
      sql`insert into verifactu_submissions (registro_id, estado, proximo_intento_en, csv,
        case_cause, case_evidence, case_opened_at, case_open_seq)
      select id, 'aceptado', ${time}, 'retained-csv', 'fiscal.registro_rechazado',
        '{"codigo":1,"mensaje":"retained","csv":null}', ${time}, 1 from verifactu_records`,
    );
    await suite.db.execute(
      sql`insert into verifactu_sending_state (id, proximo_envio_en, tiempo_espera_seg) values (1,${time},60)`,
    );
    await suite.db.execute(
      sql`insert into verifactu_certificates (id,node_id,installed_at,source,kind,fingerprint,valid_from,valid_until) values ('10000000-0000-4000-8000-000000000004',${node.nodeId},${time},'setup','sello','retained-fingerprint',${time},'2027-10-16T11:00:00.000Z')`,
    );
    await suite.db.execute(
      sql`insert into fiscal_certificate_reminders (id,node_id,install_id,stage,person_id,status,claimed_at) values ('10000000-0000-4000-8000-000000000005',${node.nodeId},'10000000-0000-4000-8000-000000000004','warning','10000000-0000-4000-8000-000000000003','sent',${time})`,
    );
    await withTransaction(suite.db, async (tx) => {
      const personId = await seedPerson(tx, { id: "10000000-0000-4000-8000-000000000003" });
      await appendHistory(tx, {
        kind: "case.note",
        nodeId: node.nodeId,
        registroId: original.id,
        at: new Date(time),
        personId,
        actionKey: "note-1",
        data: { action: "retained note" },
      });
      await appendHistory(tx, {
        kind: "clock.confirmed",
        nodeId: node.nodeId,
        at: new Date(time),
        personId,
        data: { source: "admin", reason: "start", confirmedAt: time, stepMs: 0, proof: {} },
      });
    });
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

it("verifies revoked registrations, retained filings and a clock step without a linked fiscal record", async () => {
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
    "update verifactu_identities set node_id='missing' where id=(select sif_id from fiscal_allocations where event_key='event-0')",
  ],
  [
    "registration scope",
    "update verifactu_identities set nif='B12345674' where id=(select sif_id from fiscal_allocations where event_key='event-0')",
  ],
  [
    "revoked registration instant",
    "update verifactu_identities set revocado_en='bad' where revocado_en is not null",
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
    "delete from verifactu_identities where id=(select sif_id from fiscal_allocations where event_key='event-0')",
  ],
  [
    "missing historical series",
    "delete from invoice_series where id=json_extract((select result from fiscal_allocations where event_key='event-0'),'$.series[0].id')",
  ],
  [
    "historical series node",
    "update invoice_series set node_id='missing' where retired_at is not null",
  ],
  [
    "filing note parent",
    "update verifactu_history set registro_id='missing' where kind='case.note'",
  ],
  ["filing remedy parent", "update verifactu_submissions set case_remedy_registro_id='missing'"],
  ["filing resolution person", "update verifactu_submissions set case_resolved_by='missing'"],
  ["send parent", "update verifactu_submissions set registro_id='missing'"],
  ["certificate reminder parent", "update fiscal_certificate_reminders set install_id='missing'"],
  ["clock history node parent", "update verifactu_history set node_id='missing'"],
  ["clock history person parent", "update verifactu_history set person_id='missing'"],
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
  ["approval", (v: HistoryFixture) => ({ ...v, targetNodeId: TAXPAYER_A.nodeId2 })],
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
  "verifactu_identities",
  "fiscal_allocations",
  "verifactu_submissions",
  "verifactu_sending_state",
  "verifactu_certificates",
  "fiscal_certificate_reminders",
])("retains every captured %s row", async (table) => {
  await capture();
  edit("after", (db) => db.exec(`delete from "${table}"`));
  expect(await verify()).toEqual(result("invalid"));
});

it.each([
  "update verifactu_submissions set case_cause=null, case_evidence=null, case_opened_at=null, case_open_seq=null",
  "delete from verifactu_history where kind='case.note'",
])("retains case evidence when the rest of its row or history survives", async (statement) => {
  await capture();
  edit("after", (db) => db.exec(statement));
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
  db.prepare("update verifactu_identities set numero_instalacion=? where id=?").run(
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

it("does not swallow unavailable query failures into an integrity result", async () => {
  await capture();
  edit("before", (db) => db.exec("drop table nodes"));
  await expect(verify()).rejects.toThrow();
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
  db.prepare("update verifactu_identities set numero_instalacion=? where id=?").run(
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
  edit("after", (db) =>
    db.exec(
      "update verifactu_history set data=json_set(data, '$.action', 'different valid note') where kind='case.note'",
    ),
  );
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
it("admits empty migrated fiscal tables when the captured predecessor has none", async () => {
  await capture(false);
  edit("before", (db) => {
    const tables = db
      .prepare(
        "select name from sqlite_schema where type='table' and name in ('verifactu_identities','fiscal_allocations','verifactu_history','verifactu_series_conflicts','verifactu_submissions','verifactu_sending_state','verifactu_certificates','fiscal_certificate_reminders')",
      )
      .all() as { name: string }[];
    for (const table of tables) db.exec(`drop table "${table.name.replaceAll('"', '""')}"`);
  });
  expect(await verify()).toEqual(result("passed"));
});

it("rejects a dangling record link on a conflict observation", async () => {
  await capture();
  both((db) =>
    db.exec(`
    update verifactu_history set registro_id='missing', event_key='conflict:missing:1:fiscal.huella_divergente'
    where kind='conflict.observed'`),
  );
  expect(await verify()).toEqual(result("invalid"));
});

it("retains captured conflict observations", async () => {
  await capture();
  edit("after", (db) =>
    db.exec(`
    delete from verifactu_history where id =
      (select id from verifactu_history where kind='conflict.observed')`),
  );
  expect(await verify()).toEqual(result("invalid"));
});

async function relinquishedPromotion(hour: number) {
  const issuedAt = new Date(Date.parse(time) + hour * 3600000).toISOString();
  const identity = encodeMinuteIdentity(Date.parse(issuedAt));
  const allocation: FiscalAllocation = {
    version: 1,
    allocationId: `hour-${hour}`,
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction",
    installationIdentity: identity,
    series: bases.map((b) => ({ ...b, code: `${b.code}-${identity}` })),
    source: "hour",
    reservationEvidence: null,
    issuedAt,
  };
  const approval: RecoveryApproval = {
    version: 2,
    eventId: `event-${hour}`,
    operatorId: "administrator",
    sourceId: "promotion:original",
    targetNodeId: node.nodeId,
    oldMachineOffline: false,
    oldMachineAbsent: false,
    oldMachineRelinquished: true,
    noParallelRecovery: true,
    confirmedAt: issuedAt,
    incidentEvidence: `incident-${hour}`,
  };
  const binding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: approval.eventId,
    sourceId: approval.sourceId,
    targetNodeId: node.nodeId,
  };
  return withOperationAuthority(binding, approval.operatorId, (authority) =>
    withHourAdmission(
      { binding, authority, input: { allocation, approval } },
      { requiredBases: bases, priorActivation: "none", oldMachineRelinquished: true },
      (evidence) =>
        withTransaction(suite.db, (tx) =>
          activateAllocation(tx, node, allocation, approval, {
            ...binding,
            taxpayerNif: allocation.taxpayerNif,
            softwareId: allocation.softwareId,
            environment: allocation.environment,
            mode: "recovery",
            oldMachineRelinquished: evidence.oldMachineRelinquished,
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
async function captureWithPromotion() {
  await capture();
  // The sold record's series is not an allocated base, so a later activation would refuse series_mismatch.
  await suite.db.execute(
    sql`update invoice_series set retired_at=${time} where code='S1' and retired_at is null`,
  );
  await relinquishedPromotion(2);
  await rm(directory!, { recursive: true, force: true });
  await capture(false);
}
function storedApproval(eventKey: string) {
  const db = new DatabaseSync(join(directory!, "after.db"), { readOnly: true });
  try {
    const row = db
      .prepare("select approval from fiscal_allocations where event_key=?")
      .get(eventKey)!;
    return JSON.parse(String(row.approval)) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

it("a stored version 2 relinquished approval verifies", async () => {
  await captureWithPromotion();
  expect(storedApproval("event-2")).toMatchObject({
    version: 2,
    oldMachineOffline: false,
    oldMachineAbsent: false,
    oldMachineRelinquished: true,
  });
  expect(await verify()).toEqual(result("passed"));
});

it("a stored version 1 approval verifies as today", async () => {
  await capture();
  expect(storedApproval("event-0")).toMatchObject({ version: 1, oldMachineAbsent: true });
  expect(storedApproval("event-1")).toMatchObject({ version: 1, oldMachineOffline: true });
  expect(await verify()).toEqual(result("passed"));
});

function rewriteApproval(db: DatabaseSync, eventKey: string, fields: Record<string, unknown>) {
  const row = db
    .prepare("select approval from fiscal_allocations where event_key=?")
    .get(eventKey)!;
  db.prepare("update fiscal_allocations set approval=? where event_key=?").run(
    JSON.stringify({ ...JSON.parse(String(row.approval)), ...fields }),
    eventKey,
  );
}

it("a stored version 2 approval saying neither offline, absent nor relinquished is refused", async () => {
  await captureWithPromotion();
  both((db) => rewriteApproval(db, "event-2", { oldMachineRelinquished: false }));
  expect(await verify()).toEqual(result("invalid"));
});

it.each([
  [
    "a promotion saying offline but not relinquished",
    "event-2",
    { oldMachineRelinquished: false, oldMachineOffline: true },
  ],
  [
    "a promotion saying both relinquished and offline",
    "event-2",
    { oldMachineRelinquished: true, oldMachineOffline: true },
  ],
  ["a restore saying offline", "event-1", { version: 2, oldMachineRelinquished: false }],
  ["a first setup saying absent", "event-0", { version: 2, oldMachineRelinquished: true }],
])("a stored version 2 approval no promotion writes is refused: %s", async (_name, key, fields) => {
  await captureWithPromotion();
  both((db) => rewriteApproval(db, key, fields));
  expect(await verify()).toEqual(result("invalid"));
});

it("a stored version 2 relinquished approval on an emergency row is refused", async () => {
  await capture();
  both((db) => paper(db, false, true));
  expect(await verify()).toEqual(result("passed"));
  both((db) =>
    rewriteApproval(db, "event-0", {
      version: 2,
      oldMachineOffline: false,
      oldMachineRelinquished: true,
    }),
  );
  expect(await verify()).toEqual(result("invalid"));
});

it("refuses orphaned returned-invoice markers even when both copies match", async () => {
  await capture();
  both((db) =>
    db.exec(
      "insert into returned_invoice_records values ('absent-original', '2026-11-12T12:00:00.000Z')",
    ),
  );
  expect(await verify()).toMatchObject({ status: "invalid" });
});

it("preserves the first returned-invoice receipt through backup", async () => {
  await capture();
  both((db) =>
    db.exec(
      "insert into returned_invoice_records select id, '2026-11-12T12:00:00.000Z' from verifactu_records limit 1",
    ),
  );
  expect(await verify()).toMatchObject({ status: "passed" });
  edit("after", (db) =>
    db.exec("update returned_invoice_records set received_at = '2026-11-13T12:00:00.000Z'"),
  );
  expect(await verify()).toMatchObject({ status: "invalid" });
});
