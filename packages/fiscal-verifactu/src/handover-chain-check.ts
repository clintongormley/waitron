import type { BackupQuery } from "@waitron/store";
import { walkFiscalChains } from "./backup-verification-chain.js";

/** Every record of every chain in a copy, rehashed and linked. Reads only. */
export async function checkFiscalChains(query: BackupQuery): Promise<"ok" | "broken"> {
  let tables = 0n;
  for await (const row of query.rows(
    "select count(*) as tables from sqlite_schema where type = 'table' and name in ('registros_facturacion', 'registro_sif', 'cadenas')",
  ))
    tables = BigInt(row.tables as bigint | number);
  // walk accepts a copy with none of the three tables; an enabled Veri*Factu module's copy must have them.
  if (tables !== 3n) return "broken";
  return (await walkFiscalChains(query)) ? "ok" : "broken";
}
