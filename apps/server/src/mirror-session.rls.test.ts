import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database, type DeploymentMode } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { resolveManagementSession, verifyPin } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import {
  ensureMirrorViewer,
  MIRROR_VIEWER_PERSON_ID,
  MIRROR_VIEWER_SESSION_ID,
  mirrorSession,
} from "./mirror-session.js";

// Real Postgres, not PGlite: the seed + keepalive write `persons` / `management_sessions`, both
// tenant-scoped FORCE-RLS tables, as the NON-superuser `app_user`. A PGlite connection is superuser
// and bypasses FORCE RLS (CLAUDE.md §4), so it would be a false pass — it could not show that
// `app_user`'s 0001/0006 grants and the tenant-isolation policy actually admit these writes. The
// mirror server (Task 5) hands `ensureMirrorViewer` / `mirrorSession` an app_user-authenticated pool,
// so exercise them through one: `app_login` is a cluster LOGIN role that is a MEMBER of `app_user`
// (apps/server/src/testing/global-setup.ts), inheriting its grants under FORCE RLS — the same
// production shape the sibling RLS suites (sync-api.rls.test.ts) use.
const suite = useTemplateDb({ template: "manifest" });

// One shared tenant for the whole file. The viewer is a fixed-id SINGLETON (its PK is a constant), so
// it belongs to whichever tenant first seeds it; a fresh tenant per test would make the second test's
// `on conflict (id) do nothing` leave the person on tenant #1 and RLS-hide it from tenant #2. The
// mirror is single-tenant, so one tenant is also the faithful shape. Data only — nothing to close, so
// no teardown (useTemplateDb owns the clone).
let tenantId: string;

beforeAll(async () => {
  tenantId = await seedTenant(suite.admin);
});

/**
 * Runs `fn` with a fresh `app_login` (app_user member) pool, closed in a `finally` so the suite owns
 * no database across tests — the house per-test `connectAs` pattern (guarded-teardowns only inspects
 * `afterAll`/`afterEach`, so a `try/finally` closer here is in the clear).
 */
async function withAppUserDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = await suite.pg.connectAs("app_login", "app_pw");
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

