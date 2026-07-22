# Plan 3a — Submission (the drainer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Veri*Factu outbox drainer — `drain(now)` on `FiscalBackend` — that submits `pendiente` `envios` rows to AEAT in per-tenant batches, persists the CSV atomically with the response, resolves error 3000 via both routes, halts a chain on genuine rejection, and schedules its own next run — all against a faithful in-memory fake AEAT.

**Architecture:** Three layers. (1) `packages/verifactu` gains request-parsers (`parseEnvio`/`parseConsulta`) and a stateful fake AEAT at the `fetch` layer, so tests run real `serialize → fake transport → real parse`. (2) `packages/fiscal-verifactu` gains a per-tenant flow-control table (`envio_flujo`) and the drainer (`drain.ts`), which claims rows `pendiente → enviando` under `FOR UPDATE SKIP LOCKED`, submits outside any transaction, then persists the response (CSV + estados) in one atomic transaction. (3) `packages/fiscal` gains `drain(now): Promise<DrainResult>` on the interface plus a meaningful fake.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM + drizzle-kit migrations, PostgreSQL (PGlite for unit tests, real Postgres via Testcontainers for RLS + lock contention), Vitest, `fast-xml-parser`, Stryker (mutation testing, `packages/verifactu` only).

**Design spec:** [`docs/superpowers/specs/2026-07-21-plan-3a-submission-design.md`](../specs/2026-07-21-plan-3a-submission-design.md). Read it before starting. Section references below (§N) point at it unless prefixed `§7`/`2026-07-19`.

## Global Constraints

Every task's requirements implicitly include these. Values copied verbatim from the spec and the repo's own conventions.

- **Real Postgres, not PGlite, for lock contention and RLS.** PGlite runs as superuser (bypasses RLS, proves nothing about tenant isolation) and cannot serialise concurrent backends (`SKIP LOCKED` contention is untestable on it). Use `startRealPostgres()` (`./testing/postgres.ts`) for those; it **throws** when Docker is absent rather than skipping.
- **Per-test red phase.** Observe each new test fail individually before implementing. Every task has an explicit "run to verify it fails" step.
- **CSV persisted in the SAME transaction as the submission response.** No CSV element exists in any consulta response and resubmission never returns it — a lost CSV is unrecoverable. Teeth-test: dropping the CSV write must fail a test.
- **The consulta and submission response enums are NEVER shared** (`EstadoRegistroSuministro` vs `EstadoRegistroConsulta`). Do not unify them as the drainer's own types are added.
- **`serializeEnvio` throws above `MAX_REGISTROS_POR_ENVIO` (1000)** — it does not chunk. The drainer chunks itself; a 1001-record backlog is split, never rejected with 4113/4114.
- **`proximo_intento_en` (per-record retry) and `proximo_envio_en` (per-tenant flow) are persisted, never in-memory timers.** This is what makes the art. 16.4 hourly duty survive a restart or a week offline.
- **Incidents and errors are structured `code` + `params`, never prose** — the translatable-errors constraint (spec §9).
- **No `ref_externa` column.** `RefExterna` is derived `= registros_facturacion.id` at serialization time.
- **`packages/verifactu` carries a 90% mutation gate.** The request-parsers (Task 1) must survive it; the round-trip property test is the primary killer.
- **Never a production NIF.** Fixtures and (later) AEAT preproduction only. `TEST_NIF` / `freshNif()` exist for this.
- **ESM import specifiers end in `.js`** even for `.ts` sources. Match the surrounding files.

---

## File Structure

**`packages/verifactu`** (foundation — no dependency on the fiscal packages):
- Create `src/xml/parse-request.ts` — `parseEnvio` / `parseConsulta`, inverses of `serialize.ts`.
- Create `src/xml/parse-request.test.ts` — round-trip property + edge cases.
- Create `src/testing/fake-aeat.ts` — the stateful in-memory AEAT.
- Create `src/testing/fake-aeat.test.ts` — the fake's own behaviour tests.
- Modify `src/index.ts` — export the two parsers (+ `src/index.test.ts` reachability list).

**`packages/fiscal-verifactu`**:
- Create `src/schema/envio-flujo.ts` — the `envio_flujo` table.
- Modify `src/schema/index.ts` — export `envioFlujo` (drizzle-kit reads this file for the snapshot).
- Create `drizzle/0002_*.sql` (+ `meta/` update) — generated migration.
- Create `src/drain.ts` — the drainer logic.
- Create `src/drain.test.ts` — PGlite drainer behaviour tests.
- Create `src/drain.concurrency.test.ts` — real-Postgres claim contention + RLS.
- Modify `src/backend.ts` — add `client` option; `drain` delegating to `drain.ts`.

**`packages/fiscal`**:
- Modify `src/backend.ts` — add `DrainResult` and `drain(now): Promise<DrainResult>` to `FiscalBackend`.
- Modify `src/index.ts` — export the `DrainResult` type.
- Modify `src/testing/fake-backend.ts` — `FakeFiscalBackend.drain`.

---

## Task 1: Request-parsers `parseEnvio` / `parseConsulta` (`packages/verifactu`)

