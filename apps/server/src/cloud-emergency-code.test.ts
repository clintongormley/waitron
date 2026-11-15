import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as emergency from "./cloud-emergency.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";
const code = "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";
const reply = (installationId = "installation", venueId = "venue") => ({
  version: 1,
  installationId,
  venueId,
  countryCode: "ES",
  asOf: new Date().toISOString(),
  code,
  codeIssuedAt: "2026-11-01T09:00:00.000Z",
  address: "https://emergency.example.test/",
});
const expected = {
  installationId: "installation",
  venueId: "venue",
  cloudOrigin: "https://cloud.test",
  staffOrigin: "https://staff.test",
};
it.each([code, "2345-6789-ABCD-EFGH-JKLM-NPQR"])(
  "reads the agreed code %s with its own address and issuance date",
  (spelling) => {
    const value = { ...reply(), code: spelling };
    expect(emergency.readEmergencyCode(value, expected)).toEqual(value);
  },
);
it.each([-60001, 60001])("refuses a code reply outside the exchange window by %ims", (offset) => {
  const value = reply(),
    now = Date.parse(value.asOf);
  expect(() =>
    emergency.readEmergencyCode(
      { ...value, asOf: new Date(now + offset).toISOString() },
      expected,
      { sentAt: now, receivedAt: now },
    ),
  ).toThrowError(expect.objectContaining({ code: "cloud.unavailable" }));
});
it.each([
  { code: code.toLowerCase() },
  { code: ` ${code}` },
  { code: code.replace("A", "I") },
  { code: code.replace("A", "O") },
  { code: code.replace("A", "0") },
  { code: code.replace("A", "1") },
  { code: code.slice(5) },
  { code: code.replace("-", "") },
  { code: `${code} ` },
  { installationId: "other" },
  { venueId: "other" },
  { countryCode: "PT" },
  { codeIssuedAt: "2099-01-01T00:00:00.000Z" },
  { address: "https://staff.test/" },
  { address: "https://cloud.test/" },
  { extra: true },
])("refuses an invalid or misbound code reply %j", (patch) => {
  expect(() => emergency.readEmergencyCode({ ...reply(), ...patch }, expected)).toThrowError(
    expect.objectContaining({ code: "cloud.unavailable" }),
  );
});
it("makes a fresh signed code request each time without writing a code to connection state", async () => {
  const operations: unknown[] = [];
  let staleReply = false;
  const f = await installationFixture(undefined, {
    emergencyCode: async (v, saved, req, res) => {
      operations.push(v[4]);
      expect(req.url).toBe("/api/installations/emergency-hosting-code");
      expect(v[7]).toBe('{"version":1}');
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      const answer = reply(r.installationId, r.venueId);
      if (staleReply) answer.asOf = new Date(Date.now() - 120000).toISOString();
      res.end(JSON.stringify(answer));
    },
  });
  try {
    await f.client.refresh();
    const path = join(f.options.stateDir, "cloud/connection.json"),
      before = await readFile(path, "utf8");
    const first = await f.client.emergencyCode("https://staff.test");
    const second = await f.client.emergencyCode("https://staff.test");
    expect(first).toMatchObject({ code, address: "https://emergency.example.test/" });
    expect(second).toMatchObject({ code });
    expect(operations).toHaveLength(2);
    expect(operations[0]).not.toBe(operations[1]);
    expect(await readFile(path, "utf8")).toBe(before);
    staleReply = true;
    await expect(f.client.emergencyCode("https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    await f.close();
  }
});
it.each([
  ...["setting_off", "level_inactive", "no_payment_method", "not_provisioned"].map(
    (reason) =>
      [
        403,
        { error: "emergency_hosting_closed", reason },
        {},
        { code: "cloud.emergency_hosting_closed", params: { reason } },
      ] as const,
  ),
  [403, { error: "emergency_hosting_closed", reason: "other" }, {}, { code: "cloud.unavailable" }],
  [
    403,
    { error: "emergency_hosting_closed", reason: "setting_off", extra: true },
    {},
    { code: "cloud.unavailable" },
  ],
  [403, { error: "emergency_hosting_closed" }, {}, { code: "cloud.unavailable" }],
  [403, { error: "emergency_hosting_installation_ineligible" }, {}, { code: "cloud.unavailable" }],
  [
    429,
    { error: "rate_limited" },
    { "retry-after": "17" },
    { code: "cloud.emergency_code_rate_limited", params: { seconds: 17 } },
  ],
  [429, { error: "rate_limited" }, { "retry-after": "bad" }, { code: "cloud.unavailable" }],
  [429, { error: "rate_limited" }, { "retry-after": "0" }, { code: "cloud.unavailable" }],
  [
    429,
    { error: "rate_limited", extra: true },
    { "retry-after": "17" },
    { code: "cloud.unavailable" },
  ],
] as const)(
  "maps code refusal HTTP %i %j without revoking registration",
  async (status, body, headers, wanted) => {
    const f = await installationFixture(undefined, {
      emergencyCode: async (_v, _s, _q, res) => {
        res.writeHead(status as number, headers as Record<string, string>);
        res.end(JSON.stringify(body));
      },
    });
    try {
      await f.client.refresh();
      const saved = JSON.parse(
        await readFile(join(f.options.stateDir, "cloud/connection.json"), "utf8"),
      );
      const onRefusal = vi.fn();
      await expect(
        emergency.fetchEmergencyCode(saved, "https://staff.test", { onRefusal }),
      ).rejects.toMatchObject(wanted);
      expect(onRefusal).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);

it("drops a code when its registration is replaced before Cloud answers", async () => {
  let file = "";
  const f = await installationFixture(undefined, {
    emergencyCode: async (_v, saved, _q, res) => {
      const registration = (
        saved.view as { registration: { installationId: string; venueId: string } }
      ).registration;
      const replacement = JSON.parse(await readFile(file, "utf8"));
      replacement.view.registration.installationId = "44444444-4444-4444-8444-444444444444";
      delete replacement.lifecycle;
      await writeFile(file, JSON.stringify(replacement));
      res.end(JSON.stringify(reply(registration.installationId, registration.venueId)));
    },
  });
  try {
    await f.client.refresh();
    file = join(f.options.stateDir, "cloud/connection.json");
    await expect(f.client.emergencyCode("https://staff.test")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    await f.close();
  }
});

it.each([-60000, 60000])("accepts the inclusive exchange boundary at %ims", (offset) => {
  const original = reply(),
    now = Date.parse(original.asOf);
  const value = { ...original, asOf: new Date(now + offset).toISOString() };
  expect(emergency.readEmergencyCode(value, expected, { sentAt: now, receivedAt: now })).toEqual(
    value,
  );
});
