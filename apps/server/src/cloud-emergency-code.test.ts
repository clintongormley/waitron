import { readFile } from "node:fs/promises";
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
it("reads the agreed code as one generation with its own address and issuance date", () => {
  const value = reply();
  expect(emergency.readEmergencyCode(value, expected)).toEqual(value);
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
  const f = await installationFixture(undefined, {
    emergencyCode: async (v, saved, req, res) => {
      operations.push(v[4]);
      expect(req.url).toBe("/api/installations/emergency-hosting-code");
      expect(v[7]).toBe('{"version":1}');
      const r = (saved.view as { registration: { installationId: string; venueId: string } })
        .registration;
      res.end(JSON.stringify(reply(r.installationId, r.venueId)));
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
