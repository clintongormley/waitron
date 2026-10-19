import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import type { CertKind } from "./aeat-transport.js";
import { seedTenantTillSif, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { certificateAlerts } from "./certificate-alerts.js";
import { recordInstall } from "./certificate-record.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

// 00:59 Madrid on 25 Oct 2026, the night Madrid leaves summer time.
const END = new Date("2026-10-24T22:59:00Z");

async function install(nodeId: string, kind: CertKind, validUntil = END): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordInstall(tx, {
      nodeId,
      installedAt: new Date("2026-01-02T09:00:00.000Z"),
      source: "setup",
      personId: null,
      kind,
      fingerprint: `fp-${nodeId}-${kind}`,
      organisation: "WAITRON SL",
      taxId: "89890001K",
      issuer: "Waitron test FNMT (Test FNMT)",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil,
      checkedEndpoint: null,
      checkedAt: null,
    }),
  );
}

function alertsAt(at: string, nodeId: string = TENANT_A.nodeId) {
  return withTransaction(suite.db, (tx) =>
    certificateAlerts(tx, { nodeId, locationId: TENANT_A.locationId }, new Date(at)),
  );
}

describe("certificateAlerts", () => {
  it("raises nothing when the node has no install", async () => {
    await seedTenantTillSif(suite.db);
    await expect(alertsAt("2026-10-24T23:00:00Z")).resolves.toEqual([]);
  });

  it("raises nothing for a representative certificate 61 days from its end", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId, "representante");
    await expect(alertsAt("2026-08-25T10:00:00Z")).resolves.toEqual([]);
  });

  it("warns 60 days before a representative certificate ends, since that day's local midnight", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId, "representante");
    await expect(alertsAt("2026-08-26T10:00:00Z")).resolves.toEqual([
      {
        key: "fiscal.certificate_expiring",
        code: "fiscal.certificate_expiring",
        params: { days: 60, date: "2026-10-25" },
        severity: "warning",
        since: "2026-08-25T22:00:00.000Z",
        screen: "venue-settings",
      },
    ]);
  });

  it("raises the same code as an error 14 days before a representative certificate ends", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId, "representante");
    await expect(alertsAt("2026-10-11T10:00:00Z")).resolves.toEqual([
      {
        key: "fiscal.certificate_expiring",
        code: "fiscal.certificate_expiring",
        params: { days: 14, date: "2026-10-25" },
        severity: "error",
        since: "2026-10-10T22:00:00.000Z",
        screen: "venue-settings",
      },
    ]);
  });

  it("says the certificate has expired from the instant it ends", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId, "representante");
    await expect(alertsAt("2026-10-24T23:00:00Z")).resolves.toEqual([
      {
        key: "fiscal.certificate_expired",
        code: "fiscal.certificate_expired",
        params: { date: "2026-10-25" },
        severity: "error",
        since: "2026-10-24T22:59:00.000Z",
        screen: "venue-settings",
      },
    ]);
  });

  it("warns 90 days before a seal certificate ends, and not the day before", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId, "sello");
    await expect(alertsAt("2026-07-26T10:00:00Z")).resolves.toEqual([]);
    await expect(alertsAt("2026-07-27T10:00:00Z")).resolves.toEqual([
      {
        key: "fiscal.certificate_expiring",
        code: "fiscal.certificate_expiring",
        params: { days: 90, date: "2026-10-25" },
        severity: "warning",
        since: "2026-07-26T22:00:00.000Z",
        screen: "venue-settings",
      },
    ]);
  });

  it("raises nothing for another node's expired certificate", async () => {
    await seedTenantTillSif(suite.db);
    await install("other-node", "representante");
    await expect(alertsAt("2026-10-24T23:00:00Z")).resolves.toEqual([]);
    await expect(alertsAt("2026-10-24T23:00:00Z", "other-node")).resolves.toHaveLength(1);
  });

  it("reads only the node's latest install", async () => {
    await seedTenantTillSif(suite.db);
    await install(TENANT_A.nodeId, "representante");
    await withTransaction(suite.db, (tx) =>
      recordInstall(tx, {
        nodeId: TENANT_A.nodeId,
        installedAt: new Date("2026-10-20T09:00:00.000Z"),
        source: "dashboard",
        personId: "p-1",
        kind: "sello",
        fingerprint: "fp-renewed",
        organisation: "WAITRON SL",
        taxId: "89890001K",
        issuer: "Waitron test FNMT (Test FNMT)",
        validFrom: new Date("2026-10-01T00:00:00Z"),
        validUntil: new Date("2028-10-01T00:00:00Z"),
        checkedEndpoint: "https://example.test",
        checkedAt: new Date("2026-10-20T09:00:00.000Z"),
      }),
    );
    await expect(alertsAt("2026-10-24T23:00:00Z")).resolves.toEqual([]);
  });
});
