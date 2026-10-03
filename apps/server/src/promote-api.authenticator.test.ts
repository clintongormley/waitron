import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { generateSync } from "otplib";
import { mountPromoteApi, type PromoteRunResult } from "./promote-api.js";
import { enrolAuthenticator, wrongTotpCode, TOTP_KEY_RING } from "./testing/authenticator.js";
import { writerBesideRequest } from "./testing/watched-scrypt.js";

// The admin-login path of `POST /management-api/promote` on a real database — for an admin who has
// an authenticator, and beside another writer: the sign-in, not the promote itself, so `run` is a
// stub.

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const ADMIN_PASSWORD = "promotePass123";
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function seedAdmin(status: "active" | "suspended" = "active"): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(ADMIN_PASSWORD),
        role: "admin",
        status,
      })
      .returning({ id: persons.id });
    return person!.id;
  });
}

function appWith(run: () => Promise<PromoteRunResult>): Hono {
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: suite.db,
    nodeId: NODE,
    credentialKeyRing: TOTP_KEY_RING,
    run,
  });
  return app;
}

async function post(app: Hono, body: unknown): Promise<Response> {
  return app.request("/management-api/promote", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /management-api/promote — an admin with an authenticator", () => {
  it("signs in with a correct current code and promotes", async () => {
    const personId = await seedAdmin();
    const secret = await enrolAuthenticator(suite.db, personId, ADMIN_PASSWORD, TOTP_KEY_RING);
    const run = vi.fn(async () => ({ alreadyPrimary: false, restarting: true }));

    const res = await post(appWith(run), {
      personId,
      password: ADMIN_PASSWORD,
      totp: generateSync({ secret }),
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it("refuses a wrong code with 401 password.invalid and never promotes", async () => {
    const personId = await seedAdmin();
    const secret = await enrolAuthenticator(suite.db, personId, ADMIN_PASSWORD, TOTP_KEY_RING);
    const run = vi.fn(async () => ({ alreadyPrimary: false, restarting: true }));

    const res = await post(appWith(run), {
      personId,
      password: ADMIN_PASSWORD,
      totp: wrongTotpCode(secret),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
    expect(run).not.toHaveBeenCalled();
  });

  it("answers every login that fails identically, whatever the cause, and never promotes", async () => {
    const personId = await seedAdmin();
    const secret = await enrolAuthenticator(suite.db, personId, ADMIN_PASSWORD, TOTP_KEY_RING);
    const suspendedId = await seedAdmin("suspended");
    const run = vi.fn(async () => ({ alreadyPrimary: false, restarting: true }));
    const app = appWith(run);

    const causes: Record<string, Record<string, unknown>> = {
      unknown: { personId: crypto.randomUUID(), password: ADMIN_PASSWORD },
      // The suspended admin's own password, so only the suspension can be the cause.
      suspended: { personId: suspendedId, password: ADMIN_PASSWORD },
      wrongPassword: { personId, password: "wrong", totp: generateSync({ secret }) },
      wrongCode: { personId, password: ADMIN_PASSWORD, totp: wrongTotpCode(secret) },
      missingCode: { personId, password: ADMIN_PASSWORD },
    };
    const answers: Record<string, unknown> = {};
    for (const [cause, body] of Object.entries(causes)) {
      const res = await post(app, body);
      answers[cause] = { status: res.status, body: await res.json() };
    }
    const refused = { status: 401, body: { error: { code: "password.invalid", params: {} } } };
    expect(answers).toEqual({
      unknown: refused,
      suspended: refused,
      wrongPassword: refused,
      wrongCode: refused,
      missingCode: refused,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("POST /management-api/promote — the admin login beside another writer", () => {
  it("lets another writer commit while it derives the key", async () => {
    const personId = await seedAdmin();
    const run = vi.fn(async () => ({ alreadyPrimary: false, restarting: true }));

    const { result, order } = await writerBesideRequest(suite.db, () =>
      post(appWith(run), { personId, password: ADMIN_PASSWORD }),
    );

    expect(result.status).toBe(200);
    expect(order.slice(0, 2)).toEqual(["writer", "request's transaction"]);
  });
});
