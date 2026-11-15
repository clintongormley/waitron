import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { webauthnCredentials } from "@waitron/identity";
import { openManagementSession, seedPerson } from "@waitron/identity/test/fixtures.js";
import { signingPasskey } from "@waitron/identity/test/passkey-signer.js";
import type { Logger } from "./logger.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";
import { venuePasskeyOrigins } from "./passkey-origins.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

// The WebAuthn verifier is the real one: the assertion is signed with `node:crypto`.

const RP_ID = "waitron.local";
const VENUE_ORIGIN = "https://waitron.local";
const ABCD = "abcd0000-0000-4000-8000-000000000000";
const ABCD_ORIGIN = "https://box-abcd.waitron.local";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const noopLog: Logger = () => {};

function mountApp(): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: ABCD },
      secureCookies: true,
      rpId: RP_ID,
      origin: VENUE_ORIGIN,
      passkeyOrigins: venuePasskeyOrigins(suite.db, VENUE_ORIGIN),
      credentialKeyRing: TOTP_KEY_RING,
    },
    noopLog,
  );
  mountMeApi(
    app,
    {
      db: suite.db,
      venueLocale: "en",
      modules: [],
      credentialKeyRing: TOTP_KEY_RING,
      rpId: RP_ID,
      origin: VENUE_ORIGIN,
      passkeyOrigins: venuePasskeyOrigins(suite.db, VENUE_ORIGIN),
    },
    noopLog,
  );
  return app;
}

async function chartListing(nodes: { nodeId: string; contactUrl: string }[]): Promise<void> {
  await writeNodeMembership(suite.db, {
    body: {
      term: 1,
      nodes: nodes.map((n, i) => ({
        ...n,
        standing: i === 0 ? "serving-primary" : "serving-secondary",
      })),
    },
    signerNodeId: nodes[0]!.nodeId,
    signature: "sig",
    endorsements: [],
  });
}

async function seedPasskey(personId: string) {
  const passkey = signingPasskey(RP_ID);
  await withTransaction(suite.db, (tx) =>
    tx.insert(webauthnCredentials).values({
      personId,
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: 0,
    }),
  );
  return passkey;
}

async function signInAt(origin: string): Promise<Response> {
  const passkey = await seedPasskey(await seedPerson(suite.db, "manager"));
  const app = mountApp();
  const options = await app.request("/management-api/passkey/auth/options", { method: "POST" });
  expect(options.status).toBe(200);
  const begun = (await options.json()) as {
    challengeHandle: string;
    options: { challenge: string };
  };
  return app.request("/management-api/passkey/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeHandle: begun.challengeHandle,
      response: passkey.assert(begun.options.challenge, origin),
    }),
  });
}

describe("a dashboard passkey sign-in made at a box's own name", () => {
  beforeEach(async () => {
    await chartListing([{ nodeId: randomUUID(), contactUrl: "https://box-ef01.waitron.local" }]);
  });

  it("signs in when the held chart lists that box", async () => {
    await chartListing([
      { nodeId: randomUUID(), contactUrl: "https://box-ef01.waitron.local" },
      { nodeId: ABCD, contactUrl: ABCD_ORIGIN },
    ]);

    const res = await signInAt(ABCD_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^waitron_management_session=/);
  });

  it("is refused when the held chart does not list that box", async () => {
    const res = await signInAt(ABCD_ORIGIN);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "passkey.verification_failed", params: {} },
    });
  });

  it("signs in at the venue's name", async () => {
    expect((await signInAt(VENUE_ORIGIN)).status).toBe(200);
  });
});

describe("a fresh sign-in check made at a box's own name", () => {
  async function checkAt(origin: string): Promise<Response> {
    const { personId, token } = await openManagementSession(suite.db, "manager");
    const passkey = await seedPasskey(personId);
    const app = mountApp();
    const cookie = `waitron_management_session=${token}`;
    const options = await app.request("/management-api/session/me/fresh-sign-in/passkey-options", {
      method: "POST",
      headers: { cookie },
    });
    expect(options.status).toBe(200);
    const begun = (await options.json()) as {
      challengeHandle: string;
      options: { challenge: string };
    };
    return app.request("/management-api/session/me/fresh-sign-in", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        method: "passkey",
        challengeHandle: begun.challengeHandle,
        response: passkey.assert(begun.options.challenge, origin),
      }),
    });
  }

  it("accepts it when the held chart lists that box", async () => {
    await chartListing([{ nodeId: ABCD, contactUrl: ABCD_ORIGIN }]);

    expect((await checkAt(ABCD_ORIGIN)).status).toBe(204);
  });

  it("refuses it when the held chart does not list that box", async () => {
    await chartListing([{ nodeId: randomUUID(), contactUrl: "https://box-ef01.waitron.local" }]);

    const res = await checkAt(ABCD_ORIGIN);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "passkey.verification_failed", params: {} },
    });
  });
});
