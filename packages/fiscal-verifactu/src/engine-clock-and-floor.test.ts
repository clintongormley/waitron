import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { sql } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { nodes, withTransaction, captureError, refusalOn, UNIQUE_VIOLATION } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedSoldRegistro } from "../test/fixtures.js";
import { readChainHead } from "./chain.js";

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });

const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;
const NODE = brandNodeId("11111111-1111-4111-8111-111111111111");
/** An instant no clock reading taken during the test can precede. */
const STARTED_AT = Date.now() - 1;

beforeEach(async () => {
  await withTransaction(venue.db, async (tx) => {
    await seedVenue(tx, {
      name: "Sala",
      invoiceLocales: ["es"],
    });
    await tx.insert(nodes).values({ id: NODE, name: "Caja" });
  });
});

afterEach(() => vi.useRealTimers());

describe("supplied installation identities", () => {
  it("keeps the supplied identity with a clock far ahead", async () => {
    vi.setSystemTime(new Date("2039-01-01T00:00:00.000Z"));
    const result = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
    );
    expect(result.numeroInstalacion).toBe("P000042");
  });
  it("keeps the supplied identity when the clock moves backwards", async () => {
    await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
    );
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const result = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000043" }),
    );
    expect(result.numeroInstalacion).toBe("P000043");
  });
  it("refuses reuse of a supplied identity despite a different clock", async () => {
    await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
    );
    vi.setSystemTime(new Date("2039-01-01T00:00:00.000Z"));
    const error = await captureError(() =>
      withTransaction(venue.db, (tx) =>
        registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
      ),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "verifactu_identities",
        columns: ["nif", "id_sistema_informatico", "numero_instalacion"],
      }),
    ).toBe(true);
  });
});

describe("registerSif stamps the clock", () => {
  it("revokes the identity it replaces, stamping a readable moment on the old row only", async () => {
    const first = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE }),
    );
    const second = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE }),
    );

    const rows = venue.db.all<{ id: string; revocado_en: string | null }>(
      sql`select id, revocado_en from verifactu_identities order by numero_instalacion`,
    );
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows[1]!.revocado_en).toBeNull();
    const revoked = rows[0]!.revocado_en;
    expect(revoked).not.toBeNull();
    expect(new Date(revoked!).getTime()).toBeGreaterThanOrEqual(STARTED_AT);
  });

  it("keeps the record position and starts a fresh chain after activating another identity", async () => {
    const first = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE }),
    );
    const huella = "A".repeat(64);
    await seedSoldRegistro(venue.db, {
      nodeId: NODE,
      sifId: first.id,
      nif: SIF.nif,
      secuencia: 7,
      huella,
    });
    const head = () => withTransaction(venue.db, (tx) => readChainHead(tx, NODE));
    expect(await head()).toMatchObject({ secuencia: 7, ultimaHuella: huella });

    await withTransaction(venue.db, (tx) => registerSif(tx, { ...SIF, nodeId: NODE }));

    expect(await head()).toEqual({ secuencia: 7, ultimoRegistroId: null, ultimaHuella: null });
  });
});
