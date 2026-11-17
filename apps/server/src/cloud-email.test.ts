import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { createCloudConnection } from "./cloud-client.js";

const grant = () => ({
  id: randomUUID(),
  revision: 1,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  enabled: true,
});

it("reads fresh email authority over configuration and uses only explicit off for SMTP", async () => {
  const f = await installationFixture();
  try {
    const authority = grant();
    f.patch({ emailRelay: { version: 1, grant: authority } });
    expect(await f.client.emailRelay()).not.toBeNull();
    expect(f.requests.at(-1)?.[2]).toBe("configuration");
    expect(f.requests.at(-1)?.[7]).toBe('{"servicesVersion":2}');
    f.patch({ emailRelay: { version: 1, grant: { ...authority, enabled: false } } });
    expect(await f.client.emailRelay()).toBeNull();
    for (const hint of [
      undefined,
      { version: 1, grant: null },
      { version: 2, grant: authority },
      { version: 1, grant: { ...authority, expiresAt: new Date(0).toISOString() } },
      { version: 1, grant: { ...authority, revision: 0 } },
      { version: 1, grant: { ...authority, enabled: "false" } },
      { version: 1, grant: { ...authority, id: "other" } },
    ]) {
      f.patch({ emailRelay: hint });
      await expect(f.client.emailRelay()).rejects.toMatchObject({ code: "cloud.unavailable" });
    }
    f.offline();
    await expect(f.client.emailRelay()).rejects.toMatchObject({ code: "cloud.unavailable" });
  } finally {
    await f.close();
  }
});

it("keeps unpaired installations on SMTP and refuses a revoked paired relay", async () => {
  const f = await installationFixture();
  try {
    f.patch({ emailRelay: { version: 1, grant: grant() } });
    expect(await f.client.accountEmailPaired()).toBe(true);
    f.revoke();
    await expect(f.client.emailRelay()).rejects.toMatchObject({ code: "cloud.not_configured" });
    expect(await f.client.accountEmailPaired()).toBe(true);
    const unpaired = createCloudConnection({ ...f.options, readVenueId: async () => null });
    expect(await unpaired.accountEmailPaired()).toBe(false);
    expect(await unpaired.emailRelay()).toBeNull();
  } finally {
    await f.close();
  }
});

const message = () => ({
  class: "password_reset" as const,
  recipient: "person@example.test",
  displayName: "Recipient",
  locale: "en-GB",
  timeZone: "Europe/Madrid",
  expiresAt: new Date(Date.now() + 1800000).toISOString(),
  token: Buffer.alloc(32, 7).toString("base64url"),
});

it("submits one signed structured message and waits for acceptance with a separate status id", async () => {
  const id = randomUUID(),
    payload = message(),
    authority = grant();
  const f = await installationFixture(undefined, {
    email: async (v, _s, req, res) => {
      expect(req.url).toBe(
        v[2] === "email-submit"
          ? "/v1/installations/email/submit"
          : "/v1/installations/email/status",
      );
      expect(v[6]).toContain("payload");
      if (v[2] === "email-submit") {
        expect(v[4]).toBe(id);
        expect(JSON.parse(String(v[7]))).toEqual({
          version: 1,
          messageId: id,
          grantId: authority.id,
          grantRevision: 1,
          ...payload,
        });
      } else {
        expect(v[4]).not.toBe(id);
        expect(JSON.parse(String(v[7]))).toEqual({ version: 1, messageId: id });
      }
      res.end(
        JSON.stringify({
          version: 1,
          messageId: id,
          state: v[2] === "email-submit" ? "queued" : "accepted",
          statusRevision: v[2] === "email-submit" ? 1 : 2,
          expiresAt: payload.expiresAt,
          reason: null,
        }),
      );
    },
  });
  try {
    expect(await f.client.sendEmail(authority, id, payload)).toEqual({ status: "sent" });
    expect(f.requests.filter((v) => String(v[2]).startsWith("email-")).map((v) => v[2])).toEqual([
      "email-submit",
      "email-status",
    ]);
  } finally {
    await f.close();
  }
});

it.each(["refused", "lost", "bad_identity", "bad_revision", "deadline"])(
  "does not resubmit after %s and distinguishes a definite refusal",
  async (failure) => {
    const id = randomUUID(),
      payload = message(),
      controller = new AbortController();
    const f = await installationFixture(undefined, {
      email: async (v, _s, req, res) => {
        if (failure === "refused") {
          res.writeHead(429);
          res.end('{"error":"allowance_exhausted"}');
          return;
        }
        if (failure === "lost") {
          req.socket.destroy();
          return;
        }
        if (failure === "deadline" && v[2] === "email-status") controller.abort();
        res.end(
          JSON.stringify({
            version: 1,
            messageId: failure === "bad_identity" ? randomUUID() : id,
            state: "queued",
            statusRevision: failure === "bad_revision" ? 0 : 1,
            expiresAt: payload.expiresAt,
            reason: null,
          }),
        );
      },
    });
    try {
      expect(await f.client.sendEmail(grant(), id, payload, controller.signal)).toEqual(
        failure === "refused"
          ? { status: "rejected", failureCode: "mail.relay_refused", serverRefused: true }
          : { status: "unknown", failureCode: "mail.relay_unknown" },
      );
      expect(f.requests.filter((v) => v[2] === "email-submit")).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);

it("honours the relay wait before its first status read", async () => {
  const id = randomUUID(),
    payload = message();
  let submittedAt = 0;
  const f = await installationFixture(undefined, {
    email: async (v, _s, _req, res) => {
      if (v[2] === "email-submit") {
        submittedAt = Date.now();
        res.setHeader("retry-after", "1");
      } else if (Date.now() - submittedAt < 950) {
        res.writeHead(429);
        res.end('{"error":"rate_limited"}');
        return;
      }
      res.end(
        JSON.stringify({
          version: 1,
          messageId: id,
          state: v[2] === "email-submit" ? "queued" : "accepted",
          statusRevision: v[2] === "email-submit" ? 1 : 2,
          expiresAt: payload.expiresAt,
          reason: null,
        }),
      );
    },
  });
  try {
    expect(await f.client.sendEmail(grant(), id, payload)).toEqual({ status: "sent" });
  } finally {
    await f.close();
  }
});
