import * as crypto from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { plannedZone } from "./testing/floor-today-venue.js";
import { setupPartyVenue, tableRow, type PartyVenue } from "./testing/party-venue.js";

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return { ...real, randomUUID: vi.fn(real.randomUUID) };
});

let venue: PartyVenue;
let nextUUID = 0;
const NOW = new Date("2026-10-10T12:00:00Z");

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    venue = await setupPartyVenue(db);
  },
});

afterEach(() => vi.mocked(crypto.randomUUID).mockReset());

it.each([
  { label: "Counter 3", sharedPrefix: true },
  { label: undefined, sharedPrefix: true },
  { label: "Counter 3", sharedPrefix: false },
  { label: undefined, sharedPrefix: false },
])(
  "keeps $label table labels distinct across zones with sharedPrefix=$sharedPrefix",
  async ({ label, sharedPrefix }) => {
    vi.mocked(crypto.randomUUID).mockImplementation(() => {
      const serial = String(++nextUUID).padStart(12, "0");
      const prefix = sharedPrefix ? "ea3a14" : serial.slice(-6);
      return `${prefix}${serial.slice(-2)}-0000-4000-8000-${serial}`;
    });

    const first = await plannedZone(venue, [{ key: "counter", label }], NOW);
    const second = await plannedZone(venue, [{ key: "counter", label }], NOW);
    const firstRow = await tableRow(venue, first.table.counter!);
    const secondRow = await tableRow(venue, second.table.counter!);

    expect(second.zoneId).not.toBe(first.zoneId);
    expect(secondRow.id).not.toBe(firstRow.id);
    expect(firstRow.label).toMatch(new RegExp(`^${label ?? "counter"} `));
    expect(secondRow.label).toMatch(new RegExp(`^${label ?? "counter"} `));
    expect(secondRow.label).not.toBe(firstRow.label);
  },
);
