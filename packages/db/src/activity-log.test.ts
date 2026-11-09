import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { eq, type Query } from "drizzle-orm";
import { SQLiteSelectBase } from "drizzle-orm/sqlite-core/query-builders/select";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordActivity, readActivityForSubject, readActivityForPerson } from "./activity-log.js";
import { CORE_CHANGE_SOURCES } from "./classification.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { persons } from "./schema/identity/persons.js";
import { activityLog } from "./schema/activity-log.js";
import { withTransaction } from "./tenancy.js";
import type { Transaction } from "./client.js";
import { useVenueDb } from "./testing/venue-db.js";

async function plans(read: () => Promise<unknown>) {
  const queries: Query[] = [],
    details: string[] = [];
  const prototype = SQLiteSelectBase.prototype as unknown as {
    _prepare(oneTime?: boolean): unknown;
    toSQL(): Query;
  };
  const prepare = prototype._prepare;
  const builder = vi.spyOn(prototype, "_prepare").mockImplementation(function (
    this: { toSQL(): Query },
    oneTime,
  ) {
    queries.push(this.toSQL());
    return prepare.call(this, oneTime);
  });
  const nativePrepare = DatabaseSync.prototype.prepare;
  const native = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    text,
  ) {
    const query = queries.find((entry) => entry.sql === text);
    if (query !== undefined)
      details.push(
        ...nativePrepare
          .call(this, `explain query plan ${text}`)
          .all(...(query.params as SQLInputValue[]))
          .map((row) => String(row.detail)),
      );
    return nativePrepare.call(this, text);
  });
  try {
    await read();
    return details.join("\n");
  } finally {
    native.mockRestore();
    builder.mockRestore();
  }
}

function typeCases(tx: Transaction) {
  // @ts-expect-error settings history carries no document value
  void recordActivity(tx, {
    kind: "settings.saved",
    subjectId: "probe",
    personId: null,
    data: { revision: 1, doc: {} },
  });
  // @ts-expect-error unknown kind
  void recordActivity(tx, {
    kind: "membership.node_renamed",
    subjectId: "node",
    personId: null,
    data: { term: 3 },
  });
  // @ts-expect-error term is required
  void recordActivity(tx, {
    kind: "membership.node_cleared",
    subjectId: "node",
    personId: null,
    data: {},
  });
  // @ts-expect-error clearance carries no contact URL
  void recordActivity(tx, {
    kind: "membership.node_cleared",
    subjectId: "node",
    personId: null,
    data: { term: 3, contactUrl: "https://a.example" },
  });
  // @ts-expect-error term is numeric
  void recordActivity(tx, {
    kind: "membership.node_cleared",
    subjectId: "node",
    personId: null,
    data: { term: "3" },
  });
  // @ts-expect-error the actor must be stated
  void recordActivity(tx, {
    kind: "membership.node_cleared",
    subjectId: "node",
    data: { term: 3 },
  });
}
void typeCases;

