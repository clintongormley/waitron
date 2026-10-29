/**
 * Every file that replaces or removes the live `venue.db` deletes the backup room note first, so
 * the start never trusts a note written for a database that is gone. A file that names `venue.db`
 * beside a removal or copy is either on REPLACES (it must call `deleteBackupRoomNote(`) or on
 * CO_NAMERS (with the reason it never touches the live database); any other such file fails.
 *
 * Weaker than its name: it reads TEXT. A non-test `.ts` file under `apps/<app>/src` or
 * `packages/<package>/src` matches when it names `VENUE_FILE`, or `venue.db` right after a quote or
 * a `/`, and also one of the words `rm`, `rename`, `unlink`, `copyFile`, `cp`, `removeAndSync` or
 * `rmdir`. It does not see a whole-folder `rm` that takes `venue.db` with it without naming it, a
 * copy-like write under another function name, a `venue.db` path built from pieces, or shell; and
 * a REPLACES file passes on one call, not one per path that changes the database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const NAMES_VENUE = /\bVENUE_FILE\b|["'`/]venue\.db["'`]/;
const REMOVES = /\b(rm|rename|unlink|copyFile|cp|removeAndSync|rmdir)\b/;
const DELETES_NOTE = /\bdeleteBackupRoomNote\(/;

/** Files that replace or remove the live venue.db. Matched or not, each must delete the note. */
const REPLACES: readonly string[] = [
  "apps/server/src/db-wipe.ts",
  "apps/server/src/restore.ts",
  "packages/provisioning/src/first-setup-start-again-deletion.ts",
  "packages/provisioning/src/first-setup-start-again-set-aside.ts",
];

/** Files that name venue.db beside a removal or copy without touching the live database. */
const CO_NAMERS: Readonly<Record<string, string>> = {
  "apps/server/src/backup-archive-file.ts": "unlinks its own archive copy in a scratch folder",
  "apps/server/src/backup-supervisor.ts":
    "reads venue.db's size; its rename option reaches only the note, through the note writer",
  "apps/server/src/backup-room-note.ts":
    "writes the note; its rename and unlink touch the note's own files",
  "apps/server/src/backup-verification.ts":
    "places a backup in a scratch folder and removes that folder",
  "apps/server/src/cloud-snapshot-archive.ts": "removes its own staging folder",
  "apps/server/src/first-setup-backup-recovery.ts":
    "copies backups into scratch folders it removes; places one into the target only through restoreFromArtifact, whose restore.ts deletes that target's note",
  "apps/server/src/first-setup-backup-source.ts":
    "copies a backup into a scratch folder it removes",
  "apps/server/src/first-setup-database-holdings.ts":
    "reads the live database; removes only its scratch folder",
  "apps/server/src/node-entry.ts": "names venue.db in prose and `docker compose run --rm`",
  "apps/server/src/recovery-preparation.ts":
    "reads the live database; removes only its staging folder",
  "apps/server/src/reset-request.ts":
    "checks venue.db exists; removes its own marker and state files",
  "apps/server/src/restore-request.ts":
    "removes and renames its own request files in the state folder",
  "apps/server/src/restore-stream.ts": "restores into a scratch folder it removes",
  "apps/server/src/testing/staged-hour-crash.ts": "test harness: a scratch box it removes",
  "apps/server/src/testing/staged-hour-restore.ts": "test harness: a scratch box it removes",
  "apps/server/src/testing/stream-loop-scenario.ts": "test harness: scratch folders it removes",
  "apps/server/src/testing/stream-pause-scenario.ts":
    "test harness: copies migration folders into its scratch box and only opens its venue.db",
  "packages/provisioning/src/first-setup-backup-workspace.ts":
    "lists venue.db by name; renames and unlinks its own records",
  "packages/stream/src/restore.ts": "removes its own configuration file",
  "packages/stream/src/supervisor.ts": "removes its pid file and venue.db's Litestream folder",
};

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function srcRoots(): string[] {
  const roots: string[] = [];
  for (const top of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, entry, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // A package with no src folder has nothing to scan.
      }
    }
  }
  return roots;
}

type Source = { path: string; text: string };

const matches = (text: string) => NAMES_VENUE.test(text) && REMOVES.test(text);

/** Every way the tree breaks the rule, one line each. */
function problems(files: readonly Source[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    if (REPLACES.includes(path)) {
      if (!DELETES_NOTE.test(text))
        found.push(`${path}: replaces venue.db, never deletes the note`);
    } else if (matches(text) && !(path in CO_NAMERS))
      found.push(`${path}: names venue.db beside a removal or copy, on neither list`);
  }
  for (const path of REPLACES)
    if (!files.some((file) => file.path === path)) found.push(`${path}: listed, not found`);
  for (const path of Object.keys(CO_NAMERS))
    if (!files.some((file) => file.path === path && matches(file.text)))
      found.push(`${path}: listed as a co-namer, no longer matches`);
  return found.sort();
}

function tree(): Source[] {
  return srcRoots()
    .flatMap(sourceFilesIn)
    .map((file) => ({
      path: relative(ROOT, file).split(sep).join("/"),
      text: readFileSync(file, "utf8"),
    }));
}

describe("the backup room note guard (weaker than its name: reads text)", () => {
  it("every file that replaces or removes venue.db deletes the note, and every other match is listed", () => {
    expect(problems(tree())).toEqual([]);
  });

  it("refuses an unlisted match and a replacing file without the call; passes the legitimate shapes", () => {
    const real = tree();
    const without = (path: string) => real.filter((file) => file.path !== path);
    const restore = real.find((file) => file.path === "apps/server/src/restore.ts")!;
    expect(
      problems([
        ...without(restore.path),
        { path: restore.path, text: restore.text.replaceAll("deleteBackupRoomNote(", "x(") },
      ]),
    ).toEqual(["apps/server/src/restore.ts: replaces venue.db, never deletes the note"]);
    expect(
      problems([
        ...real,
        { path: "apps/server/src/stray.ts", text: 'await rm(join(dir, "venue.db"));' },
        { path: "apps/server/src/copies.ts", text: 'await copyFile(from, join(dir, "venue.db"));' },
        {
          path: "apps/server/src/syncs.ts",
          text: 'await removeAndSync(join(dir, "venue.db"), "file");',
        },
        { path: "apps/server/src/template.ts", text: "await rm(`${dir}/venue.db`);" },
        { path: "apps/server/src/reads.ts", text: 'await lstat(join(dir, "venue.db"));' },
        { path: "apps/server/src/removes.ts", text: "await rm(dir);" },
      ]),
    ).toEqual(
      ["copies", "stray", "syncs", "template"].map(
        (name) =>
          `apps/server/src/${name}.ts: names venue.db beside a removal or copy, on neither list`,
      ),
    );
  });
});
