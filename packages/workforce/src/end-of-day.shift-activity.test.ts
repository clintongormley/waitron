import { expect, it } from "vitest";
import { attendanceFixture } from "../test/attendance-fixture.js";

const f = attendanceFixture();

it("a forgotten first clock-out uses its overrun, leaving the later planned shift its own question", async () => {
  const open = await f.open();
  await f.process({
    planned: [
      f.plan("lunch", "2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z"),
      f.plan("dinner", "2026-01-05T18:00:00Z", "2026-01-05T22:00:00Z"),
    ],
    facts: [
      f.fact("2026-01-05T10:00:00Z", "lunch-first"),
      f.fact("2026-01-05T13:30:00Z", "lunch-overrun"),
      f.fact("2026-01-05T19:00:00Z", "dinner-first"),
      f.fact("2026-01-05T21:00:00Z", "dinner-last"),
    ],
  });
  expect((await f.entries()).at(-1)).toMatchObject({
    entryKind: "out",
    eventAt: "2026-01-05T13:30:00.000Z",
    authorKind: "automatic",
  });
  expect(
    (await f.questions())
      .map((q) => ({
        key: q.shiftKey,
        kind: q.kind,
        evidence: q.evidenceKeys,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  ).toEqual([
    {
      key: `in:${open}`,
      kind: "automatic-out",
      evidence: ["order:lunch-first", "order:lunch-overrun"],
    },
    {
      key: "rota:dinner",
      kind: "missing-times",
      evidence: ["order:dinner-first", "order:dinner-last"],
    },
  ]);
});

it("an overnight shift keeps its later endpoint after the business day ends", async () => {
  await f.open("2026-01-06T02:00:00Z");
  await f.process({
    planned: [f.plan("night", "2026-01-06T02:00:00Z", "2026-01-06T06:00:00Z")],
    facts: [f.fact("2026-01-06T03:00:00Z", "first"), f.fact("2026-01-06T05:00:00Z", "last")],
    now: new Date("2026-01-06T06:00:00Z"),
  });
  expect((await f.entries()).at(-1)).toMatchObject({
    entryKind: "out",
    eventAt: "2026-01-06T05:00:00.000Z",
    authorKind: "automatic",
  });
});

it("an overnight clock-in waits for its planned end before asking or closing", async () => {
  await f.open("2026-01-06T02:00:00Z");
  expect(
    await f.process({
      planned: [f.plan("night", "2026-01-06T02:00:00Z", "2026-01-06T06:00:00Z")],
      facts: [f.fact("2026-01-06T03:00:00Z", "first")],
    }),
  ).toEqual({ automaticEntryIds: [], questionIds: [] });
  expect(await f.questions()).toEqual([]);
});
