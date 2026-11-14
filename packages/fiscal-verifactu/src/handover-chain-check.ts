import type { BackupQuery } from "@waitron/store";
import {
  FISCAL_CHAIN_TABLES,
  fiscalChainTables,
  walkFiscalChains,
} from "./backup-verification-chain.js";

/** Every record of every chain in a copy, rehashed and linked. Reads only. */
export async function checkFiscalChains(query: BackupQuery): Promise<"ok" | "broken"> {
  const tables = await fiscalChainTables(query);
  // A handover with this module enabled requires its tables even in an empty copy.
  if (![...FISCAL_CHAIN_TABLES, "nodes"].every((name) => tables.includes(name))) return "broken";
  return (await walkFiscalChains(query)) ? "ok" : "broken";
}
