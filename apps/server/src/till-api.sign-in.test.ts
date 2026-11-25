import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { staffRoles, personStaffRoles } from "@waitron/db";
import { seedPersons } from "@waitron/identity/test/person-rows.js";

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import {
  createPinThrottle,
  deviceProfileAdmissionRoles,
  PIN_THROTTLE_MAX_KEYS_PER_SLOT,
  hashSessionToken,
  loginWithPin,
  persons,
} from "@waitron/identity";
import { permissionsForRole } from "@waitron/identity/src/permissions.js";
import { PERSON_HEADER } from "@waitron/shared";
import type { LogLevel } from "./logger.js";
import { mountTillApi } from "./till-api.js";
import { run } from "./till-api-errors.js";
import { seedSessionDevice } from "./testing/session-device.js";
import { DEV_DEVICE_HEADER } from "./device-session.js";
import { SESSION_COOKIE, requireSession } from "./till-session.js";
import { leaveSessionAlone } from "./testing/tab-person.js";
import "./errors.js";
import {
  anna,
  abel,
  waterOfferId,
  sessionDeviceCookie,
  sessionDeviceId,
  suite,
  collect,
  deps,
  openSession,
  closeSession,
  enrolTillDeviceCookie,
  enrolTillDevice,
  seedDeviceProfile,
} from "./testing/till-api.test-support.js";

