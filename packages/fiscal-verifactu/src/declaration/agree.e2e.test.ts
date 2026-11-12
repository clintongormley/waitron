// Weaker than its name for 1.b) and 1.c). For 1.b) the test registers the node under
// `WAITRON_ID_SISTEMA` itself, so it does not check the code a real setup registers. For 1.c) the
// first case gives the record and the declaration the same `softwareVersion()`, so they cannot
// disagree; the second stubs a bundle stamped `1.2.3` and checks the recorded sale's version against
// the declaration prepared for `1.2.3`, building no bundle and reading no committed `v1.2.3.md`.
import { eq } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SistemaInformatico } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../../test/migrations.js";
import { seedTenantWithSif } from "../../test/fixtures.js";
import { declarationSourceFor, testProducer as producer } from "../../test/declaration.js";
import {
  fakeClient,
  saleInput,
  staticResolver,
  steadyClock,
} from "../../test/write-path-fixtures.js";
import { VerifactuBackend } from "../backend.js";
import { registrosFacturacion } from "../schema/registros.js";
import { WAITRON_ID_SISTEMA } from "../software.js";
import { runningIdentity, softwareVersion } from "../software-identity.js";
import { fillProducer } from "./render.js";
import { declarationItems } from "./source.js";

const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

const SI_NO = { S: "S - Sí", N: "N - No" } as const;

interface RecordWriter {
  VerifactuBackend: typeof VerifactuBackend;
  runningIdentity: typeof runningIdentity;
}

async function recordedSoftware(
  writer: RecordWriter = { VerifactuBackend, runningIdentity },
): Promise<SistemaInformatico> {
  vi.stubEnv("WAITRON_PRODUCER_NAME", producer.name);
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", producer.taxId);
  vi.stubEnv("WAITRON_PRODUCER_ADDRESS", producer.address);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const { nodeId, seriesId } = await seedTenantWithSif(pg.db, {
    idSistemaInformatico: WAITRON_ID_SISTEMA,
  });
  const backend = new writer.VerifactuBackend({
    deploymentEnvironment: "preproduction",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
    identity: writer.runningIdentity("preproduction"),
  });
  const { saleId } = await withTransaction(pg.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId })),
  );
  const [row] = await pg.db
    .select({ sistemaInformatico: registrosFacturacion.sistemaInformatico })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.saleId, saleId));
  return row!.sistemaInformatico as SistemaInformatico;
}

function declaredItems(version: string): ReadonlyMap<string, string> {
  return declarationItems(fillProducer(declarationSourceFor(version), producer));
}

it("says what a recorded sale's software block says", async () => {
  const record = await recordedSoftware();

  const items = declaredItems(softwareVersion());
  const declared = ["1.a", "1.b", "1.c", "1.e", "1.f", "1.h", "1.i"].map((item) => [
    item,
    items.get(item),
  ]);

  expect(Object.fromEntries(declared)).toEqual({
    "1.a": record.NombreSistemaInformatico,
    "1.b": record.IdSistemaInformatico,
    "1.c": record.Version,
    "1.e": SI_NO[record.TipoUsoPosibleSoloVerifactu],
    "1.f": SI_NO[record.TipoUsoPosibleMultiOT],
    "1.h": record.NombreRazon,
    "1.i": record.NIF,
  });
});

it("records the release version the declaration prepared for that release names", async () => {
  vi.stubGlobal("__WAITRON_RELEASE_VERSION__", { version: "1.2.3" });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  // The stamp is read when software-identity.ts loads, so the writer is loaded afresh under it.
  vi.resetModules();
  const record = await recordedSoftware({
    VerifactuBackend: (await import("../backend.js")).VerifactuBackend,
    runningIdentity: (await import("../software-identity.js")).runningIdentity,
  });

  const items = declaredItems("1.2.3");

  expect(items.get("1.c")).toBe("1.2.3");
  expect(record.Version).toBe(items.get("1.c"));
});
