import { dirname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SUMUP_CARD_PROVIDER } from "@waitron/payments-sumup";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  KEY_ENV,
  TRADING_STATE_DIR,
  copyMigrationsRoot,
  seedSharedVenue,
} from "./testing/boot-harness.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const fixture = ephemeralServerFixture();
afterAll(async () => {
  await rm(TRADING_STATE_DIR, { recursive: true, force: true });
});

describe("boot payment audits", () => {
  it("schedules a SumUp-only account and persists its gross charge summary", async () => {
    expect(SUMUP_CARD_PROVIDER.createReconciler).toBeTypeOf("function");
    fixture.beforeServerStarts();
    await seedSharedVenue(suite.db);
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, loadKeyRing(KEY_ENV), {
        purpose: "payments.sumup",
        value: { apiKey: "synthetic", merchantCode: "MC" },
      }),
    );
    const scratch = await mkdtemp(join(tmpdir(), "waitron-audit-boot-"));
    let server: Awaited<ReturnType<typeof fixture.startServer>> | undefined;
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(url));
      expect(init?.method).toBe("GET");
      expect(String(url)).toContain("/merchants/MC/transactions/history?");
      return Response.json({ items: [], links: [] });
    });
    try {
      await copyMigrationsRoot(scratch);
      server = await fixture.startServer({
        ...KEY_ENV,
        WAITRON_ENV: "preproduction",
        WAITRON_VENUE_DIR: dirname(
          suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file,
        ),
        WAITRON_MIGRATIONS_DIR: scratch,
        WAITRON_HTTP_PORT: "32123",
      });
      await vi.waitFor(() => {
        const runs = suite.db.all<{ duty: string; summary: string; state: string }>(
          sql`select duty, summary, state from scheduled_runs`,
        );
        expect(
          runs.some((run) => run.duty === "payments.reconcile.sumup" && run.state === "succeeded"),
        ).toBe(true);
        expect(runs.every((run) => run.duty !== "payments.reconcile.stripe")).toBe(true);
      });
      await server.close();
      server = undefined;
      expect(requests.length).toBeGreaterThan(0);
      const run = suite.db.all<{ summary: string }>(
        sql`select summary from scheduled_runs where state = 'succeeded' limit 1`,
      )[0]!;
      expect(JSON.parse(run.summary)).toMatchObject({ unlinkedCharges: 0, remediated: 0 });
      expect(suite.db.all(sql`select * from payment_refunds`)).toEqual([]);
    } finally {
      await server?.close();
      vi.unstubAllGlobals();
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});
