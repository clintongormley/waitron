import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { nowIso, withTransaction, type Database, type DeploymentMode } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { authorizeManager, resolveManagementSession, verifyPin } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { MANAGEMENT_COOKIE, requireManagementSession } from "@waitron/server-kit";
import {
  endMirrorViewer,
  ensureMirrorViewer,
  MIRROR_VIEWER_PERSON_ID,
  MIRROR_VIEWER_SESSION_ID,
  mirrorSession,
} from "./mirror-session.js";

/**
 * The mirror's ambient viewer session, on the engine the box now runs.
 *
 * ## What went with PostgreSQL, and is replaced by nothing
 *
 * **The role is gone and nothing replaces it.** SQLite has no roles and `pg.connectAs` has no
 * counterpart. The per-test `withAppUserDb` helper is deleted with it and every case now runs on
 * the suite's one handle. NO case was deleted: each one asserts what the middleware DOES, not what
 * a role is refused, so each survives the loss of the role with its assertions untouched. What is
 * no longer covered is the privilege claim itself — that the deployment role may make these writes
 * at all.
 *
 * ## One probe changed shape, and no assertion changed with it
 *
 * `length(pin_hash) > 0` and `ended_at is not null` are SQL booleans PostgreSQL handed back as
 * `true`/`false`; this engine has no boolean type and hands back `1`/`0` (measured 2026-09-22 —
 * `select 1 is not null` reads `1`, and `expect(1).toBe(true)` fails). Both probes now select the
 * COLUMN and decide in JavaScript, so `toBe(true)` and `toBe(false)` below still mean what they
 * meant. This is the suite's own instrument, not a product value: `mirror-session.ts` never reads
 * either expression.
 */
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

// One shared tenant for the whole file. The viewer is a fixed-id SINGLETON (its PK is a constant), so
// it belongs to whichever tenant first seeds it; a fresh tenant per test would make the second test's
// `on conflict (id) do nothing` leave the person on tenant #1 while tenant #2 looked for its own. The
// mirror is single-tenant, so one tenant is also the faithful shape. Data only — nothing to close, so
// no teardown (useVenueDb owns the database).
let db: Database;
beforeAll(async () => {
  db = suite.db;
  await seedTenant(db);
});

