import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "@waitron/composition";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import { encodeMinuteIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { readSeriesPicks, seriesPicksUnreadable } from "./first-setup-start-again-name-records.js";

const reader = vi.hoisted(() => ({ fail: null as Error | null }));
vi.mock("@waitron/provisioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/provisioning")>();
  return {
    ...actual,
    readWellFormedModulePreparations: (
      ...args: Parameters<typeof actual.readWellFormedModulePreparations>
    ) =>
      reader.fail === null
        ? actual.readWellFormedModulePreparations(...args)
        : Promise.reject(reader.fail),
  };
});

const MODULE = "fiscal-verifactu";
const seat = initialSetupFor(ALL_MODULES, MODULE)!.startAgainFloor!;
const fiscal = ALL_MODULES.find((module) => module.name === MODULE)!;
const seatless: WaitronModule = {
  ...fiscal,
  name: "no-seat",
  provisioning: {
    ...fiscal.provisioning!,
    initialSetup: { ...fiscal.provisioning!.initialSetup!, startAgainFloor: undefined },
  },
};
const binding = (module: string) => ({
  module,
  action: "select-hour",
  eventId: "event-1",
  sourceId: "source-1",
  targetNodeId: "node-1",
});
let roots: { stateDir: string; venueDir: string };
let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "start-again-name-records-"));
  roots = { stateDir: base, venueDir: join(base, "venue") };
  reader.fail = null;
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
const writePicks = (text: string) =>
  writeFile(join(roots.stateDir, "module-preparation-state.json"), text);
const picks = (value: unknown, module = MODULE) =>
  writePicks(JSON.stringify({ version: 1, revisions: [{ binding: binding(module), value }] }));

it("a picks file that is not JSON is unreadable", async () => {
  await writePicks("{damaged");
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [],
    unreadable: true,
  });
});
it("a picks file whose row the hour seat refuses is unreadable", async () => {
  await picks({ version: 1, entries: [{}] });
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [],
    unreadable: true,
  });
});
it("a missing picks file is empty and not unreadable", async () => {
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [],
    unreadable: false,
  });
});
it("a valid picks file gives its rows", async () => {
  await picks({ version: 1, entries: [] });
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [{ version: 1, entries: [] }],
    unreadable: false,
  });
});
const chosenName = (issuedAt: string, identity = encodeMinuteIdentity(Date.parse(issuedAt))) => ({
  version: 1,
  entries: [
    {
      kind: "intent",
      binding: binding(MODULE),
      operatorId: "owner-1",
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
      bases: [
        { code: "A", purpose: "standard" },
        { code: "FF", purpose: "full" },
        { code: "R", purpose: "rectificative" },
      ],
      contextKey: "country/zone/module-version/owner-generation-1",
      softwareId: "W1",
      references: [],
      identity,
      issuedAt,
    },
  ],
});
it("a picks file holding a real chosen-name row gives that row and is not unreadable", async () => {
  const row = chosenName("2026-10-16T11:40:00.000Z");
  await picks(row);
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [row],
    unreadable: false,
  });
  expect(await seriesPicksUnreadable(roots, [fiscal], [MODULE])).toBe(false);
  await picks(chosenName("2026-10-16T11:41:00.000Z", row.entries[0]!.identity));
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [],
    unreadable: true,
  });
});
it("a fault from the reader that is not a domain refusal is rethrown, even with the file present", async () => {
  await picks({ version: 1, entries: [] });
  const fault = new Error("reader fault");
  reader.fail = fault;
  await expect(readSeriesPicks(roots, MODULE, seat)).rejects.toBe(fault);
  await expect(seriesPicksUnreadable(roots, [fiscal], [MODULE])).rejects.toBe(fault);
});
it("a domain refusal from the reader with no picks file present is rethrown, not counted", async () => {
  const refused = new AppError("setup.attempt_invalid", {});
  reader.fail = refused;
  await expect(readSeriesPicks(roots, MODULE, seat)).rejects.toBe(refused);
});
it("an error from the seat that is not a domain refusal is rethrown", async () => {
  await picks({ version: 1, entries: [] });
  const broken = new Error("seat fault");
  await expect(
    readSeriesPicks(roots, MODULE, () => {
      throw broken;
    }),
  ).rejects.toBe(broken);
});
it("a damaged picks file counts only for a module with a Start again floor seat", async () => {
  await writePicks("{damaged");
  expect(await seriesPicksUnreadable(roots, [fiscal, seatless], ["no-seat"])).toBe(false);
  expect(await seriesPicksUnreadable(roots, [fiscal, seatless], ["no-seat", MODULE])).toBe(true);
});
it("an intact picks file is not unreadable for any module", async () => {
  await picks({ version: 1, entries: [] });
  expect(await seriesPicksUnreadable(roots, [fiscal, seatless], ["no-seat", MODULE])).toBe(false);
});
it.each([
  [
    "a row the hour seat refuses",
    { binding: binding(MODULE), value: { version: 1, entries: [{}] } },
  ],
  ["a revision whose binding is malformed", { binding: { module: MODULE }, value: {} }],
])(
  "a readable chosen-name row beside %s is kept, and the picks file is still unreadable",
  async (_which, bad) => {
    const row = chosenName("2026-10-16T15:00:00.000Z");
    await writePicks(
      JSON.stringify({ version: 1, revisions: [{ binding: binding(MODULE), value: row }, bad] }),
    );
    expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
      preparations: [row],
      unreadable: true,
    });
    expect(await seriesPicksUnreadable(roots, [fiscal], [MODULE])).toBe(true);
  },
);
it("a malformed revision of another module still makes this module's picks unreadable, keeping its rows", async () => {
  const row = chosenName("2026-10-16T15:00:00.000Z");
  await writePicks(
    JSON.stringify({
      version: 1,
      revisions: [
        { binding: binding(MODULE), value: row },
        { binding: { ...binding("other-module"), eventId: "" }, value: {} },
      ],
    }),
  );
  expect(await readSeriesPicks(roots, MODULE, seat)).toEqual({
    preparations: [row],
    unreadable: true,
  });
});
