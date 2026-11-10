import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { FiledFigures, FiledVersionFigures, VatBreakdownLine } from "@waitron/fiscal";
import { decimal, decimalToBasisPoints, decimalToCents } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import { decodeRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";

type Version = Pick<
  RegistroRow,
  "id" | "sale_id" | "desglose" | "cuota_total" | "importe_total"
> & {
  corrects_registro_id: string | null;
  estado: string | null;
};

const ANSWERED = new Set(["aceptado", "aceptado_con_errores"]);

/** The keys `toDetalleDesglose` (./backend.ts) writes, and no other. */
const DETAIL_KEYS = new Set([
  "ClaveRegimen",
  "CalificacionOperacion",
  "BaseImponibleOimporteNoSujeto",
  "TipoImpositivo",
  "CuotaRepercutida",
]);

/**
 * Each sale's newest alta version (the one no other alta of it fixes, as admission judges) and the
 * newest version of that line of fixes whose submission was accepted, with or without errors.
 */
export async function filedFiguresFor(
  tx: Transaction,
  saleIds: readonly SaleId[],
): Promise<ReadonlyMap<SaleId, FiledFigures>> {
  const answer = new Map<SaleId, FiledFigures>();
  if (saleIds.length === 0) return answer;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select r.id, r.sale_id, r.corrects_registro_id, r.desglose, r.cuota_total, r.importe_total,
      e.estado
    from registros_facturacion as r indexed by registros_sale_idx
    left join envios as e on e.registro_id = r.id
    where r.sale_id in (${sql.join(
      saleIds.map((id) => sql`${id}`),
      sql`, `,
    )}) and r.tipo_registro = 'alta'
  `);
  const bySale = new Map<string, Version[]>();
  for (const raw of rows) {
    const version = decodeRegistroRow(raw) as unknown as Version;
    bySale.set(version.sale_id, [...(bySale.get(version.sale_id) ?? []), version]);
  }
  for (const [saleId, versions] of bySale) {
    answer.set(saleId as SaleId, figuresOf(versions));
  }
  return answer;
}

function figuresOf(versions: readonly Version[]): FiledFigures {
  const fixed = new Set(versions.map((version) => version.corrects_registro_id));
  const latest = versions.filter((version) => !fixed.has(version.id));
  if (latest.length !== 1) return { readable: false };
  const byId = new Map(versions.map((version) => [version.id, version]));
  let answered: Version | undefined = latest[0];
  while (answered !== undefined && !ANSWERED.has(answered.estado ?? "")) {
    answered = byId.get(answered.corrects_registro_id ?? "");
  }
  const newest = versionFigures(latest[0]!);
  const newestAnswered = answered === undefined ? null : versionFigures(answered);
  if (newest === undefined || newestAnswered === undefined) return { readable: false };
  return { readable: true, newest, newestAnswered };
}

/** The version's figures, or undefined when they are not the shape this backend files. */
function versionFigures(version: Version): FiledVersionFigures | undefined {
  const details = version.desglose as unknown as Record<string, unknown>[];
  const vatBreakdown: VatBreakdownLine[] = [];
  const rates = new Set<number>();
  let gross = 0;
  let vat = 0;
  for (const detail of details) {
    if (
      Object.keys(detail).some((key) => !DETAIL_KEYS.has(key)) ||
      detail["ClaveRegimen"] !== "01" ||
      detail["CalificacionOperacion"] !== "S1" ||
      typeof detail["TipoImpositivo"] !== "string" ||
      typeof detail["CuotaRepercutida"] !== "string"
    ) {
      return undefined;
    }
    const line = {
      rate: decimal(detail["TipoImpositivo"] as string),
      base: decimal(detail["BaseImponibleOimporteNoSujeto"] as string),
      tax: decimal(detail["CuotaRepercutida"] as string),
    };
    const rate = decimalToBasisPoints(line.rate);
    if (rates.has(rate)) return undefined;
    rates.add(rate);
    gross += decimalToCents(line.base) + decimalToCents(line.tax);
    vat += decimalToCents(line.tax);
    vatBreakdown.push(line);
  }
  const total = decimal(version.importe_total!);
  if (gross !== decimalToCents(total) || vat !== decimalToCents(decimal(version.cuota_total!))) {
    return undefined;
  }
  return { total, vatBreakdown };
}
