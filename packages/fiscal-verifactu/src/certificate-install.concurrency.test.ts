import { randomBytes } from "node:crypto";
import { credentialRevision, loadKeyRing, type KeyRing } from "@waitron/credentials";
import { recordSale } from "@waitron/core";
import { sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  makeAuthority,
  mtlsMaterialFor,
  SIN_DATOS_BODY,
  startAnsweringServer,
  type AnsweringServer,
} from "../test/certificate-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { aeatClientResolver, mtlsFetch } from "./aeat-transport.js";
import { VerifactuBackend } from "./backend.js";
import { installCertificate } from "./certificate-install.js";
import { sealAeatSecret } from "./provisioning-secret.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });

const authority = makeAuthority();
const oldCert = authority.issue();
const newCert = authority.issue({ commonName: "NEW CERT" });
const NOW = new Date("2026-10-18T11:00:00Z");
const NIF = "89890001K";

const servers: AnsweringServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function testRing(): KeyRing {
  return loadKeyRing({
    WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
}

function bodyOf(file: { pfx: Buffer; passphrase: string }, expectedRevision: string | null) {
  return {
    pfxBase64: file.pfx.toString("base64"),
    passphrase: file.passphrase,
    certKind: "sello",
    expectedRevision,
  };
}

function revision(): Promise<string | null> {
  return withTransaction(suite.db, (tx) => credentialRevision(tx, { purpose: "fiscal.aeat" }));
}

describe("installCertificate beside the sale path", () => {
  it("a sale commits while the live check is held open", async () => {
    const { locationId, nodeId, seriesId } = await seedTenantWithSif(suite.db, { nif: NIF });
    const ring = testRing();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let arrived!: () => void;
    const requestArrived = new Promise<void>((resolve) => (arrived = resolve));
    const server = await startAnsweringServer(authority, {
      status: 200,
      body: SIN_DATOS_BODY,
      hold,
      onRequest: () => arrived(),
    });
    servers.push(server);

    const install = installCertificate(
      {
        db: suite.db,
        ring,
        nodeId,
        locationId,
        environment: "preproduction",
        authorize: async () => ({ personId: "p-1" }),
        transport: {
          endpointFor: () => server.origin,
          fetchFor: (material) => mtlsFetch(material, authority.caPem),
        },
      },
      bodyOf(newCert, null),
      NOW,
    );
    // Released in `finally`, so a failed expectation cannot leave the install pending.
    try {
      await requestArrived;

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
      expect(sale?.id).toBe(saleId);
    } finally {
      release();
    }

    await expect(install).resolves.toMatchObject({ outcome: "installed" });
  });

  it("a pass that resolved its client before the install keeps the old certificate, and the next pass uses the new one", async () => {
    const { locationId, nodeId } = await seedTenantWithSif(suite.db, { nif: NIF });
    const ring = testRing();
    await sealAeatSecret(
      { db: suite.db, ring, nodeId, now: () => new Date("2026-10-18T10:00:00Z") },
      bodyOf(oldCert, null),
    );
    const server = await startAnsweringServer(authority, { status: 200, body: SIN_DATOS_BODY });
    servers.push(server);
    const transportDeps = {
      db: suite.db,
      ring,
      endpointFor: () => server.origin,
      fetchFor: (m: Parameters<typeof mtlsFetch>[0]) => mtlsFetch(m, authority.caPem),
    };
    const header = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF } };
    const filter = { Ejercicio: "2026", Periodo: "10" };

    const running = aeatClientResolver(transportDeps);
    const clientA = await running.resolve();
    try {
      await expect(
        installCertificate(
          {
            db: suite.db,
            ring,
            nodeId,
            locationId,
            environment: "preproduction",
            authorize: async () => ({ personId: "p-1" }),
            transport: transportDeps,
          },
          bodyOf(newCert, await revision()),
          NOW,
        ),
      ).resolves.toMatchObject({ outcome: "installed" });

      await clientA.consultar(header, filter);
      expect(server.sawClientCn()).toBe(mtlsMaterialFor(authority, oldCert).clientCn);
    } finally {
      await running.closeAll();
    }

    const next = aeatClientResolver(transportDeps);
    try {
      await (await next.resolve()).consultar(header, filter);
      expect(server.sawClientCn()).toBe("NEW CERT");
    } finally {
      await next.closeAll();
    }
  });
});
