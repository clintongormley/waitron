import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { JOIN_TTL_MS, PENDING_CAP, createJoinRequest, readJoinStatus } from "./join-requests.js";
// `useTemplateDb` is NOT on the `@waitron/db` barrel — the exports map is enumerated (CLAUDE.md §3),
// and the sibling suite imports it from the subpath (`device-api.pg.test.ts:5-6`).
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { setupVenue } from "./testing/venue-fixtures.js";

// Real Postgres, not PGlite — these verbs run as `app_user` and the `join_requests` grants (SELECT,
// INSERT, DELETE, no UPDATE) are part of what is being asserted; PGlite connects as a superuser, where
// a missing grant passes and the run would be a false pass.
const suite = useTemplateDb({ template: "manifest" });

describe("createJoinRequest", () => {
  it("mints a two-digit number, an id and a token, and leaves one pending row", async () => {
    const venue = await setupVenue(suite.admin);
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
      });
    });
    expect(made.verificationNumber).toMatch(/^\d{2}$/);
    expect(made.token.length).toBeGreaterThan(20);
    expect(made.joinId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never mints a number another pending request already holds, in EITHER kind", async () => {
    const venue = await setupVenue(suite.admin);
    // Force the generator to want 47 every time; the first request takes it, the second must not.
    const always47 = () => 47;
    const first = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "Kitchen box",
        numbers: always47,
      });
    });
    expect(first.verificationNumber).toBe("47");
    const second = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
        numbers: (() => {
          let n = 0;
          return () => (n++ === 0 ? 47 : 13);
        })(),
      });
    });
    expect(second.verificationNumber).toBe("13");
  });

  it("refuses past the cap, per (tenant, kind)", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      for (let i = 0; i < PENDING_CAP; i++) {
        await createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: `d${i}`,
        });
      }
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: "one too many",
        }),
      ).rejects.toMatchObject({ code: "device.join_full" });
      // The OTHER kind is unaffected — the cap is per (tenant, kind).
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "print_agent",
          label: "agent",
        }),
      ).resolves.toBeDefined();
    });
  });

  it("sweeps lapsed requests, so they do not occupy the cap or a number", async () => {
    const venue = await setupVenue(suite.admin);
    const stale = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "stale" });
    });
    // Back-date it as the SUPERUSER connection — app_user holds no UPDATE on join_requests
    // (deliberately, CLAUDE.md §3), so this fixture step cannot run inside an asAppUser transaction.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.admin.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${stale.joinId}`,
    );
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "fresh" });
      // Scoped to this venue's tenant — the suite shares one database clone across tests, so an
      // unscoped select would also see other tests' rows.
      const { rows } = await tx.execute<{ label: string }>(
        sql`select label from join_requests where tenant_id = ${venue.cfg.tenantId}`,
      );
      expect(rows.map((r) => r.label)).toEqual(["fresh"]);
    });
  });
});

describe("readJoinStatus", () => {
  it("is pending for a live request with the right token", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, made.token);
      expect(status).toBe("pending");
    });
  });

  it("is not_approved for a wrong token on a live request", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, "wrong-token");
      expect(status).toBe("not_approved");
    });
  });

  it("does not leak another tenant's pending request — the id alone is not enough", async () => {
    // A globally-unique join id is not the query's isolation boundary (CLAUDE.md §3, since RLS was
    // dropped): venue B's session must not resolve venue A's join id, right token and all.
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const madeA = await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venueA.cfg, { kind: "device", label: "A's till" });
    });
    await withTenant(suite.admin, venueB.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const status = await readJoinStatus(tx, venueB.cfg, madeA.joinId, madeA.token);
      expect(status).toBe("not_approved");
    });
  });

  it("is not_approved for an id that never existed", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const status = await readJoinStatus(
        tx,
        venue.cfg,
        "00000000-0000-4000-8000-000000000000",
        "irrelevant-token",
      );
      expect(status).toBe("not_approved");
    });
  });

  it("is not_approved once the request has lapsed", async () => {
    const venue = await setupVenue(suite.admin);
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
    });
    // Back-date it as the SUPERUSER connection — app_user holds no UPDATE on join_requests
    // (deliberately, CLAUDE.md §3), so this fixture step cannot run inside an asAppUser transaction.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.admin.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${made.joinId}`,
    );
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, made.token);
      expect(status).toBe("not_approved");
    });
  });
  // The `approved` case needs an accepted device and lands in Task 6, whose test asserts it.
});
