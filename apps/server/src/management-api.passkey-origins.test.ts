import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { webauthnCredentials } from "@waitron/identity";
import { openManagementSession, seedPerson } from "@waitron/identity/test/fixtures.js";
import { signedRegistration, signingPasskey } from "@waitron/identity/test/passkey-signer.js";
import type { Logger } from "./logger.js";
import { createStaffApp } from "./cloud-remote.js";
import { mountManagementApi } from "./management-api.js";
import { mountMeApi } from "./me-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";

// The WebAuthn verifier is the real one: the assertion is signed with `node:crypto`.

const RP_ID = "waitron.local";
const VENUE_ORIGIN = "https://waitron.local";
const ABCD = "abcd0000-0000-4000-8000-000000000000";
const ABCD_ORIGIN = "https://box-abcd.waitron.local";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const noopLog: Logger = () => {};

const VERIFICATION_FAILED = { error: { code: "passkey.verification_failed", params: {} } };

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
    },
    noopLog,
  );
  return app;
}

async function chartListing(nodes: { nodeId: string; contactUrl: string }[]): Promise<void> {
  await writeNodeMembership(
    suite.db,
    signedMembershipDoc(1, {
      signerNodeId: nodes[0]!.nodeId,
      nodes: nodes.map((n, i) => ({
        ...n,
        standing: i === 0 ? "serving-primary" : "serving-secondary",
      })),
    }),
  );
}

async function seedPasskey(personId: string, rpId = RP_ID) {
  const passkey = signingPasskey(rpId);
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

async function signInAt(
  origin: string,
  app: Hono = mountApp(),
  base = "",
  passkey?: Awaited<ReturnType<typeof seedPasskey>>,
): Promise<Response> {
  passkey ??= await seedPasskey(await seedPerson(suite.db, "manager"));
  const options = await app.request(`${base}/management-api/passkey/auth/options`, {
    method: "POST",
  });
  expect(options.status).toBe(200);
  const begun = (await options.json()) as {
    challengeHandle: string;
    options: { challenge: string };
  };
  return app.request(`${base}/management-api/passkey/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challengeHandle: begun.challengeHandle,
      response: passkey.assert(begun.options.challenge, origin),
    }),
  });
}

describe("a dashboard passkey sign-in made at a box's own name", () => {
  it("signs in when the held chart lists that box", async () => {
    await chartListing([
      { nodeId: randomUUID(), contactUrl: "https://box-ef01.waitron.local" },
      { nodeId: ABCD, contactUrl: ABCD_ORIGIN },
    ]);

    const res = await signInAt(ABCD_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^waitron_management_session=/);
  });

  it("is refused while the held chart does not list that box, and accepted once it does, on the same mounted API", async () => {
    await chartListing([{ nodeId: randomUUID(), contactUrl: "https://box-ef01.waitron.local" }]);
    const app = mountApp();
    const passkey = await seedPasskey(await seedPerson(suite.db, "manager"));
    const refused = await signInAt(ABCD_ORIGIN, app, "", passkey);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual(VERIFICATION_FAILED);

    await chartListing([{ nodeId: ABCD, contactUrl: ABCD_ORIGIN }]);

    expect((await signInAt(ABCD_ORIGIN, app, "", passkey)).status).toBe(200);
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
    expect(await res.json()).toEqual(VERIFICATION_FAILED);
  });
});

describe("enrolling a passkey made at a box's own name", () => {
  it("enrols it when the held chart lists that box", async () => {
    await chartListing([{ nodeId: ABCD, contactUrl: ABCD_ORIGIN }]);
    const { token } = await openManagementSession(suite.db, "manager");
    await withTransaction(suite.db, (tx) =>
      setFreshManagementSignIn(tx, `waitron_management_session=${token}`),
    );
    const app = mountApp();
    const cookie = `waitron_management_session=${token}`;
    const options = await app.request("/management-api/passkey/register/options", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(options.status).toBe(200);
    const begun = (await options.json()) as {
      challengeHandle: string;
      options: { challenge: string };
    };
    const response = signedRegistration(RP_ID, begun.options.challenge, ABCD_ORIGIN);

    const res = await app.request("/management-api/passkey/register/verify", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ challengeHandle: begun.challengeHandle, response }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ credentialId: response.id });
  });
});

describe("a passkey sign-in through the Cloud remote-staff address", () => {
  const STAFF = "https://staff.example.test";

  it("is checked against the request's own address", async () => {
    const passkey = await seedPasskey(await seedPerson(suite.db, "manager"), "staff.example.test");

    const res = await signInAt(
      STAFF,
      createStaffApp(mountApp(), async () => STAFF),
      STAFF,
      passkey,
    );

    expect(res.status).toBe(200);
  });

  it("is refused at a box the chart lists, which only a local request may use", async () => {
    await chartListing([{ nodeId: ABCD, contactUrl: ABCD_ORIGIN }]);
    const passkey = await seedPasskey(await seedPerson(suite.db, "manager"), "staff.example.test");

    const res = await signInAt(
      ABCD_ORIGIN,
      createStaffApp(mountApp(), async () => STAFF),
      STAFF,
      passkey,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(VERIFICATION_FAILED);
  });
});