The fake AEAT (Task 2) needs to read the inbound envío/consulta XML the real `serialize.ts` produced. Add the inverse of `serializeEnvio`/`serializeConsulta` as real, mutation-gated library API. By the time a record reaches `serializeEnvio` every leaf is already a string (`RegistroAlta.CuotaTotal`/`ImporteTotal` and `DetalleDesglose.BaseImponible…` are `string`-typed — [`types.ts:124`](../../../packages/verifactu/src/types.ts#L124), [`:60`](../../../packages/verifactu/src/types.ts#L60)), so the round-trip is lossless.

**Files:**
- Create: `packages/verifactu/src/xml/parse-request.ts`
- Test: `packages/verifactu/src/xml/parse-request.test.ts`
- Modify: `packages/verifactu/src/index.ts`, `packages/verifactu/src/index.test.ts`

**Interfaces:**
- Consumes: `parser`, `asArray` (`./parse-common.js`); `Cabecera`, `ConsultaFiltro`, `EnvioRegistro`, `serializeEnvio`, `serializeConsulta` (`./serialize.js`); `RegistroAlta`, `RegistroAnulacion`, `DetalleDesglose`, `Encadenamiento`, `SistemaInformatico`, `IDFacturaAR`, `DesgloseRectificacion` (`../types.js`).
- Produces: `parseEnvio(xml: string): { cabecera: Cabecera; registros: EnvioRegistro[] }` and `parseConsulta(xml: string): { cabecera: Cabecera; filtro: ConsultaFiltro }`.

- [ ] **Step 1: Write the failing round-trip test**

```ts
// packages/verifactu/src/xml/parse-request.test.ts
import { describe, expect, it } from "vitest";
import { serializeConsulta, serializeEnvio, type Cabecera, type ConsultaFiltro, type EnvioRegistro }
  from "./serialize.js";
import { parseConsulta, parseEnvio } from "./parse-request.js";
import type { RegistroAlta, RegistroAnulacion } from "../types.js";

const cabecera: Cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };

const alta: RegistroAlta = {
  IDVersion: "1.0",
  IDFactura: { IDEmisorFactura: "89890001K", NumSerieFactura: "A/1", FechaExpedicionFactura: "20-07-2026" },
  RefExterna: "11111111-1111-1111-1111-111111111111",
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F2",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [{ CalificacionOperacion: "S1", TipoImpositivo: "21", BaseImponibleOimporteNoSujeto: "102.02", CuotaRepercutida: "21.43" }],
  CuotaTotal: "21.43",
  ImporteTotal: "123.45",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: {
    NombreRazon: "Waitron SL", NIF: "89890001K", NombreSistemaInformatico: "Waitron POS",
    IdSistemaInformatico: "77", Version: "0.0.0", NumeroInstalacion: "1",
    TipoUsoPosibleSoloVerifactu: "S", TipoUsoPosibleMultiOT: "S", IndicadorMultiplesOT: "N",
  },
  FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00",
  TipoHuella: "01",
  Huella: "ABC123",
};

describe("parseEnvio", () => {
  it("round-trips a single alta losslessly", () => {
    const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
    expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/verifactu test -- parse-request`
Expected: FAIL — `parse-request.js` / `parseEnvio` does not exist.

- [ ] **Step 3: Write `parse-request.ts`**

```ts
// packages/verifactu/src/xml/parse-request.ts
import { asArray, parser } from "./parse-common.js";
import type { Cabecera, ConsultaFiltro, EnvioRegistro } from "./serialize.js";
import type {
  DesgloseRectificacion, DetalleDesglose, Encadenamiento, IDFacturaAR,
  RegistroAlta, RegistroAnulacion, SistemaInformatico,
} from "../types.js";

// fast-xml-parser (parse-common's shared `parser`) strips namespace prefixes and keeps leaf
// values as exact strings, so every field below is read straight through. `removeNSPrefix` means
// `sfLR:RegistroFactura` and `sf:IDFactura` both land unprefixed.
interface RawEnvelope {
  Envelope?: { Body?: {
    RegFactuSistemaFacturacion?: {
      Cabecera?: RawCabecera;
      RegistroFactura?: RawRegistroFactura | RawRegistroFactura[];
    };
    ConsultaFactuSistemaFacturacion?: {
      Cabecera?: RawCabecera;
      FiltroConsulta?: RawFiltro;
    };
  } };
}
interface RawCabecera {
  ObligadoEmision: { NombreRazon: string; NIF: string };
  Representante?: { NombreRazon: string; NIF: string };
}
type RawRegistroFactura = { RegistroAlta: RawRecord } | { RegistroAnulacion: RawRecord };
type RawRecord = Record<string, unknown>;
interface RawFiltro {
  PeriodoImputacion: { Ejercicio: string; Periodo: string };
  NumSerieFactura?: string;
  FechaExpedicionFactura?: { FechaExpedicionFactura: string };
  ClavePaginacion?: { IDEmisorFactura: string; NumSerieFactura: string; FechaExpedicionFactura: string };
}

function cabeceraOf(raw: RawCabecera): Cabecera {
  const cabecera: Cabecera = { ObligadoEmision: { NombreRazon: raw.ObligadoEmision.NombreRazon, NIF: raw.ObligadoEmision.NIF } };
  if (raw.Representante) cabecera.Representante = { NombreRazon: raw.Representante.NombreRazon, NIF: raw.Representante.NIF };
  return cabecera;
}

// Only defined keys are copied back, so `toEqual` against the original record (which omits absent
// optionals) holds. `pick` copies a key only when present.
function pick<T extends object>(into: T, raw: RawRecord, keys: readonly string[]): void {
  for (const key of keys) {
    if (raw[key] !== undefined) (into as Record<string, unknown>)[key] = raw[key];
  }
}

function encadenamientoOf(raw: RawRecord): Encadenamiento {
  const enc = raw.Encadenamiento as { PrimerRegistro?: string; RegistroAnterior?: Record<string, string> };
  if (enc.RegistroAnterior !== undefined) {
    const a = enc.RegistroAnterior;
    return { RegistroAnterior: { IDEmisorFactura: a.IDEmisorFactura, NumSerieFactura: a.NumSerieFactura, FechaExpedicionFactura: a.FechaExpedicionFactura, Huella: a.Huella } };
  }
  return { PrimerRegistro: "S" };
}

function detalleOf(raw: RawRecord): DetalleDesglose {
  const d: DetalleDesglose = {} as DetalleDesglose;
  pick(d, raw, ["Impuesto", "ClaveRegimen", "CalificacionOperacion", "OperacionExenta", "TipoImpositivo",
    "BaseImponibleOimporteNoSujeto", "BaseImponibleACoste", "CuotaRepercutida",
    "TipoRecargoEquivalencia", "CuotaRecargoEquivalencia"]);
  return d;
}

function idFacturaArOf(raw: RawRecord): IDFacturaAR {
  return { IDEmisorFactura: raw.IDEmisorFactura as string, NumSerieFactura: raw.NumSerieFactura as string, FechaExpedicionFactura: raw.FechaExpedicionFactura as string };
}

function altaOf(raw: RawRecord): RegistroAlta {
  const idf = raw.IDFactura as Record<string, string>;
  const record = {
    IDVersion: raw.IDVersion,
    IDFactura: { IDEmisorFactura: idf.IDEmisorFactura, NumSerieFactura: idf.NumSerieFactura, FechaExpedicionFactura: idf.FechaExpedicionFactura },
    Desglose: asArray(raw.Desglose as RawRecord | RawRecord[]).map(detalleOf),
    Encadenamiento: encadenamientoOf(raw),
    SistemaInformatico: raw.SistemaInformatico as SistemaInformatico,
    FechaHoraHusoGenRegistro: raw.FechaHoraHusoGenRegistro, TipoHuella: raw.TipoHuella, Huella: raw.Huella,
  } as RegistroAlta;
  pick(record, raw, ["RefExterna", "NombreRazonEmisor", "Subsanacion", "RechazoPrevio", "TipoFactura",
    "TipoRectificativa", "FechaOperacion", "DescripcionOperacion", "FacturaSimplificadaArt7273",
    "FacturaSinIdentifDestinatarioArt61d", "Macrodato", "Cupon", "CuotaTotal", "ImporteTotal"]);
  const fr = raw.FacturasRectificadas as { IDFacturaRectificada: RawRecord | RawRecord[] } | undefined;
  if (fr) record.FacturasRectificadas = { IDFacturaRectificada: asArray(fr.IDFacturaRectificada).map(idFacturaArOf) };
  const fs = raw.FacturasSustituidas as { IDFacturaSustituida: RawRecord | RawRecord[] } | undefined;
  if (fs) record.FacturasSustituidas = { IDFacturaSustituida: asArray(fs.IDFacturaSustituida).map(idFacturaArOf) };
  const ir = raw.ImporteRectificacion as Record<string, string> | undefined;
  if (ir) {
    const rectif: DesgloseRectificacion = {} as DesgloseRectificacion;
    pick(rectif, ir, ["BaseRectificada", "CuotaRectificada", "CuotaRecargoRectificado"]);
    record.ImporteRectificacion = rectif;
  }
  return record;
}

function anulacionOf(raw: RawRecord): RegistroAnulacion {
  const idf = raw.IDFactura as Record<string, string>;
  const record = {
    IDVersion: raw.IDVersion,
    IDFactura: { IDEmisorFacturaAnulada: idf.IDEmisorFacturaAnulada, NumSerieFacturaAnulada: idf.NumSerieFacturaAnulada, FechaExpedicionFacturaAnulada: idf.FechaExpedicionFacturaAnulada },
    Encadenamiento: encadenamientoOf(raw),
    SistemaInformatico: raw.SistemaInformatico as SistemaInformatico,
    FechaHoraHusoGenRegistro: raw.FechaHoraHusoGenRegistro, TipoHuella: raw.TipoHuella, Huella: raw.Huella,
  } as RegistroAnulacion;
  pick(record, raw, ["RefExterna", "SinRegistroPrevio", "RechazoPrevio", "GeneradoPor"]);
  return record;
}

export function parseEnvio(xml: string): { cabecera: Cabecera; registros: EnvioRegistro[] } {
  const body = (parser.parse(xml) as RawEnvelope).Envelope?.Body?.RegFactuSistemaFacturacion;
  if (!body?.Cabecera) throw new Error("Envio does not contain a RegFactuSistemaFacturacion Cabecera");
  const registros = asArray(body.RegistroFactura).map((entry): EnvioRegistro =>
    "RegistroAlta" in entry ? { RegistroAlta: altaOf(entry.RegistroAlta) } : { RegistroAnulacion: anulacionOf(entry.RegistroAnulacion) });
  return { cabecera: cabeceraOf(body.Cabecera), registros };
}

export function parseConsulta(xml: string): { cabecera: Cabecera; filtro: ConsultaFiltro } {
  const body = (parser.parse(xml) as RawEnvelope).Envelope?.Body?.ConsultaFactuSistemaFacturacion;
  if (!body?.Cabecera || !body.FiltroConsulta) throw new Error("Consulta does not contain a ConsultaFactuSistemaFacturacion body");
  const f = body.FiltroConsulta;
  const filtro: ConsultaFiltro = { Ejercicio: f.PeriodoImputacion.Ejercicio, Periodo: f.PeriodoImputacion.Periodo };
  if (f.NumSerieFactura !== undefined) filtro.NumSerieFactura = f.NumSerieFactura;
  if (f.FechaExpedicionFactura !== undefined) filtro.FechaExpedicionFactura = f.FechaExpedicionFactura.FechaExpedicionFactura;
  if (f.ClavePaginacion !== undefined) filtro.ClavePaginacion = f.ClavePaginacion;
  return { cabecera: cabeceraOf(body.Cabecera), filtro };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/verifactu test -- parse-request`
Expected: PASS.

- [ ] **Step 5: Add the edge-case matrix (write, run-fail is skipped — same module now exists, so run and confirm each is green as added)**

Add to `parse-request.test.ts`, each asserting a round trip via `serialize*`:

```ts
import { anulacionRoundTrip } from "./parse-request.test.helpers.js"; // inline if preferred

it("round-trips an anulación", () => {
  const anulacion: RegistroAnulacion = {
    IDVersion: "1.0",
    IDFactura: { IDEmisorFacturaAnulada: "89890001K", NumSerieFacturaAnulada: "A/1", FechaExpedicionFacturaAnulada: "20-07-2026" },
    RefExterna: "22222222-2222-2222-2222-222222222222",
    Encadenamiento: { RegistroAnterior: { IDEmisorFactura: "89890001K", NumSerieFactura: "A/0", FechaExpedicionFactura: "19-07-2026", Huella: "PREV" } },
    SistemaInformatico: alta.SistemaInformatico,
    FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00", TipoHuella: "01", Huella: "XYZ",
  };
  const registros: EnvioRegistro[] = [{ RegistroAnulacion: anulacion }];
  expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
});

it("round-trips several records from several SIFs in one envío", () => {
  const other = structuredClone(alta);
  other.IDFactura.NumSerieFactura = "B/1";
  other.SistemaInformatico.NumeroInstalacion = "2";
  const registros: EnvioRegistro[] = [{ RegistroAlta: alta }, { RegistroAlta: other }];
  expect(parseEnvio(serializeEnvio(cabecera, registros))).toEqual({ cabecera, registros });
});

it("round-trips a cabecera with a Representante", () => {
  const c: Cabecera = { ...cabecera, Representante: { NombreRazon: "Gestoría X", NIF: "B12345678" } };
  const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
  expect(parseEnvio(serializeEnvio(c, registros))).toEqual({ cabecera: c, registros });
});

it("round-trips a consulta filtro (period + serie + clave de paginación)", () => {
  const filtro: ConsultaFiltro = {
    Ejercicio: "2026", Periodo: "07", NumSerieFactura: "A/1", FechaExpedicionFactura: "20-07-2026",
    ClavePaginacion: { IDEmisorFactura: "89890001K", NumSerieFactura: "A/9", FechaExpedicionFactura: "20-07-2026" },
  };
  expect(parseConsulta(serializeConsulta(cabecera, filtro))).toEqual({ cabecera, filtro });
});

it("round-trips a value carrying XML-special characters", () => {
  const c: Cabecera = { ObligadoEmision: { NombreRazon: "Bar & Grill <Málaga>", NIF: "89890001K" } };
  const registros: EnvioRegistro[] = [{ RegistroAlta: alta }];
  expect(parseEnvio(serializeEnvio(c, registros))).toEqual({ cabecera: c, registros });
});
```

Run: `pnpm --filter @waitron/verifactu test -- parse-request` → all PASS.

- [ ] **Step 6: Export from the barrel + reachability**

In `packages/verifactu/src/index.ts`, add beside the other `xml/` exports:

```ts
export { parseEnvio, parseConsulta } from "./xml/parse-request.js";
```

Add `parse-request.ts` to whatever list `src/index.test.ts` uses to assert every source file is reachable from the barrel (mirror the existing entries).

Run: `pnpm --filter @waitron/verifactu test` → all PASS. Then `pnpm --filter @waitron/verifactu typecheck`.

- [ ] **Step 7: Verify the mutation gate**

Run: `pnpm --filter @waitron/verifactu mutation`
Expected: overall score ≥ 90%; `parse-request.ts` mutants killed by the round-trip matrix. If survivors remain, add the specific round trip that distinguishes them (e.g. a record exercising `BaseImponibleACoste`, `FechaOperacion`, or `SinRegistroPrevio`).

- [ ] **Step 8: Commit**

```bash
git add packages/verifactu/src/xml/parse-request.ts packages/verifactu/src/xml/parse-request.test.ts \
        packages/verifactu/src/index.ts packages/verifactu/src/index.test.ts
git commit -m "feat(verifactu): parseEnvio/parseConsulta request-parsers"
```

---

## Task 2: Fake AEAT — submit path (`packages/verifactu`)

A stateful in-memory AEAT installed as the injected `fetch`. This task covers the **submit** side: dispatch by body, issue a CSV, a decreasing `TiempoEsperaEnvio`, per-record rejections from a configurable list, and error 2004 on future-dating. Resubmit/3000 and consulta come in Task 3.

**Files:**
- Create: `packages/verifactu/src/testing/fake-aeat.ts`
- Test: `packages/verifactu/src/testing/fake-aeat.test.ts`

**Interfaces:**
- Consumes: `parseEnvio` (`../xml/parse-request.js`); `createClient`, `VerifactuClient` (`../client.js`); `RegistroAlta`, `RegistroAnulacion` (`../types.js`).
- Produces:
  - `createFakeAeat(options?: FakeAeatOptions): FakeAeat`
  - `interface FakeAeat { fetch: typeof globalThis.fetch; client(): VerifactuClient; setServerNow(now: Date): void; reject(id: FacturaKey, code: number, message: string): void; stored(): StoredRecord[]; }`
  - `interface FakeAeatOptions { serverNow?: Date; tiempoEsperaInicial?: number; }`
  - `type FacturaKey = string` (`` `${IDEmisor}|${NumSerie}|${FechaExpedicion}` ``), exported helper `keyOf(record): FacturaKey`.
  - `interface StoredRecord { key: FacturaKey; huella: string; estado: "Correcta" | "AceptadaConErrores" | "Anulada"; tipo: "alta" | "anulacion"; refExterna?: string; }`

- [ ] **Step 1: Write the failing test — a clean alta is accepted and a CSV is issued**

```ts
// packages/verifactu/src/testing/fake-aeat.test.ts
import { describe, expect, it } from "vitest";
import { createFakeAeat, keyOf } from "./fake-aeat.js";
import type { RegistroAlta } from "../types.js";

const cabecera = { ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } };
function altaFixture(numSerie: string, fecha = "20-07-2026"): RegistroAlta {
  return {
    IDVersion: "1.0",
    IDFactura: { IDEmisorFactura: "89890001K", NumSerieFactura: numSerie, FechaExpedicionFactura: fecha },
    NombreRazonEmisor: "Waitron SL", TipoFactura: "F2", DescripcionOperacion: "Venta",
    Desglose: [{ CalificacionOperacion: "S1", TipoImpositivo: "21", BaseImponibleOimporteNoSujeto: "100.00", CuotaRepercutida: "21.00" }],
    CuotaTotal: "21.00", ImporteTotal: "121.00", Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: { NombreRazon: "Waitron SL", NIF: "89890001K", NombreSistemaInformatico: "Waitron POS",
      IdSistemaInformatico: "77", Version: "0.0.0", NumeroInstalacion: "1",
      TipoUsoPosibleSoloVerifactu: "S", TipoUsoPosibleMultiOT: "S", IndicadorMultiplesOT: "N" },
    FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+02:00", TipoHuella: "01", Huella: "H-" + numSerie,
  };
}

describe("fake AEAT — submit", () => {
  it("accepts a clean alta, issues a CSV, and stores it with its huella", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const respuesta = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);

    expect(respuesta.EstadoEnvio).toBe("Correcto");
    expect(respuesta.CSV).toMatch(/./);
    expect(respuesta.TiempoEsperaEnvio).toBe(60);
    expect(respuesta.RespuestaLinea[0].EstadoRegistro).toBe("Correcto");
    expect(aeat.stored()).toEqual([
      { key: keyOf(altaFixture("A/1")), huella: "H-A/1", estado: "Correcta", tipo: "alta", refExterna: undefined },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat`
Expected: FAIL — `fake-aeat.js` / `createFakeAeat` does not exist.

- [ ] **Step 3: Write `fake-aeat.ts` (submit path only)**

```ts
// packages/verifactu/src/testing/fake-aeat.ts
import { createClient, type VerifactuClient } from "../client.js";
import { escapeXml } from "../xml/escape.js";
import { parseEnvio } from "../xml/parse-request.js";
import type { RegistroAlta, RegistroAnulacion } from "../types.js";

export type FacturaKey = string;
export interface StoredRecord {
  key: FacturaKey; huella: string;
  estado: "Correcta" | "AceptadaConErrores" | "Anulada"; tipo: "alta" | "anulacion"; refExterna?: string;
}
export interface FakeAeatOptions { serverNow?: Date; tiempoEsperaInicial?: number; }
export interface FakeAeat {
  fetch: typeof globalThis.fetch;
  client(): VerifactuClient;
  setServerNow(now: Date): void;
  reject(key: FacturaKey, code: number, message: string): void;
  stored(): StoredRecord[];
}

function idOf(entry: { RegistroAlta: RegistroAlta } | { RegistroAnulacion: RegistroAnulacion }) {
  return "RegistroAlta" in entry
    ? { idf: entry.RegistroAlta.IDFactura, tipo: "alta" as const, huella: entry.RegistroAlta.Huella, ref: entry.RegistroAlta.RefExterna, fecha: entry.RegistroAlta.IDFactura.FechaExpedicionFactura }
    : { idf: { IDEmisorFactura: entry.RegistroAnulacion.IDFactura.IDEmisorFacturaAnulada, NumSerieFactura: entry.RegistroAnulacion.IDFactura.NumSerieFacturaAnulada, FechaExpedicionFactura: entry.RegistroAnulacion.IDFactura.FechaExpedicionFacturaAnulada }, tipo: "anulacion" as const, huella: entry.RegistroAnulacion.Huella, ref: entry.RegistroAnulacion.RefExterna, fecha: entry.RegistroAnulacion.IDFactura.FechaExpedicionFacturaAnulada };
}

export function keyOf(record: RegistroAlta | RegistroAnulacion): FacturaKey {
  const e = "TipoFactura" in record ? { RegistroAlta: record } : { RegistroAnulacion: record };
  const { idf } = idOf(e as never);
  return `${idf.IDEmisorFactura}|${idf.NumSerieFactura}|${idf.FechaExpedicionFactura}`;
}

// "DD-MM-YYYY" (AEAT's sf:fecha) → a UTC Date at midnight, for the future-dating (2004) check.
function fechaToDate(ddMmYyyy: string): Date {
  const [dd, mm, yyyy] = ddMmYyyy.split("-");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
}

let csvSequence = 0;

export function createFakeAeat(options: FakeAeatOptions = {}): FakeAeat {
  const store = new Map<FacturaKey, StoredRecord>();
  const rejections = new Map<FacturaKey, { code: number; message: string }>();
  let serverNow = options.serverNow ?? new Date("2026-07-21T00:00:00Z");
  let tiempoEspera = options.tiempoEsperaInicial ?? 60;

  function handleEnvio(xml: string): string {
    const { registros } = parseEnvio(xml);
    const lineas: string[] = [];
    let anyRejected = false;
    // Every non-rejected envío issues exactly one CSV (Task 3 will suppress it when the whole
    // envío is Incorrecto).
    const csv = `CSV-${String(++csvSequence).padStart(8, "0")}`;
    for (const entry of registros) {
      const { idf, tipo, huella, ref, fecha } = idOf(entry);
      const key = `${idf.IDEmisorFactura}|${idf.NumSerieFactura}|${idf.FechaExpedicionFactura}`;
      const forced = rejections.get(key);
      const future = fechaToDate(fecha).getTime() > serverNow.getTime();
      if (forced) {
        anyRejected = true;
        lineas.push(lineaXml(idf, "Incorrecto", forced.code, forced.message, ref));
      } else if (future) {
        // 2004 is non-rejecting: the record is still stored and the line reads AceptadoConErrores.
        store.set(key, { key, huella, estado: "AceptadaConErrores", tipo, refExterna: ref });
        lineas.push(lineaXml(idf, "AceptadoConErrores", 2004, "Fecha de expedición posterior a la fecha del sistema", ref));
      } else {
        store.set(key, { key, huella, estado: "Correcta", tipo, refExterna: ref });
        lineas.push(lineaXml(idf, "Correcto", undefined, undefined, ref));
      }
    }
    tiempoEspera = Math.max(1, tiempoEspera - 1); // decreasing, as AEAT updates it each response
    return suministroEnvelope(csv, anyRejected ? "ParcialmenteCorrecto" : "Correcto", tiempoEspera, lineas);
  }

  const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    const xml = handleEnvio(body); // Task 3 adds consulta dispatch by body sniff
    return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
  };

  return {
    fetch: fetchImpl,
    client: () => createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fetchImpl }),
    setServerNow: (now) => { serverNow = now; },
    reject: (key, code, message) => rejections.set(key, { code, message }),
    stored: () => [...store.values()],
  };
}

// --- response XML builders (parsed by the unmodified parseRespuestaSuministro) --------------
function lineaXml(idf: { IDEmisorFactura: string; NumSerieFactura: string; FechaExpedicionFactura: string },
  estado: string, code: number | undefined, message: string | undefined, ref: string | undefined): string {
  return "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    `<sfR:EstadoRegistro>${estado}</sfR:EstadoRegistro>` +
    (code !== undefined ? `<sfR:CodigoErrorRegistro>${code}</sfR:CodigoErrorRegistro>` : "") +
    (message !== undefined ? `<sfR:DescripcionErrorRegistro>${escapeXml(message)}</sfR:DescripcionErrorRegistro>` : "") +
    "</sfR:RespuestaLinea>";
}
function suministroEnvelope(csv: string, estadoEnvio: string, tiempo: number, lineas: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfR="sfR"><soapenv:Body>` +
    "<sfR:RespuestaRegFactuSistemaFacturacion>" +
    `<sfR:CSV>${escapeXml(csv)}</sfR:CSV>` +
    `<sfR:EstadoEnvio>${estadoEnvio}</sfR:EstadoEnvio>` +
    `<sfR:TiempoEsperaEnvio>${tiempo}</sfR:TiempoEsperaEnvio>` +
    lineas.join("") +
    "</sfR:RespuestaRegFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>";
}
```

> Confirm `escapeXml` is exported from `packages/verifactu/src/xml/escape.js` (it is used by `serialize.ts`). The response XML uses arbitrary namespace prefixes because `parse-common`'s parser has `removeNSPrefix: true` — prefixes are stripped, so only the local names must match.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat`
Expected: PASS.

- [ ] **Step 5: Add rejection + 2004 tests, implement is already present — run each green**

```ts
it("rejects a record on the configured reject list, marking the envío ParcialmenteCorrecto", async () => {
  const aeat = createFakeAeat();
  aeat.reject(keyOf(altaFixture("A/9")), 1100, "Campo obligatorio ausente");
  const r = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }, { RegistroAlta: altaFixture("A/9") }]);
  expect(r.EstadoEnvio).toBe("ParcialmenteCorrecto");
  expect(r.RespuestaLinea[1].EstadoRegistro).toBe("Incorrecto");
  expect(r.RespuestaLinea[1].CodigoErrorRegistro).toBe(1100);
  expect(aeat.stored().map((s) => s.key)).toEqual([keyOf(altaFixture("A/1"))]); // rejected one not stored
});

it("flags a future-dated record with 2004 (AceptadoConErrores) without rejecting it", async () => {
  const aeat = createFakeAeat({ serverNow: new Date("2026-07-20T00:00:00Z") });
  const r = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1", "25-07-2026") }]);
  expect(r.RespuestaLinea[0].EstadoRegistro).toBe("AceptadoConErrores");
  expect(r.RespuestaLinea[0].CodigoErrorRegistro).toBe(2004);
  expect(aeat.stored()[0].estado).toBe("AceptadaConErrores");
});

it("decreases TiempoEsperaEnvio on each response", async () => {
  const aeat = createFakeAeat();
  const first = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  const second = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/2") }]);
  expect(second.TiempoEsperaEnvio).toBeLessThan(first.TiempoEsperaEnvio);
});
```

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/verifactu/src/testing/fake-aeat.ts packages/verifactu/src/testing/fake-aeat.test.ts
git commit -m "feat(verifactu): faithful fake AEAT — submit path"
```

---

## Task 3: Fake AEAT — resubmit/3000 + consulta (`packages/verifactu`)

Extend the fake with the duplicate path (a resubmit of a stored identity returns **error 3000** with a `RegistroDuplicado` block reporting the stored state) and the **consulta** path (`consultar` returns the stored record with its `Huella`, for Route B).

**Files:**
- Modify: `packages/verifactu/src/testing/fake-aeat.ts`
- Modify: `packages/verifactu/src/testing/fake-aeat.test.ts`

**Interfaces:**
- Consumes (additionally): `parseConsulta` (`../xml/parse-request.js`).
- Produces (additions to `FakeAeat`): behaviour only — `client().consultar(...)` now returns stored records; a resubmit returns 3000. Add `dropRegistroDuplicadoDetail(key)` to force the `duplicate_unknown` case (a 3000 whose `RegistroDuplicado` omits `EstadoRegistroDuplicado`), and `annul(key)` to mark a stored record `Anulada`.

- [ ] **Step 1: Write the failing test — resubmit returns 3000 with the stored state**

```ts
it("returns error 3000 with the stored state on a resubmit of the same identity", async () => {
  const aeat = createFakeAeat();
  await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  const linea = again.RespuestaLinea[0];
  expect(linea.EstadoRegistro).toBe("Incorrecto");
  expect(linea.CodigoErrorRegistro).toBe(3000);
  expect(linea.RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Correcta");
});

it("consultar returns the stored record with its huella", async () => {
  const aeat = createFakeAeat();
  await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  const r = await aeat.client().consultar(cabecera, { Ejercicio: "2026", Periodo: "07", NumSerieFactura: "A/1", FechaExpedicionFactura: "20-07-2026" });
  expect(r.ResultadoConsulta).toBe("ConDatos");
  expect(r.registros[0].DatosRegistroFacturacion.Huella).toBe("H-A/1");
  expect(r.registros[0].EstadoRegistro).toBe("Correcta");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat`
Expected: FAIL — resubmit currently overwrites the store and returns `Correcto`; `consultar` hits `handleEnvio` (wrong dispatch) and throws.

- [ ] **Step 3: Implement — dispatch by body, duplicate detection, consulta response**

In `fake-aeat.ts`, change `fetchImpl` to dispatch by sniffing the SOAP body, add duplicate handling in `handleEnvio`, and add `handleConsulta`:

```ts
import { parseConsulta } from "../xml/parse-request.js";
// ... inside createFakeAeat, add state:
const noDuplicadoDetail = new Set<FacturaKey>();

// in handleEnvio's loop, BEFORE the forced/future/clean branches:
const existing = store.get(key);
if (existing) {
  anyRejected = true; // 3000 is an Incorrecto line at the outer level
  const detail = noDuplicadoDetail.has(key) ? undefined : existing.estado;
  lineas.push(duplicadoLineaXml(idf, detail, ref));
  continue;
}

// new fetch dispatch:
const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
  const body = String(init?.body ?? "");
  const xml = body.includes("ConsultaFactuSistemaFacturacion") ? handleConsulta(body) : handleEnvio(body);
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
};

function handleConsulta(xml: string): string {
  const { filtro } = parseConsulta(xml);
  // Targeted single-record lookup (Route B). 3b widens this to a paged period sweep.
  const matches = [...store.values()].filter((s) => s.key.split("|")[1] === filtro.NumSerieFactura);
  return consultaEnvelope(matches);
}

// expose:
return {
  // ...existing,
  dropRegistroDuplicadoDetail: (key: FacturaKey) => noDuplicadoDetail.add(key),
  annul: (key: FacturaKey) => { const s = store.get(key); if (s) s.estado = "Anulada"; },
};
```

Add the two builders (append to the file):

```ts
function duplicadoLineaXml(idf: { IDEmisorFactura: string; NumSerieFactura: string; FechaExpedicionFactura: string },
  estadoDuplicado: string | undefined, ref: string | undefined): string {
  return "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    "<sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>" +
    "<sfR:CodigoErrorRegistro>3000</sfR:CodigoErrorRegistro>" +
    "<sfR:DescripcionErrorRegistro>Registro duplicado</sfR:DescripcionErrorRegistro>" +
    "<sfR:RegistroDuplicado>" +
    (estadoDuplicado !== undefined ? `<sfR:EstadoRegistroDuplicado>${estadoDuplicado}</sfR:EstadoRegistroDuplicado>` : "") +
    "</sfR:RegistroDuplicado>" +
    "</sfR:RespuestaLinea>";
}
function consultaEnvelope(matches: StoredRecord[]): string {
  const registros = matches.map((s) => {
    const [emisor, serie, fecha] = s.key.split("|");
    return "<sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>" +
      "<sfRC:IDFactura>" +
      `<sf:IDEmisorFactura>${escapeXml(emisor)}</sf:IDEmisorFactura>` +
      `<sf:NumSerieFactura>${escapeXml(serie)}</sf:NumSerieFactura>` +
      `<sf:FechaExpedicionFactura>${escapeXml(fecha)}</sf:FechaExpedicionFactura>` +
      "</sfRC:IDFactura>" +
      "<sfRC:DatosRegistroFacturacion>" +
      `<sf:Huella>${escapeXml(s.huella)}</sf:Huella><sf:TipoHuella>01</sf:TipoHuella>` +
      "</sfRC:DatosRegistroFacturacion>" +
      "<sfRC:EstadoRegistro>" +
      "<sf:TimestampUltimaModificacion>2026-07-21T00:00:00+00:00</sf:TimestampUltimaModificacion>" +
      `<sf:EstadoRegistro>${s.estado}</sf:EstadoRegistro>` +
      "</sfRC:EstadoRegistro>" +
      "</sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>";
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfRC="sfRC"><soapenv:Body>` +
    "<sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    `<sfRC:ResultadoConsulta>${matches.length > 0 ? "ConDatos" : "SinDatos"}</sfRC:ResultadoConsulta>` +
    "<sfRC:IndicadorPaginacion>N</sfRC:IndicadorPaginacion>" +
    registros +
    "</sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>";
}
```

Also extend the `FakeAeat` interface with `dropRegistroDuplicadoDetail(key: FacturaKey): void` and `annul(key: FacturaKey): void`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat`
Expected: PASS (new + all Task 2 tests).

- [ ] **Step 5: Add the duplicate_unknown and annulled tests**

```ts
it("omits EstadoRegistroDuplicado when detail is dropped (the duplicate_unknown case)", async () => {
  const aeat = createFakeAeat();
  await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  aeat.dropRegistroDuplicadoDetail(keyOf(altaFixture("A/1")));
  const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  expect(again.RespuestaLinea[0].CodigoErrorRegistro).toBe(3000);
  expect(again.RespuestaLinea[0].RegistroDuplicado?.EstadoRegistroDuplicado).toBeUndefined();
});

it("reports an annulled stored record as Anulada on resubmit", async () => {
  const aeat = createFakeAeat();
  await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  aeat.annul(keyOf(altaFixture("A/1")));
  const again = await aeat.client().submit(cabecera, [{ RegistroAlta: altaFixture("A/1") }]);
  expect(again.RespuestaLinea[0].RegistroDuplicado?.EstadoRegistroDuplicado).toBe("Anulada");
});
```

Run: `pnpm --filter @waitron/verifactu test -- fake-aeat` → all PASS. Then `pnpm --filter @waitron/verifactu typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/verifactu/src/testing/fake-aeat.ts packages/verifactu/src/testing/fake-aeat.test.ts
git commit -m "feat(verifactu): fake AEAT — error 3000 duplicate + consulta"
```

---

## Task 4: `envio_flujo` table + migration (`packages/fiscal-verifactu`)

The per-tenant flow-control state (§6). `envios.proximo_intento_en` is per-record and the write path defaults new rows to `now()`, so it cannot enforce a minimum interval between envíos; a per-tenant row can.

**Files:**
- Create: `packages/fiscal-verifactu/src/schema/envio-flujo.ts`
- Modify: `packages/fiscal-verifactu/src/schema/index.ts`
- Create: `packages/fiscal-verifactu/drizzle/0002_*.sql` (+ `meta/` — generated, do not hand-write)
- Test: add to `packages/fiscal-verifactu/src/migrations.test.ts` (or a focused `envio-flujo.test.ts`)

**Interfaces:**
- Produces: `envioFlujo` Drizzle table with columns `tenantId` (uuid PK, FK `tenants.id`), `proximoEnvioEn` (timestamptz, not null), `tiempoEsperaSeg` (integer, not null). RLS enabled.

- [ ] **Step 1: Write the schema**

```ts
// packages/fiscal-verifactu/src/schema/envio-flujo.ts
import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * Per-tenant (per obligado tributario) flow-control state. Holds when this obligado's NEXT envío
 * may be sent and the current AEAT-supplied wait `t`. Separate from `envios.proximo_intento_en`
 * (per-record retry backoff) because the flow-control race — "send when `t` elapsed OR 1000
 * accumulated, whichever first" — is a per-tenant fact, and the write path defaults each new
 * `envios` row to `now()`, so a per-record column cannot bound the interval between envíos.
 *
 * Lazily created: a tenant with no row here has never sent, which reads as "may send now"; the
 * drainer upserts a row after the first response.
 */
export const envioFlujo = pgTable("envio_flujo", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  // When this obligado's next envío may go. Persisted, never an in-memory timer.
  proximoEnvioEn: timestamp("proximo_envio_en", { withTimezone: true }).notNull(),
  // The last TiempoEsperaEnvio AEAT returned. `\d{0,4}` in the schema → up to 9999; an integer
  // column holds it exactly, where baking it into a timestamptz would not make the seconds
  // re-readable.
  tiempoEsperaSeg: integer("tiempo_espera_seg").notNull(),
}).enableRLS();
```

- [ ] **Step 2: Export it so drizzle-kit sees it**

In `packages/fiscal-verifactu/src/schema/index.ts`, add (mirroring the existing `envios` export):

```ts
export { envioFlujo } from "./envio-flujo.js";
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @waitron/fiscal-verifactu db:generate`
Expected: a new `drizzle/0002_<name>.sql` creating `envio_flujo` with the PK, the FK to `tenants`, `NOT NULL` on both value columns, and `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, plus an updated `drizzle/meta/`.

Open the generated SQL and confirm it matches the schema. If the tenant-isolation RLS **policy** is applied by a separate convention in this repo (check how `envios`'s policy was added — grep `0000_esquema_fiscal.sql` / `0001_*` for `create policy`), add the matching policy for `envio_flujo` via `db:generate:custom` so a non-superuser role is actually scoped. Note the exact policy SQL used for `envios` and replicate it.

- [ ] **Step 4: Write a migration test**

```ts
// in migrations.test.ts (or envio-flujo.test.ts)
import { createPgliteDb, runMigrations, CORE_MIGRATIONS } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "./migrations.js";

it("creates envio_flujo with a tenant PK and both value columns not-null", async () => {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
  const cols = await db.execute<{ column_name: string; is_nullable: string }>(sql`
    select column_name, is_nullable from information_schema.columns where table_name = 'envio_flujo'
  `);
  const byName = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.is_nullable]));
  expect(byName).toMatchObject({ tenant_id: "NO", proximo_envio_en: "NO", tiempo_espera_seg: "NO" });
  await db.close();
});
```

- [ ] **Step 5: Run to verify it fails, then passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- migrations` (or `envio-flujo`).
Expected: FAIL before Step 3's migration is generated/applied; PASS after. Then `pnpm --filter @waitron/fiscal-verifactu typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu/src/schema/envio-flujo.ts packages/fiscal-verifactu/src/schema/index.ts \
        packages/fiscal-verifactu/drizzle packages/fiscal-verifactu/src/migrations.test.ts
git commit -m "feat(fiscal-verifactu): envio_flujo per-tenant flow-control table"
```

---

## Task 5: The drain surface — interface, `DrainResult`, both backends' minimal `drain`, client option

Add `drain` to the interface and give every implementor a compiling, minimal-but-honest body: `FakeFiscalBackend` marks its `pending` records `acknowledged`; `VerifactuBackend` returns an empty result when nothing is due. This keeps all three packages green before the real drainer logic (Tasks 6-10) lands, and threads the new `client` option through existing construction sites.

**Files:**
- Modify: `packages/fiscal/src/backend.ts` (interface + `DrainResult`)
- Modify: `packages/fiscal/src/index.ts` (export `DrainResult`)
- Modify: `packages/fiscal/src/testing/fake-backend.ts` (`FakeFiscalBackend.drain`)
- Modify: `packages/fiscal-verifactu/src/backend.ts` (`client` option + minimal `drain`)
- Modify: every existing `new VerifactuBackend({...})` construction site in tests (thread a `client`)

**Interfaces:**
- Produces:
  - `interface DrainResult { nextDueAt: Date | null; batchesSent: number; recordsSubmitted: number; recordsAccepted: number; recordsHalted: number; incidentsRaised: number; }`
  - `FiscalBackend.drain(now: Date): Promise<DrainResult>`
  - `VerifactuBackendOptions.client: VerifactuClient`
- Consumes: `VerifactuClient` (`@waitron/verifactu`).

- [ ] **Step 1: Write the failing interface test — the fake drains pending records**

```ts
// packages/fiscal/src/testing/fake-backend.test.ts — add
it("drain acknowledges pending records so pendingCount drops to zero", async () => {
  // seed one pending fake record via recordSale (see existing tests in this file for setup)
  const before = await backend.pendingCount(tenantId, tillId);
  expect(before).toBeGreaterThan(0);
  const result = await backend.drain(new Date("2026-07-21T00:00:00Z"));
  expect(result.recordsAccepted).toBe(before);
  expect(result.nextDueAt).toBeNull();
  expect(await backend.pendingCount(tenantId, tillId)).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal test -- fake-backend`
Expected: FAIL — `drain` is not a method.

- [ ] **Step 3: Add `DrainResult` + `drain` to the interface**

In `packages/fiscal/src/backend.ts`, add above `FiscalBackend` and inside it (update the reserved-names doc comment to note `drain` is now filled, `reconcile` still pending 3b):

```ts
/**
 * The outcome of one `drain(now)` pass. `nextDueAt` is the only field a scheduler needs — when to
 * invoke `drain` again (null = nothing pending). The counts are for a log line and observability;
 * a caller needing per-record detail reads the module's own tables.
 */
export interface DrainResult {
  nextDueAt: Date | null;
  batchesSent: number;
  recordsSubmitted: number;
  recordsAccepted: number; // includes accepted-with-errors — AEAT stored it
  recordsHalted: number;   // rechazado + detenido
  incidentsRaised: number;
}

// inside interface FiscalBackend:
  /**
   * Submits everything currently due (`estado = 'pendiente' AND proximo_intento_en <= now`) in
   * per-obligado batches and returns when to run again. One pass; the repeating cadence is the
   * caller re-invoking on `nextDueAt`, driven by the database, never an in-memory timer. A backend
   * with nothing to submit answers `{ nextDueAt: null, …zeros }`.
   */
  drain(now: Date): Promise<DrainResult>;
```

Export `DrainResult` from `packages/fiscal/src/index.ts` alongside the other `backend.ts` types.

- [ ] **Step 4: Implement `FakeFiscalBackend.drain`**

In `packages/fiscal/src/testing/fake-backend.ts`:

```ts
import type { DrainResult } from "../backend.js"; // add to existing type import

async drain(_now: Date): Promise<DrainResult> {
  const pending = await this.db.execute<{ count: string }>(sql`
    select count(*)::text as count from fake_fiscal_records where state = 'pending'
  `);
  const accepted = Number(pending.rows[0].count);
  await this.db.execute(sql`update fake_fiscal_records set state = 'acknowledged' where state = 'pending'`);
  return { nextDueAt: null, batchesSent: accepted > 0 ? 1 : 0, recordsSubmitted: accepted, recordsAccepted: accepted, recordsHalted: 0, incidentsRaised: 0 };
}
```

- [ ] **Step 5: Add `client` to `VerifactuBackendOptions` + a minimal `VerifactuBackend.drain`**

In `packages/fiscal-verifactu/src/backend.ts`:

```ts
import type { VerifactuClient } from "@waitron/verifactu"; // add
import type { DrainResult } from "@waitron/fiscal"; // add

// in VerifactuBackendOptions:
  /** The AEAT transport. mTLS/endpoint live inside the caller-supplied fetch this wraps
   * (createClient({ endpoint, fetch })); tests wire it over the fake AEAT's fetch. */
  client: VerifactuClient;

// in the constructor:
  private readonly client: VerifactuClient;
  // ... this.client = options.client;

// method (Task 6 replaces the body with a delegation to drain.ts):
async drain(_now: Date): Promise<DrainResult> {
  return { nextDueAt: null, batchesSent: 0, recordsSubmitted: 0, recordsAccepted: 0, recordsHalted: 0, incidentsRaised: 0 };
}
```

- [ ] **Step 6: Thread `client` through existing VerifactuBackend construction sites**

Every `new VerifactuBackend({ clock, db, … })` in tests (`backend.test.ts`, `write-path.e2e.test.ts`, `void-path.e2e.test.ts`, `pending-count.rls.test.ts`, and `packages/core` tests if any construct it) now needs a `client`. Add a shared helper and pass it:

```ts
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
// ...
const aeat = createFakeAeat();
const backend = new VerifactuBackend({ clock, db, client: aeat.client() /*, environment, systemInfo */ });
```

Run: `pnpm --filter @waitron/fiscal typecheck && pnpm --filter @waitron/fiscal-verifactu typecheck` to surface every unfixed site; fix each.

- [ ] **Step 7: Run all three packages' tests**

Run: `pnpm --filter @waitron/fiscal test && pnpm --filter @waitron/fiscal-verifactu test`
Expected: PASS. The Step 1 fake-backend test passes; existing VerifactuBackend tests still pass (they never call `drain`, and the minimal one returns empty).

- [ ] **Step 8: Commit**

```bash
git add packages/fiscal/src/backend.ts packages/fiscal/src/index.ts packages/fiscal/src/testing/fake-backend.ts \
        packages/fiscal/src/testing/fake-backend.test.ts packages/fiscal-verifactu/src
git commit -m "feat(fiscal): drain + DrainResult on FiscalBackend; client option; minimal impls"
```

---

## Task 6: Drainer happy path — one tenant, all accepted, CSV persisted (`drain.ts`)

The first real drainer slice: for one tenant, claim the due `pendiente` rows (single ≤1000 batch), rebuild each record with `RefExterna = row.id`, submit to AEAT, and persist the CSV + `aceptado` + `confirmado_en` atomically. This installs the module structure Tasks 7-10 extend, and carries the **CSV teeth-test**.

**Files:**
- Create: `packages/fiscal-verifactu/src/drain.ts`
- Modify: `packages/fiscal-verifactu/src/backend.ts` (delegate `drain` to `drain.ts`)
- Test: `packages/fiscal-verifactu/src/drain.test.ts`

**Interfaces:**
- Consumes: `fromRegistroRow`, `RegistroRow` (`./registro-row.js`); `withTenant`, `Database`, `Transaction` (`@waitron/db`); `currentSif` (`./registro-sif.js`); `envios` (`./schema/envios.js`); `envioFlujo` (`./schema/envio-flujo.js`); `VerifactuClient`, `Cabecera`, `EnvioRegistro` (`@waitron/verifactu`); `DrainResult` (`@waitron/fiscal`).
- Produces: `drain(deps: DrainDeps, now: Date): Promise<DrainResult>` where `interface DrainDeps { db: Database; client: VerifactuClient; }`. Constant `TIEMPO_ESPERA_INICIAL_SEG = 60`.

- [ ] **Step 1: Write the failing test — a batch of pending altas is accepted and each CSV persisted**

```ts
// packages/fiscal-verifactu/src/drain.test.ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { VerifactuBackend } from "./backend.js";
import { seedPendingEnvios, type SeededDrain } from "../test/drain-fixtures.js"; // created in this step

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
}, 60_000);
afterAll(async () => { await db.close(); });

describe("drain — happy path", () => {
  let seeded: SeededDrain;
  let aeat: ReturnType<typeof createFakeAeat>;
  let backend: VerifactuBackend;

  beforeEach(async () => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    seeded = await seedPendingEnvios(db, { count: 3 }); // 3 pending altas on one till/tenant
    backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
  });

  it("submits the pending batch, marks it aceptado, and persists a CSV on every row", async () => {
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

    expect(result.recordsSubmitted).toBe(3);
    expect(result.recordsAccepted).toBe(3);
    expect(result.batchesSent).toBe(1);

    const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ estado: string; csv: string | null; confirmado_en: string | null }>(sql`
      select estado, csv, confirmado_en from envios order by registro_id
    `));
    expect(rows.rows.every((r) => r.estado === "aceptado")).toBe(true);
    expect(rows.rows.every((r) => r.csv !== null && r.csv !== "")).toBe(true);
    expect(rows.rows.every((r) => r.confirmado_en !== null)).toBe(true);
  });

  it("stamps RefExterna = registro id, so AEAT stored our id", async () => {
    await backend.drain(new Date("2026-07-21T00:01:00Z"));
    const stored = aeat.stored();
    expect(new Set(stored.map((s) => s.refExterna))).toEqual(new Set(seeded.registroIds));
  });
});
```

Create `packages/fiscal-verifactu/test/drain-fixtures.ts` with `seedPendingEnvios(db, opts)` and the full `SeededDrain` shape defined **once here** (later tasks consume these fields — do not narrow it):

```ts
export interface SeededDrainOptions { count: number; futureDated?: boolean; } // futureDated used in Task 9
export interface SeededDrain {
  tenantId: TenantId; tillId: TillId; sifId: string; nif: string; legalName: string;
  registroIds: string[];            // registros_facturacion.id per seeded row (= expected RefExterna)
  facturaKeys: string[];            // keyOf(record) per row, for aeat.reject / dropRegistroDuplicadoDetail (Tasks 9-10)
  clock: TrustedClock;              // a steady clock; reuse write-path-fixtures.steadyClock
}
export async function seedPendingEnvios(db: Database, opts: SeededDrainOptions): Promise<SeededDrain>;
```

`seedPendingEnvios` seeds a tenant + till + SIF (reuse `seedTenantWithSif`), then for `opts.count` rows inserts a `registros_facturacion` alta (model on `seedSoldRegistro`, `../test/fixtures.ts`, with increasing `secuencia` and a distinct `huella`) **and** a matching `envios` row with `estado='pendiente'`, `proximo_intento_en = '2026-07-21T00:00:00Z'`. `seedSoldRegistro` does not create the `envios` row, so add the `insert into envios (registro_id, tenant_id, proximo_intento_en)` yourself. When `opts.futureDated`, set `fecha_expedicion_factura` after the fake AEAT's `serverNow` (so the fake returns 2004 → AceptadoConErrores). Build each `facturaKeys[i]` as `` `${nif}|${numSerieFactura}|${DD-MM-YYYY fecha}` `` to match `keyOf` in `fake-aeat.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: FAIL — the minimal `drain` returns zeros; envíos stay `pendiente`.

- [ ] **Step 3: Write `drain.ts` (happy path)**

```ts
// packages/fiscal-verifactu/src/drain.ts
import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { DrainResult } from "@waitron/fiscal";
import { MAX_REGISTROS_POR_ENVIO } from "@waitron/verifactu";
import type { Cabecera, EnvioRegistro, VerifactuClient, RegistroAlta } from "@waitron/verifactu";
import { fromRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";

export const TIEMPO_ESPERA_INICIAL_SEG = 60;

export interface DrainDeps { db: Database; client: VerifactuClient; }

/** A due `envios` row joined to enough of its registro to rebuild and order it. */
type DueRow = RegistroRow & { intentos: number };

/** Enumerate tenants with due pending work. Runs on the system connection — see the RLS note in
 * §7.1 (proven on real Postgres in drain.concurrency.test.ts). */
async function tenantsWithWork(db: Database, now: Date): Promise<string[]> {
  const rows = await db.execute<{ tenant_id: string }>(sql`
    select distinct tenant_id from envios
    where estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()}
  `);
  return rows.rows.map((r) => r.tenant_id);
}

export async function drain(deps: DrainDeps, now: Date): Promise<DrainResult> {
  const result: DrainResult = { nextDueAt: null, batchesSent: 0, recordsSubmitted: 0, recordsAccepted: 0, recordsHalted: 0, incidentsRaised: 0 };
  for (const tenantId of await tenantsWithWork(deps.db, now)) {
    await withTenant(deps.db, tenantId, async (tx) => {
      await drainTenant(tx, deps.client, tenantId, now, result);
    });
  }
  return result;
}

async function drainTenant(tx: Transaction, client: VerifactuClient, tenantId: string, now: Date, result: DrainResult): Promise<void> {
  // Happy path: one ≤1000 batch of due pending rows, ordered by chain sequence within each SIF.
  const batch = await claimBatch(tx, tenantId, now);
  if (batch.length === 0) return;

  const cabecera = await cabeceraFor(tx, tenantId, batch[0]);
  const registros: EnvioRegistro[] = batch.map(toEnvioRegistro);
  const respuesta = await client.submit(cabecera, registros);

  await persistResponse(tx, batch, respuesta, now, result);
}

/** Claim due pending rows → `enviando`. Task 8 adds FOR UPDATE SKIP LOCKED + intentos + enviado_en. */
async function claimBatch(tx: Transaction, tenantId: string, now: Date): Promise<DueRow[]> {
  const rows = await tx.execute<DueRow>(sql`
    select r.*, e.intentos from envios e
    join registros_facturacion r on r.id = e.registro_id
    where e.tenant_id = ${tenantId} and e.estado = 'pendiente' and e.proximo_intento_en <= ${now.toISOString()}
    order by r.sif_id, r.secuencia
    limit ${MAX_REGISTROS_POR_ENVIO}
  `);
  if (rows.rows.length > 0) {
    const ids = rows.rows.map((r) => r.id);
    await tx.execute(sql`update envios set estado = 'enviando' where registro_id = any(${ids})`);
  }
  return rows.rows;
}

function toEnvioRegistro(row: RegistroRow): EnvioRegistro {
  const record = fromRegistroRow(row);
  // RefExterna = our registro id (§10). Derived, not stored; not a huella input, so safe to attach
  // after hashing. row.id is the registros_facturacion UUID.
  if (row.tipo_registro === "anulacion") return { RegistroAnulacion: { ...record, RefExterna: row.id } as never };
  return { RegistroAlta: { ...(record as RegistroAlta), RefExterna: row.id } };
}

async function cabeceraFor(tx: Transaction, tenantId: string, row: RegistroRow): Promise<Cabecera> {
  // The obligado emisor is on every stored row (nombre_razon_emisor / id_emisor_factura).
  return { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } };
}

async function persistResponse(tx: Transaction, batch: DueRow[], respuesta: Awaited<ReturnType<VerifactuClient["submit"]>>, now: Date, result: DrainResult): Promise<void> {
  result.batchesSent += 1;
  result.recordsSubmitted += batch.length;
  const csv = respuesta.CSV ?? null;
  // Happy path: every line accepted. Task 9/10 resolve per-record via resolveEstadoEfectivo.
  for (const row of batch) {
    result.recordsAccepted += 1;
    // CSV is written in the SAME transaction as the response — the highest-consequence line in the
    // outbox (§7). Dropping this write must fail the teeth-test below.
    await tx.execute(sql`
      update envios set estado = 'aceptado', csv = ${csv}, confirmado_en = ${now.toISOString()}, enviado_en = ${now.toISOString()}
      where registro_id = ${row.id}
    `);
  }
}
```

Wire `VerifactuBackend.drain` to delegate:

```ts
// packages/fiscal-verifactu/src/backend.ts — replace the minimal body
import { drain as runDrain } from "./drain.js";
// ...
async drain(now: Date): Promise<DrainResult> {
  return runDrain({ db: this.db, client: this.client }, now);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: PASS (both happy-path tests).

- [ ] **Step 5: Add the CSV teeth-test**

```ts
it("TEETH: dropping the CSV write leaves a row with no CSV — this test must fail if csv is not persisted", async () => {
  await backend.drain(new Date("2026-07-21T00:01:00Z"));
  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ csv: string | null }>(sql`select csv from envios`));
  // If a future change drops `csv = ${csv}` from persistResponse, this assertion fails.
  expect(rows.rows.every((r) => r.csv !== null)).toBe(true);
});
```

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain` → PASS. Manually confirm the teeth-test bites: temporarily remove `csv = ${csv}` from `persistResponse`, re-run, observe FAIL, restore.

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu/src/drain.ts packages/fiscal-verifactu/src/drain.test.ts \
        packages/fiscal-verifactu/test/drain-fixtures.ts packages/fiscal-verifactu/src/backend.ts
