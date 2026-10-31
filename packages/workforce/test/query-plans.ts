import type { Transaction } from "@waitron/db";

interface CompiledStatement {
  sql: string;
  params: unknown[];
}

interface DrizzleSession {
  prepareQuery(query: CompiledStatement, ...rest: unknown[]): { all(): unknown };
}

/**
 * `tx` with every statement drizzle compiles on it recorded, each with its query plan read through
 * the same session.
 */
export function planningEveryStatement(tx: Transaction) {
  const statements: { sql: string; plan: () => string[] }[] = [];
  const recording = new Proxy(tx, {
    get: (target, key, receiver) => {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "session") return value;
      const session = value as DrizzleSession;
      return new Proxy(session, {
        get: (inner, innerKey, innerReceiver) =>
          innerKey === "prepareQuery"
            ? (query: CompiledStatement, ...rest: unknown[]) => {
                statements.push({
                  sql: query.sql,
                  plan: () =>
                    (
                      inner
                        .prepareQuery(
                          { sql: `explain query plan ${query.sql}`, params: query.params },
                          undefined,
                          "all",
                        )
                        .all() as { detail: string }[]
                    ).map((row) => row.detail),
                });
                return inner.prepareQuery(query, ...rest);
              }
            : Reflect.get(inner, innerKey, innerReceiver),
      });
    },
  });
  return { recording, statements };
}
