import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { manifestSets } from "./manifest.js";
import { imageMigrationHashes, journalHashes } from "./journal-hashes.js";

const core = manifestSets().find((set) => set.name === "core")!;

describe("imageMigrationHashes", () => {
  it("returns one hash per journal entry, in journal order", () => {
    const folder = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const hashes = imageMigrationHashes(core, null);
    expect(hashes).toHaveLength(journal.entries.length);
    // Pins the hash RULE against drizzle's own, rather than restating it: sha256 of the whole .sql
    // file text. If drizzle ever changes it, this fails instead of the ahead check silently
    // reporting every migration as unknown.
    const first = createHash("sha256")
      .update(readFileSync(join(folder, `${journal.entries[0]!.tag}.sql`), "utf8"))
      .digest("hex");
    expect(hashes[0]).toBe(first);
  });

  it("throws the classified migrations.set_missing for a set with no journal", () => {
    const missing = { name: "nope", table: "__drizzle_migrations_nope", from: "../nope/drizzle" };
    const thrown = (() => {
      try {
        imageMigrationHashes(missing, null);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(isAppError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe("migrations.set_missing");
  });
});

describe("journalHashes", () => {
  it("refuses a table name that is not a drizzle journal table", async () => {
    const db = { execute: () => Promise.reject(new Error("must not be reached")) };
    const bad = { name: "x", table: 'evil"; drop table tenants; --', from: "../db/drizzle" };
    await expect(journalHashes(db as never, bad)).rejects.toMatchObject({
      code: "migrations.invalid_table",
    });
  });

  it("returns null when the journal table does not exist", async () => {
    const db = {
      execute: () => Promise.reject(Object.assign(new Error("undefined_table"), { code: "42P01" })),
    };
    expect(await journalHashes(db as never, core)).toBeNull();
  });

  it("rethrows any other driver error rather than reporting an unmigrated set", async () => {
    const db = {
      execute: () => Promise.reject(Object.assign(new Error("no connection"), { code: "08006" })),
    };
    await expect(journalHashes(db as never, core)).rejects.toMatchObject({ code: "08006" });
  });

  it("returns the hashes the journal carries, in application order", async () => {
    const db = {
      execute: () => Promise.resolve({ rows: [{ hash: "aa" }, { hash: "bb" }] }),
    };
    expect(await journalHashes(db as never, core)).toEqual(["aa", "bb"]);
  });
});
