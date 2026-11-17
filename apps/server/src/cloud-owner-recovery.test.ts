import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ownerRecoveryFixture } from "../test/cloud-owner-recovery-fixture.js";

it("reads with a fresh operation and signs ordered, versionless approval and refusal bodies", async () => {
  const f = await ownerRecoveryFixture();
  const actor = randomUUID();
  await expect(f.client.ownerRecoveryRead(async () => actor)).resolves.toEqual({
    requests: [f.request],
  });
  await f.client.ownerRecoveryRead(async () => actor);
  expect(f.calls.map((v) => [v[2], v[7]])).toEqual([
    ["owner-recovery-read", "{}"],
    ["owner-recovery-read", "{}"],
  ]);
  expect(f.calls[0]![4]).not.toBe(f.calls[1]![4]);
  expect(f.calls[0]![4]).not.toBe(f.request.requestId);
  const reversed = Object.fromEntries(Object.entries(f.request).reverse());
  for (const action of ["approve", "refuse"] as const) {
    const state = action === "approve" ? "approved" : "refused";
    f.reply({ requestId: f.request.requestId, state });
    await expect(
      f.client.ownerRecoveryDecide(action, reversed, async () => actor),
    ).resolves.toEqual({ requestId: f.request.requestId, state });
    expect(f.calls.at(-1)!.slice(2, 5)).toEqual([
      `owner-recovery-${action}`,
      f.request.installationId,
      f.request.requestId,
    ]);
    expect(f.calls.at(-1)![7]).toBe(
      JSON.stringify({
        request: f.request,
        [action === "approve" ? "approvedBy" : "refusedBy"]: actor,
      }),
    );
  }
});

it("refuses changed request bindings and malformed requests before signing", async () => {
  const f = await ownerRecoveryFixture();
  const actor = async () => randomUUID();
  for (const key of [
    "organisationId",
    "legalBusinessId",
    "venueId",
    "installationId",
    "publicKey",
    "environment",
  ] as const) {
    await expect(
      f.client.ownerRecoveryDecide(
        "approve",
        {
          ...f.request,
          [key]:
            key === "environment"
              ? "production"
              : key === "publicKey"
                ? "another-key"
                : randomUUID(),
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
  }
  for (const request of [
    null,
    [],
    { ...f.request, email: null },
    { ...f.request, accountId: "invalid" },
    { ...f.request, countryCode: "FR" },
    { ...f.request, expiresAt: "not a date" },
    { ...f.request, extra: true },
  ])
    await expect(f.client.ownerRecoveryDecide("approve", request, actor)).rejects.toMatchObject({
      code: "cloud.request_invalid",
    });
  expect(f.calls).toEqual([]);
});

it.each(["before signing", "during HTTP"])(
  "discards recovery when the pairing changes %s",
  async (when) => {
    const f = await ownerRecoveryFixture();
    const actor = randomUUID();
    const change = () =>
      f.patch((s) => {
        const organisationId = randomUUID();
        s.view!.organisationId = organisationId;
        s.view!.registration!.organisationId = organisationId;
        s.lifecycle!.view!.organisationId = organisationId;
      });
    if (when === "during HTTP") f.hold(change);
    await expect(
      f.client.ownerRecoveryRead(async () => {
        if (when === "before signing") await change();
        return actor;
      }),
    ).rejects.toMatchObject({ code: "cloud.binding_conflict" });
    expect(f.calls).toHaveLength(when === "before signing" ? 0 : 1);
  },
);

it.each([
  [400, "invalid_input", "cloud.request_invalid"],
  [413, "too_large", "cloud.request_invalid"],
  [415, "unsupported", "cloud.request_invalid"],
  [409, "conflict", "cloud.request_unavailable"],
  [404, "not_found", "cloud.owner_recovery_not_available"],
  [503, "unavailable", "cloud.unavailable"],
  [401, "invalid_proof", "cloud.unavailable"],
  [403, "revoked", "cloud.unavailable"],
] as const)(
  "maps Cloud %s %s and retains the existing lease callbacks",
  async (status, error, code) => {
    const f = await ownerRecoveryFixture();
    await f.client.refresh();
    const before = await f.read();
    f.refuse(error, status);
    await expect(f.client.ownerRecoveryRead(async () => randomUUID())).rejects.toMatchObject({
      code,
    });
    const after = await f.read();
    expect(after.lifecycle?.revoked).toBe(error === "revoked");
    if (error === "invalid_proof" || error === "revoked")
      expect(after.lifecycle?.lease).toBeUndefined();
    else expect(after.lifecycle?.lease).toEqual(before.lifecycle?.lease);
  },
);

it("rejects a foreign discovery and mismatched decision confirmations", async () => {
  const f = await ownerRecoveryFixture(),
    actor = randomUUID();
  f.reply({ requests: [{ ...f.request, venueId: randomUUID() }] });
  await expect(f.client.ownerRecoveryRead(async () => actor)).rejects.toMatchObject({
    code: "cloud.binding_conflict",
  });
  f.reply({ requests: [{ ...f.request, extra: true }] });
  await expect(f.client.ownerRecoveryRead(async () => actor)).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  for (const reply of [
    { requestId: randomUUID(), state: "approved" },
    { requestId: f.request.requestId, state: "refused" },
  ]) {
    f.reply(reply);
    await expect(
      f.client.ownerRecoveryDecide("approve", f.request, async () => actor),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
  }
});

it("keeps recovery unavailable with a local revoke pending or a revoked pairing", async () => {
  const f = await ownerRecoveryFixture();
  f.lose();
  await expect(f.client.revoke(async () => {})).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  await expect(f.client.ownerRecoveryRead(async () => randomUUID())).rejects.toMatchObject({
    code: "cloud.not_configured",
  });
  expect(f.calls).toEqual([]);
  await f.client.revoke(async () => {});
  await expect(f.client.ownerRecoveryRead(async () => randomUUID())).rejects.toMatchObject({
    code: "cloud.not_configured",
  });
  expect(f.calls).toEqual([]);
});
