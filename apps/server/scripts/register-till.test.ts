import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { registroSif } from "@waitron/fiscal-verifactu";
import { registerTill } from "./register-till.js";
import { provisionTestVenue, type TestVenue } from "./testing/venue.js";

describe("register-till against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let venue: TestVenue;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-register-till-"));
    // Reachable two ways: named by WAITRON_VENUE_DIR, and derived from WAITRON_STATE_DIR.
    venueDir = join(workDir, "venue");
    await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
    venue = await provisionTestVenue(venueDir, "50000000K");
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  async function sifHistory(): Promise<{ numeroInstalacion: number; live: boolean }[]> {
    const store = await openVenueDatabase(venueDir);
    try {
      const rows = await store.venue
        .select({
          numeroInstalacion: registroSif.numeroInstalacion,
          revocadoEn: registroSif.revocadoEn,
        })
        .from(registroSif)
        .where(eq(registroSif.nodeId, venue.nodeId));
      return rows
        .map((r) => ({ numeroInstalacion: r.numeroInstalacion, live: r.revocadoEn === null }))
        .sort((a, b) => a.numeroInstalacion - b.numeroInstalacion);
    } finally {
      await store.close();
    }
  }

  it("provisioning already left exactly one live SIF, so a second one can only come from here", async () => {
    // The control: without it the assertions below would pass on a directory never opened.
    expect(await sifHistory()).toEqual([{ numeroInstalacion: 1, live: true }]);
  });

  it("re-registers the node in the directory WAITRON_VENUE_DIR names", async () => {
    const seeded = await registerTill(venue.nodeId, { WAITRON_VENUE_DIR: venueDir });
    expect(seeded.map((s) => s.module)).toContain("fiscal-verifactu");
    // The previous identity is retired, not edited: old registros keep pointing at it (CLAUDE.md §5).
    expect(await sifHistory()).toEqual([
      { numeroInstalacion: 1, live: false },
      { numeroInstalacion: 2, live: true },
    ]);
  });

  it("finds the same directory from WAITRON_STATE_DIR alone", async () => {
    // A third installation number here shows the default branch reached the real venue.
    const seeded = await registerTill(venue.nodeId, { WAITRON_STATE_DIR: workDir });
    expect(seeded.map((s) => s.module)).toContain("fiscal-verifactu");
    expect(await sifHistory()).toEqual([
      { numeroInstalacion: 1, live: false },
      { numeroInstalacion: 2, live: false },
      { numeroInstalacion: 3, live: true },
    ]);
  });

  it("refuses a node the venue does not hold, by its domain code", async () => {
    await expect(
      registerTill("00000000-0000-4000-8000-000000000000", { WAITRON_VENUE_DIR: venueDir }),
    ).rejects.toMatchObject({ code: "node.not_found" });
    const history = await sifHistory();
    expect(history).toHaveLength(3);
    expect(history.at(-1)).toEqual({ numeroInstalacion: 3, live: true });
  });

  it("leaves exactly one live SIF after every re-registration", async () => {
    const store = await openVenueDatabase(venueDir);
    try {
      const live = await store.venue
        .select({ id: registroSif.id })
        .from(registroSif)
        .where(and(eq(registroSif.nodeId, venue.nodeId), isNull(registroSif.revocadoEn)));
      expect(live).toHaveLength(1);
    } finally {
      await store.close();
    }
  });
});
