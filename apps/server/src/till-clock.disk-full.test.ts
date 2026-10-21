import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { FiscalBackend } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { timeEntries } from "@waitron/workforce";
import { createDiskFullState, type DiskFullState } from "./disk-full-state.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import { mountTillApi } from "./till-api.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: ClockVenue;
beforeEach(async () => {
  venue = await createClockVenue(suite.db, () => new Date());
});

const quiet = () => {};

function diskState(noted: boolean): DiskFullState {
  const disk = createDiskFullState({
    dir: "/unused",
    now: () => new Date(),
    log: quiet,
    statfs: () => Promise.resolve({ bavail: 0, frsize: 1 }),
  });
  if (noted) disk.noteRefused();
  return disk;
}

function clockIn(disk: DiskFullState) {
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      workforceEnabled: true,
      secureCookies: false,
      venueLocale: "es-ES",
      clock: systemClock(),
      backend: {} as FiscalBackend,
      disk,
    },
    quiet,
  );
  return app.request("/api/clock/in", {
    method: "POST",
    headers: { cookie: venue.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedEntryId: null }),
  });
}

async function count() {
  return (await suite.db.select({ id: timeEntries.id }).from(timeEntries)).length;
}

describe("the full-disk gate on the till's clock", () => {
  it("clocks no one in while the stop holds", async () => {
    const before = await count();
    const refused = await clockIn(diskState(true));
    expect(refused.status).toBe(507);
    expect(await refused.json()).toEqual({ error: { code: "storage.disk_full", params: {} } });
    expect(await count()).toBe(before);
  });

  it("clocks a person in while nothing is noted", async () => {
    const before = await count();
    const clocked = await clockIn(diskState(false));
    expect(clocked.status).toBe(200);
    expect(await count()).toBe(before + 1);
  });
});