git commit -m "feat(fiscal-verifactu): drainer happy path — submit, accept, persist CSV"
```

---

## Task 7: Batching, the 1001-split, and flow control (`envio_flujo`)

Make `drainTenant` loop: chunk the backlog at 1000, send back-to-back while ≥1000 remain (the "1000 accumulated" branch), and otherwise gate the next envío on `envio_flujo.proximo_envio_en = now + t` (the "`t` elapsed" branch). Compute `nextDueAt`.

**Files:**
- Modify: `packages/fiscal-verifactu/src/drain.ts`
- Modify: `packages/fiscal-verifactu/src/drain.test.ts`

**Interfaces:**
- Consumes (additionally): `envioFlujo` (`./schema/envio-flujo.js`), `TIEMPO_ESPERA_INICIAL_SEG`.
- Produces: no new exports; `drainTenant` now loops and updates `envio_flujo`; `DrainResult.nextDueAt` is populated.

- [ ] **Step 1: Write the failing tests — 1001-split and flow gate**

```ts
it("splits a >1000 backlog at the XSD cap: full 1000-chunk now, the <1000 tail deferred until t", async () => {
  // Flow-control decision (spec §7, whichever-first): a trailing partial AFTER a full chunk is
  // neither a full batch nor t-elapsed, so it waits — it does NOT ride back-to-back this pass.
  const seeded = await seedPendingEnvios(db, { count: 1001 });
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });

  const first = await backend.drain(new Date("2026-07-21T00:01:00Z"));
  expect(first.batchesSent).toBe(1);            // the full 1000-chunk only
  expect(first.recordsSubmitted).toBe(1000);
  expect(first.nextDueAt).not.toBeNull();       // the deferred tail schedules the next pass at now+t

  const pending = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ count: string }>(sql`
    select count(*)::text as count from envios where tenant_id = ${seeded.tenantId} and estado = 'pendiente'
  `));
  expect(Number(pending.rows[0].count)).toBe(1); // exactly the tail remains

  // Second pass at the gated time: the tail goes — 1001 total, split, never rejected with 4113/4114.
  const second = await backend.drain(first.nextDueAt!);
  expect(second.batchesSent).toBe(1);
  expect(second.recordsSubmitted).toBe(1);
});

