#!/usr/bin/env python3
"""Generate `packages/reporting/src/dr303-layout.ts` from the official AEAT record design.

PRIMARY SOURCE (do NOT hand-edit the generated .ts — regenerate from here):
  file : packages/reporting/reference/DR303e26.xlsx
  md5  : e42cbe6baf7f21dd95c274b4c6f11bbe
  url  : https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/DR303e26.xlsx
  what : AEAT-published "diseño de registro" for modelo 303, ejercicio 2026 (version 1.01).

We emit the three segments a régimen-general filing needs:
  - comun    : sheet DP30300 fields 1-13 (envelope-open <T3030{ej}{per}0000> + <AUX>...</AUX>), len 328.
  - pagina1  : sheet DP30301 (page "01000": régimen general devengado + deducible + resultado), len 1581.
  - pagina3  : sheet DP30303 (page "03000": resultado de la autoliquidación), len 1017.
Pages 2/4/5 (régimen simplificado) and the DID/IBAN domiciliación block are out of scope (see dr303.ts).

Usage:  python3 generate-dr303-layout.py  > ../src/dr303-layout.ts
The generated file is validated by packages/reporting/src/dr303-layout.test.ts (a contiguity /
page-length self-check ported from the AEAT record design). No Python is needed at test time.
"""

import hashlib
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

HERE = Path(__file__).resolve().parent
XLSX = HERE / "DR303e26.xlsx"
EXPECTED_MD5 = "e42cbe6baf7f21dd95c274b4c6f11bbe"
URL = "https://sede.agenciatributaria.gob.es/static_files/Sede/Disenyo_registro/DR_300_399/archivos_26/DR303e26.xlsx"

# (sheet, segment name, declared total length) — the segments a régimen-general filing emits.
SEGMENTS = [
    ("DP30300", "comun", 328),
    ("DP30301", "pagina1", 1581),
    ("DP30303", "pagina3", 1017),
]


def load(path):
    md5 = hashlib.md5(path.read_bytes()).hexdigest()
    if md5 != EXPECTED_MD5:
        sys.exit(f"md5 mismatch: {md5} != {EXPECTED_MD5} (wrong/corrupt {path.name})")
    z = zipfile.ZipFile(path)
    shared = []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall(f"{NS}si"):
        shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {r.get("Id"): r.get("Target") for r in rels}
    sheets = {}
    for s in wb.find(f"{NS}sheets"):
        tgt = relmap[s.get(f"{RNS}id")]
        if not tgt.startswith("xl/"):
            tgt = "xl/" + tgt
        sheets[s.get("name")] = tgt
    return z, shared, sheets


def colnum(ref):
    n = 0
    for ch in re.match(r"([A-Z]+)", ref).group(1):
        n = n * 26 + (ord(ch) - 64)
    return n


def cell_val(c, shared):
    t = c.get("t")
    v = c.find(f"{NS}v")
    if t == "s":
        return shared[int(v.text)] if v is not None else ""
    if t == "inlineStr":
        isn = c.find(f"{NS}is")
        return "".join(x.text or "" for x in isn.iter(f"{NS}t")) if isn is not None else ""
    return v.text if v is not None else ""


