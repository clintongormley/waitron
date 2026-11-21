import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { hashSessionToken } from "@waitron/identity";
import { cloudFixture } from "../test/cloud-fixture.js";
import { createCloudConnection } from "./cloud-client.js";
import { mountSetupCloudSignIn } from "./setup-cloud-sign-in.js";

const origin = "https://box.test";
const route = origin + "/setup-api/cloud/sign-in/address-lookup";
const address = "Calle Mayor 1, Madrid";
const fields = {
  addressLine1: "Calle Mayor 1",
  addressLine2: null,
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  countryCode: "ES",
};

async function addressFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const tab = randomUUID();
  const session = randomBytes(32).toString("base64url");
  const workflowId = randomUUID();
  const calls: unknown[][] = [];
  let refusal = 0;
  const cloud = await cloudFixture(async (values, _saved, req, res, sent) => {
    calls.push(values);
    expect(req.url).toBe("/api/installations/" + values[2]);
    expect(req.headers.origin).toBeUndefined();
    expect(Object.keys(sent).sort()).toEqual(["payload", "signature"]);
    expect(values[3]).toBe(cloud.installationId);
    if (values[2] === "renew") {
      const now = Date.now();
      const until = now + 3600000;
      const payload = Buffer.from(
        JSON.stringify([
          "waitron-cloud-access-v1",
          cloud.options.origin,
          "a".repeat(43),
          randomUUID(),
          cloud.installationId,
          cloud.venueId,
          "test",
          key,
          now,
          until,
          "control",
        ]),
      ).toString("base64url");
      res.end(
        JSON.stringify({
          ...registration,
          revision: 1,
          environment: "test",
          revokedAt: null,
          lastContactAt: new Date(now).toISOString(),
          leaseExpiresAt: new Date(until).toISOString(),
          services: ["continuous_backup", "remote_access", "retained_snapshots"].map((service) => ({
            service,
            state: "unconfigured",
            health: "unknown",
            failure: null,
            configuration: {},
            observedAt: null,
          })),
          lease: { payload, signature: "A".repeat(86) },
        }),
      );
      return;
    }
    const body = JSON.parse(String(values[7]));
    if (refusal) {
      res.writeHead(refusal);
      res.end('{"error":"rate_limited"}');
      return;
    }
    res.end(
      JSON.stringify({
        workflowId,
        provider: "google",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...(body.kind === "suggest" ? { candidates: [{ text: address }] } : { fields }),
      }),
    );
  });
  const registration = {
    installationId: cloud.installationId,
    venueId: cloud.venueId,
    organisationId: cloud.organisationId,
    legalBusinessId: cloud.legalBusinessId,
  };
  const file = join(cloud.stateDir, "cloud", "connection.json");
  const attempt = {
    kind: "setup",
    phase: "account_bound",
    tab,
    session: hashSessionToken(session),
    requestId: randomUUID(),
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    provisionalRegistration: registration,
  };
  const save = (patch: Partial<typeof attempt>) =>
    writeFile(
      file,
      JSON.stringify({
        version: 4,
        origin: cloud.options.origin,
        publicKey: key,
        privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
        attempt: { ...attempt, ...patch },
      }),
      { mode: 0o600 },
    );
  await mkdir(join(cloud.stateDir, "cloud"));
  await save({});
  const app = new Hono();
  const socket = new TLSSocket(new Socket());
  const connection = createCloudConnection({
    ...cloud.options,
    signIn: {
      setup: true,
      callback: origin + "/cloud/pairing/callback",
      readProfile: async () => {
        throw new Error("venue is unset");
      },
    },
    readVenueId: async () => {
      throw new Error("venue is unset");
    },
  });
  mountSetupCloudSignIn(
    app,
    { origin, connection },
    async () => {},
    () => {},
  );
  return {
    calls,
    file,
    save,
    workflowId,
    refuse: (status: number) => {
      refusal = status;
    },
    post: (operation: object, headers: Record<string, string> = {}) =>
      app.request(
        route,
        {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            cookie: "__Host-waitron-setup-cloud=" + session,
            ...headers,
          },
          body: JSON.stringify({ tab, ...operation }),
        },
        { incoming: { socket } },
      ),
    close: async () => {
      socket.destroy();
      await cloud.close();
    },
  };
}

it("uses one provisional lease for suggestions and validation without writing a venue or address", async () => {
  const f = await addressFixture();
  try {
    const before = await readFile(f.file, "utf8");
    const status = await f.post({ kind: "available" });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ available: true });
    const suggest = {
      kind: "suggest",
      workflowId: f.workflowId,
      query: "Calle Mayor",
      language: "en",
    };
    const validate = { kind: "validate", workflowId: f.workflowId, selectedText: address };
    expect(await (await f.post(suggest)).json()).toEqual({ candidates: [{ text: address }] });
    expect(await (await f.post(validate)).json()).toEqual({ fields });
    expect(f.calls.map((call) => call[2])).toEqual(["renew", "address-lookup", "address-lookup"]);
    expect(f.calls[1]?.[6]).toBe(f.calls[2]?.[6]);
    expect(f.calls[1]?.[4]).not.toBe(f.calls[2]?.[4]);
    expect(f.calls.slice(1).map((call) => JSON.parse(String(call[7])))).toEqual([
      { version: 1, ...suggest },
      { version: 1, ...validate },
    ]);
    expect(await readFile(f.file, "utf8")).toBe(before);
  } finally {
    await f.close();
  }
});

it("keeps manual entry for a Cloud refusal and never calls Cloud for another setup binding", async () => {
  const f = await addressFixture();
  try {
    const suggest = {
      kind: "suggest",
      workflowId: f.workflowId,
      query: "Calle Mayor",
      language: "es",
    };
    expect((await f.post(suggest, { cookie: "" })).status).toBe(403);
    expect((await f.post(suggest, { origin: "https://other.test" })).status).toBe(403);
    expect((await f.post({ ...suggest, tab: randomUUID() })).status).toBe(409);
    await f.save({ expiresAt: new Date(0).toISOString() });
    expect((await f.post(suggest)).status).toBe(409);
    await f.save({ provisionalRegistration: undefined });
    expect(await (await f.post({ kind: "available" })).json()).toEqual({ available: false });
    expect((await f.post(suggest)).status).toBe(409);
    expect(f.calls).toEqual([]);

    await f.save({});
    f.refuse(429);
    const refused = await f.post(suggest);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: { code: "cloud.unavailable", params: {} } });
    expect(f.calls.map((call) => call[2])).toEqual(["renew", "address-lookup"]);
  } finally {
    await f.close();
  }
});
