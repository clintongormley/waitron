import { describe, expect, it } from "vitest";
import { DR303_ENVELOPE_CLOSE_TEMPLATE, DR303_LAYOUT, type Dr303Segment } from "./dr303-layout.js";

// The layout self-check. `dr303-layout.ts` is machine-generated from the official AEAT record design
// (packages/reporting/reference/DR303e26.xlsx, md5 e42cbe6baf7f21dd95c274b4c6f11bbe) by
// packages/reporting/reference/generate-dr303-layout.py; this suite is the runtime receipt that the
// transcription is faithful, independent of the generator's own generation-time check. Within each
// segment (record) every field must ABUT the next — posición + longitud === next posición — the first
// field starts at position 1, and the last ends exactly at the segment's AEAT-declared total length. A
// single mistranscribed pos/len breaks it. No Python runs at test time; the .xlsx + generator are the
// provenance/regeneration path only.

/** Returns a list of contiguity/length violations in a segment (empty === faithful). */
function contiguityErrors(segment: Dr303Segment): string[] {
  const errors: string[] = [];
  const fields = [...segment.fields].sort((a, b) => a.pos - b.pos);
  if (fields.length === 0) {
    errors.push(`${segment.name}: no fields`);
    return errors;
  }
  if (fields[0]!.pos !== 1) {
    errors.push(`${segment.name}: first field at pos ${fields[0]!.pos}, expected 1`);
  }
  for (let i = 0; i < fields.length - 1; i++) {
    const end = fields[i]!.pos + fields[i]!.len;
    const nextPos = fields[i + 1]!.pos;
    if (end !== nextPos) {
      errors.push(
        `${segment.name}: field ${fields[i]!.n} (pos ${fields[i]!.pos} len ${fields[i]!.len}) ` +
          `ends before pos ${end}, but field ${fields[i + 1]!.n} starts at ${nextPos}`,
      );
    }
  }
  const last = fields[fields.length - 1]!;
  const end = last.pos + last.len - 1;
  if (end !== segment.length) {
    errors.push(`${segment.name}: last field ends at ${end}, declared length is ${segment.length}`);
  }
  return errors;
}

const SEGMENTS = [DR303_LAYOUT.comun, DR303_LAYOUT.pagina1, DR303_LAYOUT.pagina3];

describe("DR303 layout self-check (contiguity + declared length)", () => {
  it.each(SEGMENTS)(
    "$name: fields are contiguous and fill the declared length exactly",
    (segment) => {
      expect(contiguityErrors(segment)).toEqual([]);
    },
  );

  it("declares the AEAT-published segment lengths (común 328, página1 1581, página3 1017)", () => {
    // The régimen-general filing is común + página 01000 + página 03000 + the 18-char envelope close.
    expect(DR303_LAYOUT.comun.length).toBe(328);
    expect(DR303_LAYOUT.pagina1.length).toBe(1581);
    expect(DR303_LAYOUT.pagina3.length).toBe(1017);
    const fileLength =
      DR303_LAYOUT.comun.length +
      DR303_LAYOUT.pagina1.length +
      DR303_LAYOUT.pagina3.length +
      DR303_ENVELOPE_CLOSE_TEMPLATE.length;
    expect(fileLength).toBe(2944);
  });

  it("every constant field's literal is exactly its declared length", () => {
    for (const segment of SEGMENTS) {
      for (const field of segment.fields) {
        if (field.role === "constant") {
          expect(field.value, `${segment.name} field ${field.n}`).not.toBeNull();
          expect(field.value!.length, `${segment.name} field ${field.n} value ${field.value}`).toBe(
            field.len,
          );
        }
      }
    }
  });

  it("every data (amount) field carries a casilla, and only constants carry a literal value", () => {
    for (const segment of SEGMENTS) {
      for (const field of segment.fields) {
        if (field.role === "amount") {
          expect(field.casilla, `${segment.name} field ${field.n}`).not.toBeNull();
        }
        if (field.role !== "constant") {
          expect(field.value, `${segment.name} field ${field.n}`).toBeNull();
        }
      }
    }
  });

  it("pins the load-bearing casilla positions transcribed from DR303e26 (regression receipt)", () => {
    const posOf = (segment: Dr303Segment, casilla: string): number | undefined =>
      segment.fields.find((f) => f.casilla === casilla)?.pos;
    // Página 1 (DP30301): total cuota devengada [27], total a deducir [45], resultado general [46],
    // deducible corrientes base/cuota [28]/[29].
    expect(posOf(DR303_LAYOUT.pagina1, "27")).toBe(696);
    expect(posOf(DR303_LAYOUT.pagina1, "45")).toBe(1002);
    expect(posOf(DR303_LAYOUT.pagina1, "46")).toBe(1019);
    expect(posOf(DR303_LAYOUT.pagina1, "28")).toBe(713);
    expect(posOf(DR303_LAYOUT.pagina1, "29")).toBe(730);
    // Página 3 (DP30303): % atribuible al Estado [65], resultado de la autoliquidación [71].
    expect(posOf(DR303_LAYOUT.pagina3, "65")).toBe(216);
    expect(posOf(DR303_LAYOUT.pagina3, "71")).toBe(408);
    // Casilla 67 is absent from the current form (compensation flows via 110/78/87) — confirmed here.
    expect(posOf(DR303_LAYOUT.pagina1, "67")).toBeUndefined();
    expect(posOf(DR303_LAYOUT.pagina3, "67")).toBeUndefined();
  });

  it("the closing envelope template is the 18-char </T3030AAAAPP0000> (DP30300 field 15)", () => {
    expect(DR303_ENVELOPE_CLOSE_TEMPLATE).toBe("</T3030AAAAPP0000>");
    expect(DR303_ENVELOPE_CLOSE_TEMPLATE).toHaveLength(18);
  });

  // Prove the self-check BITES: a one-character length perturbation must be reported. Without this,
  // a `contiguityErrors` that always returned [] would pass the suites above and validate nothing.
  it("bites: perturbing a single field length is caught as a break", () => {
    const target = DR303_LAYOUT.pagina1.fields[10]!;
    const broken: Dr303Segment = {
      ...DR303_LAYOUT.pagina1,
      fields: DR303_LAYOUT.pagina1.fields.map((f) =>
        f.n === target.n ? { ...f, len: f.len + 1 } : f,
      ),
    };
    expect(contiguityErrors(broken).length).toBeGreaterThan(0);
    // The real layout still passes — the perturbation was on a copy.
    expect(contiguityErrors(DR303_LAYOUT.pagina1)).toEqual([]);
  });
});