describe("mirror ambient viewer session", () => {
  it("ensureMirrorViewer seeds an admin viewer + a live session that resolves", async () => {
    const token = await ensureMirrorViewer(db);
    const person = await withTransaction(db, (tx) =>
      tx.execute<{
        role: string;
        display_name: string;
        pin_hash: string;
        password_hash: string | null;
      }>(sql`select role, display_name, pin_hash, password_hash
                     from persons where id = ${MIRROR_VIEWER_PERSON_ID}`),
    );
    // admin holds every permission, so every gated dashboard read passes authorizeManager; the pin
    // hash is non-empty (the length>0 CHECK) yet unusable, so login can never resolve it.
    expect(person.rows[0]).toMatchObject({
      role: "admin",
      display_name: "mirror viewer",
    });

    // THE "viewer can never authenticate" PROPERTY, runtime-tested against the row read BACK from the
    // DB — not merely `length > 0`. Reading is not verification (CLAUDE.md §1): a change to the
    // sentinel format, to `verifySecret`'s parsing, or a later write path setting `password_hash` on
    // this row would silently make the viewer loggable-in, and only this assertion would catch it.
    // Both PIN and password login must fail closed: `verifyPin` rejects the stored sentinel for any
    // PIN, and `password_hash IS NULL` means `loginManager` has nothing to verify.
    const stored = person.rows[0]!;
    expect(stored.pin_hash.length > 0).toBe(true);
    expect(verifyPin("0000", stored.pin_hash)).toBe(false);
    expect(verifyPin("", stored.pin_hash)).toBe(false);
    expect(stored.password_hash).toBeNull();

    const resolved = await withTransaction(db, (tx) => resolveManagementSession(tx, token));
    expect(resolved).toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID, role: "admin" });
  });

  // What a copy of the database, or a node served without `mirrorSession`, can do with the row: the
  // row id is a public constant, so it must not work as a cookie. Proven by deletion: storing
  // `hashSessionToken(MIRROR_VIEWER_SESSION_ID)` again makes the public value resolve and this reddens.
  it("the viewer's public row id is refused as a cookie; only the token ensureMirrorViewer returns resolves", async () => {
    const token = await ensureMirrorViewer(db);
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, MIRROR_VIEWER_SESSION_ID)),
    ).rejects.toMatchObject({ code: "management_session.required" });
    expect(token).not.toBe(MIRROR_VIEWER_SESSION_ID);
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, token)),
    ).resolves.toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID, role: "admin" });
  });

  it("a gated write route WITHOUT the mirror middleware refuses the public row id and accepts the token", async () => {
    const token = await ensureMirrorViewer(db);
    const app = new Hono();
    app.post("/gated", async (c) => {
      try {
        await withTransaction(db, (tx) =>
          authorizeManager(tx, {
            managementSessionId: requireManagementSession(c),
            permission: "mirror.create",
          }),
        );
      } catch (error) {
        if (isAppError(error)) return c.json({ code: error.code }, 401);
        throw error;
      }
      return c.text("ok");
    });
    const post = (cookie: string): Promise<Response> =>
      Promise.resolve(
        app.request("/gated", {
          method: "POST",
          headers: { cookie: `${MANAGEMENT_COOKIE}=${cookie}` },
        }),
      );

    const refused = await post(MIRROR_VIEWER_SESSION_ID);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ code: "management_session.required" });
    expect((await post(token)).status).toBe(200);
  });

  it("each ensureMirrorViewer call rotates the token, so an earlier boot's cookie stops resolving", async () => {
    const first = await ensureMirrorViewer(db);
    const second = await ensureMirrorViewer(db);
    expect(second).not.toBe(first);
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, first)),
    ).rejects.toMatchObject({ code: "management_session.required" });
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, second)),
    ).resolves.toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID });
  });

  it("ensureMirrorViewer is idempotent (a second call does not throw or duplicate)", async () => {
    await ensureMirrorViewer(db);
    await ensureMirrorViewer(db);
    const n = await withTransaction(db, (tx) =>
      tx.execute<{ c: string }>(
        sql`select cast(count(*) as text) as c from persons where id = ${MIRROR_VIEWER_PERSON_ID}`,
      ),
    );
    expect(n.rows[0]?.c).toBe("1");
  });

  const readLastSeen = (db: Database): Promise<string> => {
    return withTransaction(db, (tx) =>
      tx.execute<{ last_seen_at: string }>(
        sql`select last_seen_at from management_sessions where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    ).then((r) => r.rows[0]!.last_seen_at);
  };

  // Age the ambient session past the 1-minute throttle (and past the 30-minute IDLE_TIMEOUT_MS) so the
  // next request's keepalive must fire. A fixed two-minute step — never built from a variable.
  //
  // The subtraction moved onto a `Date` in JavaScript: this engine has neither `now()` nor an
  // interval type. `toISOString()` is the spelling `mirror-session.ts` and every other writer of
  // this `tsString` column uses, which is what makes the keepalive's `<` on it a correct time
  // ordering (`packages/printing/src/runtime.ts` has the measurement).
  const BACKDATE_MS = 2 * 60_000;
  const backdateLastSeen = (db: Database): Promise<unknown> => {
    const staleSeenAt = new Date(Date.now() - BACKDATE_MS).toISOString();
    return withTransaction(db, (tx) =>
      tx.execute(
        sql`update management_sessions set last_seen_at = ${staleSeenAt}
            where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    );
  };

  const driveOnce = async (
    db: Database,
    token: string,
    mode: DeploymentMode = "mirror",
  ): Promise<Response> => {
    const app = new Hono();
    app.use(
      "*",
      mirrorSession(db, false, () => mode, token),
    );
    app.get("/thing", (c) => c.text("ok"));
    return app.request("/thing");
  };

  it("mirrorSession refreshes a STALE session's last_seen_at (the idle-mirror keepalive) and sets the cookie", async () => {
    const token = await ensureMirrorViewer(db);
    // An idle mirror: last_seen_at is older than the 1-minute throttle (and, in reality, older than the
    // 30-minute IDLE_TIMEOUT_MS that would 401 the next request). The keepalive must refresh it.
    await backdateLastSeen(db);
    const before = await readLastSeen(db);

    const res = await driveOnce(db, token);

    expect(res.status).toBe(200);
    // No cookie on the request → the middleware injects the ambient session's token.
    expect(res.headers.get("set-cookie")).toContain(`${MANAGEMENT_COOKIE}=${token}`);
    // Proven by deletion: dropping the keepalive `update` in mirrorSession leaves last_seen_at at the
    // backdated value, so `after` no longer advances past `before` and this reddens.
    const after = await readLastSeen(db);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("mirrorSession SKIPS the write for a FRESH session (the throttle — no per-request amplification)", async () => {
    const token = await ensureMirrorViewer(db); // seeds last_seen_at = now(), within the throttle
    const before = await readLastSeen(db);

    const res = await driveOnce(db, token);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
    // The throttle guard (`last_seen_at < now() - interval '1 minute'`) matches no row, so last_seen_at
    // is byte-for-byte unchanged — the amplification fix. Proven by deletion: dropping the throttle
    // clause makes this write unconditionally and `after` advances, reddening this assertion.
    const after = await readLastSeen(db);
    expect(after).toBe(before);
  });

  const driveWithCookie = async (
    db: Database,
    token: string,
    cookie: string,
    mode: DeploymentMode = "mirror",
  ): Promise<Response> => {
    const app = new Hono();
    app.use(
      "*",
      mirrorSession(db, false, () => mode, token),
    );
    app.get("/thing", (c) => c.text("ok"));
    return app.request("/thing", { headers: { cookie } });
  };

  const isEnded = (db: Database): Promise<boolean> => {
    return withTransaction(db, (tx) =>
      tx.execute<{ ended_at: string | null }>(
        sql`select ended_at from management_sessions where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    ).then((r) => r.rows[0]!.ended_at !== null);
  };

  it("mirrorSession leaves the AMBIENT cookie untouched (no redundant Set-Cookie)", async () => {
    const token = await ensureMirrorViewer(db);
    const res = await driveWithCookie(db, token, `${MANAGEMENT_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    // The request already carries the ambient session's token, so the middleware sets no new cookie.
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("mirrorSession OVERWRITES a corrupted/forged non-ambient cookie with the ambient session", async () => {
    const token = await ensureMirrorViewer(db);
    // A corrupted/non-UUID cookie (and, equally, a forged valid-UUID one) must not survive: left
    // untouched it would fail requireManagementSession's shape check (or resolve to no row) and 401,
    // breaking the unauthenticated dashboard posture. The middleware overwrites anything that is not
    // already the ambient token. Proven by deletion: reverting the guard to `=== null` leaves the bad
    // cookie in place and injects nothing, reddening the Set-Cookie assertion.
    const res = await driveWithCookie(db, token, `${MANAGEMENT_COOKIE}=not-a-valid-uuid`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${MANAGEMENT_COOKIE}=${token}`);
  });

  it("once promoted, a request WITHOUT the ambient cookie neither injects a cookie nor writes", async () => {
    const token = await ensureMirrorViewer(db);
    // Promote (holder reads 'primary'). A fresh browser (no ambient cookie) gets nothing — real auth
    // applies. Backdate so an UNGUARDED mirror middleware WOULD write, proving the mode guard stops it.
    await backdateLastSeen(db);
    const before = await readLastSeen(db);

    const res = await driveOnce(db, token, "primary");

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const after = await readLastSeen(db);
    expect(after).toBe(before); // no keepalive write, even though last_seen_at is stale
    expect(await isEnded(db)).toBe(false); // an untouched session is left alone
  });

  it("once promoted, a request carrying the ambient cookie ENDS the session and CLEARS the cookie", async () => {
    const token = await ensureMirrorViewer(db);
    // The security fix: a client holding a pre-promotion ambient cookie must NOT keep admin access once
    // the write gate opens. Promotion drops it — ends the ambient session (resolveManagementSession then
    // 401s it) and clears the cookie. Proven by deletion: removing the end+clear block leaves the session
    // live (isEnded false) and sets no clearing cookie, so a promoted node still auto-logs-in an admin.
    const res = await driveWithCookie(db, token, `${MANAGEMENT_COOKIE}=${token}`, "primary");
    expect(res.status).toBe(200);
    expect(await isEnded(db)).toBe(true);
    // The ambient session no longer resolves — a promoted node requires real auth.
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, token)),
    ).rejects.toMatchObject({ code: "management_session.required" });
    // A clearing Set-Cookie is emitted (an expiry), so the browser stops presenting the ambient token.
    expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
  });

  it("on a mirror, the keepalive REVIVES a session whose ended_at was stamped (even if last_seen_at is fresh)", async () => {
    const token = await ensureMirrorViewer(db); // fresh last_seen_at
    // Defensively stamp ended_at while last_seen_at stays fresh — the throttle-only WHERE would skip the
    // write and leave the session dead. The `or ended_at is not null` clause must revive it.
    await withTransaction(db, (tx) =>
      tx.execute(
        // `nowIso()` bound in place of `now()`: this engine has no such function, and this is the
        // spelling `mirror-session.ts` itself stamps `ended_at` with.
        sql`update management_sessions set ended_at = ${nowIso()} where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    );
    expect(await isEnded(db)).toBe(true);

    const res = await driveOnce(db, token); // mirror mode
    expect(res.status).toBe(200);
    // Proven by deletion: dropping `or ended_at is not null` leaves ended_at set and this reddens.
    expect(await isEnded(db)).toBe(false);
  });

  it("endMirrorViewer ends the viewer's session, and a later ensureMirrorViewer revives it", async () => {
    const kept = await ensureMirrorViewer(db);
    await endMirrorViewer(db);
    expect(await isEnded(db)).toBe(true);
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, kept)),
    ).rejects.toMatchObject({ code: "management_session.required" });

    const revived = await ensureMirrorViewer(db);
    expect(await isEnded(db)).toBe(false);
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, revived)),
    ).resolves.toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID });
  });

  it("endMirrorViewer leaves an already-ended session's ended_at as it was", async () => {
    await ensureMirrorViewer(db);
    await endMirrorViewer(db);
    const readEndedAt = (): Promise<string | null> =>
      withTransaction(db, (tx) =>
        tx.execute<{ ended_at: string | null }>(
          sql`select ended_at from management_sessions where id = ${MIRROR_VIEWER_SESSION_ID}`,
        ),
      ).then((r) => r.rows[0]!.ended_at);
    const first = await readEndedAt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await endMirrorViewer(db);
    expect(await readEndedAt()).toBe(first);
  });
});
