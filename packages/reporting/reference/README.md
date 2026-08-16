# DR303 record design — provenance & regeneration

This directory holds the **primary source** for the modelo 303 fixed-layout file writer
(`../src/dr303.ts`) and the machine-derived field table it consumes
(`../src/dr303-layout.ts`). None of it runs at test time — it is the provenance and
regeneration path only.

## `DR303e26.xlsx` — the official record design (committed verbatim)

- **What:** the AEAT-published _diseño de registro_ for **modelo 303, ejercicio 2026**
  (version 1.01) — the byte layout the sede "presentación por fichero" path validates
  uploads against.
- **md5:** `e42cbe6baf7f21dd95c274b4c6f11bbe`
- **URL:** <https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/DR303e26.xlsx>
- **Sheets used:** `DP30300` (envelope + `<AUX>` común, positions 1–328), `DP30301`
  (página `01000`: régimen general devengado + deducible + resultado, length 1581),
  `DP30303` (página `03000`: resultado de la autoliquidación, length 1017). Pages 2/4/5
  (régimen simplificado) and the `DP303DID` domiciliación/IBAN page are out of scope for a
  régimen-general deli and are not extracted.

A régimen-general filing is therefore `común (328) + página1 (1581) + página3 (1017) +
envelope-close (18) = 2944` characters, ISO-8859-1.

## `generate-dr303-layout.py` — the generator

Reads `DR303e26.xlsx` (asserting its md5) and emits `../src/dr303-layout.ts`: every field's
`{ n, pos, len, type, casilla, decimals, role, value, description }`, transcribed verbatim,
with a role that tells the serializer how to fill it. It self-checks segment contiguity and
declared length at generation time; the committed `../src/dr303-layout.test.ts` re-checks the
same invariants at test time (independently, in Vitest), so no Python is needed to build or
test the package.

**Regenerate (from the repo root):**

```sh
python3 packages/reporting/reference/generate-dr303-layout.py \
  | npx prettier --parser typescript > packages/reporting/src/dr303-layout.ts
```

The generated `dr303-layout.ts` is **auto-generated — do not hand-edit**; change the source
`.xlsx` (a new ejercicio) or the generator, then regenerate and let the layout self-check and
the `dr303.ts` fixture test confirm the result.

## `manual_uso.txt` — AEAT encoding/format manual

The AEAT "Breve manual de uso" for diseños de registro, extracted to text: the ISO-8859-1
rule, the alfanumeric (upper, left-aligned, accents stripped, Ñ/Ç kept) and numeric
(right-aligned, zero-filled, `N`-prefixed negatives) alignment rules `dr303.ts` implements.
