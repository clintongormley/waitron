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

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

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
    expect(person.rows[0]).toMatchObject({
      role: "admin",
      display_name: "mirror viewer",
    });

    // The viewer can never log in, checked against the row read back: no PIN verifies against the
    // stored hash, and there is no password hash.
    const stored = person.rows[0]!;
    expect(stored.pin_hash.length > 0).toBe(true);
    expect(verifyPin("0000", stored.pin_hash)).toBe(false);
    expect(verifyPin("", stored.pin_hash)).toBe(false);
    expect(stored.password_hash).toBeNull();

    const resolved = await withTransaction(db, (tx) => resolveManagementSession(tx, token));
    expect(resolved).toMatchObject({ personId: MIRROR_VIEWER_PERSON_ID, role: "admin" });
  });

  // The row id is a public constant, so a copy of the database, or a node served without
  // `mirrorSession`, must not be able to use it as a cookie.
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

  // Past the one-minute throttle. `toISOString()` is the spelling `nowIso` writes, so the keepalive's
  // text `<` on the column orders correctly.
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
    await backdateLastSeen(db);
    const before = await readLastSeen(db);

    const res = await driveOnce(db, token);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${MANAGEMENT_COOKIE}=${token}`);
    const after = await readLastSeen(db);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("mirrorSession SKIPS the write for a FRESH session (the throttle — no per-request amplification)", async () => {
    const token = await ensureMirrorViewer(db);
    const before = await readLastSeen(db);

    const res = await driveOnce(db, token);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
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
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("mirrorSession OVERWRITES a corrupted/forged non-ambient cookie with the ambient session", async () => {
    const token = await ensureMirrorViewer(db);
    const res = await driveWithCookie(db, token, `${MANAGEMENT_COOKIE}=not-a-valid-uuid`);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${MANAGEMENT_COOKIE}=${token}`);
  });

  it("once promoted, a request WITHOUT the ambient cookie neither injects a cookie nor writes", async () => {
    const token = await ensureMirrorViewer(db);
    // Backdated, so a middleware without the mode check would write.
    await backdateLastSeen(db);
    const before = await readLastSeen(db);

    const res = await driveOnce(db, token, "primary");

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const after = await readLastSeen(db);
    expect(after).toBe(before);
    expect(await isEnded(db)).toBe(false);
  });

  it("once promoted, a request carrying the ambient cookie ENDS the session and CLEARS the cookie", async () => {
    const token = await ensureMirrorViewer(db);
    // A pre-promotion cookie must not keep admin access once writes open.
    const res = await driveWithCookie(db, token, `${MANAGEMENT_COOKIE}=${token}`, "primary");
    expect(res.status).toBe(200);
    expect(await isEnded(db)).toBe(true);
    await expect(
      withTransaction(db, (tx) => resolveManagementSession(tx, token)),
    ).rejects.toMatchObject({ code: "management_session.required" });
    expect(res.headers.get("set-cookie")).toContain(MANAGEMENT_COOKIE);
  });

  it("on a mirror, the keepalive REVIVES a session whose ended_at was stamped (even if last_seen_at is fresh)", async () => {
    const token = await ensureMirrorViewer(db);
    // Ended with a fresh `last_seen_at`: a throttle-only check would skip the write.
    await withTransaction(db, (tx) =>
      tx.execute(
        sql`update management_sessions set ended_at = ${nowIso()} where id = ${MIRROR_VIEWER_SESSION_ID}`,
      ),
    );
    expect(await isEnded(db)).toBe(true);

    const res = await driveOnce(db, token);
    expect(res.status).toBe(200);
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
