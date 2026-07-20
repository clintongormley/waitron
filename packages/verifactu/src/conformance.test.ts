import { describe, expect, it } from "vitest";
import {
  VECTOR_1_CADENA,
  VECTOR_1_HUELLA,
  VECTOR_1_INPUT,
  VECTOR_2_HUELLA,
  VECTOR_2_INPUT,
  VECTOR_3_CADENA,
  VECTOR_3_HUELLA,
  VECTOR_3_INPUT,
} from "../test/vectors.js";
import { buildCadenaAlta, buildCadenaAnulacion } from "./huella.js";
import { createHash } from "node:crypto";

/**
 * AEAT conformance. These are the authority's own published worked examples,
 * and they are the closest thing to ground truth available before
 * preproduction access exists. If one fails, the implementation is wrong —
 * never adjust a vector to match the code.
 */
describe("AEAT conformance vectors", () => {
  const hash = (cadena: string) =>
    createHash("sha256").update(cadena, "utf8").digest("hex").toUpperCase();

  it("vector 1 canonical string matches the published text", () => {
    expect(buildCadenaAlta(VECTOR_1_INPUT)).toBe(VECTOR_1_CADENA);
  });

  it("vector 1 hashes to the published huella", () => {
    // Hashes the cadena the library BUILDS, not the stored VECTOR_1_CADENA
    // constant — otherwise this test would still pass if buildCadenaAlta
    // were deleted.
    expect(hash(buildCadenaAlta(VECTOR_1_INPUT))).toBe(VECTOR_1_HUELLA);
  });

  it("vector 2 hashes to the published huella", () => {
    expect(hash(buildCadenaAlta(VECTOR_2_INPUT))).toBe(VECTOR_2_HUELLA);
  });

  it("vector 3 canonical string matches the published text", () => {
    expect(buildCadenaAnulacion(VECTOR_3_INPUT)).toBe(VECTOR_3_CADENA);
  });

  it("vector 3 hashes to the published huella", () => {
    // Hashes the cadena the library BUILDS, not the stored VECTOR_3_CADENA
    // constant — see vector 1 above for why.
    expect(hash(buildCadenaAnulacion(VECTOR_3_INPUT))).toBe(VECTOR_3_HUELLA);
  });
});
