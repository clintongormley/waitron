import { randomBytes } from "node:crypto";
import { credentialRevision, loadKeyRing } from "@waitron/credentials";
import { withTransaction, type Database } from "@waitron/db";
import type { FiscalCertificateDiagnosisDeps } from "@waitron/fiscal";
import {
  authorizeManager,
  persons,
  resolveManagementSession,
  startManagementSession,
} from "@waitron/identity";
import { sql } from "drizzle-orm";
import { makeCertificateDiagnosisChild } from "../src/certificate-diagnosis-child.js";
import type { CertificateDiagnosisRequest } from "../src/certificate-diagnosis-contract.js";
import { sealAeatSecret } from "../src/provisioning-secret.js";
import { makeAuthority } from "./certificate-fixtures.js";
import { seedTenantNodeSif, TENANT_A } from "./fixtures.js";

export const NOW = new Date("2026-10-18T11:00:00.000Z");
export const INSTALLED_AT = "2026-10-18T10:00:00.000Z";
export const authority = makeAuthority();
export const installed = authority.issue({ commonName: "installed private subject" });
export const candidate = authority.issue({ commonName: "candidate private subject" });
export const material = (file = installed, certKind: "sello" | "representante" = "sello") => ({
  pfxBase64: file.pfx.toString("base64"),
  passphrase: file.passphrase,
  certKind,
});

export function revision(db: Database) {
  return db.withWriteLock(() => credentialRevision(db, { purpose: "fiscal.aeat" }));
}

export async function parentFixture(db: Database, seal = true) {
  await seedTenantNodeSif(db);
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  if (seal) {
    await sealAeatSecret(
      { db, ring, nodeId: TENANT_A.nodeId, now: () => new Date(INSTALLED_AT) },
      material(),
    );
  }
  const session = await withTransaction(db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Private administrator",
        role: "admin",
      })
      .returning();
    return startManagementSession(tx, { personId: person!.id });
  });
  const child = makeCertificateDiagnosisChild();
  const controller = new AbortController();
  const deps: FiscalCertificateDiagnosisDeps = {
    db,
    ring,
    nodeId: TENANT_A.nodeId,
    locationId: TENANT_A.locationId,
    environment: "preproduction",
    signal: controller.signal,
    clock: () => NOW,
    authorize: async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: session.token,
        permission: "system.manage",
        touch: false,
      });
      const { expiresAt } = await resolveManagementSession(tx, session.token, { touch: false });
      return { personId: authorizedBy, expiresAt };
    },
    runChild: async (input, signal) => ({
      outcome: "completed",
      value: await child(input, signal, () => {}),
    }),
  };
  const request: CertificateDiagnosisRequest = {
    schemaVersion: 1,
    source: "installed",
    operation: "inspect",
    sourceGeneration: 7,
    expectedRevision: await revision(db),
  };
  return { deps, request, controller, session };
}

export async function rawState(db: Database) {
  return db.withWriteLock(async () => {
    const names = db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' order by name`,
    );
    const tables = Object.fromEntries(
      names.map(({ name }) => [
        name,
        db
          .all(sql`select * from ${sql.identifier(name)}`)
          .map((row) => JSON.stringify(row))
          .sort(),
      ]),
    );
    const writes = db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
    return { tables, writes };
  });
}
