import { compareBackupTables } from "@waitron/db";
import type { BackupQuery, BackupRow, BackupValue } from "@waitron/store";
import { validate, verifyHuella } from "@waitron/verifactu";
import { decodeRegistroRow, fromRegistroRow, type RegistroRow } from "./registro-row.js";

const TABLES = ["registros_facturacion", "registro_sif", "cadenas"];

function integer(value: BackupValue | undefined): number | null {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) ? number : null;
}

function record(raw: BackupRow): RegistroRow | null {
  const offset = integer(raw.offset_minutos);
  if (
    !["alta", "anulacion"].includes(String(raw.tipo_registro)) ||
    (raw.primer_registro !== 0n && raw.primer_registro !== 1n) ||
    offset === null ||
    offset < -840 ||
    offset > 840 ||
    typeof raw.fecha_hora_huso_gen_registro !== "string" ||
    !Number.isFinite(Date.parse(raw.fecha_hora_huso_gen_registro))
  )
    return null;
  try {
    const row = decodeRegistroRow({
      ...raw,
      secuencia: integer(raw.secuencia),
      offset_minutos: offset,
      primer_registro: Number(raw.primer_registro),
    });
    const rebuilt = fromRegistroRow(row);
    if (
      !verifyHuella(rebuilt) ||
      validate(rebuilt, { now: row.fecha_hora_huso_gen_registro }).some(
        (issue) =>
          issue.severity === "error" ||
          issue.code === "HUELLA_FORMAT" ||
          issue.code === "HUELLA_ANTERIOR_FORMAT",
      )
    )
      return null;
    return row;
  } catch (error) {
    // These failures arise while decoding captured values, outside any database operation.
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError)
      return null;
    throw error;
  }
}

async function walk(query: BackupQuery): Promise<boolean> {
  const tables = [];
  for await (const row of query.rows(
    "select name from sqlite_schema where type = 'table' and name in ('registros_facturacion', 'registro_sif', 'cadenas')",
  ))
    tables.push(row.name);
  if (tables.length === 0) return true;
  if (tables.length !== 3) return false;

  for await (const node of query.rows(
    "select node_id from registros_facturacion union select node_id from registro_sif union select node_id from cadenas order by node_id",
  )) {
    if (typeof node.node_id !== "string") return false;
    const nodes = [];
    for await (const row of query.rows("select id from nodes where id = ?", [node.node_id]))
      nodes.push(row.id);
    if (nodes.length !== 1) return false;
    const identities = new Map<string, BackupRow>();
    let current: string | null = null;
    for await (const sif of query.rows("select * from registro_sif where node_id = ?", [
      node.node_id,
    ])) {
      if (
        typeof sif.id !== "string" ||
        [sif.nif, sif.id_sistema_informatico, sif.numero_instalacion].some(
          (value) => typeof value !== "string" || value.length === 0,
        ) ||
        typeof sif.registrado_en !== "string" ||
        !Number.isFinite(Date.parse(sif.registrado_en)) ||
        (sif.revocado_en !== null &&
          (typeof sif.revocado_en !== "string" || !Number.isFinite(Date.parse(sif.revocado_en))))
      )
        return false;
      identities.set(sif.id, sif);
      if (sif.revocado_en === null) {
        if (current !== null) return false;
        current = sif.id;
      }
    }
    if (identities.size > 0 && current === null) return false;

    let sequence = 0;
    let previous: RegistroRow | null = null;
    const visited = new Set<string>();
    for await (const raw of query.rows(
      "select * from registros_facturacion where node_id = ? order by secuencia",
      [node.node_id],
    )) {
      sequence++;
      if (integer(raw.secuencia) !== sequence) return false;
      const row = record(raw);
      if (row === null) return false;
      const sif = identities.get(row.sif_id);
      if (
        sif === undefined ||
        row.sistema_informatico.NIF !== sif.nif ||
        row.sistema_informatico.IdSistemaInformatico !== sif.id_sistema_informatico ||
        row.sistema_informatico.NumeroInstalacion !== sif.numero_instalacion
      )
        return false;

      if (previous === null || previous.sif_id !== row.sif_id) {
        if (
          visited.has(row.sif_id) ||
          !row.primer_registro ||
          (previous !== null && identities.get(previous.sif_id)!.revocado_en === null) ||
          [
            row.anterior_id_emisor_factura,
            row.anterior_num_serie_factura,
            row.anterior_fecha_expedicion_factura,
            row.anterior_huella,
          ].some((value) => value !== null)
        )
          return false;
        visited.add(row.sif_id);
      } else if (
        row.primer_registro ||
        row.anterior_id_emisor_factura !== previous.id_emisor_factura ||
        row.anterior_num_serie_factura !== previous.num_serie_factura ||
        row.anterior_fecha_expedicion_factura !== previous.fecha_expedicion_factura ||
        row.anterior_huella !== previous.huella
      )
        return false;
      previous = row;
    }

    let heads = 0;
    for await (const head of query.rows("select * from cadenas where node_id = ?", [
      node.node_id,
    ])) {
      heads++;
      if (integer(head.secuencia) !== sequence) return false;
      if (previous !== null && previous.sif_id === current) {
        if (head.ultimo_registro_id !== previous.id || head.ultima_huella !== previous.huella)
          return false;
      } else if (head.ultimo_registro_id !== null || head.ultima_huella !== null) return false;
    }
    if (heads !== 1) return false;
  }
  return true;
}

export async function verifyBackupFiscalChains(
  before: BackupQuery,
  after: BackupQuery,
): Promise<boolean> {
  return (
    (await walk(before)) &&
    (await walk(after)) &&
    (await compareBackupTables({
      before,
      after,
      policies: TABLES.map((table) => ({ table, immutable: true, addedColumns: {} })),
    }))
  );
}
