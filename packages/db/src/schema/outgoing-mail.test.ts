import { randomUUID } from "node:crypto";
import { engineErrorMessage } from "../testing/errors.js";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

describe("outgoing mail database protections", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const person = randomUUID();
  beforeEach(() => {
    suite.db.run(
      sql`insert into persons (id, display_name, created_at) values (${person}, 'Mail recipient', '2026-11-09T12:00:00.000Z')`,
    );
  });
  const insert = (patch: Record<string, string | number | null> = {}) => {
    const row = {
      id: randomUUID(),
      seq: 1,
      kind: "account_action",
      dedupe_key: randomUUID(),
      person_id: person,
      status: "pending",
      attempts: 0,
      next_attempt_at: "2026-11-09T12:00:00.000Z",
      queued_at: "2026-11-09T12:00:00.000Z",
      not_after: "2026-11-09T12:30:00.000Z",
      ...patch,
    };
    const columns = Object.keys(row).map((k) => sql.identifier(k));
    suite.db.run(
      sql`insert into outgoing_mail (${sql.join(columns, sql`, `)}) values (${sql.join(
        Object.values(row).map((v) => sql`${v}`),
        sql`, `,
      )})`,
    );
  };
  const refusal = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return engineErrorMessage(error);
    }
    throw new Error("Expected database refusal");
  };
  it("accepts a pending row, an invoice without a person, and waiting and finished rejections", () => {
    insert();
    insert({ seq: 2, kind: "invoice", person_id: null });
    insert({ seq: 3, status: "rejected" });
    insert({ seq: 4, status: "rejected", finished_at: "2026-11-09T12:01:00.000Z" });
    expect(suite.db.get<{ n: number }>(sql`select count(*) as n from outgoing_mail`)?.n).toBe(4);
  });
  it.each([
    ["kind", { kind: "bad" }],
    ["status", { status: "bad" }],
    ["failure", { failure_code: "raw SMTP secret" }],
    ["attempts", { attempts: -1 }],
    ["not_after", { not_after: "2026-11-09T12:00:00.000Z" }],
    ["claim", { claim_token: randomUUID() }],
    ["claim", { claimed_at: "2026-11-09T12:00:00.000Z" }],
    ["sending", { status: "sending" }],
    [
      "sending",
      { status: "sending", claim_token: randomUUID(), claimed_at: "2026-11-09T12:00:00.000Z" },
    ],
    ["finished", { status: "sent" }],
    ["finished", { status: "unknown" }],
    ["finished", { status: "expired" }],
    ["finished", { status: "cancelled" }],
    ["finished", { finished_at: "2026-11-09T12:01:00.000Z" }],
    ["person", { person_id: null }],
  ] as const)("refuses the %s violation %#", (name, patch) => {
    expect(refusal(() => insert(patch))).toContain(`outgoing_mail_${name}_ck`);
  });
  it.each(["person_id", "requested_by"])("refuses a missing %s", (key) => {
    expect(refusal(() => insert({ [key]: randomUUID() }))).toContain(
      "FOREIGN KEY constraint failed",
    );
  });
  it("refuses duplicate keys and sequences", () => {
    insert({ dedupe_key: "same" });
    expect(refusal(() => insert({ seq: 2, dedupe_key: "same" }))).toContain(
      "UNIQUE constraint failed: outgoing_mail.dedupe_key",
    );
    expect(refusal(() => insert())).toContain("UNIQUE constraint failed: outgoing_mail.seq");
  });
  it.each(["person_id", "requested_by"])("refuses deleting the person named by %s", (key) => {
    insert({ kind: "invoice", person_id: null, [key]: person });
    expect(refusal(() => suite.db.run(sql`delete from persons where id = ${person}`))).toContain(
      "FOREIGN KEY constraint failed",
    );
  });
});
