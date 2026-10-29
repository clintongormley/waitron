import { recordSale } from "@waitron/core";
import { invoiceSeries, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { makeCertificateDiagnosisChild } from "./certificate-diagnosis-child.js";
import { diagnoseCertificate } from "./certificate-diagnosis.js";
import { diagnosticTransport } from "./certificate-diagnosis-transport.js";
import { mtlsFetch } from "./aeat-transport.js";
import { VerifactuBackend } from "./backend.js";
import { installCertificate } from "./certificate-install.js";
import { registrosFacturacion, cadenas } from "./schema/index.js";
import { startDiagnosticServer } from "../test/certificate-diagnosis-fixtures.js";
import {
  authority,
  candidate,
  material,
  NOW,
  parentFixture,
} from "../test/certificate-diagnosis-parent-fixtures.js";
import { SIN_DATOS_BODY } from "../test/certificate-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { credentialRevision, loadKeyRing } from "@waitron/credentials";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });
const servers: Awaited<ReturnType<typeof startDiagnosticServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server?.close()));
});

async function heldServer() {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = await startDiagnosticServer(authority, (_request, response) => {
    void hold.then(() => {
      response.writeHead(200);
      response.end(SIN_DATOS_BODY);
    });
  });
  servers.push(server);
  const child = makeCertificateDiagnosisChild({
    endpointFor: () => server.origin,
    transport: (m, options) => diagnosticTransport(m, { ...options, ca: authority.caPem }),
  });
  return {
    server,
    release,
    runChild: async (input, signal) => ({
      outcome: "completed" as const,
      value: await child(input, signal, () => {}),
    }),
  } satisfies {
    server: typeof server;
    release(): void;
    runChild: import("@waitron/fiscal").FiscalCertificateDiagnosisDeps["runChild"];
  };
}

describe("certificate diagnosis without a sale or install lock", () => {
  it("commits a real sale and its fiscal record, chain and invoice counter before the query answers", async () => {
    const { locationId, nodeId, seriesId } = await seedTenantWithSif(suite.db, {
      nif: "89890001K",
    });
    const held = await heldServer();
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 41).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    const diagnosis = diagnoseCertificate(
      {
        db: suite.db,
        ring,
        nodeId,
        locationId,
        environment: "preproduction",
        signal: new AbortController().signal,
        clock: () => NOW,
        authorize: async () => ({
          personId: "administrator",
          expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        }),
        runChild: held.runChild,
      },
      {
        schemaVersion: 1,
        source: "candidate",
        operation: "check",
        sourceGeneration: 1,
        expectedRevision: null,
        ...material(candidate, "representante"),
      },
      NOW,
    );
    try {
      await held.server.requestArrived;
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: steadyClock,
        db: suite.db,
        resolveClient: staticResolver(fakeClient),
      });
      const { saleId } = await withTransaction(suite.db, (tx) =>
        recordSale(tx, backend, saleInput({ nodeId, seriesId })),
      );
      const [sale] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
      expect(sale).toMatchObject({
        id: saleId,
        invoiceNumber: 1,
        fiscalState: "recorded",
        total: 1441,
      });
      const [record] = await suite.db
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.saleId, saleId));
      expect(record).toMatchObject({ saleId, secuencia: 1 });
      const [chain] = await suite.db.select().from(cadenas).where(eq(cadenas.nodeId, nodeId));
      expect(chain).toMatchObject({ ultimoRegistroId: record!.id, ultimaHuella: record!.huella });
      const [series] = await suite.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, seriesId));
      expect(series?.nextNumber).toBe(2);
    } finally {
      held.release();
    }
    await expect(diagnosis).resolves.toMatchObject({
      category: "query-completed",
      association: "not-applicable",
    });
    expect(held.server.requests()).toBe(1);
  });

  it("finishes a real install while diagnosis waits and refuses the old result as stale", async () => {
    const f = await parentFixture(suite.db);
    const held = await heldServer();
    const installServer = await startDiagnosticServer(authority, (_request, response) => {
      response.writeHead(200);
      response.end(SIN_DATOS_BODY);
    });
    servers.push(installServer);
    const diagnosis = diagnoseCertificate(
      { ...f.deps, runChild: held.runChild },
      { ...f.request, operation: "check" },
      NOW,
    );
    const stale = expect(diagnosis).rejects.toMatchObject({
      code: "fiscal.certificate_changed",
      params: {},
    });
    try {
      await held.server.requestArrived;
      await expect(
        installCertificate(
          {
            ...f.deps,
            transport: {
              endpointFor: () => installServer.origin,
              fetchFor: (m) => mtlsFetch(m, authority.caPem),
            },
          },
          { ...material(candidate, "representante"), expectedRevision: f.request.expectedRevision },
          NOW,
        ),
      ).resolves.toMatchObject({ outcome: "installed" });
      const current = await withTransaction(suite.db, (tx) =>
        credentialRevision(tx, { purpose: "fiscal.aeat" }),
      );
      expect(current).not.toBe(f.request.expectedRevision);
      expect(installServer.requests()).toBe(1);
    } finally {
      held.release();
    }
    await stale;
  });
});
