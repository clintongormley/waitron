import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin } from "@waitron/identity";
import { PERSON_HEADER } from "@waitron/shared";
import { SESSION_COOKIE } from "../till-session.js";
import { DEVICE_COOKIE } from "../device-session.js";
import { setupPartyVenue } from "./party-venue.js";
import { fixturePinHash } from "./known-secret-hashes.js";
import { leaveSessionAlone } from "./tab-person.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** An app whose `/echo` answers the person header it received, and whose sign-in route answers a
 * fresh token for whichever person the body names, as the box's does. */
function echoApp() {
  const app = new Hono();
  app.get("/echo", (c) => c.json({ person: c.req.header(PERSON_HEADER) ?? null }));
  app.post("/api/session", async (c) => {
    const { personId } = await c.req.json<{ personId: string }>();
    const token = randomUUID();
    setCookie(c, SESSION_COOKIE, token, { path: "/" });
    return c.json({ personId, permissions: [], locale: null });
  });
  return app;
}

const cookie = (token: string) => `${DEVICE_COOKIE}=x.y; ${SESSION_COOKIE}=${token}`;
const sessionToken = (setCookie: string) =>
  new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie)![1]!;

let base = "";
let close: () => Promise<void> = async () => {};
beforeAll(async () => {
  const server = serve({ fetch: echoApp().fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});
afterAll(() => close());

async function signIn(): Promise<{ token: string; personId: string }> {
  const v = await setupPartyVenue(suite.db);
  const [row] = await seedPersons(suite.db, {
    displayName: "Anna",
    pinHash: fixturePinHash("4411"),
    role: "staff",
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId: v.cfg.origin.deviceId, personId: row!.id, pin: "4411" }),
  );
  return { token: session.token, personId: row!.id };
}

const personSeenBy = async (res: Response) =>
  ((await res.json()) as { person: string | null }).person;

describe("the test harness naming a session's person", () => {
  it("names the person of a token loginWithPin minted, on app.request", async () => {
    const { token, personId } = await signIn();
    const res = await echoApp().request("/echo", { headers: { cookie: cookie(token) } });
    expect(await personSeenBy(res)).toBe(personId);
  });

  it("names it on a Request handed to app.request", async () => {
    const { token, personId } = await signIn();
    const res = await echoApp().request(
      new Request("http://localhost/echo", { headers: { cookie: cookie(token) } }),
    );
    expect(await personSeenBy(res)).toBe(personId);
  });

  it("hands app.request the Request the test built, so the test's own hooks on it still run", async () => {
    const { token, personId } = await signIn();
    const app = echoApp();
    app.post("/echo", async (c) =>
      c.json({ person: c.req.header(PERSON_HEADER) ?? null, body: await c.req.text() }),
    );
    const raw = new Request("http://localhost/echo", {
      method: "POST",
      headers: { cookie: cookie(token) },
      body: "sent",
    });
    raw.text = async () => "read through the test's hook";
    const res = await app.request(raw);
    expect(await res.json()).toEqual({ person: personId, body: "read through the test's hook" });
  });

  it("names it on the global fetch against a started listener", async () => {
    const { token, personId } = await signIn();
    const res = await fetch(`${base}/echo`, { headers: { cookie: cookie(token) } });
    expect(await personSeenBy(res)).toBe(personId);
  });

  it("learns the person of a token from a sign-in answer, through fetch and app.request", async () => {
    const viaFetch = randomUUID();
    const signedIn = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: viaFetch }),
    });
    const fetched = sessionToken(signedIn.headers.get("set-cookie")!);
    // The answer's body is still the test's to read.
    expect(((await signedIn.json()) as { personId: string }).personId).toBe(viaFetch);
    const res = await fetch(`${base}/echo`, { headers: { cookie: cookie(fetched) } });
    expect(await personSeenBy(res)).toBe(viaFetch);

    const viaRequest = randomUUID();
    const app = echoApp();
    const answered = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: viaRequest }),
    });
    const requested = sessionToken(answered.headers.get("set-cookie")!);
    const again = await app.request("/echo", { headers: { cookie: cookie(requested) } });
    expect(await personSeenBy(again)).toBe(viaRequest);
  });

  it("never replaces a person header the test set", async () => {
    const { token } = await signIn();
    const other = randomUUID();
    const headers = { cookie: cookie(token), [PERSON_HEADER.toUpperCase()]: other };
    expect(await personSeenBy(await echoApp().request("/echo", { headers }))).toBe(other);
    expect(await personSeenBy(await fetch(`${base}/echo`, { headers }))).toBe(other);
    const empty = { cookie: cookie(token), [PERSON_HEADER]: "" };
    expect(await personSeenBy(await echoApp().request("/echo", { headers: empty }))).toBe("");
  });

  it("names no one for a session the test told it to leave alone", async () => {
    const { token } = await signIn();
    leaveSessionAlone(token);
    const headers = { cookie: cookie(token) };
    expect(await personSeenBy(await echoApp().request("/echo", { headers }))).toBeNull();
    expect(await personSeenBy(await fetch(`${base}/echo`, { headers }))).toBeNull();
  });

  it("names no one for a token it does not know", async () => {
    const headers = { cookie: cookie(randomUUID()) };
    expect(await personSeenBy(await echoApp().request("/echo", { headers }))).toBeNull();
    expect(await personSeenBy(await fetch(`${base}/echo`, { headers }))).toBeNull();
    expect(await personSeenBy(await echoApp().request("/echo"))).toBeNull();
  });
});
