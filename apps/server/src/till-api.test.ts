import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import type { Database } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin } from "@waitron/identity";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { TenantId } from "@waitron/shared";
import type { Logger, LogLevel } from "./logger.js";
import { mountTillApi, run } from "./till-api.js";
import type { TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE, requireSession } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// PGlite, not real Postgres: the session routes are LOGIC (login → cookie → logout), and the login
// path runs through `withTenant` + `asAppUser` exactly as production does, so RLS scopes the person
// lookup to the till's tenant on the app role. Sessions/persons live in identity, so the schema is
// CORE_MIGRATIONS + IDENTITY_MIGRATIONS. Real-PG privilege proofs for these tables are elsewhere
// (identity's sessions.rls.test.ts / persons.rls.test.ts); they are not re-proven here.
let cfg: TillConfig;
let ana: { id: string };

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    const tenantId = await seedTenant(db);
    // A location → till the session cookie references: `loginWithPin` inserts a `sessions` row with a
    // FK to `tills`, so the till `cfg.tillId` names must exist. Seeded as the PGlite superuser (RLS
    // bypassed) — pure setup, as `@waitron/db`'s own seed helpers document.
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Counter', array['es'], 'Retail') returning id`);
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name)
      values (${tenantId}, ${loc.rows[0]!.id}, 'Till 1') returning id`);
    // Ana's PIN is "5555"; anything else must not verify. Stored hashed via `hashPin`, never plain.
    const person = await db.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (${tenantId}, 'Ana', ${hashPin("5555")}, 'staff') returning id`);
    ana = { id: person.rows[0]!.id };
    cfg = makeCfg(tenantId, till.rows[0]!.id, loc.rows[0]!.id);
  },
});

/** A collecting logger for asserting the structured lines the routes emit. */
function collect(
  lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[],
): Logger {
  return (level, event, fields) => lines.push({ level, event, fields: fields ?? {} });
}

/** The till's config for the seeded tenant. `nodeId`/`seriesId` are unused by the session routes, so
 * they carry fresh uuids; `locationId` is the seeded one the sale routes (Tasks 5/6) will read. */
function makeCfg(tenantId: TenantId, tillId: string, locationId: string): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(tillId),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: "es-ES",
    invoiceLocales: ["es"],
  };
}

function deps(db: Database): TillApiDeps {
  return {
    db,
    // `backend`/`clock` are unused by the session routes — Tasks 5/6's `POST /api/sales` wires real
    // ones. Stubbed (never called) so this suite pulls in no fiscal backend.
    backend: {} as FiscalBackend,
    clock: {} as TrustedClock,
    cfg,
    // FALSE so the Set-Cookie is issued over the non-TLS `app.request` — it must still carry HttpOnly
    // and SameSite=Strict, and must NOT carry Secure.
    secureCookies: false,
  };
}

describe("POST /api/session (log in) + DELETE /api/session (log out)", () => {
  it("POST opens a session and sets an httpOnly SameSite=Strict cookie; DELETE ends it", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: ana.id, pin: "5555" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ personId: ana.id });

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/waitron_till_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    // secureCookies:false → no Secure attribute, so the cookie is usable over the non-TLS request.
    expect(cookie).not.toMatch(/Secure/i);

    const del = await app.request("/api/session", { method: "DELETE", headers: { cookie } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    // DELETE actually stamped ended_at on the row the cookie named (read as superuser, RLS bypassed).
    const sessionId = /waitron_till_session=([^;]+)/.exec(cookie)![1];
    const rows = await suite.db.execute<{ ended: boolean }>(
      sql`select ended_at is not null as ended from sessions where id = ${sessionId}`,
    );
    expect(rows.rows).toEqual([{ ended: true }]);
  });

  it("POST rejects a bad pin with 401 and a code", async () => {
    const app = new Hono();
    mountTillApi(app, deps(suite.db), collect([]));

    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: ana.id, pin: "0000" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "pin.invalid" } });
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
});

describe("the run wrapper (the shared error boundary Tasks 5 & 6 reuse)", () => {
  it("maps a registered but UNMAPPED AppError code to 400 (its default)", async () => {
    const app = new Hono();
    // `tenant.not_found` is a real code deliberately absent from STATUS, so it takes the `?? 400`
    // default the wrapper falls back to for any code a later task forgets to map.
    app.get("/boom", (c) =>
      run(c, collect([]), () =>
        Promise.reject(new AppError("tenant.not_found", { id: randomUUID() })),
      ),
    );
    const res = await app.request("/boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "tenant.not_found" } });
  });

  it("maps a non-AppError to an opaque 500 server.internal and logs it at error", async () => {
    const lines: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
    const app = new Hono();
    app.get("/crash", (c) => run(c, collect(lines), () => Promise.reject(new Error("boom"))));

    const res = await app.request("/crash");
    expect(res.status).toBe(500);
    // No message leaks — only the opaque code, and the structured line is logged at error level with
    // `codeOf`'s classification (an unclassified value → "unknown").
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    const failed = lines.find((l) => l.event === "till.failed");
    expect(failed?.level).toBe("error");
    expect(failed?.fields).toMatchObject({ errorCode: "unknown" });
  });
});

describe("requireSession (the gate Tasks 5 & 6's operator-scoped routes sit behind)", () => {
  it("returns the session id when the cookie is present", async () => {
    const app = new Hono();
    app.get("/whoami", (c) =>
      run(c, collect([]), () => Promise.resolve(c.json({ id: requireSession(c) }))),
    );

    const res = await app.request("/whoami", {
      headers: { cookie: `${SESSION_COOKIE}=sess-123` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "sess-123" });
  });

  it("throws session.required (→ 401 through run) when no cookie is present", async () => {
    const app = new Hono();
    app.get("/whoami", (c) =>
      run(c, collect([]), () => Promise.resolve(c.json({ id: requireSession(c) }))),
    );

    const res = await app.request("/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session.required" } });
  });
});