describe("activity log", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let actor: string, other: string;
  const at = new Date("2026-11-08T10:00:00.000Z");
  beforeEach(async () => {
    const rows = await suite.db
      .insert(persons)
      .values([{ displayName: "Actor" }, { displayName: "Other" }])
      .returning();
    actor = rows[0]!.id;
    other = rows[1]!.id;
  });
  afterEach(() => vi.useRealTimers());
  function add(subjectId = "node", time = at, personId: string | null = actor) {
    return withTransaction(suite.db, (tx) =>
      recordActivity(tx, {
        kind: "membership.node_cleared",
        subjectId,
        personId,
        at: time,
        data: { term: 3 },
      }),
    );
  }
  it("records its kind's subject kind stamped with the server clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at });
    const entry = await withTransaction(suite.db, (tx) =>
      recordActivity(tx, {
        kind: "membership.node_removed",
        subjectId: "node",
        personId: actor,
        data: { contactUrl: "https://a.example", term: 3 },
      }),
    );
    expect(entry).toEqual({ id: expect.any(String), at });
    expect(await suite.db.select().from(activityLog)).toEqual([
      {
        id: entry.id,
        at,
        kind: "membership.node_removed",
        subjectKind: "node",
        subjectId: "node",
        personId: actor,
        deviceId: null,
        data: { contactUrl: "https://a.example", term: 3 },
      },
    ]);
  });
  it("records the time it is given", async () => {
    const time = new Date("2026-01-01T00:00:00.000Z");
    const entry = await add("node", time);
    expect(entry.at).toEqual(time);
    expect((await suite.db.select().from(activityLog))[0]!.at).toEqual(time);
  });
  it("writes nothing when its transaction rolls back", async () => {
    await expect(
      withTransaction(suite.db, async (tx) => {
        await recordActivity(tx, {
          kind: "membership.node_cleared",
          subjectId: "node",
          personId: actor,
          data: { term: 3 },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await suite.db.select().from(activityLog)).toEqual([]);
  });
  it("reads a subject oldest first, ties in written order, with the person's current name", async () => {
    const first = await add();
    const second = await add();
    const earlier = await add("node", new Date("2026-01-01T00:00:00.000Z"));
    await add("other-node");
    await suite.db
      .insert(activityLog)
      .values({
        at,
        kind: "membership.node_cleared",
        subjectKind: "other",
        subjectId: "node",
        personId: actor,
        data: { term: 3 },
      });
    const entries = await readActivityForSubject(suite.db, { kind: "node", id: "node" });
    expect(entries.map((entry) => entry.id)).toEqual([earlier.id, first.id, second.id]);
    expect(entries.map((entry) => [entry.personName, entry.subjectPersonName])).toEqual([
      ["Actor", null],
      ["Actor", null],
      ["Actor", null],
    ]);
    await suite.db.update(persons).set({ displayName: "Anonymised" }).where(eq(persons.id, actor));
    expect(
      (await readActivityForSubject(suite.db, { kind: "node", id: "node" })).map(
        (entry) => entry.personName,
      ),
    ).toEqual(["Anonymised", "Anonymised", "Anonymised"]);
  });
  it("filters subject kinds and returns nothing for an empty kind list", async () => {
    const cleared = await add();
    await suite.db
      .insert(activityLog)
      .values({
        at,
        kind: "membership.node_removed",
        subjectKind: "node",
        subjectId: "node",
        data: { contactUrl: "https://a.example", term: 3 },
      });
    expect(
      (
        await readActivityForSubject(
          suite.db,
          { kind: "node", id: "node" },
          { kinds: ["membership.node_cleared"] },
        )
      ).map((entry) => entry.id),
    ).toEqual([cleared.id]);
    expect(
      await readActivityForSubject(suite.db, { kind: "node", id: "node" }, { kinds: [] }),
    ).toEqual([]);
    expect(await readActivityForSubject(suite.db, { kind: "node", id: "absent" })).toEqual([]);
  });
  it("reads what the person did and what was done to them, with current names", async () => {
    const own = await add();
    const [subject] = await suite.db
      .insert(activityLog)
      .values({
        at,
        kind: "membership.node_removed",
        subjectKind: "person",
        subjectId: actor,
        personId: other,
        data: { contactUrl: "https://a.example", term: 3 },
      })
      .returning();
    await add("node", at, other);
    await add("node", at, null);
    const entries = await readActivityForPerson(suite.db, actor);
    expect(entries.map((entry) => entry.id)).toEqual([own.id, subject!.id]);
    expect(entries.map((entry) => [entry.personName, entry.subjectPersonName])).toEqual([
      ["Actor", null],
      ["Other", "Actor"],
    ]);
    expect(
      (await readActivityForPerson(suite.db, actor, { kinds: ["membership.node_removed"] })).map(
        (entry) => entry.id,
      ),
    ).toEqual([subject!.id]);
    expect(await readActivityForPerson(suite.db, actor, { kinds: [] })).toEqual([]);
  });
  it("keeps entries with no actor and returns null names", async () => {
    await add("node", at, null);
    expect((await readActivityForSubject(suite.db, { kind: "node", id: "node" }))[0]).toMatchObject(
      { personId: null, personName: null, subjectPersonName: null },
    );
  });
  it("each reader's query uses its index", async () => {
    await add();
    const subject = await plans(() =>
      readActivityForSubject(suite.db, { kind: "node", id: "node" }),
    );
    expect(subject).toContain("activity_log_subject_idx");
    expect(subject).not.toContain("SCAN activity_log");
    const person = await plans(() => readActivityForPerson(suite.db, actor));
    expect(person).toContain("activity_log_person_at_idx");
    expect(person).toContain("activity_log_subject_idx");
    expect(person).not.toContain("SCAN activity_log");
  });
  it("is a live-update source", () => {
    expect(CORE_CHANGE_SOURCES).toContainEqual({
      table: "activity_log",
      type: "activity_log",
      related: [],
    });
  });
});
