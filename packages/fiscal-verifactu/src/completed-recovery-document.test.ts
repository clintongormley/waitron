import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  deployment,
  invoiceSeries,
  tenants,
  locations,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_RECOVERY_PACK_PAGE } from "./completed-recovery-document.js";
import { recoveryDocumentBytes } from "./recovery-document.js";
import { serverKeyPage } from "./server-key-page.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { registroSif } from "./schema/sif.js";
import { cadenas } from "./schema/cadenas.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { locationId } from "@waitron/shared";

const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((m) => ["core", "fiscal-verifactu"].includes(m.name)),
    null,
  ),
});
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const nodeKey = {
  nodeId: node.nodeId,
  name: "2026-10-18 · TEST",
  secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
};
const row = {
  reference: "earlier-setup",
  kind: "intent",
  taxpayerNif: "89890001K",
  environment: "preproduction",
  softwareId: "W2",
  nodeId: node.nodeId,
  identity: "0CNRC",
  recordedAtMs: Date.parse("2026-10-16T13:00:00Z"),
};
beforeEach(async () => {
  await seedTenants(suite.db);
  await stampDeployment(suite.db, "preproduction");
  for (const [nodeId, code] of [
    [node.nodeId, "0CNNW"],
    [TENANT_A.nodeId2, "0CNPG"],
  ] as const) {
    await seedFixtureSif(suite.db, {
      nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: code,
    });
    await suite.db.insert(invoiceSeries).values(
      [
        { code: `A-${code}`, purpose: "standard" as const },
        { code: `FF-${code}`, purpose: "full" as const },
        { code: `R-${code}`, purpose: "rectificative" as const },
      ].map((value) => ({ ...value, nodeId, nextNumber: 123 })),
    );
  }
  await suite.db
    .update(registroSif)
    .set({ revocadoEn: new Date("2026-10-16T12:30:00Z") })
    .where(eq(registroSif.nodeId, TENANT_A.nodeId2));
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: new Date("2026-10-16T12:30:00Z") })
    .where(eq(invoiceSeries.nodeId, TENANT_A.nodeId2));
});
async function snapshot() {
  return {
    series: await suite.db.select().from(invoiceSeries),
    sifs: await suite.db.select().from(registroSif),
    chains: await suite.db.select().from(cadenas),
    allocations: await suite.db.select().from(fiscalAllocations),
  };
}
describe("the pack's server-key page seat", () => {
  const evidence = {
    "hour-history": { reference: "prepared-hours", complete: true, records: [row] },
  };
  const keyInForce = { nodeId: node.nodeId, name: "2026-09-02 · OLD" };
  const newKey = { name: nodeKey.name, secret: nodeKey.secret };
  const scope = {
    kind: "waitron-recovery-document" as const,
    version: 1 as const,
    scope: { taxpayerNif: "89890001K", softwareId: "W1", environment: "preproduction" as const },
    taxpayerName: "Waitron SL",
    venueName: "Local principal",
    createdAt: "2026-10-18T12:00:00.000Z",
  };
  function page(
    options: {
      locale?: "en" | "es";
      newKey?: typeof newKey;
      keyInForce?: typeof keyInForce;
      evidence?: Record<string, unknown>;
      target?: typeof node;
    } = {},
  ) {
    return withTransaction(suite.db, (tx) =>
      FISCAL_RECOVERY_PACK_PAGE(tx, options.target ?? node, {
        keyInForce: options.keyInForce ?? keyInForce,
        ...(options.newKey ? { newKey: options.newKey } : {}),
        createdAt: "2026-10-18T12:00:00.000Z",
        locale: options.locale ?? "en",
        evidence: options.evidence ?? evidence,
      }),
    );
  }

  // A1301: deleted with cfg in S18
  it("names the venue without reading the supplied location scope", async () => {
    const result = await page({
      target: { ...node, locationId: locationId("a0000000-0000-4000-8000-000000000091") },
      newKey,
    });
    expect(result.keyFile).toEqual({ ...scope, nodeKey });
  });
  it("refuses a missing venue with venue.not_found", async () => {
    await suite.db.execute(sql`pragma foreign_keys = off`);
    try {
      await suite.db.delete(locations);
      await expect(page()).rejects.toMatchObject({ code: "venue.not_found" });
    } finally {
      await suite.db.execute(sql`pragma foreign_keys = on`);
    }
  });
  it.each(["en", "es"] as const)(
    "with a new key (%s) draws that key and returns its key file, changing no fiscal state",
    async (locale) => {
      const before = await snapshot();
      const result = await page({ locale, newKey });
      const keyFile = { ...scope, nodeKey };
      expect(result.page).toEqual(serverKeyPage(keyFile, { locale, timeZone: "Europe/Madrid" }));
      expect(result.keyFile).toEqual(keyFile);
      expect(recoveryDocumentBytes(result.keyFile as typeof keyFile)).toEqual(
        recoveryDocumentBytes(keyFile),
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it("without a new key describes the key in force and returns no key file", async () => {
    const result = await page();
    expect(result).toEqual({
      page: serverKeyPage(
        { ...scope, nodeKey: keyInForce },
        { locale: "en", timeZone: "Europe/Madrid" },
      ),
    });
    expect(result.page).not.toHaveProperty("secret");
  });

  it("draws in the saved venue's time zone", async () => {
    await suite.db
      .update(locations)
      .set({ timeZone: "Atlantic/Canary" })
      .where(eq(locations.id, node.locationId));
    const result = await page({ newKey });
    expect(result.page.rows.at(-1)).toEqual({
      label: "Created",
      value: "18 October 2026, 13:00 WEST",
    });
  });

  const refusals: [string, () => Promise<unknown>][] = [
    ["damaged history", async () => ({ evidence: { "hour-history": null } })],
    [
      "contradicting history",
      async () => ({
        evidence: {
          "hour-history": {
            reference: "prepared-hours",
            complete: true,
            records: [{ ...row, identity: "wrong" }],
          },
        },
      }),
    ],
    [
      "a missing environment stamp",
      async () => {
        await suite.db.delete(deployment);
        return {};
      },
    ],
    [
      "a taxpayer whose NIF is not the invoice system's",
      async () => {
        await suite.db.update(tenants).set({ taxId: "B12345674" });
        return {};
      },
    ],
    [
      "a key held for another node",
      async () => ({ keyInForce: { ...keyInForce, nodeId: TENANT_A.nodeId2 } }),
    ],
  ];
  for (const withNewKey of [false, true])
    it.each(refusals)(
      `refuses %s (new key: ${withNewKey}), with the seat's own code`,
      async (_name, arrange) => {
        const options = (await arrange()) as Parameters<typeof page>[0];
        const before = await snapshot();
        await expect(page({ ...options, ...(withNewKey ? { newKey } : {}) })).rejects.toMatchObject(
          { code: "sif.allocation_invalid", params: { reason: "history_invalid" } },
        );
        expect(await snapshot()).toEqual(before);
      },
    );
});
