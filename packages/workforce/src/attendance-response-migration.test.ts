import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, newId, runMigrations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { WorkforceBackend } from "./clocking.js";
import { readChain } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { attendanceMail, attendanceQuestions } from "./schema/attendance.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
let personId: string, manager: string, locationId: string, questionId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  personId = await seedPerson(suite.db);
  manager = await seedPerson(suite.db, "Manager");
  const [question] = await suite.db
    .insert(attendanceQuestions)
    .values({
      personId,
      locationId,
      businessDay: "2026-01-05",
      startAt: "2026-01-05T04:00:00.000Z",
      endAt: "2026-01-06T04:00:00.000Z",
      shiftKey: "rota:one",
      kind: "missing-times",
      missingKinds: ["in", "out"],
      evidenceKeys: ["rota:one"],
      createdAt: "2026-01-06T04:00:00.000Z",
    })
    .returning({ id: attendanceQuestions.id });
  questionId = question!.id;
});
function receipt(patch: Record<string, string | null> = {}) {
  return {
    id: newId(),
    requester: personId,
    authorizer: personId,
    subject: personId,
    location: locationId,
    question: questionId,
    action: "request",
    input: JSON.stringify({
      action: "request",
      questionId,
      locationId,
      changes: [
        { target: { missingKind: "in" }, at: "2026-01-05T09:00:00.000Z", offsetMinutes: 0 },
        { target: { missingKind: "out" }, at: "2026-01-05T17:00:00.000Z", offsetMinutes: 0 },
      ],
      reason: "Forgot both times",
    }),
    entries: JSON.stringify(["entry-in", "entry-out"]),
    ...patch,
  };
}
const insert = (r: ReturnType<typeof receipt>) =>
  withTransaction(suite.db, (tx) =>
    tx.execute(sql`
  insert into attendance_response_commands
    (id, requested_by_person_id, authorized_by_person_id, person_id, location_id,
     question_id, action, input, entry_ids, created_at)
  values (${r.id}, ${r.requester}, ${r.authorizer}, ${r.subject}, ${r.location},
    ${r.question}, ${r.action}, ${r.input}, ${r.entries}, '2026-01-06T08:00:00.000Z')`),
  );

it("stores a question-linked response receipt and both legal result ids", async () => {
  const r = receipt();
  await expect(insert(r)).resolves.toBeDefined();
  expect(suite.db.execute(sql`select * from attendance_response_commands`).rows).toEqual([
    {
      id: r.id,
      requested_by_person_id: personId,
      authorized_by_person_id: personId,
      person_id: personId,
      location_id: locationId,
      question_id: questionId,
      action: "request",
      input: r.input,
      entry_ids: '["entry-in","entry-out"]',
      created_at: "2026-01-06T08:00:00.000Z",
    },
  ]);
});