it("persists the server's TiempoEsperaEnvio into envio_flujo and sets nextDueAt when a partial batch remains for next time", async () => {
  // 3 records → one partial envío; the tenant's next envío waits t.
  const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));
  const flujo = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(sql`select proximo_envio_en, tiempo_espera_seg from envio_flujo`));
  expect(flujo.rows[0].tiempo_espera_seg).toBeGreaterThan(0);
  // nothing pending now, so nextDueAt is null; assert flujo persisted instead:
  expect(result.nextDueAt).toBeNull();
});

it("round-trips TiempoEsperaEnvio = 9999 into tiempo_espera_seg", async () => {
  const big = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z"), tiempoEsperaInicial: 10000 });
  const backend2 = new VerifactuBackend({ clock: seeded.clock, db, client: big.client() });
  await backend2.drain(new Date("2026-07-21T00:01:00Z"));
  const flujo = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ tiempo_espera_seg: number }>(sql`select tiempo_espera_seg from envio_flujo`));
  expect(flujo.rows[0].tiempo_espera_seg).toBe(9999); // fake caps its decreasing t at ≤9999 per the schema
});
```

> For the 9999 test the fake should clamp `tiempoEsperaInicial` into the schema's `\d{0,4}` domain — add `Math.min(9999, …)` where the fake initialises `tiempoEspera`, so the first response reports 9999. Adjust the Task 2 fake accordingly and note it in that file.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: FAIL — current `drainTenant` sends exactly one batch and never writes `envio_flujo`.

- [ ] **Step 3: Implement the loop + flow control**

> **⚠️ STRUCTURE UPDATE — the T1/T2 split (read the current `drain.ts` first).** After Task 6, `drain.ts` uses the spec-§7.2 transaction split: `drainTenant(db, client, tenantId, now, result)` takes **`db`, not a `tx`**, and never holds a transaction across the network call. Claim runs in `withTenant(db, tenantId, (tx) => claimBatch(tx, …))`, `client.submit(…)` runs **outside any transaction**, and persist runs in `withTenant(db, tenantId, (tx) => persistResponse(tx, …))`. Also note Task 6 simplified `cabeceraFor` to take just the row: `cabeceraFor(batch[0]!)` (synchronous, no `tx`/`tenantId`). The flow-control helpers below (`readFlujo`/`countDue`/`upsertFlujo`) still take a `tx` and run inside a `withTenant` tx. Build the loop on the split as shown here:

Replace `drainTenant` and add the flow helpers (`TIEMPO_ESPERA_INICIAL_SEG` is already defined at the top of `drain.ts` from Task 6 — do not re-import it):

```ts
async function drainTenant(db: Database, client: VerifactuClient, tenantId: string, now: Date, result: DrainResult): Promise<void> {
  // Read flow state + current due count in one short tx.
  const { flujo, dueCount0 } = await withTenant(db, tenantId, async (tx) => ({
    flujo: await readFlujo(tx, tenantId),      // { proximoEnvioEn: Date | null, tiempoEsperaSeg: number }
    dueCount0: await countDue(tx, tenantId, now),
  }));
  const gateOpen = flujo.proximoEnvioEn === null || flujo.proximoEnvioEn.getTime() <= now.getTime();
  // The race: send if the gate is open OR a full envío has accumulated. Otherwise defer to the gate.
  if (dueCount0 === 0) return;
  if (!gateOpen && dueCount0 < MAX_REGISTROS_POR_ENVIO) {
    bumpNextDue(result, flujo.proximoEnvioEn);
    return;
  }

  let t = flujo.tiempoEsperaSeg || TIEMPO_ESPERA_INICIAL_SEG;
  let dueCount = dueCount0;
  while (dueCount > 0) {
    const batch = await withTenant(db, tenantId, (tx) => claimBatch(tx, tenantId, now));   // T1
    if (batch.length === 0) break;
    const respuesta = await client.submit(cabeceraFor(batch[0]!), batch.map(toEnvioRegistro));  // network, no tx
    dueCount = await withTenant(db, tenantId, async (tx) => {                               // T2
      await persistResponse(tx, batch, respuesta, now, result);
      return countDue(tx, tenantId, now);
    });
    t = respuesta.TiempoEsperaEnvio;
    // 1000-accumulated branch: keep sending back-to-back. Otherwise stop and let the gate wait t.
    if (dueCount < MAX_REGISTROS_POR_ENVIO) break;
  }

  const proximoEnvioEn = new Date(now.getTime() + t * 1000);
  await withTenant(db, tenantId, (tx) => upsertFlujo(tx, tenantId, proximoEnvioEn, t));
  // If a partial batch still remains, the next envío is gated at proximoEnvioEn; else earliest
  // per-record retry (Task 8) drives nextDueAt. Here (happy path) surface the gate only when work remains.
  if (dueCount > 0) bumpNextDue(result, proximoEnvioEn);
}

