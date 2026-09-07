import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import {
  buildConninfo,
  createSubscription,
  createSubscriptionStatement,
  disableSubscription,
  dropSubscription,
  enableSubscription,
  setSubscriptionPublications,
  skipSubscription,
} from "./subscriptions.js";

const CONN = {
  host: "node-a",
  port: 5432,
  database: "waitron",
  user: "waitron_repl",
  password: "p'a\\ss",
};

// The whole ALTER/DROP string lands in a single sql.raw StringChunk (same pattern as
// packages/sync/src/publications.test.ts and packages/provisioning/src/instance-apply.test.ts), so
// reading it back off a fake db.execute asserts the literal statement without a database.
function fakeDb() {
  const calls: string[] = [];
  const db = {
    execute: async (query: { queryChunks: { value: string[] }[] }) => {
      calls.push(query.queryChunks.map((chunk) => chunk.value.join("")).join(""));
      return { rows: [] };
    },
  };
  return { db: db as unknown as Database, calls };
}

describe("buildConninfo", () => {
  it("single-quotes and backslash-escapes each value (libpq)", () => {
    expect(buildConninfo(CONN)).toBe(
      "host='node-a' port='5432' dbname='waitron' user='waitron_repl' password='p\\'a\\\\ss'",
    );
  });
});

describe("createSubscriptionStatement", () => {
  it("names it, escapes the conninfo (E-string for the backslash), sets origin=none", () => {
    const stmt = createSubscriptionStatement({
      name: "waitron_sub_a",
      conninfo: "host='h' password='a\\b'",
      publications: ["waitron_production_ledger", "waitron_production_state"],
      copyData: true,
      enabled: true,
    });
    // The conninfo carries a backslash, so the outer literal is E'…' with doubled backslashes and
    // doubled single quotes.
    expect(stmt).toContain("CONNECTION E'host=''h'' password=''a\\\\b'''");
    expect(stmt).toContain('PUBLICATION "waitron_production_ledger", "waitron_production_state"');
    expect(stmt).toContain("origin = none");
    expect(stmt).toContain("copy_data = true");
    expect(stmt).toContain("enabled = true");
  });

  it("uses the plain quoted form when the conninfo carries no backslash", () => {
    const stmt = createSubscriptionStatement({
      name: "waitron_sub_a",
      conninfo: "host='h' password='ab'",
      publications: ["waitron_production_ledger"],
      copyData: false,
      enabled: false,
    });
    expect(stmt).toContain("CONNECTION 'host=''h'' password=''ab'''");
    expect(stmt).toContain("copy_data = false");
    expect(stmt).toContain("enabled = false");
  });
});

describe("the maintenance verbs run the right ALTER/DROP", () => {
  it("enable/disable/drop/setPublications/skip", async () => {
    const { db, calls } = fakeDb();
    await enableSubscription(db, "waitron_sub_a");
    await disableSubscription(db, "waitron_sub_a");
    await dropSubscription(db, "waitron_sub_a");
    await setSubscriptionPublications(db, "waitron_sub_a", ["waitron_production_ledger"]);
    await skipSubscription(db, "waitron_sub_a", "0/328F738");
    expect(calls[0]).toBe('ALTER SUBSCRIPTION "waitron_sub_a" ENABLE');
    expect(calls[1]).toBe('ALTER SUBSCRIPTION "waitron_sub_a" DISABLE');
    expect(calls[2]).toBe('DROP SUBSCRIPTION IF EXISTS "waitron_sub_a"');
    expect(calls[3]).toBe(
      'ALTER SUBSCRIPTION "waitron_sub_a" SET PUBLICATION "waitron_production_ledger"',
    );
    expect(calls[4]).toBe("ALTER SUBSCRIPTION \"waitron_sub_a\" SKIP (lsn = '0/328F738')");
  });

  it("refuses a bad subscription name and a bad LSN", async () => {
    const { db } = fakeDb();
    await expect(enableSubscription(db, 'bad"; drop')).rejects.toThrow();
    await expect(skipSubscription(db, "waitron_sub_a", "not-an-lsn")).rejects.toThrow();
  });
});

describe("createSubscription success", () => {
  it("executes the CREATE SUBSCRIPTION statement once", async () => {
    const { db, calls } = fakeDb();
    await createSubscription(db, {
      name: "waitron_sub_a",
      conninfo: buildConninfo(CONN),
      publications: ["waitron_production_ledger"],
      copyData: true,
      enabled: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('CREATE SUBSCRIPTION "waitron_sub_a"');
  });
});

describe("createSubscription failure", () => {
  it("throws sync.subscription_failed with only a SQLSTATE — never the conninfo/password", async () => {
    const password = "unmistakable-password-marker";
    const cause = Object.assign(new Error("boom"), { code: "42710" });
    const db = {
      execute: async () => {
        throw cause;
      },
    } as unknown as Database;
    let thrown: unknown;
    try {
      await createSubscription(db, {
        name: "waitron_sub_a",
        conninfo: buildConninfo({ ...CONN, password }),
        publications: ["waitron_production_ledger"],
        copyData: true,
        enabled: true,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("sync.subscription_failed");
    expect(thrown.params).toEqual({ sqlState: "42710" });
    expect(`${thrown.code} ${JSON.stringify(thrown.params)}`).not.toContain(password);
    expect((thrown as Error).cause).toBeUndefined();
  });
});