it.each(["requester", "authorizer", "subject", "location", "question"])(
  "refuses an absent %s without retaining a receipt",
  async (field) => {
    await expect(
      insert(
        receipt({
          [field]: newId(),
          ...(field === "subject" || field === "location" ? { question: null } : {}),
        }),
      ),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(suite.db.execute(sql`select * from attendance_response_commands`).rows).toEqual([]);
  },
);

it("refuses another person's or location's question even when every individual id exists", async () => {
  const otherLocation = await seedLocation(suite.db);
  const scopes: Record<string, string | null>[] = [
    { subject: manager },
    { location: otherLocation },
  ];
  for (const patch of scopes) {
    await expect(insert(receipt(patch))).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(suite.db.execute(sql`select * from attendance_response_commands`).rows).toEqual([]);
  }
});

it.each(["unknown", "", "APPROVE"])("refuses unrecognised action %j", async (action) => {
  await expect(insert(receipt({ action }))).rejects.toThrow(
    "attendance_response_commands_action_ck",
  );
  expect(suite.db.execute(sql`select * from attendance_response_commands`).rows).toEqual([]);
});

it.each(["[]", "{}", '"entry"', "null"])(
  "refuses an empty or non-array result %s",
  async (entries) => {
    await expect(insert(receipt({ entries }))).rejects.toThrow(
      "attendance_response_commands_entries_ck",
    );
    expect(suite.db.execute(sql`select * from attendance_response_commands`).rows).toEqual([]);
  },
);

it("accepts a manager command with no question and keeps the exact command id unique", async () => {
  const r = receipt({ question: null, action: "propose", requester: manager, authorizer: manager });
  await insert(r);
  await expect(insert(r)).rejects.toThrow("UNIQUE constraint failed");
  expect(
    suite.db.execute(sql`select id, question_id from attendance_response_commands`).rows,
  ).toEqual([{ id: r.id, question_id: null }]);
});

const previousFolder = mkdtempSync(join(tmpdir(), "a10-4-before-response-"));
mkdirSync(join(previousFolder, "meta"));
const journal = JSON.parse(
  readFileSync(join(WORKFORCE_MIGRATIONS.migrationsFolder, "meta/_journal.json"), "utf8"),
) as { entries: { tag: string }[] };
journal.entries = journal.entries.slice(0, 8);
writeFileSync(join(previousFolder, "meta/_journal.json"), JSON.stringify(journal));
for (const { tag } of journal.entries)
  copyFileSync(
    join(WORKFORCE_MIGRATIONS.migrationsFolder, `${tag}.sql`),
    join(previousFolder, `${tag}.sql`),
  );
afterAll(() => rmSync(previousFolder, { recursive: true, force: true }));

describe("populated A10-3 response-table upgrade", () => {
  const old = useVenueDb({
    resetPerTest: false,
    migrations: [
      CORE_MIGRATIONS,
      IDENTITY_MIGRATIONS,
      { ...WORKFORCE_MIGRATIONS, migrationsFolder: previousFolder },
    ],
  });
  it("adds only the empty receipt table and retains legal rows, heads, questions and attempted mail byte for byte", async () => {
    const db = old.db;
    await seedTenant(db);
    const subject = await seedPerson(db);
    const place = await seedLocation(db);
    const node = await seedNode(db, brandLocationId(place));
    const backend = new WorkforceBackend();
    const input = {
      nodeId: node,
      personId: subject,
      locationId: place,
      offsetMinutes: 0,
      origin: jobOrigin("dashboard"),
    };
    await withTransaction(db, (tx) =>
      backend.clockIn(tx, { ...input, at: "2026-01-05T09:00:00Z" }),
    );
    await withTransaction(db, (tx) =>
      backend.clockOut(tx, { ...input, at: "2026-01-05T17:00:00Z" }),
    );
    const [question] = await db
      .insert(attendanceQuestions)
      .values({
        personId: subject,
        locationId: place,
        businessDay: "2026-01-06",
        startAt: "2026-01-06T04:00:00.000Z",
        endAt: "2026-01-07T04:00:00.000Z",
        shiftKey: "rota:retained",
        kind: "missing-times",
        missingKinds: ["in", "out"],
        evidenceKeys: ["rota:retained"],
        createdAt: "2026-01-07T04:00:00.000Z",
      })
      .returning({ id: attendanceQuestions.id });
    await db.insert(attendanceMail).values({
      questionId: question!.id,
      status: "sent",
      outcome: "sent",
      recipient: "ana@example.test",
      nextAttemptAt: "2026-01-07T05:00:00.000Z",
    });
    const before = {
      entries: JSON.stringify(
        db.execute(sql`select * from time_entries order by sequence_no`).rows,
      ),
      heads: JSON.stringify(db.execute(sql`select * from workforce_chains`).rows),
      questions: JSON.stringify(db.execute(sql`select * from attendance_questions`).rows),
      mail: JSON.stringify(db.execute(sql`select * from attendance_mail`).rows),
      tables: db
        .execute<{ name: string }>(
          sql`select name from sqlite_master where type='table' order by name`,
        )
        .rows.map((r) => r.name),
    };
    await runMigrations(db, WORKFORCE_MIGRATIONS);
    expect(
      JSON.stringify(db.execute(sql`select * from time_entries order by sequence_no`).rows),
    ).toBe(before.entries);
    expect(JSON.stringify(db.execute(sql`select * from workforce_chains`).rows)).toBe(before.heads);
    expect(JSON.stringify(db.execute(sql`select * from attendance_questions`).rows)).toBe(
      before.questions,
    );
    expect(JSON.stringify(db.execute(sql`select * from attendance_mail`).rows)).toBe(before.mail);
    const tables = db
      .execute<{ name: string }>(
        sql`select name from sqlite_master where type='table' order by name`,
      )
      .rows.map((r) => r.name);
    expect(tables.filter((name) => !before.tables.includes(name))).toEqual([
      "attendance_response_commands",
    ]);
    expect(before.tables.filter((name) => !tables.includes(name))).toEqual([]);
    expect(db.execute(sql`select * from attendance_response_commands`).rows).toEqual([]);
    expect(verifyChain(await readChain(db, { nodeId: node, locationId: place }))).toEqual({
      ok: true,
    });
    await expect(
      withTransaction(db, (tx) =>
        tx.execute(sql`update time_entries set event_at='2026-01-05T08:00:00.000Z'`),
      ),
    ).rejects.toThrow("time_entries is append-only");
    expect(
      JSON.stringify(db.execute(sql`select * from time_entries order by sequence_no`).rows),
    ).toBe(before.entries);
  });
});