describe("chosen-device sessions", () => {
  it("keeps two chosen devices signed in independently and refuses a borrowed session", async () => {
    const app = new Hono();
    const auth = { ...deps(suite.db), devMode: true, deviceChooserEnabled: true };
    mountTillApi(app, auth, collect([]));
    app.get("/chooser-person", (c) =>
      run(c, collect([]), async () => c.json(await requireSession(auth, c))),
    );
    const a = await seedSessionDevice(suite.db);
    const b = await seedSessionDevice(suite.db);
    const login = async (device: string, person: string, pin: string) => {
      const response = await app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", [DEV_DEVICE_HEADER]: device },
        body: JSON.stringify({ personId: person, pin }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")!;
      expect(cookie).toContain(`${SESSION_COOKIE}_${device}=`);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      return cookie.split(";")[0]!;
    };
    const cookieA = await login(a, anna.id, "5555");
    const cookieB = await login(b, abel.id, "1111");
    const browserCookies = `${cookieA}; ${cookieB}; ${SESSION_COOKIE}=${await openSession(suite.db)}`;
    const headers = (device: string, person: string, cookie = browserCookies) => ({
      cookie,
      [DEV_DEVICE_HEADER]: device,
      [PERSON_HEADER]: person,
    });
    for (const [device, person] of [
      [a, anna.id],
      [b, abel.id],
    ]) {
      const response = await app.request("/chooser-person", { headers: headers(device!, person!) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ personId: person, deviceId: device });
    }
    const tokenA = cookieA.slice(cookieA.indexOf("=") + 1);
    const borrowed = await app.request("/chooser-person", {
      headers: headers(b, anna.id, `${SESSION_COOKIE}_${b}=${tokenA}`),
    });
    expect(borrowed.status).toBe(401);
    expect(await borrowed.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    const signedOut = await app.request("/api/session", {
      method: "DELETE",
      headers: headers(a, anna.id),
    });
    expect(signedOut.status).toBe(200);
    expect((await app.request("/chooser-person", { headers: headers(a, anna.id) })).status).toBe(
      401,
    );
    expect((await app.request("/chooser-person", { headers: headers(b, abel.id) })).status).toBe(
      200,
    );
  });
});

describe("POST /api/session (log in) + DELETE /api/session (log out)", () => {
  it("POST opens a session and sets an httpOnly SameSite=Strict cookie; DELETE ends it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // The login is DEVICE-GATED (§5/§6): the request carries an enrolled device cookie exactly as a
    // sale does, or it is refused `device.unauthorized` (proven by the dedicated test below).
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: anna.id, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    // `locale` is the operator's own UI-language preference — Anna has none, so null.
    const body = (await res.json()) as { permissions: string[] };
    expect(body).toEqual({
      personId: anna.id,
      permissions: permissionsForRole("staff"),
      locale: null,
    });
    expect(body.permissions).not.toContain("venue.configure");

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/waitron_till_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // secureCookies:false → no Secure attribute, so the cookie is usable over the non-TLS request.
    expect(cookie).not.toMatch(/Secure/i);

    const del = await app.request("/api/session", { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    // DELETE actually stamped ended_at on the row the cookie named.
    // 1, not `true`: the engine has no boolean type, and the `flag` column helper's boolean mapping
    // (`packages/db/src/schema/columns.ts`) belongs to a declared COLUMN, not to a predicate written
    // in raw SQL. An unstamped row would come back 0, so the case still fails if DELETE wrote
    // nothing.
    const token = /waitron_till_session=([^;]+)/.exec(cookie)![1]!;
    const rows = await suite.db.execute<{ ended: number }>(
      sql`select ended_at is not null as ended from till_sessions where token_hash = ${hashSessionToken(token)}`,
    );
    expect(rows.rows).toEqual([{ ended: 1 }]);
  });

  it("POST answers the permissions of the operator's ACTUAL role — a manager's hold venue.configure", async () => {
    // A manager holds `venue.configure`; with the staff case above this pins the role, not a constant.
    // Cleaned up so the roster's exact ordering assertions elsewhere stay untouched.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const [mgr] = await seedPersons(suite.db, {
      displayName: "Martha",
      pinHash: fixturePinHash("9999"),
      role: "manager",
    });
    const managerId = mgr!.id;

    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: managerId, pin: "9999" }),
    });
    expect(res.status).toBe(200);
    // Martha carries no locale preference either.
    const body = (await res.json()) as { permissions: string[] };
    expect(body).toEqual({
      personId: managerId,
      permissions: permissionsForRole("manager"),
      locale: null,
    });
    expect(body.permissions).toContain("venue.configure");

    await suite.db.execute(sql`delete from till_sessions where person_id = ${managerId}`);
    await suite.db.execute(sql`delete from persons where id = ${managerId}`);
  });

  it("POST returns the operator's own locale preference when set (persons.locale)", async () => {
    // Cleaned up so the roster tests' exact ordering assertions stay untouched.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const [row] = await seedPersons(suite.db, {
      displayName: "Beatrice",
      pinHash: fixturePinHash("7777"),
      role: "staff",
      locale: "en-GB",
    });
    const personId = row!.id;

    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId, pin: "7777" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      personId,
      permissions: permissionsForRole("staff"),
      locale: "en-GB",
    });

    await suite.db.execute(sql`delete from till_sessions where person_id = ${personId}`);
    await suite.db.execute(sql`delete from persons where id = ${personId}`);
  });

  it("POST rejects a bad pin with 401 and a code", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A single wrong PIN on an enrolled device: below the free-attempt threshold, so it is a plain
    // `pin.invalid` (401), not yet a throttle.
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: anna.id, pin: "0000" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "pin.invalid" } });
  });

  it("POST with no enrolled device is refused device.unauthorized (login is device-gated, §5/§6)", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No `waitron_device` cookie: the throttle keys off the device and the shift records the device's
    // register, so a device-less login is refused up front — the same fail-closed gate the sale routes
    // apply.
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: anna.id, pin: "5555" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
  });

  it("DELETE with no session cookie is an idempotent 200 no-op", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // No cookie: nothing to end, but logout is idempotent — the cookie is cleared and the request
    // answered 200 rather than treated as an error.
    const del = await app.request("/api/session", { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
  });

  it("DELETE with a NON-UUID cookie is an idempotent 200 that clears the cookie", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const del = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=not-a-uuid` },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    const cleared = del.headers.get("set-cookie")!;
    expect(cleared).toMatch(/waitron_till_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it("DELETE with an ALREADY-ended session's cookie, naming nobody, is still an idempotent 200 that clears the cookie", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    // A cookie naming a session that was already closed: `endSession` matches nothing, but a logout
    // naming nobody still answers 200 and clears the cookie.
    const token = await openSession(suite.db);
    leaveSessionAlone(token);
    await closeSession(suite.db, token);

    const del = await app.request("/api/session", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    // The clear is a Set-Cookie that empties the value and expires it (deleteCookie → maxAge 0).
    const cleared = del.headers.get("set-cookie")!;
    expect(cleared).toMatch(/waitron_till_session=;/);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  describe("DELETE naming a person", () => {
    function signOutApp(): Hono {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      app.get("/whoami", (c) =>
        run(c, collect([]), async () =>
          c.json({ personId: (await requireSession({ db: suite.db }, c)).personId }),
        ),
      );
      return app;
    }

    async function signOut(
      app: Hono,
      token: string | null,
      ask: { named?: string; body?: string } = {},
    ): Promise<Response> {
      return app.request("/api/session", {
        method: "DELETE",
        headers: {
          ...(token === null ? {} : { cookie: `${SESSION_COOKIE}=${token}` }),
          "content-type": "application/json",
          ...(ask.named === undefined ? {} : { [PERSON_HEADER]: ask.named }),
        },
        ...(ask.body === undefined ? {} : { body: ask.body }),
      });
    }

    async function isOpen(app: Hono, token: string): Promise<boolean> {
      const res = await app.request("/whoami", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      return res.status === 200;
    }

    it("refuses, ends nothing and keeps the cookie when the session is someone else's", async () => {
      const app = signOutApp();
      const token = await openSession(suite.db);

      const del = await signOut(app, token, { named: abel.id });

      expect(del.status).toBe(409);
      expect(await del.json()).toEqual({
        error: { code: "session.person_not_signed_in", params: { personId: abel.id } },
      });
      expect(del.headers.get("set-cookie")).toBeNull();
      expect(await isOpen(app, token)).toBe(true);
    });

    it.each([
      ["their own id", () => anna.id],
      ["their own id in capitals", () => anna.id.toUpperCase()],
    ])("ends the session of the person named by %s", async (_how, named) => {
      expect(anna.id.toUpperCase()).not.toBe(anna.id);
      const app = signOutApp();
      const token = await openSession(suite.db);

      const del = await signOut(app, token, { named: named() });

      expect(del.status).toBe(200);
      expect(await del.json()).toEqual({ ok: true });
      expect(del.headers.get("set-cookie")).toBeNull();
      expect(await isOpen(app, token)).toBe(false);
    });

    it.each([
      ["a word", "not-a-uuid"],
      ["an empty string", ""],
    ])("refuses a header naming nobody by %s, and ends nothing", async (_what, named) => {
      const app = signOutApp();
      const token = await openSession(suite.db);

      const del = await signOut(app, token, { named });

      expect(del.status).toBe(409);
      expect(await del.json()).toEqual({
        error: { code: "session.person_not_signed_in", params: { personId: null } },
      });
      expect(del.headers.get("set-cookie")).toBeNull();
      expect(await isOpen(app, token)).toBe(true);
    });

    it("ignores a body naming someone else", async () => {
      const app = signOutApp();
      const token = await openSession(suite.db);

      const del = await signOut(app, token, {
        named: anna.id,
        body: JSON.stringify({ personId: abel.id }),
      });

      expect(del.status).toBe(200);
      expect(await isOpen(app, token)).toBe(false);
    });

    it.each([
      ["no body at all", undefined],
      ["an empty body", ""],
      ["an object naming nobody", "{}"],
      ["a body that is not JSON", "{"],
    ])(
      "ends the session behind the cookie for %s, as a sign-out always has",
      async (_what, body) => {
        const app = signOutApp();
        const token = await openSession(suite.db);

        const del = await signOut(app, token, body === undefined ? {} : { body });

        expect(del.status).toBe(200);
        expect(await del.json()).toEqual({ ok: true });
        expect(del.headers.get("set-cookie")).toBeNull();
        expect(await isOpen(app, token)).toBe(false);
      },
    );

    it.each([
      ["someone", () => abel.id],
      ["nobody, by a word", () => "not-a-uuid"],
    ])(
      "leaves a closed session's cookie in place when the header names %s",
      async (_what, named) => {
        const app = signOutApp();
        const token = await openSession(suite.db);
        await closeSession(suite.db, token);

        const del = await signOut(app, token, { named: named() });

        expect(del.status).toBe(200);
        expect(await del.json()).toEqual({ ok: true });
        expect(del.headers.get("set-cookie")).toBeNull();
      },
    );

    it("answers 200 with no session cookie, whoever it names", async () => {
      const del = await signOut(signOutApp(), null, { named: abel.id });

      expect(del.status).toBe(200);
      expect(await del.json()).toEqual({ ok: true });
      expect(del.headers.get("set-cookie")).toBeNull();
    });

    describe("a sign-out naming a person, with the next person's sign-in", () => {
      async function signIn(
        app: Hono,
        deviceCookie: string,
        person: { id: string },
        pin: string,
        held = "",
      ): Promise<Response> {
        const res = await app.request("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${held}${deviceCookie}` },
          body: JSON.stringify({ personId: person.id, pin }),
        });
        expect(res.status).toBe(200);
        return res;
      }

      function tokenOf(answer: Response): string {
        return /waitron_till_session=([^;]+)/.exec(answer.headers.get("set-cookie")!)![1]!;
      }

      /** What a browser keeps of the session cookie after these answers, taken in this order. */
      function sessionCookieAfter(...answers: Response[]): string | null {
        let kept: string | null = null;
        for (const answer of answers) {
          const header = answer.headers.get("set-cookie");
          if (header === null) continue;
          const pair = /^waitron_till_session=([^;]*)/.exec(header);
          if (pair === null) continue;
          kept = /Max-Age=0/i.test(header) ? null : `${SESSION_COOKIE}=${pair[1]!}`;
        }
        return kept;
      }

      async function read(app: Hono, cookie: string | null): Promise<Response> {
        return app.request("/whoami", cookie === null ? {} : { headers: { cookie } });
      }

      it("leaves that person signed in", async () => {
        const app = signOutApp();
        const device = await enrolTillDeviceCookie(suite.db);
        const annaIn = await signIn(app, device, anna, "5555");
        const annaOut = await signOut(app, tokenOf(annaIn), { named: anna.id });
        const benIn = await signIn(app, device, abel, "1111");

        const held = await read(app, sessionCookieAfter(annaIn, benIn, annaOut));

        expect(held.status).toBe(200);
        expect(await held.json()).toEqual({ personId: abel.id });
      });

      it("still ends her session when nobody follows, so her token answers as no cookie does", async () => {
        const app = signOutApp();
        const device = await enrolTillDeviceCookie(suite.db);
        const annaIn = await signIn(app, device, anna, "5555");
        const token = tokenOf(annaIn);
        expect((await read(app, `${SESSION_COOKIE}=${token}`)).status).toBe(200);

        const annaOut = await signOut(app, token, { named: anna.id });
        expect(annaOut.status).toBe(200);
        expect(annaOut.headers.get("set-cookie")).toBeNull();

        const withDeadToken = await read(app, sessionCookieAfter(annaIn, annaOut));
        const withNoCookie = await read(app, null);
        expect(withDeadToken.status).toBe(401);
        expect(withNoCookie.status).toBe(401);
        const refusal = await withDeadToken.json();
        expect(refusal).toMatchObject({ error: { code: "session.required" } });
        expect(refusal).toEqual(await withNoCookie.json());
      });

      it("lets the next sign-in replace the dead cookie it was sent with", async () => {
        const app = signOutApp();
        const device = await enrolTillDeviceCookie(suite.db);
        const annaIn = await signIn(app, device, anna, "5555");
        const deadToken = tokenOf(annaIn);
        const annaOut = await signOut(app, deadToken, { named: anna.id });
        const dead = sessionCookieAfter(annaIn, annaOut);
        expect(dead).toBe(`${SESSION_COOKIE}=${deadToken}`);

        const benIn = await signIn(app, device, abel, "1111", `${dead!}; `);

        expect(tokenOf(benIn)).not.toBe(deadToken);
        const after = await read(app, sessionCookieAfter(annaIn, annaOut, benIn));
        expect(after.status).toBe(200);
        expect(await after.json()).toEqual({ personId: abel.id });
      });
    });
  });
});

