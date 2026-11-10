import { DatabaseSync } from "node:sqlite";

/** Node's version alone does not name SQLite's: Homebrew's Node links a different one. */
export interface Runtime {
  node: string;
  sqlite: string;
  /** With STAT4, `ANALYZE` gathers more statistics and the planner can choose other indexes. */
  sqliteStat4: boolean;
}

export function runtime(): Runtime {
  const db = new DatabaseSync(":memory:");
  try {
    const { version } = db.prepare("select sqlite_version() as version").get() as {
      version: string;
    };
    const stat4 = db
      .prepare("select 1 from pragma_compile_options where compile_options = 'ENABLE_STAT4'")
      .get();
    return { node: process.version, sqlite: version, sqliteStat4: stat4 !== undefined };
  } finally {
    db.close();
  }
}

export function describeRuntime({ node, sqlite, sqliteStat4 }: Runtime): string {
  return `Node ${node}, SQLite ${sqlite} ${sqliteStat4 ? "with" : "without"} STAT4`;
}