def rows(z, shared, tgt):
    ws = ET.fromstring(z.read(tgt))
    for row in ws.find(f"{NS}sheetData").findall(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            cn = colnum(c.get("r"))
            vv = cell_val(c, shared)
            if vv not in (None, ""):
                cells[cn] = vv
        yield cells


def isint(x):
    try:
        int(str(x).strip())
        return True
    except (TypeError, ValueError):
        return False


# A quoted literal at the START of the Contenido column, optionally prefixed "Constante". These are
# emitted verbatim to the record ("<T", "303", "01000", ">", "<AUX>", the Tipo % constants "02100"...).
# A trailing annotation after the quote is allowed ("Constante \"00400\". Nota 7") — but a SECOND
# quote after the first means the cell is a list/alternation of values, not a single constant (e.g.
# the Período cell `"01"..."12" o "1T"…"4T"`), so that is NOT treated as a constant.
CONST_RE = re.compile(r'^\s*(?:Constante\.?\s*)?"([^"]*)"(.*)$', re.S)


def const_value(content):
    m = CONST_RE.match(content)
    if not m or '"' in m.group(2):
        return None
    return m.group(1)


# The field's OWN casilla is the LAST [NN] in the description (formula rows list operands first,
# e.g. "Total cuota devengada ( [152] + ... + [26] ) [27]").
CASILLA_RE = re.compile(r"\[(\d+)\]")


def classify(n, typ, desc, content):
    """Return (role, value, casilla, decimals). role drives serialization; value is the constant
    literal when role == 'constant'. Roles are ENGLISH (the repo's english-only guard scans
    identifiers AND string literals in packages/reporting): year/period/amount/declarationType, not
    the Spanish AEAT terms — those live in the // comment above each field, which the guard excludes.
    Kept conservative and explicit; the .ts is eyeballed and the contiguity + fixture tests bite on
    any drift."""
    casillas = CASILLA_RE.findall(desc)
    casilla = casillas[-1] if casillas else None
    decimals = 2 if "decimales" in content.lower() else 0

    value = const_value(content)
    if value is not None:
        return "constant", value, casilla, decimals

    # Header identity, keyed by the AEAT description text.
    if "Identificación (1) - NIF" in desc:
        return "taxId", None, casilla, decimals
    if "Apellidos y nombre o Razón social" in desc:
        return "name", None, casilla, decimals
    if desc.strip() == "Tipo Declaración":
        return "declarationType", None, casilla, decimals
    if "Ejercicio" in desc and ("Devengo" in desc or "EEEE" in desc):
        return "year", None, casilla, decimals
    if re.search(r"Per[ií]odo", desc):
        return "period", None, casilla, decimals

    # A data box: has a casilla and an importe/percentage content ("15 enteros y 2 decimales",
    # "3 enteros y 2 decimales"). The Tipo % boxes are constants and were caught above.
    if casilla is not None and "decimales" in content.lower():
        return "amount", None, casilla, decimals

    # Everything else — reserved AEAT areas, optional Sí/No identification indicators, developer
    # AUX fields — is placed at its position with a type-neutral blank (see dr303.ts).
    return "blank", None, casilla, decimals


def ts_str(s):
    if s is None:
        return "null"
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    z, shared, sheets = load(XLSX)
    out = []
    w = out.append

    w("// AUTO-GENERATED — DO NOT HAND-EDIT. Regenerate (from the repo root) via:")
    w("//   python3 packages/reporting/reference/generate-dr303-layout.py \\")
    w("//     | npx prettier --parser typescript > packages/reporting/src/dr303-layout.ts")
    w("//")
    w("// PRIMARY SOURCE (AEAT-published record design, committed verbatim):")
    w("//   file : packages/reporting/reference/DR303e26.xlsx")
    w(f"//   md5  : {EXPECTED_MD5}")
    w(f"//   url  : {URL}")
    w("//   what : modelo 303 diseño de registro, ejercicio 2026 (version 1.01).")
    w("//")
    w("// Positions are 1-based (as in the AEAT design); the serializer converts to a 0-based byte")
    w("// offset as posición − 1. Every field's { pos, len, type } is transcribed from the .xlsx and")
    w("// self-validated by dr303-layout.test.ts (per-segment contiguity + declared length). The AEAT")
    w("// Descripción of each field (which carries the casilla-27/45 summation formulas verbatim) is the")
    w("// // comment ABOVE each field — a comment, not a string literal, because the english-only guard")
    w("// scans string literals in packages/reporting but excludes comments (the descriptions are Spanish).")
    w("")
    w('/** A single fixed-layout field, transcribed from the DR303e26 record design. */')
    w("export interface Dr303Field {")
    w("  /** Nº — the field's order number within its segment (AEAT column 1). */")
    w("  readonly n: number;")
    w("  /** Posición — 1-based start position within the segment (AEAT column 2). */")
    w("  readonly pos: number;")
    w("  /** Longitud — number of character positions the field occupies (AEAT column 3). */")
    w("  readonly len: number;")
    w("  /** Tipo/Naturaleza: A alfabético, Num numérico sin signo, N numérico con signo, An alfanumérico. */")
    w('  readonly type: "A" | "Num" | "N" | "An";')
    w("  /** Casilla (box) number this field carries, e.g. \"27\"; null for constants/headers/reserved. */")
    w("  readonly casilla: string | null;")
    w("  /** Decimal places packed into the field (2 for importe/tipo/percentage; 0 otherwise). */")
    w("  readonly decimals: number;")
    w("  /**")
    w("   * How the serializer fills this field (roles are English; the Spanish AEAT term is in each")
    w("   * field's // comment):")
    w('   *  - "constant"        emit `value` verbatim (envelope tags, Tipo % constants, </AUX>, …).')
    w('   *  - "year"            the 4-digit EEEE ejercicio, from options.')
    w('   *  - "period"          the 2-char PP período ("01".."12" | "1T".."4T"), from options.')
    w('   *  - "taxId"           the obligado NIF, alfanumeric, from options.')
    w('   *  - "name"            apellidos y nombre o razón social, alfanumeric, from options.')
    w('   *  - "declarationType" the tipo de declaración indicator, from options.')
    w('   *  - "amount"          a data box (importe), looked up by `casilla` in the Modelo303 map (0 when absent).')
    w('   *  - "blank"           reserved / optional indicator: type-neutral blank fill.')
    w("   */")
    w('  readonly role:')
    w('    | "constant"')
    w('    | "year"')
    w('    | "period"')
    w('    | "taxId"')
    w('    | "name"')
    w('    | "declarationType"')
    w('    | "amount"')
    w('    | "blank";')
    w("  /** The literal to emit when role === \"constant\" (already exactly `len` chars); else null. */")
    w("  readonly value: string | null;")
    w("}")
    w("")
    w("/** One segment (record) of the fixed-layout file, with its AEAT-declared total length. */")
    w("export interface Dr303Segment {")
    w("  readonly name: string;")
    w("  /** Total character positions in the segment (last field's pos + len − 1). */")
    w("  readonly length: number;")
    w("  readonly fields: readonly Dr303Field[];")
    w("}")
    w("")

    seg_consts = []
    for sheet, name, declared in SEGMENTS:
        fields = []
        for cells in rows(z, shared, sheets[sheet]):
            a, b, c = cells.get(1), cells.get(2), cells.get(3)
            if not (isint(a) and isint(b) and isint(c)):
                continue
            n = int(a)
            pos = int(b)
            length = int(str(c).strip())
            typ = (cells.get(4) or "").strip()
            desc = (cells.get(5) or "").strip()
            content = (cells.get(7) or "").strip()
            role, value, casilla, decimals = classify(n, typ, desc, content)
            # A constant must be exactly `len` chars — a mistranscribed literal is caught here at
            # generation time (and again by the serializer's per-field length assertion at runtime).
            if role == "constant" and len(value) != length:
                sys.exit(
                    f"{name}: field {n} constant {value!r} is {len(value)} chars, expected {length}"
                )
            fields.append((n, pos, length, typ, casilla, decimals, role, value, desc))

        # Faithfulness check at generation time (the .ts test re-checks independently).
        fields.sort(key=lambda f: f[1])
        for i in range(len(fields) - 1):
            if fields[i][1] + fields[i][2] != fields[i + 1][1]:
                sys.exit(f"{name}: non-contiguous at field {fields[i][0]}")
        last = fields[-1]
        if last[1] + last[2] - 1 != declared:
            sys.exit(f"{name}: ends at {last[1] + last[2] - 1}, expected {declared}")

        const = f"DR303_{name.upper()}"
        seg_consts.append((name, const))
        w(f"const {const}: Dr303Segment = {{")
        w(f'  name: "{name}",')
        w(f"  length: {declared},")
        w("  fields: [")
        for (n, pos, length, typ, casilla, decimals, role, value, desc) in fields:
            # AEAT Descripción as a // comment (Spanish — kept out of string literals so the
            # english-only guard, which scans literals but not comments, stays green). A `//` or
            # newline in the source text would corrupt the comment; neither occurs in these fields,
            # but guard anyway.
            desc1 = " ".join(desc.split()).replace("//", "/ /")
            w(f"    // {desc1}")
            w(
                f"    {{ n: {n}, pos: {pos}, len: {length}, type: \"{typ}\", "
                f"casilla: {ts_str(casilla)}, decimals: {decimals}, "
                f"role: \"{role}\", value: {ts_str(value)} }},"
            )
        w("  ],")
        w("};")
        w("")

    w("/** The three segments a régimen-general modelo 303 filing emits, in file order. */")
    w("export const DR303_LAYOUT = {")
    for name, const in seg_consts:
        w(f"  {name}: {const},")
    w("} as const;")
    w("")
    w("/**")
    w(" * The envelope-closing constant (común field 15, DP30300): `Constante \"</T3030AAAAPP0000>\"`,")
    w(" * length 18, where AAAA = ejercicio and PP = período. Emitted after the last página, closing the")
    w(" * outer <T3030{ej}{per}0000> envelope. Its position is variable (it follows the páginas), so it is")
    w(" * a template here rather than a positioned field.")
    w(" */")
    w('export const DR303_ENVELOPE_CLOSE_TEMPLATE = "</T3030AAAAPP0000>";')
    w("")

    sys.stdout.write("\n".join(out))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