describe("mirror ambient viewer session (real Postgres, as app_user under FORCE RLS)", () => {
  it("ensureMirrorViewer seeds an admin viewer + a live session that resolves", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId);
      const person = await withTenant(db, tenantId, (tx) =>
        tx.execute<{
          role: string;
          display_name: string;
          has_pin: boolean;
          pin_hash: string;
          password_hash: string | null;
        }>(sql`select role, display_name, length(pin_hash) > 0 as has_pin, pin_hash, password_hash
                       from persons where id = ${MIRROR_VIEWER_PERSON_ID}`),
      );
      // admin holds every permission, so every gated dashboard read passes authorizeManager; the pin
      // hash is non-empty (the length>0 CHECK) yet unusable, so login can never resolve it.
      expect(person.rows[0]).toMatchObject({
        role: "admin",
        display_name: "mirror viewer",
        has_pin: true,
      });

      // THE "viewer can never authenticate" PROPERTY, runtime-tested against the row read BACK from the
      // DB — not merely `length > 0`. Reading is not verification (CLAUDE.md §1): a change to the
      // sentinel format, to `verifySecret`'s parsing, or a later write path setting `password_hash` on
      // this row would silently make the viewer loggable-in, and only this assertion would catch it.
      // Both PIN and password login must fail closed: `verifyPin` rejects the stored sentinel for any
      // PIN, and `password_hash IS NULL` means `loginManager` has nothing to verify.
      const stored = person.rows[0]!;
      expect(verifyPin("0000", stored.pin_hash)).toBe(false);
      expect(verifyPin("", stored.pin_hash)).toBe(false);
      expect(stored.password_hash).toBeNull();

      const resolved = await withTenant(db, tenantId, (tx) =>
        resolveManagementSession(tx, MIRROR_VIEWER_SESSION_ID),
      );
      expect(resolved).toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID, role: "admin" });
    });
  });

  it("ensureMirrorViewer is idempotent (a second call does not throw or duplicate)", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId);
      await ensureMirrorViewer(db, tenantId);
      const n = await withTenant(db, tenantId, (tx) =>
        tx.execute<{ c: string }>(
          sql`select count(*)::text as c from persons where id = ${MIRROR_VIEWER_PERSON_ID}`,
        ),
      );
      expect(n.rows[0]?.c).toBe("1");
    });
  });

  const readLastSeen = (db: Database, tenantId: string): Promise<string> =>
    withTenant(db, tenantId, (tx) =>
      tx.execute<{ last_seen_at: string }>(
        sql`select last_seen_at from management_sessions where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    ).then((r) => r.rows[0]!.last_seen_at);

  // Age the ambient session past the 1-minute throttle (and past the 30-minute IDLE_TIMEOUT_MS) so the
  // next request's keepalive must fire. A fixed literal interval — never built from a variable.
  const backdateLastSeen = (db: Database, tenantId: string): Promise<unknown> =>
    withTenant(db, tenantId, (tx) =>
      tx.execute(
        sql`update management_sessions set last_seen_at = now() - interval '2 minutes'
            where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    );

  const driveOnce = async (
    db: Database,
    tenantId: string,
    mode: DeploymentMode = "mirror",
  ): Promise<Response> => {
    const app = new Hono();
    app.use(
      "*",
      mirrorSession(db, tenantId, false, () => mode),
    );
    app.get("/thing", (c) => c.text("ok"));
    return app.request("/thing");
  };

  it("mirrorSession refreshes a STALE session's last_seen_at (the idle-mirror keepalive) and sets the cookie", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId);
      // An idle mirror: last_seen_at is older than the 1-minute throttle (and, in reality, older than the
      // 30-minute IDLE_TIMEOUT_MS that would 401 the next request). The keepalive must refresh it.
      await backdateLastSeen(db, tenantId);
      const before = await readLastSeen(db, tenantId);

      const res = await driveOnce(db, tenantId);

      expect(res.status).toBe(200);
      // No cookie on the request → the middleware injects the ambient session's id.
      expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      // Proven by deletion: dropping the keepalive `update` in mirrorSession leaves last_seen_at at the
      // backdated value, so `after` no longer advances past `before` and this reddens.
      const after = await readLastSeen(db, tenantId);
      expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    });
  });

  it("mirrorSession SKIPS the write for a FRESH session (the throttle — no per-request amplification)", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId); // seeds last_seen_at = now(), well within the 1-minute throttle
      const before = await readLastSeen(db, tenantId);

      const res = await driveOnce(db, tenantId);

      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
      // The throttle guard (`last_seen_at < now() - interval '1 minute'`) matches no row, so last_seen_at
      // is byte-for-byte unchanged — the amplification fix. Proven by deletion: dropping the throttle
      // clause makes this write unconditionally and `after` advances, reddening this assertion.
      const after = await readLastSeen(db, tenantId);
      expect(after).toBe(before);
    });
  });

  const driveWithCookie = async (
    db: Database,
    tenantId: string,
    cookie: string,
  ): Promise<Response> => {
    const app = new Hono();
    app.use(
      "*",
      mirrorSession(db, tenantId, false, () => "mirror"),
    );
    app.get("/thing", (c) => c.text("ok"));
    return app.request("/thing", { headers: { cookie } });
  };

  it("mirrorSession leaves the AMBIENT cookie untouched (no redundant Set-Cookie)", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId);
      const res = await driveWithCookie(
        db,
        tenantId,
        `${MANAGEMENT_COOKIE}=${MIRROR_VIEWER_SESSION_ID}`,
      );
      expect(res.status).toBe(200);
      // The request already carries the ambient session id, so the middleware sets no new cookie.
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  it("mirrorSession OVERWRITES a corrupted/forged non-ambient cookie with the ambient session", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId);
      // A corrupted/non-UUID cookie (and, equally, a forged valid-UUID one) must not survive: left
      // untouched it would fail requireManagementSession's shape check (or resolve to no row) and 401,
      // breaking the unauthenticated dashboard posture. The middleware overwrites anything that is not
      // already the ambient id. Proven by deletion: reverting the guard to `=== null` leaves the bad
      // cookie in place and injects nothing, reddening the Set-Cookie assertion.
      const res = await driveWithCookie(db, tenantId, `${MANAGEMENT_COOKIE}=not-a-valid-uuid`);
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain(
        `${MANAGEMENT_COOKIE}=${MIRROR_VIEWER_SESSION_ID}`,
      );
    });
  });

  it("mirrorSession is a no-op once promoted (getMode() === 'primary'): no cookie, no keepalive write", async () => {
    await withAppUserDb(async (db) => {
      await ensureMirrorViewer(db, tenantId);
      // Simulate the promote flag-flip: the holder now reads 'primary'. The ambient admin viewer must be
      // dropped (real auth applies) — otherwise a promoted node's open write routes would still auto-login
      // an admin. Backdate so an UNGUARDED middleware WOULD write (proving the guard, not the throttle, is
      // what stops it).
      await backdateLastSeen(db, tenantId);
      const before = await readLastSeen(db, tenantId);

      const res = await driveOnce(db, tenantId, "primary");

      expect(res.status).toBe(200);
      // No ambient cookie injected on a promoted node...
      expect(res.headers.get("set-cookie")).toBeNull();
      // ...and no keepalive write, even though last_seen_at is stale. Proven by deletion: dropping the
      // `getMode() !== "mirror"` guard makes this inject the cookie and refresh last_seen_at, reddening both.
      const after = await readLastSeen(db, tenantId);
      expect(after).toBe(before);
    });
  });
});
