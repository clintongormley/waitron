import { seedModuleSettings } from "../test/module-settings.js";
import { cp, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTransaction, saveSettings } from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { failAttempting, PAYMENTS_SETTINGS } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Alert } from "@waitron/module";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

vi.mock("./stripe-account.js", async (original) => {
  const actual = await original<typeof import("./stripe-account.js")>();
  const { FakeStripeReport } =
    await import("../../../packages/payments-stripe/src/testing/fake-stripe-report.js");
  return {
    ...actual,
    stripeAccountResolver: () => async () => ({
      report: new FakeStripeReport(),
      refund: {
        refund: async () => {
          throw new Error("unexpected refund");
        },
      },
    }),
  };
});

const { startServer, httpPort } = ephemeralServerFixture();

const sets = manifestSets();
describe.each([false, true])("the running server with Payments Off (installed=%s)", (installed) => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(
      sets.filter((set) => installed || set.name !== "payments"),
      null,
    ),
  });
  it("keeps an absent set absent, or upgrades retained tables and recovers earlier payments", async () => {
    const venue = await setupVenue(suite.db);
    const [port] = await freePorts(1);
    let scratch: string | undefined;
    let server: StartedServer | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "waitron-boot-payments-off-"));
      const migrationsRoot = join(scratch, "migrations");
      const options = migrationOptionsFor(sets, null);
      for (const [index, set] of sets.entries()) {
        await cp(options[index]!.migrationsFolder, join(migrationsRoot, set.name), {
          recursive: true,
        });
      }
      const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
      const journalPath = join(migrationsRoot, "payments", "meta", "_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      const last = journal.entries.at(-1);
      journal.entries.push({
        ...last,
        idx: last.idx + 1,
        when: last.when + 1,
        tag: "9999_a646_probe",
      });
      await writeFile(journalPath, JSON.stringify(journal));
      await writeFile(
        join(migrationsRoot, "payments", "9999_a646_probe.sql"),
        "create table a646_probe (id integer);\n",
      );
      await seedModuleSettings(suite.db, { "fiscal-none": false, payments: false });
      const env = {
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_STATE_DIR: scratch,
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_NODE_ID: venue.cfg.nodeId,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_ENV: "preproduction",
      };
      if (installed) {
        await withTransaction(suite.db, async (tx) => {
          await saveSettings(tx, PAYMENTS_SETTINGS, {
            doc: { providers: { stripe: false, sumup: false } },
            expectedRevision: 0,
            personId: null,
          });
          await putCredential(tx, loadKeyRing(env), {
            purpose: "payments.stripe",
            value: {
              secretKey: "sk_test_retained",
              webhookSecret: "whsec_test",
              successUrl: "https://example.test/yes",
              cancelUrl: "https://example.test/no",
            },
          });
          tx.run(
            sql`insert into working_orders (id, source, order_number, opened_at) values ('retained-order', 'operator_script', 1, '2026-11-14T10:00:00.000Z')`,
          );
          tx.run(sql`insert into payments (id, working_order_id, source, provider, payment_ref, amount, state, created_at, updated_at)
            values ('retained-payment', 'retained-order', 'operator_script', 'stripe', 'retained-ref', 1000, 'attempting', '2026-11-14T10:00:00.000Z', '2026-11-14T10:00:00.000Z')`);
        });
      }
      server = await startServer(env, env, {
        cardPool: ({ db }) => {
          const card = new FakePaymentProvider(db);
          Object.defineProperty(card, "provider", { value: "stripe" });
          card.resolvePending = async () => {
            const row = db.all<{ state: string }>(
              sql`select state from payments where id = 'retained-payment'`,
            )[0];
            if (row?.state === "attempting")
              await withTransaction(db, (tx) =>
                failAttempting(tx, { provider: "stripe", paymentRef: "retained-ref" }),
              );
            return { nextDueAt: null, forwarded: 0, declined: 1, incidentsRaised: 0 };
          };
          return { get: async () => card, evict() {} };
        },
      });
      const base = `http://127.0.0.1:${httpPort()}`;
      await vi.waitFor(async () => {
        expect((await fetch(`${base}/health`)).status).toBe(200);
      });

      const events = await fetch(
        `${base}/management-api/events?resources=${encodeURIComponent(JSON.stringify(["settings.modules", "settings.payments", ...(installed ? ["payments"] : [])].map((type) => ({ type }))))}`,
        { headers: { cookie: venue.managerCookie } },
      );
      try {
        expect(events.status).toBe(200);
        const reader = events.body!.getReader();
        try {
          expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
        } finally {
          await reader.cancel();
        }
      } finally {
        if (!events.body?.locked) await events.body?.cancel();
      }

      if (installed) {
        await expect
          .poll(
            () =>
              suite.db.all<{ state: string }>(
                sql`select state from payments where id = 'retained-payment'`,
              )[0]?.state,
          )
          .toBe("failed");
        await expect
          .poll(
            () =>
              suite.db.all(
                sql`select id from scheduled_runs where duty = 'payments.reconcile.stripe' and state = 'succeeded'`,
              ).length,
          )
          .toBeGreaterThan(0);
      }
      const response = await fetch(`${base}/management-api/alerts`, {
        headers: { cookie: venue.managerCookie },
      });
      expect(response.status).toBe(200);
      const { alerts } = (await response.json()) as { alerts: Alert[] };
      expect(alerts.filter((alert) => alert.area === "card_reader")).toEqual([]);
      const tables = suite.db.all<{
        name: string;
      }>(sql`select name from sqlite_master where name in
        ('payments', 'payment_resolutions', 'payment_holds', 'payment_hold_outcomes', 'a646_probe', '__drizzle_migrations_payments') order by name`);
      expect(tables.map((row) => row.name)).toEqual(
        installed
          ? [
              "__drizzle_migrations_payments",
              "a646_probe",
              "payment_hold_outcomes",
              "payment_holds",
              "payment_resolutions",
              "payments",
            ]
          : [],
      );
    } finally {
      if (server !== undefined) await server.close();
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });
});