async function readFlujo(tx: Transaction, tenantId: string): Promise<{ proximoEnvioEn: Date | null; tiempoEsperaSeg: number }> {
  const rows = await tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(sql`
    select proximo_envio_en, tiempo_espera_seg from envio_flujo where tenant_id = ${tenantId}
  `);
  const row = rows.rows[0];
  return row ? { proximoEnvioEn: new Date(row.proximo_envio_en), tiempoEsperaSeg: row.tiempo_espera_seg } : { proximoEnvioEn: null, tiempoEsperaSeg: 0 };
}

async function countDue(tx: Transaction, tenantId: string, now: Date): Promise<number> {
  const rows = await tx.execute<{ count: string }>(sql`
    select count(*)::text as count from envios
    where tenant_id = ${tenantId} and estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()}
  `);
  return Number(rows.rows[0].count);
}

async function upsertFlujo(tx: Transaction, tenantId: string, proximoEnvioEn: Date, t: number): Promise<void> {
  await tx.execute(sql`
    insert into envio_flujo (tenant_id, proximo_envio_en, tiempo_espera_seg)
    values (${tenantId}, ${proximoEnvioEn.toISOString()}, ${t})
    on conflict (tenant_id) do update set proximo_envio_en = excluded.proximo_envio_en, tiempo_espera_seg = excluded.tiempo_espera_seg
  `);
}

