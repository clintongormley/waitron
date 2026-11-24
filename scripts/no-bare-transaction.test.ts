/** Weaker than its name: reads text, so a `transaction` reached another way (destructured,
 * `["transaction"]`, an alias) escapes; it does not check that a listed site really runs inside a
 * write-queue transaction; it reads only product `.ts` files under `apps/<name>/src` and
 * `packages/<name>/src`, and skips `packages/store/src/` and the browser's IndexedDB calls in
 * `packages/ui/src/document-delivery-recovery.ts`; comment blanking shares blankComments'
 * documented guesses. */
// Why: docs/developers/conventions-data.md, "A full disk sometimes ends the whole transaction".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { blankComments } from "../packages/shared/src/source-comments.js";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const root = join(import.meta.dirname, "..");
const savepoint = "nested savepoint on the caller's transaction";
const allowed: Record<string, { count: number; reason: string }> = {
  "apps/server/src/alerts.ts": { count: 1, reason: savepoint },
  "apps/server/src/bill-payments.ts": { count: 1, reason: savepoint },
  "apps/server/src/clock-correction.ts": {
    count: 1,
    reason: "the `transaction` dependency, wired to withTransaction in boot.ts",
  },
  "apps/server/src/optional-document.ts": { count: 1, reason: savepoint },
  "apps/server/src/staff-notices.ts": { count: 1, reason: savepoint },
  "packages/fiscal-verifactu/src/chain.ts": { count: 1, reason: savepoint },
  "packages/fiscal-verifactu/src/handover-return.ts": { count: 1, reason: savepoint },
  "packages/workforce/src/chain.ts": { count: 1, reason: savepoint },
};
const excluded = (path: string) =>
  path.startsWith("packages/store/src/") ||
  path === "packages/ui/src/document-delivery-recovery.ts";

function transactionCalls(source: string): number {
  return blankComments(source).match(/\.transaction\s*[<(]/g)?.length ?? 0;
}
const files = ["apps", "packages"]
  .flatMap((dir) => sourceFilesIn(root, dir))
  .filter(
    (path) =>
      /^(apps|packages)\/[^/]+\/src\/.*\.ts$/.test(path) && !/\.test\.ts$|\/testing\//.test(path),
  );

it("opens a .transaction( only at the listed sites, as many times as listed", () => {
  const found = Object.fromEntries(
    files
      .filter((path) => !excluded(path))
      .map((path) => [path, transactionCalls(readFileSync(join(root, path), "utf8"))] as const)
      .filter(([, count]) => count > 0),
  );
  expect(found).toEqual(
    Object.fromEntries(Object.entries(allowed).map(([path, { count }]) => [path, count])),
  );
});
it("selects product sources and leaves tests and testing helpers out", () => {
  expect(files).toEqual(
    expect.arrayContaining(["apps/server/src/alerts.ts", "packages/workforce/src/chain.ts"]),
  );
  expect(files.filter((path) => /\.test\.ts$|\/testing\//.test(path))).toEqual([]);
});
it.each([
  ["await db.transaction(fn);", 1],
  ["await this.opts.db.transaction((tx) => insert(tx));", 1],
  ["await tx.transaction (async () => {});", 1],
  ["await db.transaction<number>(fn);", 1],
  ["const x = 1; // await db.transaction(fn);", 0],
  ["/* await db.transaction(fn); */ const x = 1;", 0],
  ['const p = "/*"; await db.transaction(fn); // */', 1],
  ["await withTransaction(db, (tx) => insert(tx));", 0],
  ["await db.withWriteLock(() => read());", 0],
])("counts %s", (source, expected) => expect(transactionCalls(source)).toBe(expected));
