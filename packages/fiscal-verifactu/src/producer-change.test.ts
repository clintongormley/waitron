import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { SistemaInformatico } from "@waitron/verifactu";
import { captureError } from "@waitron/db";
import type { IdentityChangeNote } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { appendToChain } from "./chain.js";
import { refuseProducerChange } from "./producer-change.js";
import { registerSif } from "./registro-sif.js";
import { PRODUCER_PENDING, SOFTWARE_IDENTITY, softwareVersion } from "./software-identity.js";
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
    sql`select nif, numero_instalacion from verifactu_identities where node_id = ${node.nodeId} and revocado_en is null`,
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

  it("passes a node with no records, and does not create a record", async () => {
    const node = await seedNode(suite.db);

    await expect(
      check(node, running({ name: "PRODUCER PERSON", nif: "11111111H" })),
    ).resolves.toBeUndefined();
    const rows = suite.db.all(sql`select 1 from verifactu_records where node_id = ${node.nodeId}`);
    expect(rows).toHaveLength(0);
  });

  it("passes a chain whose head a new installation emptied", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);
    const [sif] = suite.db.all<{ nif: string }>(
      sql`select nif from verifactu_identities where node_id = ${node.nodeId} and revocado_en is null`,
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
      sql`select sistema_informatico as software from verifactu_records where node_id = ${node.nodeId}`,
    );
    expect(JSON.parse(stored!.software)).toMatchObject({ IDOtro: { ID: "FR00000000000" } });
    expect(JSON.parse(stored!.software)).not.toHaveProperty("NIF");

    const error = await captureError(() =>
      check(node, running({ name: "PRODUCER PERSON", nif: "00000000T" })),
    );

    expect(error).toMatchObject({ code: "sif.producer_changed" });
  });
});

describe("refuseProducerChange with an upgrade's note", () => {
  const OLD = FILED_UNDER.NIF;
  const NEW = "11111111H";
  const note = (overrides: Partial<IdentityChangeNote> = {}): IdentityChangeNote => ({
    release: softwareVersion(),
    producerTaxId: NEW,
    fromProducerTaxId: OLD,
    ...overrides,
  });
  const checkWith = (
    node: SeededNode,
    naming: IdentityChangeNote,
    options: { producer?: SoftwareIdentity["producer"]; environment?: string } = {},
  ) =>
    suite.db.transaction((tx) =>
      refuseProducerChange(
        tx,
        node.nodeId,
        running(options.producer ?? { name: "PRODUCER PERSON", nif: NEW }),
        options.environment ?? "production",
        naming,
      ),
    );

  it("answers pending for a note naming this release, this producer and the head's", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    await expect(checkWith(node, note())).resolves.toBe("pending");
  });

  it.each([
    ["another release", { release: "9.9.9" }],
    ["another producer than the running one", { producerTaxId: "22222222J" }],
    ["another producer than the head's", { fromProducerTaxId: "22222222J" }],
  ])("refuses a note naming %s", async (_label, overrides) => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    const error = await captureError(() => checkWith(node, note(overrides)));

    expect(error).toMatchObject({ code: "sif.producer_changed" });
  });

  it("refuses a head filed under a foreign id", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1, {
      NombreRazon: "PRODUCER PERSON",
      NIF: undefined,
      IDOtro: { CodigoPais: "FR", IDType: "02", ID: "FR00000000000" },
    });

    const error = await captureError(() => checkWith(node, note()));

    expect(error).toMatchObject({ code: "sif.producer_changed" });
  });

  it("answers nothing pending once the head names the running producer", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1, { NombreRazon: "PRODUCER PERSON", NIF: NEW });

    await expect(checkWith(node, note())).resolves.toBeUndefined();
    await expect(checkWith(node, note({ fromProducerTaxId: NEW }))).resolves.toBeUndefined();
  });

  it("answers nothing pending on a chain with no records", async () => {
    const node = await seedNode(suite.db);

    await expect(checkWith(node, note())).resolves.toBeUndefined();
  });

  it("answers nothing pending outside production, or while no producer is set", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);

    await expect(
      checkWith(node, note(), { environment: "preproduction" }),
    ).resolves.toBeUndefined();
    await expect(checkWith(node, note(), { producer: PRODUCER_PENDING })).resolves.toBeUndefined();
  });

  it("refuses an invalid producer setting", async () => {
    const node = await seedNode(suite.db);
    const invalid = new AppError("sif.producer_invalid", {
      setting: "WAITRON_PRODUCER_TAX_ID",
      reason: "check_failed",
    });

    const error = await captureError(() => checkWith(node, note(), { producer: { invalid } }));

    expect(error).toBe(invalid);
  });

  it("reaches the backend's check", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      identity: running({ name: "PRODUCER PERSON", nif: NEW }),
    });
    const seat = (naming: IdentityChangeNote) =>
      suite.db.transaction((tx) => backend.checkFilingIdentity(tx, node.nodeId, naming));

    await expect(seat(note())).resolves.toEqual({ pending: true });
    expect(await captureError(() => seat(note({ release: "9.9.9" })))).toMatchObject({
      code: "sif.producer_changed",
    });
  });
});

