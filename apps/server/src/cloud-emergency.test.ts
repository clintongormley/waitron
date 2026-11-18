import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  fetchEmergencyDisplay,
  readEmergencyCopyStatus,
  readEmergencyDisplay,
} from "./cloud-emergency.js";
import { lockedCopyStatusReply } from "./testing/cloud-locked-fixture.js";
import { bindingFor } from "./testing/emergency-copy-source.js";
import { billingEnvelope } from "./cloud-billing.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { emergencyReply } from "../test/cloud-emergency-fixture.js";

const expected = {
  installationId: "installation",
  venueId: "venue",
  cloudOrigin: "https://cloud.test",
  staffOrigin: "https://staff.test",
};
const reply = () => emergencyReply(expected.installationId, expected.venueId);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("reads open facts and each closed shape without treating unavailable prices as zero", () => {
  const value = reply();
  expect(readEmergencyDisplay(value, expected)).toEqual(value);
  for (const closedReason of [
    "setting_off",
    "level_inactive",
    "no_payment_method",
    "not_provisioned",
  ]) {
    const closed = {
      ...value,
      emergency: { status: "ready", open: false, closedReason, address: null, codeIssuedAt: null },
    };
    expect(readEmergencyDisplay(closed, expected)).toEqual(closed);
  }
  const unavailable = { ...value, emergency: { status: "unavailable", reason: "state_not_ready" } };
  expect(readEmergencyDisplay(unavailable, expected)).toEqual(unavailable);
});
it("validates published prices without inventing their calendar day", () => {
  const value = {
    ...reply(),
    prices: {
      status: "published",
      revision: 1,
      effectiveFrom: "2026-11-12",
      currency: "EUR",
      taxExclusive: true,
      vatRateBasisPoints: 2100,
      registeredMonthlyCents: 0,
      connectedMonthlyCents: 3000,
      hostedMonthlyCents: 9000,
      hostedDayDivisor: 30,
    },
  };
  expect(readEmergencyDisplay(value, expected).prices).toEqual(value.prices);
  expect(() =>
    readEmergencyDisplay(
      { ...value, prices: { ...value.prices, effectiveFrom: "2026-02-30" } },
      expected,
    ),
  ).toThrowError(expect.objectContaining({ code: "cloud.unavailable" }));
});
it.each([
  { version: 2 },
  { installationId: "another" },
  { venueId: "another" },
  { countryCode: "PT" },
  { extra: true },
  { asOf: "2026-11-10" },
  { asOf: "2026-11-10T12:00:00Z" },
  { prices: { status: "unavailable", reason: "unknown" } },
  ...[
    { open: true, closedReason: "setting_off" },
    { open: false },
    { open: "true" },
    { address: null },
    { codeIssuedAt: null },
    { codeIssuedAt: "2026-11-11T12:00:00.000Z" },
    { codeIssuedAt: "invalid" },
    { extra: true },
  ].map((patch) => ({ emergency: { ...reply().emergency, ...patch } })),
])("refuses inconsistent or non-closed facts %j", (patch) => {
  expect(() => readEmergencyDisplay({ ...reply(), ...patch }, expected)).toThrowError(
    expect.objectContaining({ code: "cloud.unavailable" }),
  );
});
it.each([
  "http://emergency.test/",
  "https://emergency.test",
  "https://EMERGENCY.test/",
  "https://emergency.test:443/",
  "https://user@emergency.test/",
  "https://emergency.test/?",
  "https://emergency.test/#",
  "https://emergency.test/path",
  "https://emergency.test./",
  "https://127.0.0.1/",
  "https://2130706433/",
  "https://[::1]/",
  "https://host/",
  "https://box.local/",
  "https://box.internal/",
  "https://box.lan/",
  "https://box.localhost/",
  "https://staff.test/",
  "https://cloud.test/",
])("refuses an unsafe or noncanonical emergency address %s", (address) => {
  expect(() =>
    readEmergencyDisplay({ ...reply(), emergency: { ...reply().emergency, address } }, expected),
  ).toThrowError(expect.objectContaining({ code: "cloud.unavailable" }));
});
it("compares trusted hosts after canonicalization and rejects a stale exchange", () => {
  expect(() =>
    readEmergencyDisplay(reply(), {
      ...expected,
      staffOrigin: "https://EMERGENCY.EXAMPLE.TEST.:443",
    }),
  ).toThrowError(expect.objectContaining({ code: "cloud.unavailable" }));
  expect(() =>
    readEmergencyDisplay(reply(), expected, {
      sentAt: Date.parse(reply().asOf) + 60001,
      receivedAt: Date.parse(reply().asOf) + 60001,
    }),
  ).toThrowError(expect.objectContaining({ code: "cloud.unavailable" }));
});
it.each([
  [
    "emergency-hosting-display",
    "ZlI6sjLzNukjrGYE7dhEfxRaqgpNKTiUTYKRbmfVwv3uOx_PITz9MAXiCTB6od077fAja270f2mqtJoCKjTcDA",
  ],
  [
    "emergency-hosting-code",
    "nH8zlNQI9NrZASWbw607w-fa6hn6PJfLjI5EAoK_uvFHk4TM82Q8jqdSiUBRocJ--TN2fmBxmCwpjWjH7bXKDA",
  ],
] as const)("matches Cloud 417aa6f's fixed %s primitive signature", (action, signature) => {
  const privateKey = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, 1),
  ]).toString("base64url");
  const envelope = billingEnvelope(
    {
      origin: "https://cloud.example.test",
      privateKey,
      view: { registration: { installationId: "11111111-1111-4111-8111-111111111111" } },
    } as Parameters<typeof billingEnvelope>[0],
    "33333333-3333-4333-8333-333333333333",
    "synthetic-lease-not-authority",
    1800000000000,
    action,
  );
  expect(envelope.signature).toBe(signature);
  const bytes = Buffer.from(envelope.payload, "base64url");
  expect(JSON.parse(bytes.toString())).toEqual([
    "waitron-cloud-machine-v1",
    "https://cloud.example.test",
    action,
    "11111111-1111-4111-8111-111111111111",
    "33333333-3333-4333-8333-333333333333",
    1800000000000,
    "synthetic-lease-not-authority",
    '{"version":1}',
  ]);
  expect(
    verify(
      null,
      bytes,
      createPublicKey(
        createPrivateKey({
          key: Buffer.from(privateKey, "base64url"),
          format: "der",
          type: "pkcs8",
        }),
      ),
      Buffer.from(signature, "base64url"),
    ),
  ).toBe(true);
});
it("sends the signed display read, validates its reply and never requests a code", async () => {
  const seen: unknown[][] = [];
  const f = await installationFixture(undefined, {
    emergency: async (v, s, req, res) => {
      seen.push(v);
      expect(req.url).toBe("/api/installations/emergency-hosting-display");
      const r = (s.view as { registration: { installationId: string; venueId: string } })
        .registration;
      res.end(
        JSON.stringify(emergencyReply(r.installationId, r.venueId, new Date().toISOString())),
      );
    },
  });
  try {
    await f.client.refresh();
    const result = await fetchEmergencyDisplay(
      JSON.parse(await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8")),
      "https://staff.test",
    );
    expect(result.emergency).toMatchObject({
      open: true,
      address: "https://emergency.example.test/",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![2]).toBe("emergency-hosting-display");
    expect(seen[0]![7]).toBe('{"version":1}');
  } finally {
    await f.close();
  }
});
it.each([
  [400, '{"error":"unsupported_emergency_hosting_version"}', "cloud.request_invalid"],
  [403, '{"error":"emergency_hosting_installation_ineligible"}', "cloud.unavailable"],
  [403, '{"error":"emergency_hosting_closed","reason":"setting_off"}', "cloud.unavailable"],
  [503, '{"error":"temporarily_unavailable"}', "cloud.unavailable"],
  [200, "x".repeat(16385), "cloud.unavailable"],
])("refuses HTTP %i without withdrawing the connection", async (status, body, code) => {
  const f = await installationFixture(undefined, {
    emergency: async (_v, _s, _q, res) => {
      res.writeHead(status);
      res.end(body);
    },
  });
  try {
    await f.client.refresh();
    const onRefusal = vi.fn();
    await expect(
      fetchEmergencyDisplay(
        JSON.parse(await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8")),
        "https://staff.test",
        { onRefusal },
      ),
    ).rejects.toMatchObject({ code });
    expect(onRefusal).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
it("bounds the whole body read and refuses redirects", async () => {
  let redirect = false;
  const f = await installationFixture(undefined, {
    emergency: async (_v, _s, _q, res) => {
      if (redirect) {
        res.writeHead(302, { location: "/private" });
        res.end();
      } else {
        res.writeHead(200);
        res.write('{"version":');
      }
    },
  });
  try {
    await f.client.refresh();
    const saved = JSON.parse(
      await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8"),
    );
    await expect(
      fetchEmergencyDisplay(saved, "https://staff.test", { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    redirect = true;
    await expect(fetchEmergencyDisplay(saved, "https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    await f.close();
  }
});

const copy = bindingFor("a".repeat(64));
const asOf = "2026-11-17T10:10:00.000Z";
const copyStatus = lockedCopyStatusReply(copy, asOf);

it.each([
  [null, null],
  ["2026-11-17T10:07:59.999Z", null],
  ["2026-11-17T10:08:00.000Z", "source_recent"],
  [asOf, "source_recent"],
])("interprets source contact %s as %s", (sourceLastHeardAt, reason) => {
  expect(readEmergencyCopyStatus({ ...copyStatus, sourceLastHeardAt }, copy)).toEqual({
    sourceLastHeardAt,
    reason,
  });
});

it("reports a known closure even if the source was recently heard from", () => {
  expect(
    readEmergencyCopyStatus(
      {
        ...copyStatus,
        eligibility: { status: "ready", open: false, closedReason: "no_payment_method" },
        sourceLastHeardAt: asOf,
      },
      copy,
    ),
  ).toEqual({ sourceLastHeardAt: asOf, reason: "no_payment_method" });
});

it("reports an unavailable eligibility check without losing the source contact", () => {
  expect(
    readEmergencyCopyStatus(
      {
        ...copyStatus,
        eligibility: { status: "unavailable", reason: "state_not_ready" },
        sourceLastHeardAt: asOf,
      },
      copy,
    ),
  ).toEqual({ sourceLastHeardAt: asOf, reason: "state_not_ready" });
});

it.each([
  { version: 2 },
  { installationId: "other-installation" },
  { venueId: "other-venue" },
  { sourceNodeId: "other-source-node" },
  { copyNodeId: "other-copy-node" },
  { startedAt: "2026-11-17T10:00:01.000Z" },
  { copyOperationId: "other-copy" },
  { sourceInstallationId: "other-source" },
  { environment: "production" },
  { expiresAt: "2026-11-17T10:31:00.000Z" },
  { asOf: "2026-11-17T09:59:59.999Z" },
  { asOf: "2026-11-17T10:30:00.000Z" },
  { unexpected: true },
  { eligibility: { status: "ready", open: true, closedReason: "setting_off" } },
  { eligibility: { status: "unavailable", reason: "other" } },
  { sourceLastHeardAt: "2026-11-17T10:10:00.001Z" },
  { sourceLastHeardAt: "2026-11-17T10:09:00Z" },
])("refuses an invalid status reply %j", (patch) => {
  expect(() => readEmergencyCopyStatus({ ...copyStatus, ...patch }, copy)).toThrowError(
    expect.objectContaining({ code: "cloud.unavailable" }),
  );
});

it.each([60001, -60001])("refuses a reply outside the exchange window by %i ms", (offset) => {
  const sentAt = Date.parse(asOf) + offset;
  expect(() =>
    readEmergencyCopyStatus(copyStatus, copy, { sentAt, receivedAt: sentAt }),
  ).toThrowError(expect.objectContaining({ code: "cloud.unavailable" }));
});
