import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { registrosFacturacion } from "./schema/registros.js";
import { makeVerifactuBackend } from "./slot.js";
import {
  PRODUCER_PENDING,
  SOFTWARE_IDENTITY,
  producerFields,
  refuseProducerSettings,
  runningProducer,
  softwareVersion,
  type SoftwareIdentity,
} from "./software-identity.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock("./hour-release.js");
  vi.resetModules();
});

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const pending: SoftwareIdentity = { ...SOFTWARE_IDENTITY, producer: PRODUCER_PENDING };
const filled: SoftwareIdentity = {
  ...SOFTWARE_IDENTITY,
  producer: { name: "Producer Person", nif: "12345678Z" },
};
const taxpayer = { legalName: "Bar Lucía S.L.", nif: "B12345674" };

describe("SOFTWARE_IDENTITY", () => {
  it("holds the owner's answers", () => {
    expect(SOFTWARE_IDENTITY).toMatchObject({
      name: "Waitron",
      code: "W1",
      onlyVerifactu: "S",
      multipleTaxpayersPossible: "N",
      multipleTaxpayersNow: "N",
    });
    expect(SOFTWARE_IDENTITY).not.toHaveProperty("producer");
  });
});

describe("softwareVersion", () => {
  it("names a published build by its commit", () => {
    const version = softwareVersion(COMMIT);
    expect(version).toBe(`0.0.0-dev+${COMMIT}`);
    expect(version).toHaveLength(50);
    expect(softwareVersion(null)).toBe("0.0.0-dev");
    expect(softwareVersion()).toBe("0.0.0-dev");
  });

  it("reads the bundle's stamp itself", async () => {
    vi.stubGlobal("__WAITRON_HOUR_RELEASE__", { sourceCommit: COMMIT });
    vi.resetModules();
    const fresh = await import("./software-identity.js");
    expect(fresh.BUILD_COMMIT).toBe(COMMIT);
    expect(fresh.softwareVersion()).toBe(`0.0.0-dev+${COMMIT}`);
  });

  it.each([{}, { sourceCommit: "short" }, { sourceCommit: `${COMMIT}a` }, null])(
    "treats a stamp with no usable commit (%j) as none",
    async (stamp) => {
      vi.stubGlobal("__WAITRON_HOUR_RELEASE__", stamp);
      vi.resetModules();
      const fresh = await import("./software-identity.js");
      expect(fresh.BUILD_COMMIT).toBeNull();
      expect(fresh.softwareVersion()).toBe("0.0.0-dev");
    },
  );

  it("is not fooled by a mocked release reader", async () => {
    vi.doMock("./hour-release.js", () => ({
      readHourRelease: () => ({
        sourceCommit: COMMIT,
        committedAt: "2026-10-15T11:00:00.000Z",
        instantMs: 1792062000000,
        generator: "scripts/generate-hour-release.mjs:v1",
        generatorSha256: "a".repeat(64),
      }),
    }));
    vi.resetModules();
    const fresh = await import("./software-identity.js");
    expect(fresh.BUILD_COMMIT).toBeNull();
  });

  it("a published version passes AEAT's checks", () => {
    const at = new Date("2026-10-15T12:00:00.000Z");
    const recordWith = (version: string) =>
      buildAltaRecord({
        IDEmisorFactura: "B12345674",
        NumSerieFactura: "A-S000001/1",
        FechaExpedicionFactura: at,
        NombreRazonEmisor: "Bar Lucía S.L.",
        TipoFactura: "F2",
        DescripcionOperacion: "Version check",
        Desglose: [
          {
            BaseImponibleOimporteNoSujeto: "100.00",
            CuotaRepercutida: "21.00",
            TipoImpositivo: "21.00",
            ClaveRegimen: "01",
            CalificacionOperacion: "S1",
          },
        ],
        CuotaTotal: "21.00",
        ImporteTotal: "121.00",
        SistemaInformatico: {
          NombreRazon: "Bar Lucía S.L.",
          NIF: "B12345674",
          NombreSistemaInformatico: SOFTWARE_IDENTITY.name,
          IdSistemaInformatico: SOFTWARE_IDENTITY.code,
          Version: version,
          NumeroInstalacion: "1",
          TipoUsoPosibleSoloVerifactu: SOFTWARE_IDENTITY.onlyVerifactu,
          TipoUsoPosibleMultiOT: SOFTWARE_IDENTITY.multipleTaxpayersPossible,
          IndicadorMultiplesOT: SOFTWARE_IDENTITY.multipleTaxpayersNow,
        },
        Encadenamiento: { PrimerRegistro: "S" },
        generadoEn: at,
        offsetMinutes: 0,
      });
    const versionIssues = (version: string) =>
      validate(recordWith(version), { now: at }).filter(
        (issue) => issue.field === "SistemaInformatico.Version",
      );
    expect(versionIssues(softwareVersion(COMMIT))).toEqual([]);
    // Control: one character past the field's limit is reported, so the check above can fail.
    expect(versionIssues(`${softwareVersion(COMMIT)}x`)).not.toEqual([]);
  });
});

describe("producerFields", () => {
  it("keeps the taxpayer while the producer is pending", () => {
    expect(producerFields(pending, taxpayer)).toEqual({
      NombreRazon: "Bar Lucía S.L.",
      NIF: "B12345674",
    });
  });

  it("names the producer once supplied", () => {
    expect(producerFields(filled, taxpayer)).toEqual({
      NombreRazon: "Producer Person",
      NIF: "12345678Z",
    });
  });
});

