import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SistemaInformatico } from "@waitron/verifactu";
import { captureError } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { refuseProducerChange } from "./producer-change.js";
import { registerSif } from "./registro-sif.js";
import { PRODUCER_PENDING, SOFTWARE_IDENTITY } from "./software-identity.js";
import type { SoftwareIdentity } from "./software-identity.js";
import { altaFor, seedSale, seedNode, type SeededNode } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const FILED_UNDER = { NombreRazon: "PRODUCER PERSON", NIF: "00000000T" };

function running(producer: SoftwareIdentity["producer"]): SoftwareIdentity {
  return { ...SOFTWARE_IDENTITY, producer };
}

async function append(
  node: SeededNode,
  number: number,
  software: Record<string, unknown> = FILED_UNDER,
) {
  const sale = await seedSale(suite.db, node, number);
  const [sif] = suite.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from registro_sif where node_id = ${node.nodeId} and revocado_en is null`,
  );
  const pending = altaFor(node, sale, number, number);
  pending.input.SistemaInformatico = {
    ...pending.input.SistemaInformatico,
    IDOtro: undefined,
    ...software,
    NumeroInstalacion: sif!.numero_instalacion,
  } as SistemaInformatico;
  pending.input.IDEmisorFactura = sif!.nif;
  pending.input.NumSerieFactura = `${node.nodeId}/${number}`;
  return suite.db.transaction((tx) => appendToChain(tx, node.nodeId, pending));
}

function check(node: SeededNode, identity: SoftwareIdentity, environment = "production") {
  return suite.db.transaction((tx) => refuseProducerChange(tx, node.nodeId, identity, environment));
}

describe("refuseProducerChange", () => {
  it("refuses a production chain whose latest record names another producer's tax number", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    const error = await captureError(() =>
      check(node, running({ name: "PRODUCER PERSON", nif: "11111111H" })),
    );

    expect(error).toMatchObject({ code: "sif.producer_changed" });
  });

  it("passes when the latest record names the same tax number", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    await expect(
      check(node, running({ name: "PRODUCER PERSON", nif: "00000000T" })),
    ).resolves.toBeUndefined();
  });

  it("passes a different name under the same tax number", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    await expect(
      check(node, running({ name: "ANOTHER NAME", nif: "00000000T" })),
    ).resolves.toBeUndefined();
  });

  it("passes a node with no chain row, and does not make one", async () => {
    const node = await seedNode(suite.db);
    suite.db.run(sql`delete from cadenas where node_id = ${node.nodeId}`);

    await expect(
      check(node, running({ name: "PRODUCER PERSON", nif: "11111111H" })),
    ).resolves.toBeUndefined();
    const rows = suite.db.all(sql`select 1 from cadenas where node_id = ${node.nodeId}`);
    expect(rows).toHaveLength(0);
  });

  it("passes a chain whose head a new installation emptied", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);
    const [sif] = suite.db.all<{ nif: string }>(
      sql`select nif from registro_sif where node_id = ${node.nodeId} and revocado_en is null`,
    );
    await suite.db.transaction((tx) =>
      registerSif(tx, {
        nodeId: node.nodeId,
        nif: sif!.nif,
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
      }),
    );

    await expect(
      check(node, running({ name: "PRODUCER PERSON", nif: "11111111H" })),
    ).resolves.toBeUndefined();
  });

  it("passes a different tax number in preproduction", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    await expect(
      check(node, running({ name: "PRODUCER PERSON", nif: "11111111H" }), "preproduction"),
    ).resolves.toBeUndefined();
  });

  it("passes when no producer is set", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    await expect(check(node, running(PRODUCER_PENDING))).resolves.toBeUndefined();
  });

  it("refuses an invalid producer setting in production rather than compare it", async () => {
    const node = await seedNode(suite.db);
    const invalid = new AppError("sif.producer_invalid", {
      setting: "WAITRON_PRODUCER_TAX_ID",
      reason: "check_failed",
    });

    const error = await captureError(() => check(node, running({ invalid })));

    expect(error).toBe(invalid);
  });

  it("refuses an invalid producer setting in preproduction too", async () => {
    const node = await seedNode(suite.db);
    const invalid = new AppError("sif.producer_invalid", {
      setting: "WAITRON_PRODUCER_TAX_ID",
      reason: "check_failed",
    });

    const error = await captureError(() => check(node, running({ invalid }), "preproduction"));

    expect(error).toBe(invalid);
  });

  it("refuses a production chain whose latest record names a producer by a foreign id", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1, {
      NombreRazon: "PRODUCER PERSON",
      NIF: undefined,
      IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR00000000000" },
    });
    const [stored] = suite.db.all<{ software: string }>(
      sql`select sistema_informatico as software from registros_facturacion where node_id = ${node.nodeId}`,
    );
    expect(JSON.parse(stored!.software)).toMatchObject({ IDOtro: { ID: "FR00000000000" } });
    expect(JSON.parse(stored!.software)).not.toHaveProperty("NIF");

    const error = await captureError(() =>
      check(node, running({ name: "PRODUCER PERSON", nif: "00000000T" })),
    );

    expect(error).toMatchObject({ code: "sif.producer_changed" });
  });
});

describe("VerifactuBackend.checkFilingIdentity", () => {
  function backend(environment: "production" | "preproduction") {
    return new VerifactuBackend({
      deploymentEnvironment: environment,
      clock: steadyClock,
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
      identity: running({ name: "PRODUCER PERSON", nif: "11111111H" }),
    });
  }

  it("checks against the producer the backend files under, in its deployment", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    const error = await captureError(() =>
      suite.db.transaction((tx) => backend("production").checkFilingIdentity(tx, node.nodeId)),
    );
    expect(error).toMatchObject({ code: "sif.producer_changed" });
    await expect(
      suite.db.transaction((tx) => backend("preproduction").checkFilingIdentity(tx, node.nodeId)),
    ).resolves.toBeUndefined();
  });
});
