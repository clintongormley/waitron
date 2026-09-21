// Two migrating PROCESSES against one venue directory. A real second OS process, because the
// property under test is a lock SQLite holds on a file: two handles inside one process would not
// reproduce it, and the migration itself is synchronous, so nothing in one process can interleave
// with it.
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./apply.js";
import { manifestSets, migrationOptionsFor } from "./manifest.js";

/** How long a peer holds the lock before letting go. Long enough to lose the race if nothing waits. */
const HOLD_MS = 600;

const scratch: string[] = [];

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * A peer process that takes the venue's migration lock, holds it, records that it let go, and
 * exits. Plain JavaScript on purpose: a child cannot load this repository's TypeScript without a
 * transpiling runtime, and `node:sqlite` is a builtin, so this needs no resolution at all.
 *
 * With `takeLock` = `no` it does everything EXCEPT take the lock. That is the control: the same
 * timings, the same log line, nothing for `applyMigrations` to wait for.
 */
const PEER = `
import { appendFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const [lockPath, logPath, holdMs, takeLock] = process.argv.slice(2);
const db = new DatabaseSync(lockPath);
db.exec("pragma busy_timeout = 30000");
if (takeLock === "yes") db.exec("begin immediate");
console.log("held");
setTimeout(() => {
  appendFileSync(logPath, "peer-released\\n");
  if (takeLock === "yes") db.exec("commit");
  db.close();
}, Number(holdMs));
`;

function peerScript(): string {
  const path = join(temp("wt-peer-"), "hold-lock.mjs");
  writeFileSync(path, PEER);
  return path;
}

/**
 * Runs one race and returns the order the two sides recorded.
 *
 * The peer writes `peer-released` at the moment it lets go; this process writes `migrated` when
 * `applyMigrations` returns. Order, not elapsed time: a duration assertion would have to name a
 * threshold, and the same two answers would then look alike on a loaded machine.
 */
async function race(takeLock: "yes" | "no"): Promise<string[]> {
  const venue = temp("wt-race-");
  const log = join(venue, "order.log");
  writeFileSync(log, "");
  const peer = spawn(process.execPath, [
    peerScript(),
    join(venue, "migrations.lock"),
    log,
    String(HOLD_MS),
    takeLock,
  ]);
  const exited = new Promise<void>((resolve) => peer.on("close", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    peer.stdout.on("data", (chunk) => String(chunk).includes("held") && resolve());
    peer.on("error", reject);
    peer.on("close", () =>
      reject(new Error("the peer exited before it reported holding the lock")),
    );
  });
  const core = manifestSets().find((set) => set.name === "core")!;
  await applyMigrations(venue, migrationOptionsFor([core], null));
  appendFileSync(log, "migrated\n");
  await exited;
  return readFileSync(log, "utf8").trim().split("\n");
}

describe("applyMigrations under two concurrent hosts", () => {
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("waits for a peer process holding the venue's migration lock", async () => {
    // Why a lock at all, measured rather than assumed: with none, two processes running drizzle's
    // migrator against one virgin file both read the journal as empty and both replay the DDL. In
    // 15 runs of that race on 2026-09-21 (Node v26.7.0, three sets), two ended with one process
    // throwing `table \`locations\` already exists` / `table \`content_languages\` already exists`
    // — errcode 1, from inside drizzle's own transaction. SQLite's file locking plus the 5s busy
    // timeout serialises the WRITES and still allows that, because the journal READ happens
    // outside the transaction that writes.
    expect(await race("yes")).toEqual(["peer-released", "migrated"]);
  });

  it("does not wait when the peer holds nothing — the control", async () => {
    // The same peer, the same hold, the same log line, with only the `begin immediate` removed. It
    // reverses the order, which is what makes the case above a measurement rather than a pair of
    // answers that look alike.
    expect(await race("no")).toEqual(["migrated", "peer-released"]);
  });
});