function bumpNextDue(result: DrainResult, at: Date | null): void {
  if (at === null) return;
  result.nextDueAt = result.nextDueAt === null ? at : new Date(Math.min(result.nextDueAt.getTime(), at.getTime()));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: PASS. If the 1001-split test sees only one envío, confirm `claimBatch`'s `limit` is `MAX_REGISTROS_POR_ENVIO` and the loop re-counts `dueCount` after each persist.

- [ ] **Step 5: Commit**

```bash
git add packages/fiscal-verifactu/src/drain.ts packages/fiscal-verifactu/src/drain.test.ts packages/verifactu/src/testing/fake-aeat.ts
git commit -m "feat(fiscal-verifactu): drainer batching + flow control (envio_flujo)"
```

---

## Task 8: Claim/persist concurrency + stale recovery + retry backoff (real Postgres)

Harden the claim: `FOR UPDATE SKIP LOCKED`, increment `intentos` and set `enviado_en` at claim, recover stale `enviando` rows on entry, and back off failed rows exponentially (cap 3600s) with `incidencia = true`. Prove disjoint claiming and RLS on **real Postgres**.

**Files:**
- Modify: `packages/fiscal-verifactu/src/drain.ts`
- Create: `packages/fiscal-verifactu/src/drain.concurrency.test.ts` (real Postgres)
- Modify: `packages/fiscal-verifactu/src/drain.test.ts` (stale recovery + backoff on PGlite where lock-free)

**Interfaces:**
- Consumes (additionally): `startRealPostgres`, `RealPostgres` (`./testing/postgres.js`); seed helpers (`./testing/seed.js`).
- Produces: constants `RECUPERACION_ENVIANDO_MS = 5 * 60_000`, `BACKOFF_BASE_MS = 60_000`, `BACKOFF_MAX_MS = 3_600_000`; `backoffMs(intentos: number): number`.

- [ ] **Step 1: Write the failing unit tests — stale recovery + backoff**

```ts
// drain.test.ts
it("recovers a stale enviando row back to pendiente with incidencia set", async () => {
  const seeded = await seedPendingEnvios(db, { count: 1 });
  // simulate a crashed claim: mark enviando with an old enviado_en
  await withTenant(db, seeded.tenantId, (tx) => tx.execute(sql`
    update envios set estado = 'enviando', enviado_en = ${new Date("2026-07-20T00:00:00Z").toISOString()}
  `));
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
  await backend.drain(new Date("2026-07-21T00:01:00Z")); // > RECUPERACION_ENVIANDO_MS later
  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ estado: string; incidencia: boolean }>(sql`select estado, incidencia from envios`));
  // recovered then re-submitted this same pass → aceptado, but incidencia stays true
  expect(rows.rows[0].incidencia).toBe(true);
});

it("backs off a transiently-failed batch exponentially, capped at 3600s, marking incidencia", async () => {
  const failing = { submit: async () => { throw new Error("network down"); }, consultar: async () => { throw new Error("n/a"); } };
  const seeded = await seedPendingEnvios(db, { count: 1 });
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: failing as never });
  const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));
  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ estado: string; intentos: number; incidencia: boolean; proximo_intento_en: string }>(sql`select estado, intentos, incidencia, proximo_intento_en from envios`));
  expect(rows.rows[0].estado).toBe("pendiente");
  expect(rows.rows[0].intentos).toBe(1);
  expect(rows.rows[0].incidencia).toBe(true);
  expect(new Date(rows.rows[0].proximo_intento_en).getTime()).toBe(new Date("2026-07-21T00:01:00Z").getTime() + 60_000);
  expect(result.nextDueAt).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: FAIL — no recovery, no backoff, `intentos` never incremented, a throwing submit propagates out of `drain`.

- [ ] **Step 3: Implement claim hardening, recovery, and backoff**

> **⚠️ STRUCTURE — map these onto Task 6's T1/T2 split (read the current `drain.ts` first).** `drainTenant` takes `db`, not a `tx`. So: **recovery** runs in its OWN short tx at the top — `await withTenant(db, tenantId, (tx) => recoverStaleClaims(tx, tenantId, now))`. **claimBatch**'s `FOR UPDATE SKIP LOCKED` select + `enviando` update stay together in the **T1 claim tx** (already `withTenant(db, tenantId, (tx) => claimBatch(tx, …))` from Task 7). The **try/catch** wraps the network `submit` (outside any tx) and the **T2 persist tx**; on failure, `backoffBatch` runs in a `withTenant` tx. This is why the split matters: `recoverStaleClaims` only has committed `enviando` rows to recover *because* claim (T1) commits before the network call. **Also:** the `enviando` UPDATE below must use `where registro_id in ${ids}` (Task 6 proved `= any(${ids})` and `in (${ids})` both fail on PG/PGlite — drizzle expands a JS array into an already-parenthesised list).

```ts
export const RECUPERACION_ENVIANDO_MS = 5 * 60_000;
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 3_600_000;
export function backoffMs(intentos: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, intentos - 1));
}

