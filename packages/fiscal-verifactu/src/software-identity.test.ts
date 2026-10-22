import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import { AppError } from "@waitron/shared";
import {
  PRODUCER_PENDING,
  SOFTWARE_IDENTITY,
  producerFields,
  refuseUnsetProducer,
  softwareVersion,
  type SoftwareIdentity,
} from "./software-identity.js";

afterEach(() => {
  vi.unstubAllGlobals();
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

  it.each([{}, { sourceCommit: "short" }, null])(
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

describe("refuseUnsetProducer", () => {
  it("refuses a published production build while pending", () => {
    let thrown: unknown;
    try {
      refuseUnsetProducer("production", true, pending);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      code: "sif.producer_unset",
      params: { environment: "production" },
    });
  });

  it("serves a published preproduction build while pending", () => {
    expect(() => refuseUnsetProducer("preproduction", true, pending)).not.toThrow();
  });

  it("serves an unpublished production build while pending", () => {
    expect(() => refuseUnsetProducer("production", false, pending)).not.toThrow();
  });

  it("serves a published production build once the producer is supplied", () => {
    expect(() => refuseUnsetProducer("production", true, filled)).not.toThrow();
  });
});
