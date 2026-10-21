import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import forge from "node-forge";
import type { BackupQuery } from "@waitron/store";
import {
  beginOwnTotpEnrollment,
  hashPassword,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { accountPurposeKey, resolveAccountKey } from "../account-key.js";
import { afterEach, beforeEach, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { recordSale } from "@waitron/core";
import { deployment, locations, nodes, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor } from "@waitron/migrations";
import { orderedMigrationSets, withOperationAuthority } from "@waitron/module";
import { locationId, nodeId, seriesId } from "@waitron/shared";
import { certificate } from "@waitron/server-kit/certificate.js";
import { activateAllocation } from "@waitron/fiscal-verifactu/src/allocation.js";
import {
  withHourAdmission,
  type FiscalAllocation,
  type RecoveryApproval,
} from "@waitron/fiscal-verifactu/src/allocation-envelope.js";
import { encodeHourIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { sealAeatSecret } from "@waitron/fiscal-verifactu/src/provisioning-secret.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { buildManifest } from "../backup-manifest.js";
import { assembleArchiveEntries, collectStateParts } from "../archive-entries.js";
import { packArchive, type ArchiveEntry } from "../backup-archive.js";
import { encryptArtifactAsync } from "../artifact-cipher.js";
import { buildBackupVerificationTarget } from "../backup-verification-target.js";
import type { BackupVerificationRequest } from "../backup-verification-protocol.js";
import type { BackupVerificationDeps } from "../backup-verification.js";

export const verificationNode = {
  nodeId: nodeId("20000000-0000-4000-8000-000000000002"),
  locationId: locationId("10000000-0000-4000-8000-000000000001"),
};
export const verificationTime = "2026-10-20T12:00:00.000Z";
const vault = Buffer.alloc(32, 19).toString("base64");
const key = "disposable-verification-archive-key";
const bases = [
  { code: "A", purpose: "standard" },
  { code: "R", purpose: "rectificative" },
];
const pair = forge.pki.rsa.generateKeyPair(2048);
const issuer = { cn: "Verification fixture CA", key: pair.privateKey };
const validity = { notBefore: new Date("2026-01-01Z"), notAfter: new Date("2030-01-01Z") };
const ca = certificate(issuer.cn, pair, issuer, "01", validity, [
  { name: "basicConstraints", cA: true },
]);
const server = certificate("verification.test", pair, issuer, "02", validity, [
  { name: "basicConstraints", cA: false },
]);
const candidate = makeAuthority().issue();
const runtime = {
  release: "authority-test",
  revision: "a".repeat(40),
  fingerprint: "b".repeat(64),
};

function ident(name: string) {
  return '"' + name.replaceAll('"', '""') + '"';
}
export function logicalDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      (
        db.prepare("select name from sqlite_schema where type='table' order by name").all() as {
          name: string;
        }[]
      ).map(({ name }) => {
        const statement = db.prepare(`select * from ${ident(name)}`);
        statement.setReadBigInts(true);
        const rows = statement
          .all()
          .map((row) =>
            JSON.stringify(row, (_key, value: unknown) =>
              typeof value === "bigint"
                ? { integer: String(value) }
                : value instanceof Uint8Array
                  ? { bytes: Buffer.from(value).toString("hex") }
                  : value,
            ),
          )
          .sort();
        return [name, rows];
      }),
    );
  } finally {
    db.close();
  }
}