describe("POST /api/session — wrong-PIN throttle (§5) + device register (§6)", () => {
  async function sessionCount(personId: string): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from till_sessions where person_id = ${personId}`,
    );
    return rows[0]!.n;
  }

  /** Parse the `deviceId` selector out of a `waitron_device=<id>.<token>` cookie header value. */
  function deviceIdOf(cookie: string): string {
    return /waitron_device=([^.]+)\./.exec(cookie)![1]!;
  }

  it("records the signing-in device on the session", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: anna.id, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    const token = /waitron_till_session=([^;]+)/.exec(res.headers.get("set-cookie")!)![1]!;
    const sess = await suite.db.execute<{ device_id: string }>(
      sql`select device_id from till_sessions where token_hash = ${hashSessionToken(token)}`,
    );
    expect(sess.rows).toEqual([{ device_id: deviceIdOf(deviceCookie) }]);

    await suite.db.execute(
      sql`delete from till_sessions where token_hash = ${hashSessionToken(token)}`,
    );
  });

  it("throttles a (device, person) after the free failures: a further attempt is 429 pin.throttled and loginWithPin never runs", async () => {
    // A fixed injected clock (CLAUDE.md §4): the window opens at `now` and blocks a later `check` at the
    // same `now`, deterministically, with no real sleep.
    const now = 1_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId: anna.id, pin }),
      });

    // Four wrong PINs: three are free, the 4th failure opens the first (2s) wait window. Each still
    // answers a plain 401 `pin.invalid` (the throttle `check` runs BEFORE the failure it records).
    for (let i = 0; i < 4; i++) {
      const bad = await post("0000");
      expect(bad.status).toBe(401);
      expect(await bad.json()).toMatchObject({ error: { code: "pin.invalid" } });
    }

    // The next attempt is now inside the window. Using Anna's CORRECT PIN proves `loginWithPin` was NOT
    // reached: were it, a session would open (200). Instead it is 429 `pin.throttled` carrying
    // `retryAfterSeconds`, with NO session cookie and NO new session row.
    const before = await sessionCount(anna.id);
    const throttled = await post("5555");
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toMatchObject({
      error: { code: "pin.throttled", params: { retryAfterSeconds: 2 } },
    });
    expect(throttled.headers.get("set-cookie")).toBeNull();
    expect(await sessionCount(anna.id)).toBe(before);
  });

  it("keys the throttle on the CANONICAL personId, so an alternate UUID spelling shares the bucket (§5)", async () => {
    // `canonicaliseUuid` (`till-session.ts`) folds an uppercase / dash-free spelling of Anna's id to
    // the same canonical value, so both spellings name the SAME person. The throttle must therefore key
    // on the canonical value, or a brute-forcer cycles spellings to get a fresh back-off bucket per
    // spelling and evades the window.
    const now = 5_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (personId: string, pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId, pin }),
      });

    // Four wrong PINs on the LOWERCASE (canonical) id open the wait window on this (device, person).
    for (let i = 0; i < 4; i++) expect((await post(anna.id, "0000")).status).toBe(401);

    // A DIFFERENT spelling of the SAME id — uppercase — with Anna's CORRECT PIN must ALSO be throttled
    // (429), NOT reach `loginWithPin` (a 200 would prove it did) nor land in a fresh bucket (a 401
    // `pin.invalid`). Keyed on the raw string, uppercase is a distinct bucket and this is a 200 — the
    // bypass the canonicalisation closes.
    const upper = await post(anna.id.toUpperCase(), "5555");
    expect(upper.status).toBe(429);
    expect(await upper.json()).toMatchObject({ error: { code: "pin.throttled" } });

    // And a dash-free spelling, which `canonicaliseUuid` folds the same way, shares the bucket.
    const dashless = await post(anna.id.replace(/-/g, ""), "5555");
    expect(dashless.status).toBe(429);
    expect(await dashless.json()).toMatchObject({ error: { code: "pin.throttled" } });
  });

  it("a successful login clears the throttle, so the streak restarts (§5)", async () => {
    const now = 2_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId: anna.id, pin }),
      });

    // Three wrong PINs (still free), then a correct PIN succeeds and CLEARS the streak.
    for (let i = 0; i < 3; i++) expect((await post("0000")).status).toBe(401);
    expect((await post("5555")).status).toBe(200);

    // After the clear, two more wrong PINs are BOTH plain 401 `pin.invalid`. Had the streak NOT reset,
    // the three pre-success failures plus the first post-success failure would open the window and this
    // SECOND post-success attempt would be 429 — so both being 401 is the decisive proof `clear` ran.
    expect((await post("0000")).status).toBe(401);
    const p2 = await post("0000");
    expect(p2.status).toBe(401);
    expect(await p2.json()).toMatchObject({ error: { code: "pin.invalid" } });

    await suite.db.execute(sql`delete from till_sessions where person_id = ${anna.id}`);
  });

  it("throttles per (device, person): a second person on the same device is unaffected (§5)", async () => {
    const now = 3_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const headers = { "content-type": "application/json", cookie: deviceCookie };
    const post = (personId: string, pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ personId, pin }),
      });

    // Fully throttle (device, Anna).
    for (let i = 0; i < 4; i++) expect((await post(anna.id, "0000")).status).toBe(401);
    expect((await post(anna.id, "5555")).status).toBe(429); // Anna is locked out on this device

    // Abel — a DIFFERENT person on the SAME device — is independent: his correct PIN logs in (200).
    const abelOk = await post(abel.id, "1111");
    expect(abelOk.status).toBe(200);
    expect(await abelOk.json()).toMatchObject({ personId: abel.id });

    await suite.db.execute(sql`delete from till_sessions where person_id = ${abel.id}`);
  });

  it("one device filling its share of the throttle with made-up ids does not refuse another till's correct PIN", async () => {
    const now = 4_000_000;
    const pinThrottle = createPinThrottle({ now: () => now });
    const app = new Hono();
    mountTillApi(app, { ...deps(suite.db), pinThrottle }, collect([]));
    const flooder = await enrolTillDeviceCookie(suite.db);
    const other = await enrolTillDeviceCookie(suite.db);
    const post = (cookie: string, personId: string, pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ personId, pin }),
      });

    // Filled through the route's own throttle rather than thousands of requests; "counts an unknown
    // person's wrong attempts" below shows the route records exactly this failure for a made-up id.
    for (let i = 0; i < PIN_THROTTLE_MAX_KEYS_PER_SLOT; i++) {
      pinThrottle.recordFailure(deviceIdOf(flooder), randomUUID());
    }
    const refused = await post(flooder, randomUUID(), "0000");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: { code: "pin.throttled", params: { retryAfterSeconds: 60 } },
    });

    const ok = await post(other, anna.id, "5555");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ personId: anna.id });

    await suite.db.execute(sql`delete from till_sessions where person_id = ${anna.id}`);
  });
});

describe("PUT /api/session/locale (set your OWN UI locale)", () => {
  // Log in a FRESH staff person rather than the shared `anna`, so the row this route MUTATES is
  // disposable and no sibling test's locale assertion (e.g. the login block's `locale: null` for Anna)
  // is disturbed. Cleaned up (session + person) in a finally so the suite stays order-independent (§4).
  async function loginFresh(pin: string): Promise<{ personId: string; token: string }> {
    const [row] = await seedPersons(suite.db, {
      displayName: "Locale User",
      pinHash: fixturePinHash(pin),
      role: "staff",
    });
    const personId = row!.id;
    const session = await withTransaction(suite.db, async (tx) => {
      return loginWithPin(tx, { deviceId: sessionDeviceId, personId, pin });
    });
    return { personId, token: session.token };
  }
  async function cleanup(personId: string): Promise<void> {
    await suite.db.execute(sql`delete from till_sessions where person_id = ${personId}`);
    await suite.db.execute(sql`delete from persons where id = ${personId}`);
  }

  it("204s and writes the session person's persons.locale for a supported value", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6001");
    try {
      const res = await app.request("/api/session/locale", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
        },
        body: JSON.stringify({ locale: "en-GB" }),
      });
      expect(res.status).toBe(204);
      // The operator's OWN row now carries the chosen locale (the write ran under the session's identity).
      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBe("en-GB");
    } finally {
      await cleanup(personId);
    }
  });

  it("400s (locale.unsupported) an unsupported value, leaving the row unchanged", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6002");
    try {
      const res = await app.request("/api/session/locale", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
        },
        body: JSON.stringify({ locale: "ca-ES" }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "locale.unsupported" } });
      // `setPersonLocale` validates BEFORE it writes, so an unsupported value never reaches the row.
      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBeNull();
    } finally {
      await cleanup(personId);
    }
  });

  it("400s (locale.unsupported) a missing/null body — coerced to '' → the ONE rejection path", async () => {
    // A `null` JSON body → `?? {}` → an absent `locale` → the `typeof … ? … : ""` coercion → "", which
    // `assertSupportedLocale` rejects as `locale.unsupported` exactly like any other unsupported value.
    // There is no separate request-invalid branch — a missing/non-string locale is the same 400.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6003");
    try {
      const res = await app.request("/api/session/locale", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
        },
        body: JSON.stringify(null),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "locale.unsupported" } });
      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBeNull();
    } finally {
      await cleanup(personId);
    }
  });

  it("400s (locale.unsupported) an EMPTY or MALFORMED body, never a 500", async () => {
    // hono's `c.req.json()` THROWS a `SyntaxError` on an empty or malformed body, which would reach
    // `run` as an opaque 500. The guarded parse coerces it to `{}`, so the body takes the same
    // `locale.unsupported` path.
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { personId, token } = await loginFresh("6004");
    try {
      // An EMPTY body under a JSON content-type.
      const empty = await app.request("/api/session/locale", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
        },
        body: "",
      });
      expect(empty.status).toBe(400);
      expect(await empty.json()).toMatchObject({ error: { code: "locale.unsupported" } });

      // A MALFORMED body — not valid JSON at all.
      const malformed = await app.request("/api/session/locale", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${token}; ${sessionDeviceCookie}`,
        },
        body: "not json",
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: "locale.unsupported" } });

      const rows = await suite.db.execute<{ locale: string | null }>(
        sql`select locale from persons where id = ${personId}`,
      );
      expect(rows.rows[0]!.locale).toBeNull();
    } finally {
      await cleanup(personId);
    }
  });

  it("401s (session.required) when no session cookie is sent", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/session/locale", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en-GB" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});

