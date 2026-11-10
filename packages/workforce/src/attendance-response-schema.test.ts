import { beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, newId, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { attendanceQuestions } from "./schema/attendance.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
let personId: string, manager: string, questionId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  await seedLocation(suite.db);
  personId = await seedPerson(suite.db);
  manager = await seedPerson(suite.db, "Manager");
  const [question] = await suite.db
    .insert(attendanceQuestions)
    .values({
      personId,
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
    question: questionId,
    action: "request",
    input: JSON.stringify({
      action: "request",
      questionId,
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
    (id, requested_by_person_id, authorized_by_person_id, person_id, question_id, action, input, entry_ids, created_at)
  values (${r.id}, ${r.requester}, ${r.authorizer}, ${r.subject}, ${r.question}, ${r.action}, ${r.input}, ${r.entries}, '2026-01-06T08:00:00.000Z')`),
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
      question_id: questionId,
      action: "request",
      input: r.input,
      entry_ids: '["entry-in","entry-out"]',
      created_at: "2026-01-06T08:00:00.000Z",
    },
  ]);
});

it.each(["requester", "authorizer", "subject", "question"])(
  "refuses an absent %s without retaining a receipt",
  async (field) => {
    await expect(
      insert(
        receipt({
          [field]: newId(),
          ...(field === "subject" ? { question: null } : {}),
        }),
      ),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(suite.db.execute(sql`select * from attendance_response_commands`).rows).toEqual([]);
  },
);

it("refuses another person's question even when every individual id exists", async () => {
  const scopes: Record<string, string | null>[] = [{ subject: manager }];
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