describe("VerifactuBackend.checkFilingIdentity with a note that has nothing left to open", () => {
  const NEW = "11111111H";
  const answer = (
    node: SeededNode,
    overrides: Partial<IdentityChangeNote> | null = {},
    options: {
      producer?: SoftwareIdentity["producer"];
      environment?: "production" | "preproduction";
    } = {},
  ) => {
    const backend = new VerifactuBackend({
      deploymentEnvironment: options.environment ?? "production",
      clock: steadyClock,
      db: suite.db,
      identity: running(options.producer ?? { name: "PRODUCER PERSON", nif: NEW }),
    });
    const note = overrides && {
      release: softwareVersion(),
      producerTaxId: NEW,
      fromProducerTaxId: FILED_UNDER.NIF,
      ...overrides,
    };
    return suite.db.transaction((tx) => backend.checkFilingIdentity(tx, node.nodeId, note));
  };
  const filedUnderNew = async () => {
    const node = await seedNode(suite.db);
    await append(node, 1, { NombreRazon: "PRODUCER PERSON", NIF: NEW });
    return node;
  };

  it("answers leftover once the head names the running producer", async () => {
    await expect(answer(await filedUnderNew())).resolves.toEqual({ leftover: true });
  });

  it("answers leftover while the installation it opened holds no record", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);
    await expect(answer(node)).resolves.toEqual({ pending: true });
    const [sif] = suite.db.all<{ nif: string }>(
      sql`select nif from verifactu_identities where node_id = ${node.nodeId} and revocado_en is null`,
    );
    await suite.db.transaction((tx) =>
      registerSif(tx, {
        nodeId: node.nodeId,
        nif: sif!.nif,
        idSistemaInformatico: "WT",
        numeroInstalacion: "second",
      }),
    );
    await expect(answer(node)).resolves.toEqual({ leftover: true });
  });

  it("answers leftover outside production, where nothing is ever opened", async () => {
    const node = await seedNode(suite.db);
    await append(node, 1);
    await expect(answer(node, {}, { environment: "preproduction" })).resolves.toEqual({
      leftover: true,
    });
  });

  it.each([
    ["for a note naming another release", { release: "9.9.9" }, undefined],
    ["for a note naming another producer", { producerTaxId: "22222222J" }, undefined],
    ["with no note", null, undefined],
    ["while no producer is set", {}, PRODUCER_PENDING],
  ] as const)("answers nothing %s", async (_label, overrides, producer) => {
    await expect(answer(await filedUnderNew(), overrides, { producer })).resolves.toBeUndefined();
  });
});

describe("VerifactuBackend.checkFilingIdentity", () => {
  function backend(environment: "production" | "preproduction") {
    return new VerifactuBackend({
      deploymentEnvironment: environment,
      clock: steadyClock,
      db: suite.db,
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