describe("the device checks read the session's device, not the device cookie", () => {
  /** A shift on a fresh till device whose profile allows only `capabilities`. */
  async function sessionOnDeviceWith(capabilities: string[]): Promise<string> {
    const profileId = await seedDeviceProfile(
      suite.db,
      `Session profile ${randomUUID()}`,
      capabilities,
    );
    const { deviceId } = await enrolTillDevice(suite.db, profileId);
    return `${SESSION_COOKIE}=${await openSession(suite.db, deviceId)}`;
  }

  /** The cookie of a fresh till device whose profile allows `capabilities`. */
  async function deviceCookieWith(capabilities: string[]): Promise<string> {
    const profileId = await seedDeviceProfile(
      suite.db,
      `Cookie profile ${randomUUID()}`,
      capabilities,
    );
    return (await enrolTillDevice(suite.db, profileId)).cookie;
  }

  it.each([false, true])(
    "refuses a cash payment with a missing or mismatched device proof (other device: %s)",
    async (withOtherDevice) => {
      const app = new Hono();
      mountTillApi(app, deps(suite.db), collect([]));
      const session = await sessionOnDeviceWith(["open-cash-drawer"]);
      const cookie = withOtherDevice
        ? `${session}; ${await deviceCookieWith(["take-cash"])}`
        : session;
      const id = randomUUID();
      const res = await app.request(`/api/working-orders/${id}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          dining: "eat_in",
          submissionId: id,
          kind: "share",
          shareOf: 1,
          method: "cash",
          tendered: "10.00",
          basket: { lines: [{ menuItemId: waterOfferId, quantity: "1" }] },
        }),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "device.unauthorized" } });
    },
  );

  it("refuses a drawer open from a session on a device that may not open it, though the cookie names one that may", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const cookie = `${await sessionOnDeviceWith(["take-cash"])}; ${await deviceCookieWith(["open-cash-drawer"])}`;
    const res = await app.request("/api/drawer/open", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "device.forbidden_action", params: { action: "drawer_open" } },
    });
  });

  it("refuses a drawer open sent with no device cookie from a session on a device that may not open it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const res = await app.request("/api/drawer/open", {
      method: "POST",
      headers: { cookie: await sessionOnDeviceWith(["take-cash"]) },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "device.forbidden_action", params: { action: "drawer_open" } },
    });
  });
});

describe("POST /api/session refusals say nothing about the account", () => {
  it("answers an unknown person, a suspended one, a wrong PIN and an id that is no UUID identically", async () => {
    const app = new Hono();
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    mountTillApi(app, deps(suite.db), collect(lines));
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const [zoe] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(sql`display_name = 'Zoe'`);
    const causes: Record<string, { personId: unknown; pin: string }> = {
      unknown: { personId: randomUUID(), pin: "5555" },
      // Zoe's own PIN, so only her suspension can be the cause.
      suspended: { personId: zoe!.id, pin: "2222" },
      wrongPin: { personId: anna.id, pin: "0000" },
      notAUuid: { personId: "ana", pin: "5555" },
      notAString: { personId: 42, pin: "5555" },
    };
    const answers: Record<string, unknown> = {};
    for (const [cause, body] of Object.entries(causes)) {
      const res = await app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: deviceCookie },
        body: JSON.stringify(body),
      });
      answers[cause] = { status: res.status, body: await res.json() };
    }
    const refused = { status: 401, body: { error: { code: "pin.invalid", params: {} } } };
    expect(answers).toEqual({
      unknown: refused,
      suspended: refused,
      wrongPin: refused,
      notAUuid: refused,
      notAString: refused,
    });
    expect(
      lines.filter((line) => line.event === "pin.invalid").map((line) => line.fields.logReason),
    ).toEqual(["unknown_person", "suspended", "wrong_pin", "malformed", "malformed"]);
  });

  it("counts an unknown person's wrong attempts toward the back-off exactly as a known person's", async () => {
    const now = 7_000_000;
    const app = new Hono();
    mountTillApi(
      app,
      { ...deps(suite.db), pinThrottle: createPinThrottle({ now: () => now }) },
      collect([]),
    );
    const deviceCookie = await enrolTillDeviceCookie(suite.db);
    const nobody = randomUUID();
    const post = () =>
      app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: deviceCookie },
        body: JSON.stringify({ personId: nobody, pin: "0000" }),
      });
    // The same sequence the known-person throttle case sees: four plain refusals, then the wait.
    for (let i = 0; i < 4; i++) {
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "pin.invalid", params: {} } });
    }
    const throttled = await post();
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({
      error: { code: "pin.throttled", params: { retryAfterSeconds: 2 } },
    });
  });
});

describe("a device's profile decides who may sign in on it", () => {
  async function managersAndAnnaDevice(): Promise<{
    deviceId: string;
    cookie: string;
    profileId: string;
  }> {
    const profileId = await seedDeviceProfile(suite.db, `Managers ${randomUUID()}`, []);
    const [job] = await suite.db.insert(staffRoles).values({ name: randomUUID() }).returning();
    await suite.db
      .delete(deviceProfileAdmissionRoles)
      .where(eq(deviceProfileAdmissionRoles.deviceProfileId, profileId));
    await suite.db
      .insert(deviceProfileAdmissionRoles)
      .values({ deviceProfileId: profileId, staffRoleId: job!.id });
    await suite.db.insert(personStaffRoles).values({ personId: anna.id, staffRoleId: job!.id });
    const { deviceId, cookie } = await enrolTillDevice(suite.db, profileId);
    return { deviceId, cookie, profileId };
  }

  async function sessionsOf(personId: string, deviceId: string): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from till_sessions
          where person_id = ${personId} and device_id = ${deviceId}`,
    );
    return rows[0]!.n;
  }

  it("GET /api/staff lists only the people the device's profile admits", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { cookie } = await managersAndAnnaDevice();
    const open = await enrolTillDeviceCookie(suite.db);

    const restricted = await app.request("/api/staff", { headers: { cookie } });
    const unrestricted = await app.request("/api/staff", { headers: { cookie: open } });

    expect(restricted.status).toBe(200);
    expect(await restricted.json()).toEqual([{ personId: anna.id, displayName: "Anna" }]);
    expect(await unrestricted.json()).toEqual([
      { personId: abel.id, displayName: "Abel" },
      { personId: anna.id, displayName: "Anna" },
    ]);
  });

  it("GET /api/staff?everyone=true lists every active person whatever device asks, for a roster rather than a sign-in list", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));
    const { cookie } = await managersAndAnnaDevice();

    const res = await app.request("/api/staff?everyone=true", { headers: { cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { personId: abel.id, displayName: "Abel" },
      { personId: anna.id, displayName: "Anna" },
    ]);
  });

  it("GET /api/staff reads the device from the dev header in dev mode", async () => {
    const app = new Hono();
    mountTillApi(app, { ...deps(suite.db), devMode: true }, collect([]));
    const { deviceId } = await managersAndAnnaDevice();

    const res = await app.request("/api/staff", { headers: { [DEV_DEVICE_HEADER]: deviceId } });

    expect(await res.json()).toEqual([{ personId: anna.id, displayName: "Anna" }]);
  });

  it("POST /api/session refuses a person the profile does not admit exactly as a wrong PIN, and signs in one it does", async () => {
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect(lines));
    const { deviceId, cookie } = await managersAndAnnaDevice();
    const post = (personId: string, pin: string) =>
      app.request("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ personId, pin }),
      });

    // Abel's own PIN, so only the profile can be the cause.
    const notAdmitted = await post(abel.id, "1111");
    const wrongPin = await post(abel.id, "0000");

    const refused = { status: 401, body: { error: { code: "pin.invalid", params: {} } } };
    expect({ status: notAdmitted.status, body: await notAdmitted.json() }).toEqual(refused);
    expect({ status: wrongPin.status, body: await wrongPin.json() }).toEqual(refused);
    expect(
      lines.filter((line) => line.event === "pin.invalid").map((line) => line.fields.logReason),
    ).toEqual(["not_admitted", "wrong_pin"]);
    expect(await sessionsOf(abel.id, deviceId)).toBe(0);

    const admitted = await post(anna.id, "5555");
    expect(admitted.status).toBe(200);
    expect(await sessionsOf(anna.id, deviceId)).toBe(1);
  });
});
