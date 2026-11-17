import { is, sql, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CORE_MIGRATIONS,
  captureError,
  checkFailed,
  refusalOn,
  NOT_NULL_VIOLATION,
  UNIQUE_VIOLATION,
} from "../../index.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { liveDisplayNameKey, loginEmailKey, pendingEmailKey, persons } from "./persons.js";

const dialect = new SQLiteSyncDialect();

function render(fragment: SQL): string {
  return dialect.sqlToQuery(fragment).sql;
}

function indexExpression(name: string): string {
  const index = getTableConfig(persons).indexes.find((each) => each.config.name === name);
  const [part, ...rest] = index!.config.columns;
  expect(rest).toEqual([]);
  return render(is(part, SQL) ? part : sql`${part}`);
}

// The callers pre-check a unique index by comparing against these keys, so a key that drifts from its
// index lets a duplicate through to the database's refusal.
describe("the keys the persons unique indexes are over", () => {
  it.each([
    ["persons_email_uq", loginEmailKey],
    ["persons_live_display_name_uq", liveDisplayNameKey],
    ["persons_pending_email_uq", pendingEmailKey],
  ] as const)("%s is over the same expression its key function builds", (name, key) => {
    expect(render(key())).toBe(indexExpression(name));
  });
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
function insert(row: {
  displayName?: string;
  displayNameFolded?: string | null;
  email?: string | null;
  emailFolded?: string | null;
  pendingEmail?: string | null;
  pendingEmailFolded?: string | null;
  status?: string;
}) {
  return suite.db.run(
    sql`insert into persons (id, display_name, display_name_folded, email, email_folded, pending_email, pending_email_folded, status, created_at) values (${randomUUID()}, ${row.displayName ?? "Ada"}, ${row.displayNameFolded === undefined ? "ada" : row.displayNameFolded}, ${row.email ?? null}, ${row.emailFolded ?? null}, ${row.pendingEmail ?? null}, ${row.pendingEmailFolded ?? null}, ${row.status ?? "active"}, '2026-11-17T00:00:00Z')`,
  );
}

describe("required person comparison keys", () => {
  it("refuses a person without a folded display name", async () => {
    const error = await captureError(() => insert({ displayNameFolded: null }));
    expect(
      refusalOn(error, NOT_NULL_VIOLATION, { table: "persons", columns: ["display_name_folded"] }),
    ).toBe(true);
  });
  it.each([
    ["email", { email: "ada@x.com" }, "persons_email_folded_ck"],
    ["folded email", { emailFolded: "ada@x.com" }, "persons_email_folded_ck"],
    ["pending email", { pendingEmail: "next@x.com" }, "persons_pending_email_folded_ck"],
    [
      "folded pending email",
      { pendingEmailFolded: "next@x.com" },
      "persons_pending_email_folded_ck",
    ],
  ])("refuses a half-set %s pair", async (_name, row, constraint) => {
    const error = await captureError(() => insert(row));
    expect(checkFailed(error, constraint)).toBe(true);
  });
  it("accepts absent addresses and complete address pairs", async () => {
    await insert({});
    await insert({
      displayName: "Other",
      displayNameFolded: "other",
      email: "ADA@X.COM",
      emailFolded: "ada@x.com",
      pendingEmail: "NEXT@X.COM",
      pendingEmailFolded: "next@x.com",
    });
    expect(
      suite.db.all(
        sql`select email, email_folded, pending_email, pending_email_folded from persons order by display_name`,
      ),
    ).toEqual([
      { email: null, email_folded: null, pending_email: null, pending_email_folded: null },
      {
        email: "ADA@X.COM",
        email_folded: "ada@x.com",
        pending_email: "NEXT@X.COM",
        pending_email_folded: "next@x.com",
      },
    ]);
  });
  it("refuses matching accented live names and releases the name on suspension", async () => {
    await insert({
      displayName: "Jos\u00e9 Garc\u00eda",
      displayNameFolded: "jos\u00e9 garc\u00eda",
    });
    const duplicate = {
      displayName: "JOS\u00c9 GARC\u00cdA",
      displayNameFolded: "jos\u00e9 garc\u00eda",
    };
    const error = await captureError(() => insert(duplicate));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "persons", columns: ["display_name_folded"] }),
    ).toBe(true);
    suite.db.run(sql`update persons set status='suspended'`);
    await insert(duplicate);
    expect(suite.db.all(sql`select status from persons order by status`)).toEqual([
      { status: "active" },
      { status: "suspended" },
    ]);
  });
  it("accepts Lopez beside L\u00f3pez", async () => {
    await insert({ displayName: "Lopez", displayNameFolded: "lopez" });
    await insert({ displayName: "L\u00f3pez", displayNameFolded: "l\u00f3pez" });
    expect(suite.db.all(sql`select display_name from persons order by display_name`)).toEqual([
      { display_name: "Lopez" },
      { display_name: "L\u00f3pez" },
    ]);
  });
  it.each([
    [
      "email",
      { email: "JOS\u00c9@X.COM", emailFolded: "jos\u00e9@x.com" },
      { email: "Jos\u00e9@x.com", emailFolded: "jos\u00e9@x.com" },
      "email_folded",
    ],
    [
      "pending email",
      { pendingEmail: "JOS\u00c9@X.COM", pendingEmailFolded: "jos\u00e9@x.com" },
      { pendingEmail: "Jos\u00e9@x.com", pendingEmailFolded: "jos\u00e9@x.com" },
      "pending_email_folded",
    ],
  ])("refuses matching accented %s keys", async (_name, first, second, column) => {
    await insert(first);
    const error = await captureError(() =>
      insert({ displayName: "Other", displayNameFolded: "other", ...second }),
    );
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "persons", columns: [column] })).toBe(true);
  });
});