const PRODUCER = {
  WAITRON_PRODUCER_NAME: "PRODUCER PERSON",
  WAITRON_PRODUCER_TAX_ID: "00000000T",
  WAITRON_PRODUCER_ADDRESS: "1 Example Street, 00000 Nowhere (Province), Spain",
};

function setProducer(values: Partial<typeof PRODUCER>): void {
  for (const name of Object.keys(PRODUCER) as (keyof typeof PRODUCER)[])
    vi.stubEnv(name, values[name] ?? "");
}

function running(): SoftwareIdentity {
  return { ...SOFTWARE_IDENTITY, producer: runningProducer() };
}

function refusal(environment: string): unknown {
  try {
    refuseProducerSettings(environment, running());
  } catch (error) {
    return error;
  }
  return null;
}

describe("a start, by the producer settings", () => {
  describe("with none set", () => {
    beforeEach(() => setProducer({}));

    it("refuses production, stamped build or not", () => {
      const thrown = refusal("production");
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        code: "sif.producer_unset",
        params: { environment: "production" },
      });
    });

    it("trades in preproduction, naming the taxpayer", () => {
      expect(refusal("preproduction")).toBeNull();
      expect(producerFields(running(), taxpayer)).toEqual({
        NombreRazon: "Bar Lucía S.L.",
        NIF: "B12345674",
      });
    });
  });

  describe("with all three set and valid", () => {
    beforeEach(() => setProducer(PRODUCER));

    it.each(["production", "preproduction"])("trades in %s, naming the producer", (env) => {
      expect(refusal(env)).toBeNull();
      expect(producerFields(running(), taxpayer)).toEqual({
        NombreRazon: "PRODUCER PERSON",
        NIF: "00000000T",
      });
    });
  });

  describe.each(["production", "preproduction"])("in %s", (environment) => {
    it("refuses a partly set producer", () => {
      setProducer({ WAITRON_PRODUCER_NAME: PRODUCER.WAITRON_PRODUCER_NAME });
      expect(refusal(environment)).toMatchObject({
        code: "software_producer.invalid",
        params: { setting: "WAITRON_PRODUCER_TAX_ID", reason: "partial" },
      });
    });

    it("refuses a value failing the shape check", () => {
      setProducer({ ...PRODUCER, WAITRON_PRODUCER_ADDRESS: "1 Example Street\nSpain" });
      expect(refusal(environment)).toMatchObject({
        code: "software_producer.invalid",
        params: { setting: "WAITRON_PRODUCER_ADDRESS", reason: "line_break" },
      });
    });

    it("refuses a tax number with a wrong check letter", () => {
      setProducer({ ...PRODUCER, WAITRON_PRODUCER_TAX_ID: "X1234567A" });
      const thrown = refusal(environment);
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        code: "sif.producer_invalid",
        params: { setting: "WAITRON_PRODUCER_TAX_ID", reason: "check_failed" },
      });
    });

    it("refuses a name longer than Veri*Factu's 120 characters", () => {
      setProducer({ ...PRODUCER, WAITRON_PRODUCER_NAME: "P".repeat(121) });
      expect(refusal(environment)).toMatchObject({
        code: "sif.producer_invalid",
        params: { setting: "WAITRON_PRODUCER_NAME", reason: "too_long" },
      });
    });
  });

  it("accepts a foreigner's number with its right check letter", () => {
    setProducer({ ...PRODUCER, WAITRON_PRODUCER_TAX_ID: "X1234567L" });
    expect(refusal("production")).toBeNull();
    expect(producerFields(running(), taxpayer).NIF).toBe("X1234567L");
  });

  it("accepts a name of exactly 120 characters", () => {
    setProducer({ ...PRODUCER, WAITRON_PRODUCER_NAME: "P".repeat(120) });
    expect(refusal("production")).toBeNull();
  });

  it("an invalid producer reached through producerFields throws its error", () => {
    setProducer({ ...PRODUCER, WAITRON_PRODUCER_TAX_ID: "X1234567A" });
    expect(() => producerFields(running(), taxpayer)).toThrow(
      expect.objectContaining({ code: "sif.producer_invalid" }),
    );
  });

  it("reads the given environment, not only the process's", () => {
    setProducer({});
    expect(runningProducer(PRODUCER)).toEqual({ name: "PRODUCER PERSON", nif: "00000000T" });
    expect(runningProducer({})).toBe(PRODUCER_PENDING);
  });
});

describe("a backend keeps its first reading of the settings", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

  it("names the producer read when it was built, after the settings change", async () => {
    const { nodeId, seriesId } = await seedTenantWithSif(suite.db);
    setProducer(PRODUCER);
    const backend = makeVerifactuBackend({
      db: suite.db,
      clock: steadyClock,
      environment: "preproduction",
    });
    setProducer({});

    const { saleId } = await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ nodeId, seriesId })),
    );
    const [row] = await suite.db
      .select({ sistemaInformatico: registrosFacturacion.sistemaInformatico })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    expect(row!.sistemaInformatico).toMatchObject({
      NombreRazon: "PRODUCER PERSON",
      NIF: "00000000T",
    });
  });
});
