import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as library from "@waitron/verifactu";
import * as candidatesApi from "./initial-paper-candidates.js";
import { deviceId, saleId } from "@waitron/shared";
import type { InitialSetupContext } from "@waitron/module";
import { altaFor } from "./testing/seed.js";
import {
  validateInitialPaperCandidates,
  readInitialPaperCandidates,
} from "./initial-paper-candidates.js";

vi.mock("@waitron/verifactu", { spy: true });

const context: InitialSetupContext = {
  attemptId: "attempt1",
  binding: {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "event1",
    sourceId: "first-setup:attempt1",
    targetNodeId: "node1",
  },
  administratorId: "admin1",
  country: "ES",
  taxId: "89890001K",
  environment: "production",
  recipientVenueId: "first-setup:attempt1",
  bases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
};
const invalid = expect.objectContaining({ code: "sif.allocation_invalid" });

describe("host initial paper candidate validation", () => {
  it("validates the exact full candidate set with the real validator at both counter boundaries", () => {
    const spy = vi.spyOn(library, "validate");
    try {
      const result = validateInitialPaperCandidates(context, [1, 999999]);
      expect(result.version).toBe(1);
      expect(result.candidates.map((a) => a.installationIdentity)).toEqual(["S000001", "S999999"]);
      expect(result.candidates[0]).toEqual({
        version: 1,
        allocationId: expect.any(String),
        taxpayerNif: "89890001K",
        softwareId: "W1",
        environment: "production",
        installationIdentity: "S000001",
        series: [
          { code: "A-S000001", purpose: "standard" },
          { code: "FF-S000001", purpose: "full" },
          { code: "R-S000001", purpose: "rectificative" },
        ],
        source: "initial-paper",
        issuedAt: expect.any(String),
      });
      expect(
        spy.mock.calls.map(([record]) =>
          "TipoFactura" in record ? record.IDFactura.NumSerieFactura : undefined,
        ),
      ).toEqual([
        "A-S000001/1",
        "A-S000001/9999999999",
        "FF-S000001/1",
        "FF-S000001/9999999999",
        "R-S000001/1",
        "R-S000001/9999999999",
        "A-S999999/1",
        "A-S999999/9999999999",
        "FF-S999999/1",
        "FF-S999999/9999999999",
        "R-S999999/1",
        "R-S999999/9999999999",
      ]);
      expect(
        spy.mock.results.every(
          (entry) =>
            entry.type === "return" && Array.isArray(entry.value) && entry.value.length === 0,
        ),
      ).toBe(true);
      expect(readInitialPaperCandidates(context, JSON.parse(JSON.stringify(result)))).toEqual(
        result,
      );
      expect(result.candidateDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.isFrozen(result.candidates[0]?.series[0])).toBe(true);
      expect(Object.isFrozen(result.candidates)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it.each([[], [0], [1000000], [1.5], [1, 1], Array.from({ length: 101 }, (_, i) => i + 1)])(
    "refuses invalid/duplicate/out-of-capacity serial selection %j",
    (...serials) => {
      expect(() => validateInitialPaperCandidates(context, serials)).toThrowError(invalid);
    },
  );
  it.each([
    [],
    [{ code: "A", purpose: "standard" }],
    [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
    ],
    [
      { code: "A", purpose: "standard" },
      { code: "A", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
    [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "full" },
    ],
    [
      { code: "A".repeat(22), purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
  ])("refuses incomplete or ambiguous purpose/base sets %j", (...bases) => {
    expect(() => validateInitialPaperCandidates({ ...context, bases }, [1])).toThrowError(invalid);
  });
  it.each(["staging", "", null])("refuses environment %j", (environment) => {
    expect(() =>
      validateInitialPaperCandidates({ ...context, environment } as InitialSetupContext, [1]),
    ).toThrowError(invalid);
  });
  it("accepts preproduction as a distinct signed scope", () => {
    expect(
      validateInitialPaperCandidates({ ...context, environment: "preproduction" }, [1])
        .candidates[0]?.environment,
    ).toBe("preproduction");
  });
  it("refuses a valid-shape NIF with a wrong control letter through the real fiscal library", () => {
    expect(() =>
      validateInitialPaperCandidates({ ...context, taxId: "89890001A" }, [1]),
    ).toThrowError(invalid);
  });
  it.each(["version", "candidateDigest", "candidates", "validated"])(
    "does not trust altered persisted %s",
    (field) => {
      const result = structuredClone(validateInitialPaperCandidates(context, [1]));
      const altered = {
        ...result,
        [field]: field === "candidates" ? [] : field === "validated" ? true : "changed",
      };
      expect(() => readInitialPaperCandidates(context, altered)).toThrowError(invalid);
    },
  );
  it("refuses a candidate changed under an unchanged digest", () => {
    const result = structuredClone(validateInitialPaperCandidates(context, [1]));
    const altered = {
      ...result,
      candidates: [{ ...result.candidates[0]!, allocationId: "replaced" }],
    };
    expect(() => readInitialPaperCandidates(context, altered)).toThrowError(invalid);
  });
  it("refuses a public candidate set too large for the bounded signed handoff", () => {
    const result = validateInitialPaperCandidates(
      context,
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    const candidates = result.candidates.map((candidate, i) => ({
      ...candidate,
      allocationId: `${i}-` + "é".repeat(250),
    }));
    const candidateDigest = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
    expect(Buffer.byteLength(JSON.stringify(candidates))).toBeGreaterThan(64 * 1024);
    expect(() =>
      readInitialPaperCandidates(context, { version: 1, candidates, candidateDigest }),
    ).toThrowError(invalid);
  });
  it("accepts the maximum block before signing and preserves reordered object properties", () => {
    const result = validateInitialPaperCandidates(
      context,
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    const candidates = result.candidates.map((value) =>
      Object.fromEntries(Object.entries(value).reverse()),
    );
    expect(readInitialPaperCandidates(context, { ...result, candidates })).toEqual(result);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(64 * 1024);
  });
  it.each([
    { field: "allocationId", value: "" },
    { field: "source", value: "paper" },
    { field: "taxpayerNif", value: "12345678Z" },
    { field: "softwareId", value: "XX" },
    { field: "environment", value: "preproduction" },
    { field: "series", value: [] },
  ])("refuses a recomputed digest with wrong candidate $field", ({ field, value }) => {
    const result = validateInitialPaperCandidates(context, [1]);
    const candidates = [{ ...result.candidates[0]!, [field]: value }];
    const candidateDigest = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
    expect(() =>
      readInitialPaperCandidates(context, { version: 1, candidates, candidateDigest }),
    ).toThrowError(invalid);
  });
  it.each(["allocationId", "installationIdentity"])(
    "refuses duplicate frozen candidate %s even with a matching digest",
    (field) => {
      const result = validateInitialPaperCandidates(context, [1, 2]);
      const candidates = [
        { ...result.candidates[0]! },
        {
          ...result.candidates[1]!,
          [field]: result.candidates[0]![field as "allocationId" | "installationIdentity"],
        },
      ];
      if (field === "installationIdentity") candidates[1]!.series = candidates[0]!.series;
      const candidateDigest = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
      expect(() =>
        readInitialPaperCandidates(context, { version: 1, candidates, candidateDigest }),
      ).toThrowError(invalid);
    },
  );
  it.each([null, [], {}, { version: 1, candidateDigest: "digest", candidates: null }])(
    "refuses malformed stored candidates %j",
    (value) => {
      expect(() => readInitialPaperCandidates(context, value)).toThrowError(invalid);
    },
  );
  it("qualifies complete independent records and a discriminating 61-character control", () => {
    const input = altaFor(
      { deviceId: deviceId("10000000-0000-4000-8000-000000000001") },
      saleId("10000000-0000-4000-8000-000000000002"),
      1,
      1,
    ).input;
    for (const identity of ["S000001", "S999999"])
      for (const series of ["A", "FF", "R"])
        for (const counter of [1, 9999999999]) {
          expect(
            library.validate(
              library.buildAltaRecord({
                ...input,
                NumSerieFactura: `${series}-${identity}/${counter}`,
                SistemaInformatico: { ...input.SistemaInformatico, NumeroInstalacion: identity },
                Encadenamiento: { PrimerRegistro: "S" },
              }),
            ),
          ).toEqual([]);
        }
    expect(
      library.validate(
        library.buildAltaRecord({
          ...input,
          NumSerieFactura: "X".repeat(61),
          Encadenamiento: { PrimerRegistro: "S" },
        }),
      ),
    ).toContainEqual(expect.objectContaining({ field: "NumSerieFactura", severity: "error" }));
  });
  it("retains every configured base when two bases serve the same purpose", () => {
    const four = { ...context, bases: [...context.bases, { code: "B", purpose: "standard" }] };
    const result = validateInitialPaperCandidates(four, [42]);
    expect(result.candidates[0]?.series).toEqual([
      { code: "A-S000042", purpose: "standard" },
      { code: "FF-S000042", purpose: "full" },
      { code: "R-S000042", purpose: "rectificative" },
      { code: "B-S000042", purpose: "standard" },
    ]);
    for (const series of [
      result.candidates[0]!.series.slice(0, 3),
      result.candidates[0]!.series.map((s) =>
        s.code === "B-S000042" ? { ...s, purpose: "full" } : s,
      ),
      [...result.candidates[0]!.series.slice(0, 3), result.candidates[0]!.series[0]!],
    ]) {
      const candidates = [{ ...result.candidates[0]!, series }];
      const candidateDigest = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
      expect(() =>
        readInitialPaperCandidates(four, { version: 1, candidates, candidateDigest }),
      ).toThrowError(invalid);
    }
  });
  it("validates fresh recovery P candidates with the same complete configured set", () => {
    expect(candidatesApi).toHaveProperty("validatePaperCandidates");
    const result = candidatesApi.validatePaperCandidates(context, "P", [8, 999999]);
    expect(result.candidates.map((a) => [a.installationIdentity, a.source])).toEqual([
      ["P000008", "paper"],
      ["P999999", "paper"],
    ]);
    expect(result.candidates[0]?.series).toEqual([
      { code: "A-P000008", purpose: "standard" },
      { code: "FF-P000008", purpose: "full" },
      { code: "R-P000008", purpose: "rectificative" },
    ]);
    expect(() => readInitialPaperCandidates(context, result)).toThrowError(invalid);
  });
});