// at the top of drainTenant, before reading flujo:
await recoverStaleClaims(tx, tenantId, now);

async function recoverStaleClaims(tx: Transaction, tenantId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RECUPERACION_ENVIANDO_MS).toISOString();
  await tx.execute(sql`
    update envios set estado = 'pendiente', incidencia = true, proximo_intento_en = ${now.toISOString()}
    where tenant_id = ${tenantId} and estado = 'enviando' and enviado_en < ${cutoff}
  `);
}

// claimBatch: add FOR UPDATE SKIP LOCKED + intentos + enviado_en
async function claimBatch(tx: Transaction, tenantId: string, now: Date): Promise<DueRow[]> {
  const rows = await tx.execute<DueRow>(sql`
    select r.*, e.intentos from envios e
    join registros_facturacion r on r.id = e.registro_id
    where e.tenant_id = ${tenantId} and e.estado = 'pendiente' and e.proximo_intento_en <= ${now.toISOString()}
    order by r.sif_id, r.secuencia
    limit ${MAX_REGISTROS_POR_ENVIO}
    for update of e skip locked
  `);
  if (rows.rows.length > 0) {
    const ids = rows.rows.map((r) => r.id);
    await tx.execute(sql`
      update envios set estado = 'enviando', enviado_en = ${now.toISOString()}, intentos = intentos + 1
      where registro_id in ${ids}
    `);
  }
  return rows.rows.map((r) => ({ ...r, intentos: r.intentos + 1 })); // reflect the increment for backoff math
}

// wrap the submit in drainTenant's loop so a throw becomes a backoff, not an escape:
try {
  const respuesta = await client.submit(cabecera, registros);
  await persistResponse(tx, batch, respuesta, now, result);
  t = respuesta.TiempoEsperaEnvio;
} catch {
  await backoffBatch(tx, batch, now, result);
  break; // stop this tenant's loop; the retry is scheduled on proximo_intento_en
}

async function backoffBatch(tx: Transaction, batch: DueRow[], now: Date, result: DrainResult): Promise<void> {
  for (const row of batch) {
    const next = new Date(now.getTime() + backoffMs(row.intentos));
    await tx.execute(sql`
      update envios set estado = 'pendiente', incidencia = true, proximo_intento_en = ${next.toISOString()}
      where registro_id = ${row.id}
    `);
    bumpNextDue(result, next);
  }
}
```

> Transaction boundary note: the T1/T2 split is already in place (Task 6, spec §7.2) — claim commits (T1) before the network `submit`, then persist (or backoff) runs in a second short tx (T2). This is exactly what makes `recoverStaleClaims` meaningful: a process that crashes between T1 and T2 leaves committed `enviando` rows, which the next drain recovers (resubmit is idempotent — a duplicate returns error 3000, handled in Task 10). Do NOT collapse this back into one transaction: holding a row lock across the AEAT round-trip is the contention/pool risk the split exists to avoid. The CSV + estado still land together in the T2 persist tx (the highest-consequence atomicity rule is intact).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: PASS.

- [ ] **Step 5: Write the real-Postgres concurrency test**

```ts
// packages/fiscal-verifactu/src/drain.concurrency.test.ts
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { VerifactuBackend } from "./backend.js";
// seed via the same helpers the write path uses; see ./testing/seed.ts + ../test/fixtures.ts

let pg: RealPostgres;
beforeAll(async () => { pg = await startRealPostgres(); }); // throws if Docker absent — intended
afterAll(async () => { await pg.stop(); });

describe("drain — concurrency (real Postgres)", () => {
  it("two concurrent drains over the same tenant never submit a record twice (SKIP LOCKED)", async () => {
    const db = await pg.connect();
    // seed N pending rows on one tenant (run CORE + FISCAL migrations first — see write-path.e2e.test.ts)
    const aeat = createFakeAeat();
    const a = new VerifactuBackend({ clock, db, client: aeat.client() });
    const b = new VerifactuBackend({ clock, db, client: aeat.client() });
    const now = new Date("2026-07-21T00:01:00Z");
    const [ra, rb] = await Promise.all([a.drain(now), b.drain(now)]);
    // Each pending row is claimed by exactly one drainer: no double submission.
    expect(ra.recordsSubmitted + rb.recordsSubmitted).toBe(/* N */ 5);
    expect(aeat.stored()).toHaveLength(5); // no duplicate identities stored
    await db.close();
  });

  it("pendingCount under the app_user role reflects drained rows (RLS)", async () => {
    // Run drain, then read pendingCount as app_user (asAppUser) and assert it dropped —
    // proves the cross-tenant enumeration + withTenant scoping work under real RLS, not just superuser.
  });
});
```

Fill in the seeding using the real-Postgres seed helpers (`seedTill`, `seedSale`/`seedSoldRegistro`, `TEST_SISTEMA`) plus an `envios` insert per row, mirroring `chain.concurrency.test.ts`'s harness. Run migrations (`CORE_MIGRATIONS` then `FISCAL_MIGRATIONS`) against `db` before seeding.

- [ ] **Step 6: Run the concurrency test (requires Docker)**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain.concurrency`
Expected: PASS. If Docker is unavailable it fails loudly (by design) — do not convert to a skip.

- [ ] **Step 7: Commit**

```bash
git add packages/fiscal-verifactu/src/drain.ts packages/fiscal-verifactu/src/drain.test.ts packages/fiscal-verifactu/src/drain.concurrency.test.ts
git commit -m "feat(fiscal-verifactu): claim contention, stale recovery, retry backoff"
```

---

## Task 9: Per-record estado transitions — rejections, halting, incidents, Incidencia

Replace the happy-path "everything accepted" in `persistResponse` with the real per-record resolution via `resolveEstadoEfectivo`: `aceptado`, `aceptado_con_errores` (warning incident), `rechazado` (error incident + **halt successors** to `detenido`), and `Incidencia="S"`.

**Files:**
- Modify: `packages/fiscal-verifactu/src/drain.ts`
- Modify: `packages/fiscal-verifactu/src/drain.test.ts`

**Interfaces:**
- Consumes (additionally): `resolveEstadoEfectivo`, `RespuestaLinea`, `EstadoEfectivo` (`@waitron/verifactu`); `incidents` (`@waitron/db`).
- Produces: `resolveLine` mapping per-record; `haltSuccessors`; `raiseIncident`.

- [ ] **Step 1: Write the failing tests — rejection halts the chain and raises an incident**

```ts
it("halts a chain on a genuine rejection: the record is rechazado, its successors detenido, an error incident is raised", async () => {
  const seeded = await seedPendingEnvios(db, { count: 3 }); // secuencia 1,2,3 on one SIF
  aeat.reject(seeded.facturaKeys[1], 1100, "Campo obligatorio ausente"); // reject the middle record
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
  const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ secuencia: number; estado: string; incidencia: boolean }>(sql`
    select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id order by r.secuencia
  `));
  expect(rows.rows.map((r) => r.estado)).toEqual(["aceptado", "rechazado", "detenido"]);
  expect(rows.rows[1].incidencia).toBe(true);
  expect(result.recordsHalted).toBe(2); // rechazado + detenido
  expect(result.incidentsRaised).toBeGreaterThanOrEqual(1);

  const inc = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ code: string; severity: string }>(sql`select code, severity from incidents`));
  expect(inc.rows.some((i) => i.severity === "error")).toBe(true);
});

it("marks aceptado_con_errores and raises a warning incident, but the record still counts as accepted", async () => {
  const seeded = await seedPendingEnvios(db, { count: 1, futureDated: true }); // triggers 2004 → AceptadoConErrores
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
  const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));
  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ estado: string }>(sql`select estado from envios`));
  expect(rows.rows[0].estado).toBe("aceptado_con_errores");
  expect(result.recordsAccepted).toBe(1);
  const inc = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ severity: string }>(sql`select severity from incidents`));
  expect(inc.rows[0].severity).toBe("warning");
});
```

Extend `seedPendingEnvios` to return `facturaKeys` (the `keyOf` of each seeded record, so tests can target the fake's reject list) and accept `futureDated` (sets `fecha_expedicion_factura` after the fake's serverNow).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: FAIL — `persistResponse` marks everything `aceptado`; no incidents, no halting.

- [ ] **Step 3: Implement per-record resolution + halting + incidents**

