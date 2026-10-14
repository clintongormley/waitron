import { randomInt } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, readBreakGlassKeyName, stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { mintBreakGlassKey, verifyBreakGlass } from "./break-glass.js";

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

const drawCodeIndex = vi.mocked(randomInt as (max: number) => number);

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
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
  const key = await mintBreakGlassKey(suite.db, NODE);
  expect(key.name).toMatch(/^2026-10-15 · [34679ACDEFHJKMNPQRTUVWXY]{4}$/);
  expect(await readBreakGlassKeyName(suite.db, NODE)).toBe(key.name);
  expect(await verifyBreakGlass(suite.db, NODE, key.secret)).toBe(true);
  expect(await verifyBreakGlass(suite.db, NODE, key.name)).toBe(false);
});

it("uses the next issue day across midnight without changing a previously stored name", async () => {
  const first = await mintBreakGlassKey(suite.db, NODE);
  vi.setSystemTime(new Date("2026-10-16T00:00:00.000Z"));
  const second = await mintBreakGlassKey(suite.db, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  expect(second.name).toMatch(/^2026-10-16 · [34679ACDEFHJKMNPQRTUVWXY]{4}$/);
  expect(await readBreakGlassKeyName(suite.db, NODE)).toBe(first.name);
});

it("draws another code when a replacement would reuse the current paper name", async () => {
  drawCodeIndex.mockImplementation(() => 0);
  const original = await mintBreakGlassKey(suite.db, NODE);
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
  const replacement = await mintBreakGlassKey(suite.db, NODE);
  expect(replacement.name).toBe("2026-10-15 · 4444");
  expect(await readBreakGlassKeyName(suite.db, NODE)).toBe(replacement.name);
  expect(await verifyBreakGlass(suite.db, NODE, original.secret)).toBe(false);
  expect(await verifyBreakGlass(suite.db, NODE, replacement.secret)).toBe(true);
});