export function useBackupVerificationFixture() {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null),
  });
  const roots: string[] = [];
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(verificationTime) }));
  afterEach(async () => {
    vi.useRealTimers();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });
  async function activate(hour: number) {
    const issuedAt = new Date(Date.parse(verificationTime) - (3 - hour) * 3600000).toISOString();
    const allocation: FiscalAllocation = {
      version: 1,
      allocationId: `verification-hour-${hour}`,
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "production",
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
      eventId: `verification-event-${hour}`,
      operatorId: "fixture-administrator",
      sourceId: hour === 0 ? "first-setup:original" : "backup:original",
      targetNodeId: verificationNode.nodeId,
      oldMachineOffline: hour !== 0,
      oldMachineAbsent: hour === 0,
      noParallelRecovery: true,
      confirmedAt: issuedAt,
      incidentEvidence: `fixture-incident-${hour}`,
    };
    const binding = {
      module: "fiscal-verifactu",
      action: hour === 0 ? "setup" : "re-register",
      eventId: approval.eventId,
      sourceId: approval.sourceId,
      targetNodeId: verificationNode.nodeId,
    };
    return withOperationAuthority(binding, approval.operatorId, (authority) =>
      withHourAdmission(
        { binding, authority, input: { allocation, approval } },
        { requiredBases: bases, priorActivation: "none" },
        (evidence) =>
          withTransaction(suite.db, (tx) =>
            activateAllocation(tx, verificationNode, allocation, approval, {
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
  async function create() {
    const root = await mkdtemp(join(tmpdir(), "a850-authority-"));
    roots.push(root);
    const stateDir = join(root, "source-state"),
      scratchRoot = join(root, "scratch");
    await mkdir(scratchRoot);
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Fixture restaurant" });
    await suite.db.insert(locations).values({
      id: verificationNode.locationId,
      name: "Fixture location",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant service",
    });
    await suite.db.insert(nodes).values({
      id: verificationNode.nodeId,
      locationId: verificationNode.locationId,
      name: "Source node",
    });
    await suite.db.insert(deployment).values({ id: 1, environment: "production" });
    const clock = {
      ...steadyClock,
      now: () => ({ ...steadyClock.now(), instant: new Date(verificationTime) }),
    };
    const backend = new VerifactuBackend({
      db: suite.db,
      clock,
      environment: "production",
      deploymentEnvironment: "production",
      resolveClient: async () => {
        throw new Error("fixture must not contact AEAT");
      },
    });
    for (const hour of [0, 1]) {
      const activation = await activate(hour);
      for (let number = 0; number < 2; number++)
        await withTransaction(suite.db, (tx) =>
          recordSale(
            tx,
            backend,
            saleInput({
              nodeId: verificationNode.nodeId,
              seriesId: seriesId(activation.series.find((s) => s.purpose === "standard")!.id),
              clock,
              locale: "en",
              invoiceLocales: ["en"],
              lines: [
                {
                  lineNo: 1,
                  name: "Fixture meal",
                  descriptions: { en: "Fixture meal" },
                  quantity: "1",
                  unitPrice: "10.00",
                  vatRate: "10.00",
                  lineTotal: "10.00",
                },
              ],
              total: "11.00",
              settlement: {
                kind: "immediate",
                tenders: [
                  {
                    method: "cash",
                    amount: "11.00",
                    tipAmount: "0.00",
                    settledAt: new Date(verificationTime),
                  },
                ],
              },
            }),
          ),
        );
    }
    await activate(2);
    await sealAeatSecret(
      {
        db: suite.db,
        ring: loadKeyRing({ WAITRON_CREDENTIALS_KEY: vault }),
        nodeId: verificationNode.nodeId,
        now: () => new Date(verificationTime),
      },
      {
        pfxBase64: candidate.pfx.toString("base64"),
        passphrase: candidate.passphrase,
        certKind: "sello",
      },
    );
    const [person] = await suite.db
      .insert(persons)
      .values({
        displayName: "Fixture manager",
        email: "manager@example.test",
        passwordHash: hashPassword("fixture-only-password"),
        role: "manager",
      })
      .returning();
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: person!.id }),
    );
    const env = { WAITRON_CREDENTIALS_KEY: vault };
    const accountKey = resolveAccountKey(env, loadKeyRing(env));
    await withTransaction(suite.db, (tx) =>
      beginOwnTotpEnrollment(tx, {
        managementSessionId: session.token,
        currentPassword: "fixture-only-password",
        keyRing: { current: { version: 1, key: accountPurposeKey(accountKey, "totp") } },
      }),
    );
    const files: Record<string, string> = {
      "secrets.env": `WAITRON_CREDENTIALS_KEY=${vault}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
      "trading.env": `WAITRON_TILL_NODE_ID=${verificationNode.nodeId}\nWAITRON_TILL_LOCATION_ID=${verificationNode.locationId}\nWAITRON_ENV=production\n`,
      "tls/ca.crt": forge.pki.certificateToPem(ca),
      "tls/ca.key": forge.pki.privateKeyToPem(pair.privateKey),
      "tls/server.crt": forge.pki.certificateToPem(server),
      "tls/server.key": forge.pki.privateKeyToPem(pair.privateKey),
    };
    for (const [name, value] of Object.entries(files)) {
      await mkdir(dirname(join(stateDir, name)), { recursive: true });
      await writeFile(join(stateDir, name), value);
    }
    const historyName = "module-evidence/fiscal-verifactu/hour-history.json";
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal-verifactu")!;
    const history = fiscal.backup!.nonDbState!.find((s) => s.kind === "preparation-history")!;
    if (history.kind !== "preparation-history") throw new Error("missing hour history source");
    const retained = history.project({
      preparations: [],
      retained: [
        {
          reference: "prepared-hours",
          complete: true,
          records: [
            {
              reference: "intent/fiscal-verifactu/retired",
              kind: "intent",
              taxpayerNif: "89890001K",
              environment: "production",
              softwareId: "W1",
              nodeId: "retired-node",
              identity: encodeHourIdentity(Date.parse(verificationTime) - 4 * 3600000),
              recordedAtMs: Date.parse(verificationTime) - 4 * 3600000,
            },
          ],
        },
      ],
    });
    await mkdir(dirname(join(stateDir, historyName)), { recursive: true });
    await writeFile(join(stateDir, historyName), JSON.stringify(retained));
    const databasePath = join(root, "source.db");
    await suite.db.archiveTo(databasePath);
    const manifest = await buildManifest({
      db: suite.db,
      modules: ALL_MODULES,
      environment: "production",
      now: new Date(verificationTime),
    });
    const entries = assembleArchiveEntries(
      manifest,
      await readFile(databasePath),
      await collectStateParts({ stateDir, venueDir: root, modules: ALL_MODULES, resolvers: {} }),
    );
    const target = buildBackupVerificationTarget({
      modules: ALL_MODULES,
      migrationsRoot: null,
      runtime,
    });
    const request: BackupVerificationRequest = {
      protocol: "backup-data-restore/v1",
      captureId: "capture-authority",
      pointId: "capture-authority",
      venueId: "venue-test",
      sourceInstallationId: "source-installation",
      sourceNodeId: verificationNode.nodeId,
      capturedAt: verificationTime,
      archive: {
        sha256: "c".repeat(64),
        bytes: 1,
        manifestVersion: 1,
        environment: "production",
        modules: manifest.modules,
      },
      backupKey: { version: 1, reference: "key-1" },
      target,
      verifierImage: "registry.example/waitron@sha256:" + "d".repeat(64),
      attempt: {
        jobId: "job-authority",
        number: 1,
        claimId: "claim-authority",
        controllerScope: "controller-test",
        childToken: "child-authority",
        deadline: new Date(Date.parse(verificationTime) + 30000).toISOString(),
      },
    };
    const deps: BackupVerificationDeps = {
      artifactPath: join(root, "input.enc"),
      recoveryKey: { ...request.backupKey, secret: key },
      scratchRoot,
      modules: ALL_MODULES,
      migrationsRoot: null,
      runtime,
      signal: new AbortController().signal,
      now: () => new Date(verificationTime),
    };
    async function seal(next: readonly ArchiveEntry[] = entries) {
      const bytes = await encryptArtifactAsync(packArchive([...next]), key);
      await writeFile(deps.artifactPath, bytes);
      request.archive.sha256 = createHash("sha256").update(bytes).digest("hex");
      request.archive.bytes = bytes.length;
      return bytes;
    }
    async function corrupt(run: (db: DatabaseSync) => void) {
      const path = join(root, "extracted.db");
      await writeFile(path, entries.find((e) => e.name === "db.dump")!.bytes);
      const db = new DatabaseSync(path);
      try {
        db.exec("pragma foreign_keys=off; pragma ignore_check_constraints=on");
        const triggers = db
          .prepare("select name,sql from sqlite_schema where type='trigger'")
          .all() as { name: string; sql: string }[];
        for (const t of triggers) db.exec(`drop trigger ${ident(t.name)}`);
        run(db);
        for (const t of triggers) db.exec(t.sql);
      } finally {
        db.close();
      }
      const damaged = await readFile(path);
      await seal(entries.map((e) => (e.name === "db.dump" ? { ...e, bytes: damaged } : e)));
    }
    await seal();
    return {
      root,
      stateDir,
      databasePath,
      entries,
      request,
      deps,
      seal,
      logical: logicalDatabase(databasePath),
      corrupt,
      db: suite.db,
    };
  }
  return { create };
}
export type BackupVerificationFixture = Awaited<
  ReturnType<ReturnType<typeof useBackupVerificationFixture>["create"]>
>;

export async function querySnapshot(query: BackupQuery) {
  const answer: Record<string, string[]> = {};
  for await (const { name } of query.rows(
    "select name from sqlite_schema where type='table' order by name",
  )) {
    if (typeof name !== "string") throw new Error("invalid table name");
    const rows: string[] = [];
    for await (const row of query.rows(`select * from "${name.replaceAll('"', '""')}"`))
      rows.push(
        JSON.stringify(row, (_key, value: unknown) =>
          typeof value === "bigint"
            ? { integer: String(value) }
            : value instanceof Uint8Array
              ? { bytes: Buffer.from(value).toString("hex") }
              : value,
        ),
      );
    answer[name] = rows.sort();
  }
  return answer;
}
