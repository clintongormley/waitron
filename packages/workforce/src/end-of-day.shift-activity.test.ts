import { beforeEach, expect, it } from "vitest";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { attendanceFixture } from "../test/attendance-fixture.js";

const f = attendanceFixture();
beforeEach(() => seedBusinessDay(f.suite.db, { timeZone: "UTC", dayCutover: "04:00" }));

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

it("a later clock-in keeps the earlier automatic finish separate from the dinner finish", async () => {
  await f.open();
  const planned = [
    f.plan("lunch", "2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z"),
    f.plan("dinner", "2026-01-05T18:00:00Z", "2026-01-05T22:00:00Z"),
  ];
  const lunch = [f.fact("2026-01-05T13:30:00Z", "lunch-overrun")];
  await f.process({ planned, facts: lunch });
  await f.open("2026-01-05T18:00:00Z");
  await f.process({ planned, facts: [...lunch, f.fact("2026-01-05T22:30:00Z", "dinner-overrun")] });
  expect((await f.entries()).filter((e) => e.entryKind === "out").map((e) => e.eventAt)).toEqual([
    "2026-01-05T13:30:00.000Z",
    "2026-01-05T22:30:00.000Z",
  ]);
  expect(
    (await f.questions())
      .filter((q) => q.kind === "automatic-out")
      .map((q) => q.evidenceKeys)
      .sort((a, b) => a.join().localeCompare(b.join())),
  ).toEqual([["order:dinner-overrun"], ["order:lunch-overrun"]]);
});

it("an overnight legal break end remains activity after the day changeover", async () => {
  await f.open("2026-01-06T02:00:00Z");
  await f.run((tx) => f.backend.breakStart(tx, f.event("2026-01-06T04:30:00Z")));
  await f.run((tx) => f.backend.breakEnd(tx, f.event("2026-01-06T05:00:00Z")));
  await f.process({
    planned: [f.plan("night", "2026-01-06T02:00:00Z", "2026-01-06T06:00:00Z")],
    facts: [f.fact("2026-01-06T03:00:00Z")],
    now: new Date("2026-01-06T06:00:00Z"),
  });
  expect((await f.entries()).at(-1)).toMatchObject({
    entryKind: "out",
    eventAt: "2026-01-06T05:00:00.000Z",
  });
});