Rewrite `persistResponse` to resolve each line and match it to its batch row by `RefExterna` (= `row.id`), and add helpers. **Thread `client` through `persistResponse → applyOutcome → handleDuplicate` now** (unused until Task 10's Route B, but wiring it here avoids a signature churn later and there is no module-global client). Update `drainTenant`'s call site to `await persistResponse(tx, client, batch, respuesta, now, result)`:

```ts
import { resolveEstadoEfectivo } from "@waitron/verifactu";
import type { RespuestaLinea, EstadoEfectivo } from "@waitron/verifactu";

async function persistResponse(tx: Transaction, client: VerifactuClient, batch: DueRow[], respuesta: Awaited<ReturnType<VerifactuClient["submit"]>>, now: Date, result: DrainResult): Promise<void> {
  result.batchesSent += 1;
  result.recordsSubmitted += batch.length;
  const csv = respuesta.CSV ?? null;
  const byId = new Map(batch.map((r) => [r.id, r]));

  for (const linea of respuesta.RespuestaLinea) {
    const row = linea.RefExterna !== undefined ? byId.get(linea.RefExterna) : undefined;
    if (!row) continue; // defensive: a line we can't match to a claimed row
    const efectivo = resolveEstadoEfectivo(linea);
    await applyOutcome(tx, client, row, efectivo, linea, csv, now, result); // Task 10 handles duplicate_* via routeB
  }
}

async function applyOutcome(tx: Transaction, client: VerifactuClient, row: DueRow, efectivo: EstadoEfectivo, linea: RespuestaLinea, csv: string | null, now: Date, result: DrainResult): Promise<void> {
  switch (efectivo) {
    case "accepted":
      await setEstado(tx, row.id, "aceptado", { csv, confirmadoEn: now });
      result.recordsAccepted += 1;
      return;
    case "accepted_with_errors":
      await setEstado(tx, row.id, "aceptado_con_errores", { csv, confirmadoEn: now });
      await raiseIncident(tx, row, "warning", "fiscal.aceptado_con_errores", { codigo: linea.CodigoErrorRegistro, mensaje: linea.DescripcionErrorRegistro }, now, result);
      result.recordsAccepted += 1;
      return;
    case "rejected":
      await setEstado(tx, row.id, "rechazado", { csv, codigoError: linea.CodigoErrorRegistro, mensajeError: linea.DescripcionErrorRegistro, incidencia: true });
      await raiseIncident(tx, row, "error", "fiscal.registro_rechazado", { codigo: linea.CodigoErrorRegistro, mensaje: linea.DescripcionErrorRegistro }, now, result);
      result.recordsHalted += 1 + await haltSuccessors(tx, row, now);
      return;
    // duplicate_annulled / duplicate_unknown handled in Task 10
    default:
      await handleDuplicate(tx, client, row, efectivo, csv, now, result);
  }
}

async function setEstado(tx: Transaction, registroId: string, estado: string, opts: { csv?: string | null; confirmadoEn?: Date; codigoError?: number; mensajeError?: string; incidencia?: boolean }): Promise<void> {
  await tx.execute(sql`
    update envios set
      estado = ${estado},
      csv = coalesce(${opts.csv ?? null}, csv),
      confirmado_en = ${opts.confirmadoEn ? opts.confirmadoEn.toISOString() : null},
      codigo_error = ${opts.codigoError ?? null},
      mensaje_error = ${opts.mensajeError ?? null},
      incidencia = ${opts.incidencia ?? false} or incidencia
    where registro_id = ${registroId}
  `);
}

/** Halt still-pending successors in the SAME chain (same sif, higher secuencia) → detenido, so
 * nothing submits over an unresolvable gap. Returns how many were halted. */
async function haltSuccessors(tx: Transaction, row: DueRow, now: Date): Promise<number> {
  const halted = await tx.execute<{ registro_id: string }>(sql`
    update envios e set estado = 'detenido', incidencia = true
    from registros_facturacion r
    where r.id = e.registro_id and r.sif_id = ${row.sif_id} and r.secuencia > ${row.secuencia}
      and e.estado in ('pendiente', 'enviando')
    returning e.registro_id
  `);
  return halted.rows.length;
}

async function raiseIncident(tx: Transaction, row: DueRow, severity: "warning" | "error", code: string, params: Record<string, unknown>, now: Date, result: DrainResult): Promise<void> {
  await tx.execute(sql`
    insert into incidents (tenant_id, till_id, sale_id, code, params, severity, detected_at)
    values (${row.tenant_id}, ${row.till_id}, ${row.sale_id}, ${code}, ${JSON.stringify(params)}::jsonb, ${severity}, ${now.toISOString()})
  `);
  result.incidentsRaised += 1;
}

// Minimal stub so this task compiles — no resubmit test reaches the duplicate cases yet. Task 10
// replaces this body with Route A (duplicate_annulled) + Route B (duplicate_unknown → consulta).
async function handleDuplicate(_tx: Transaction, _client: VerifactuClient, row: DueRow, _efectivo: EstadoEfectivo, _csv: string | null, now: Date, result: DrainResult): Promise<void> {
  await setEstado(_tx, row.id, "detenido", { incidencia: true });
  await raiseIncident(_tx, row, "error", "fiscal.duplicado_sin_resolver", {}, now, result);
  result.recordsHalted += 1;
}
```

Register `fiscal.registro_rechazado`, `fiscal.aceptado_con_errores`, and `fiscal.duplicado_sin_resolver` in this package's `errors.ts` (structured code+params, matching the existing registration pattern there).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: PASS. `recordsHalted` = rejected (1) + halted successors.

- [ ] **Step 5: Add the Incidencia-while-open test**

```ts
it("sets Incidencia on a record enqueued while its chain has an open detenido incident", async () => {
  // secuencia 2 rejected in a first drain → secuencia 3 halted. A newly-enqueued secuencia 4 must
  // also carry incidencia while that chain is halted.
  // (Assert incidencia = true on the later record after a second drain.)
});
```

Implement the enqueue-while-open check in `claimBatch` or a pre-claim step: if a chain (sif) has any `detenido`/`rechazado` row, set `incidencia = true` on that chain's newly-claimed rows and do not submit over the gap (they should themselves be `detenido`). Keep the rule minimal and covered by this test.

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu/src/drain.ts packages/fiscal-verifactu/src/drain.test.ts packages/fiscal-verifactu/src/errors.ts
git commit -m "feat(fiscal-verifactu): estado transitions, chain halting, incidents"
```

---

## Task 10: Error 3000 — Route A + Route B (consulta + huella compare)

Resolve the duplicate cases `resolveEstadoEfectivo` surfaces: `duplicate_annulled` → `detenido` + error incident; `duplicate_unknown` → **Route B** (a targeted consulta, compare AEAT's stored `Huella` against ours: match → `aceptado`, differ → `detenido` + error incident). Carry the 3000-`Correcta`→accepted teeth-test.

**Files:**
- Modify: `packages/fiscal-verifactu/src/drain.ts`
- Modify: `packages/fiscal-verifactu/src/drain.test.ts`

**Interfaces:**
- Consumes (additionally): `client.consultar`, `RespuestaConsulta` (`@waitron/verifactu`); `toAeatDate`-style period derivation from the row's `fecha_expedicion_factura`.
- Produces: `handleDuplicate`; `routeB`.

- [ ] **Step 1: Write the failing tests — Route A accepted, Route B match/mismatch**

```ts
it("TEETH: a 3000 whose RegistroDuplicado is Correcta resolves to aceptado, not rechazado", async () => {
  const seeded = await seedPendingEnvios(db, { count: 1 });
  await aeat.client().submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } },
    [/* pre-store the identity so the drainer's submit is a resubmit → 3000 Correcta */]);
  // simpler: drain once (stores it), reset envios to pendiente, drain again → resubmit → 3000 Correcta
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
  await backend.drain(new Date("2026-07-21T00:01:00Z"));
  await withTenant(db, seeded.tenantId, (tx) => tx.execute(sql`update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:02:00Z").toISOString()}`));
  await backend.drain(new Date("2026-07-21T00:03:00Z"));
  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ estado: string }>(sql`select estado from envios`));
  expect(rows.rows[0].estado).toBe("aceptado"); // despite the outer Incorrecto on the 3000 line
});

it("Route B: duplicate_unknown with a matching huella resolves to aceptado", async () => {
  const seeded = await seedPendingEnvios(db, { count: 1 });
  const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
  await backend.drain(new Date("2026-07-21T00:01:00Z"));
  aeat.dropRegistroDuplicadoDetail(seeded.facturaKeys[0]); // force duplicate_unknown on resubmit
  await withTenant(db, seeded.tenantId, (tx) => tx.execute(sql`update envios set estado='pendiente', proximo_intento_en=${new Date("2026-07-21T00:02:00Z").toISOString()}`));
  await backend.drain(new Date("2026-07-21T00:03:00Z"));
  const rows = await withTenant(db, seeded.tenantId, (tx) => tx.execute<{ estado: string }>(sql`select estado from envios`));
  expect(rows.rows[0].estado).toBe("aceptado"); // AEAT's stored huella matched ours
});

it("Route B: duplicate_unknown with a differing huella halts the chain and raises an error incident", async () => {
  // Seed so AEAT's stored huella differs from ours (store a different huella under the same identity),
  // then force duplicate_unknown and drain → detenido + error incident.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: FAIL — `handleDuplicate` is currently a no-op default; duplicate_unknown never consults.

- [ ] **Step 3: Implement `handleDuplicate` + `routeB`**

Replace the Task 9 stub `handleDuplicate` with the real body, and add `routeB`. `client` is already threaded in as a parameter (Task 9):

```ts
import type { RespuestaConsulta } from "@waitron/verifactu";

async function handleDuplicate(tx: Transaction, client: VerifactuClient, row: DueRow, efectivo: EstadoEfectivo, csv: string | null, now: Date, result: DrainResult): Promise<void> {
  if (efectivo === "duplicate_annulled") {
    await setEstado(tx, row.id, "detenido", { csv, incidencia: true });
    await raiseIncident(tx, row, "error", "fiscal.duplicado_anulado", { numSerie: row.num_serie_factura }, now, result);
    result.recordsHalted += 1;
    return;
  }
  // duplicate_unknown → Route B
  const match = await routeB(client, row);
  if (match) {
    await setEstado(tx, row.id, "aceptado", { csv, confirmadoEn: now });
    result.recordsAccepted += 1;
  } else {
    await setEstado(tx, row.id, "detenido", { csv, incidencia: true });
    await raiseIncident(tx, row, "error", "fiscal.huella_divergente", { numSerie: row.num_serie_factura }, now, result);
    result.recordsHalted += 1 + await haltSuccessors(tx, row, now);
  }
}

/** Route B: consulta this single record and compare AEAT's stored Huella against ours. Period is
 * derived from the record's own fecha de expedición — our records never carry a FechaOperacion, so
 * operation month ≡ expedition month (§1). `toAeatDate` flips YYYY-MM-DD → DD-MM-YYYY; import it if
 * `registro-row.ts` exports it, otherwise inline the split-and-rejoin. */
async function routeB(client: VerifactuClient, row: DueRow): Promise<boolean> {
  const [yyyy, mm] = row.fecha_expedicion_factura.split("-"); // stored as YYYY-MM-DD
  const respuesta: RespuestaConsulta = await client.consultar(
    { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } },
    { Ejercicio: yyyy, Periodo: mm, NumSerieFactura: row.num_serie_factura, FechaExpedicionFactura: toAeatDate(row.fecha_expedicion_factura) },
  );
  const stored = respuesta.registros.find((r) => r.IDFactura.NumSerieFactura === row.num_serie_factura);
  return stored?.DatosRegistroFacturacion.Huella === row.huella;
}
```

Also remove the now-unused `fiscal.duplicado_sin_resolver` code from `errors.ts` (Task 9's stub used it; the real paths use `fiscal.duplicado_anulado` / `fiscal.huella_divergente`).

Register `fiscal.duplicado_anulado` and `fiscal.huella_divergente` in `errors.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @waitron/fiscal-verifactu test -- drain`
Expected: PASS (all three duplicate tests, including the teeth-test).

- [ ] **Step 5: Full package runs + typecheck + lint**

Run:
```bash
pnpm --filter @waitron/verifactu test
pnpm --filter @waitron/fiscal test
pnpm --filter @waitron/fiscal-verifactu test
pnpm --filter @waitron/fiscal-verifactu typecheck
pnpm -r lint
```
Expected: all PASS. Then the real-Postgres suites once more with Docker up:
```bash
pnpm --filter @waitron/fiscal-verifactu test -- drain.concurrency
pnpm --filter @waitron/fiscal-verifactu test -- chain.concurrency
```

- [ ] **Step 6: Commit**

```bash
git add packages/fiscal-verifactu/src/drain.ts packages/fiscal-verifactu/src/drain.test.ts packages/fiscal-verifactu/src/errors.ts
git commit -m "feat(fiscal-verifactu): error 3000 route A + route B (consulta huella compare)"
```

---

## Final verification (before opening the PR)

- [ ] All package test suites green: `pnpm -r test` (with Docker available so the real-Postgres suites run, not throw).
- [ ] `packages/verifactu` mutation gate ≥ 90%: `pnpm --filter @waitron/verifactu mutation`.
- [ ] Typecheck + lint clean across the repo: `pnpm -r typecheck && pnpm -r lint`.
- [ ] Teeth-tests confirmed to bite (CSV write; 3000-`Correcta`→accepted; 1001-split; `t=9999` round-trip; enums unshared).
- [ ] The diff is within Copilot's 20,000-line review cap (the reason plan 3 was split; §1).
