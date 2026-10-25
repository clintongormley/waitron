import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";

/** A full disk that refuses any write turn which changed a row; a turn that only reads commits. */
export function writeRefusingDb(db: Database): Database {
  const changes = () => db.all<{ n: number }>(sql`select total_changes() as n`)[0]!.n;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "withWriteLock") {
        return <T>(body: () => Promise<T>) =>
          target.withWriteLock(async () => {
            const before = changes();
            const value = await body();
            if (changes() !== before) throw new AppError("storage.disk_full", {});
            return value;
          });
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
