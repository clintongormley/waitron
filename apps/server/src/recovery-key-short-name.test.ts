import { randomInt } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, insertRecoveryPack, stampDeployment, withTransaction } from "@waitron/db";
import { NODE_MIGRATIONS, readRecoveryKeyName } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { newBreakGlassKeyName } from "@waitron/provisioning";
import { mintBreakGlassKey, verifyBreakGlass } from "./break-glass.js";

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

const drawCodeIndex = vi.mocked(randomInt as (max: number) => number);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T23:59:59.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  drawCodeIndex.mockReset();
  drawCodeIndex.mockImplementation((max: number) => max - 1);
});

it("stores the UTC issue day and a four-character code independently of the secret", async () => {
  const key = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, NODE);
  expect(key.name).toMatch(/^2026-10-15 · [34679ACDEFHJKMNPQRTUVWXY]{4}$/);
  expect(await readRecoveryKeyName(suite.node, NODE)).toBe(key.name);
  expect(await verifyBreakGlass(suite.node, NODE, key.secret)).toBe(true);
  expect(await verifyBreakGlass(suite.node, NODE, key.name)).toBe(false);
});

it("uses the next issue day across midnight without changing a previously stored name", async () => {
  const first = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, NODE);
  vi.setSystemTime(new Date("2026-10-16T00:00:00.000Z"));
  const second = await mintBreakGlassKey(
    { venue: suite.db, node: suite.node },
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );
  expect(second.name).toMatch(/^2026-10-16 · [34679ACDEFHJKMNPQRTUVWXY]{4}$/);
  expect(await readRecoveryKeyName(suite.node, NODE)).toBe(first.name);
});

it("draws another code when a replacement would reuse the current paper name", async () => {
  drawCodeIndex.mockImplementation(() => 0);
  const original = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, NODE);
  expect(original.name).toBe("2026-10-15 · 3333");
  drawCodeIndex
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1);
  const replacement = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, NODE);
  expect(replacement.name).toBe("2026-10-15 · 4444");
  expect(await readRecoveryKeyName(suite.node, NODE)).toBe(replacement.name);
  expect(await verifyBreakGlass(suite.node, NODE, original.secret)).toBe(false);
  expect(await verifyBreakGlass(suite.node, NODE, replacement.secret)).toBe(true);
});

it("draws another code when a new key would reuse a name this node's packs recorded", async () => {
  await withTransaction(suite.db, (tx) =>
    insertRecoveryPack(tx, {
      nodeId: NODE,
      number: 1,
      madeAt: new Date("2026-10-15T09:00:00.000Z"),
      madeBy: null,
      parts: [
        { part: "server-key", state: "included", keyName: "2026-10-15 · 3333", carriedKey: true },
      ],
    }),
  );
  drawCodeIndex
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1);
  const key = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, NODE);
  expect(key.name).toBe("2026-10-15 · 4444");
  expect(await readRecoveryKeyName(suite.node, NODE)).toBe("2026-10-15 · 4444");
});

it("draws a new name until it matches none of the names it is told are taken", () => {
  drawCodeIndex
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(1)
    .mockReturnValueOnce(2)
    .mockReturnValueOnce(2)
    .mockReturnValueOnce(2)
    .mockReturnValueOnce(2);
  const taken = new Set(["2026-10-15 · 3333", "2026-10-15 · 4444"]);
  expect(newBreakGlassKeyName("2026-10-15", taken)).toBe("2026-10-15 · 6666");
});
