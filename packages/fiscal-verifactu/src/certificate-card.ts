import { credentialRevision } from "@waitron/credentials";
import { readTenant, withTransaction, type Database, type Transaction } from "@waitron/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { CertKind } from "./aeat-transport.js";
import { calendarDaysLeft, certificateStage, type CertificateStage } from "./certificate-dates.js";
import { normaliseTaxId } from "./certificate-file.js";
import { venueTimeZone } from "./certificate-install.js";
import { latestInstall } from "./certificate-record.js";
import { envios, registrosFacturacion } from "./schema/index.js";

export interface CertificateCard {
  revision: string | null;
  timeZone: string;
  installed: null | {
    kind: CertKind;
    organisation: string | null;
    taxId: string | null;
    taxIdMatches: boolean | null;
    issuer: string | null;
    validFrom: string;
    validUntil: string;
    daysLeft: number;
    stage: CertificateStage | null;
    installedAt: string;
    source: "setup" | "dashboard";
    installedByName: string | null;
    lastAcceptedAt: string | null;
  };
}

export interface CertificateCardDeps {
  db: Database;
  nodeId: string;
  locationId: string;
  authorize(tx: Transaction): Promise<void>;
  nameOf(tx: Transaction, personId: string): Promise<string | null>;
}

async function lastAcceptedSince(
  tx: Transaction,
  nodeId: string,
  since: Date,
): Promise<Date | null> {
  const [row] = await tx
    .select({ confirmadoEn: envios.confirmadoEn })
    .from(envios)
    .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
    .where(
      and(
        eq(registrosFacturacion.nodeId, nodeId),
        inArray(envios.estado, ["aceptado", "aceptado_con_errores"]),
        gte(envios.confirmadoEn, since),
      ),
    )
    .orderBy(desc(envios.confirmadoEn))
    .limit(1);
  return row?.confirmadoEn ?? null;
}

/** The facts the certificate card shows, read from the install row and the vault's revision; the
 * vault entry itself is never decrypted. */
export async function readCertificateCard(
  deps: CertificateCardDeps,
  now: Date,
): Promise<CertificateCard> {
  return withTransaction(deps.db, async (tx) => {
    await deps.authorize(tx);
    const revision = await credentialRevision(tx, { purpose: "fiscal.aeat" });
    const timeZone = await venueTimeZone(tx, deps.locationId);
    const row = await latestInstall(tx, deps.nodeId);
    if (row === null) return { revision, timeZone, installed: null };

    const tenant = await readTenant(tx);
    if (tenant === null) {
      throw new Error("tenants is empty: there is no taxpayer to match the certificate against");
    }
    const installedByName = row.personId === null ? null : await deps.nameOf(tx, row.personId);
    const lastAccepted = await lastAcceptedSince(tx, deps.nodeId, row.installedAt);
    return {
      revision,
      timeZone,
      installed: {
        kind: row.kind,
        organisation: row.organisation,
        taxId: row.taxId,
        taxIdMatches: row.taxId === null ? null : row.taxId === normaliseTaxId(tenant.taxId),
        issuer: row.issuer,
        validFrom: row.validFrom.toISOString(),
        validUntil: row.validUntil.toISOString(),
        daysLeft: calendarDaysLeft(now, row.validUntil, timeZone),
        stage: certificateStage(row.kind, now, row.validUntil, timeZone),
        installedAt: row.installedAt.toISOString(),
        source: row.source,
        installedByName,
        lastAcceptedAt: lastAccepted?.toISOString() ?? null,
      },
    };
  });
}
