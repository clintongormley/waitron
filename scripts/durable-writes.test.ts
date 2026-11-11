/** Weaker than its name: reads text, only sees three rename spellings in files importing fs.
 * Plain writes, aliases, re-exports and indirect fs access escape it; comment stripping shares
 * blankComments' documented guesses. Allowed files are not checked for actually flushing. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { blankComments } from "../packages/shared/src/source-comments.js";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const root = join(import.meta.dirname, "..");
const server = Object.fromEntries(
  [
    ["box-tls-repair", "flushes; fl6 owns it"],
    ["box-tls-install", "A947 resumable TLS install"],
    ["cloud-remote", "the staff key's create-only link"],
    ["cloud-snapshot-worker", "snapshot state and archives; jr10 owns replacement"],
    ["cloud-tunnel", "tunnel volume outside state"],
    ["handover-acceptance", "A1018 reachDisk"],
    ["handover-place-copy", "A1018 reachDisk"],
    ["handover-source-api", "A1018 final-copy retake"],
    ["mirror-bundle-fetch", "A1018 reachDisk"],
    ["local-fs-backend", "flushes, keeping cancellation before replacement"],
    ["log-file", "log rotation"],
    ["restore-request", "database and secret swaps; fl5 owns it"],
    ["restore-secrets", "database and secret swaps"],
    ["restore", "database and secret swaps"],
  ].map(([name, reason]) => [`apps/server/src/${name}.ts`, reason]),
);
const allowed = {
  ...server,
  "packages/provisioning/src/durable-host-json.ts": "flushes; exclusive temporary setup names",
  "packages/provisioning/src/first-setup-start-again-set-aside.ts":
    "moves originals aside and flushes",
  "packages/provisioning/src/fs-atomic.ts": "the durable writer",
  "packages/store/src/archive.ts": "VACUUM output into scratch or a caller's folder",
  "packages/store/src/venue-holder.ts": "unflushed heartbeat, by design",
  "packages/stream/src/s3-file-store.ts": "download into scratch",
  "packages/fiscal-verifactu/src/emergency-attempt.ts": "flushes; environment slice retires it",
};
function renames(source: string): boolean {
  const code = blankComments(source);
  return (
    /\bfrom\s*["'](?:node:)?fs(?:\/promises)?["']/.test(code) &&
    /(?<![#\w$.])rename\(|(?<![#\w$])renameSync\(|\b[\w$]+\.rename\(/.test(code)
  );
}
const files = ["apps", "packages"]
  .flatMap((dir) => sourceFilesIn(root, dir))
  .filter(
    (path) =>
      /^(apps|packages)\/[^/]+\/src\/.*\.ts$/.test(path) && !/\.test\.ts$|\/testing\//.test(path),
  );

it("only the listed files rename a file into place", () => {
  expect(
    files.filter(
      (path) =>
        renames(readFileSync(join(root, path), "utf8")) &&
        !Object.hasOwn(allowed, path) &&
        !path.startsWith("apps/print-agent/src/"),
    ),
  ).toEqual([]);
});
it("the unflushed atomic writer does not exist", () => {
  expect(
    files.filter((path) =>
      /\bwriteFileAtomic\b/.test(blankComments(readFileSync(join(root, path), "utf8"))),
    ),
  ).toEqual([]);
});
it.each([
  ['import { rename } from "node:fs/promises"; await rename(a, b);', true],
  ['import fs from "fs"; fs.rename(a, b);', true],
  ['import { renameSync } from "node:fs"; renameSync(a, b);', true],
  ['import { readFile } from "node:fs/promises"; this.#rename(view, menu);', false],
  ["await rename(a, b);", false],
  ['import { rename } from "node:fs/promises"; // rename(a, b);', false],
])("scans %s", (source, expected) => expect(renames(source)).toBe(expected));
