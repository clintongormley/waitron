import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import * as cloudEmail from "./cloud-email.js";
const { sendCloudEmail } = cloudEmail;
import { createCloudConnection, type SavedCloudState } from "./cloud-client.js";

const grant = () => ({
  id: randomUUID(),
  revision: 1,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  enabled: true,
});

it("keeps SMTP for a paired box that never relayed, then remembers enabled across restart", async () => {
  const f = await installationFixture(undefined, { emailConfiguration: true });
  try {
    f.patch({ emailRelay: { version: 1, grant: null } });
    expect(await f.client.emailRelay()).toBeNull();
    f.offline();
    expect(await f.client.emailRelay()).toBeNull();
    f.online();
    const authority = grant();
    f.patch({ emailRelay: { version: 1, grant: authority } });
    expect(await f.client.emailRelay()).toEqual(authority);
    const restarted = createCloudConnection(f.options);
    f.patch({ emailRelay: { version: 1, grant: null } });
    await expect(restarted.emailRelay()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.patch({
      emailRelay: { version: 1, grant: { ...authority, expiresAt: new Date(0).toISOString() } },
    });
    await expect(restarted.emailRelay()).rejects.toMatchObject({ code: "cloud.unavailable" });
    f.patch({ emailRelay: { version: 1, grant: { ...authority, enabled: false } } });
    expect(await restarted.emailRelay()).toBeNull();
    f.offline();
    expect(await createCloudConnection(f.options).emailRelay()).toBeNull();
  } finally {
    await f.close();
  }
});

it("restores SMTP after a confirmed local pairing revoke", async () => {
  const f = await installationFixture(undefined, { emailConfiguration: true });
  try {
    f.patch({ emailRelay: { version: 1, grant: grant() } });
    await f.client.emailRelay();
    await f.client.revoke(async () => {});
    expect(await createCloudConnection(f.options).emailRelay()).toBeNull();
  } finally {
    await f.close();
  }
});

it("states the management origin only on the grant lookup's canonical test configuration", async () => {
  const f = await installationFixture(undefined, {
    emailConfiguration: true,
    managementOrigin: "https://waitron.local:3000",
  });
  try {
    f.patch({ emailRelay: { version: 1, grant: grant() } });
    await f.client.emailRelay();
    expect(f.requests.at(-1)?.[7]).toBe(
      '{"servicesVersion":2,"managementOrigin":"https://waitron.local:3000"}',
    );
    await f.client.refresh();
    expect(f.requests.at(-1)?.[7]).toBe('{"servicesVersion":2}');
  } finally {
    await f.close();
  }
});

it("reads fresh email authority over configuration and uses only explicit off for SMTP", async () => {
  const f = await installationFixture(undefined, { emailConfiguration: true });
  try {
    const authority = grant();
    f.patch({ emailRelay: { version: 1, grant: authority } });
    expect(await f.client.emailRelay()).not.toBeNull();
    expect(f.requests.at(-1)?.[2]).toBe("configuration");
    expect(f.requests.at(-1)?.[7]).toBe('{"servicesVersion":2}');
    f.patch({ emailRelay: { version: 1, grant: { ...authority, enabled: false } } });
    expect(await f.client.emailRelay()).toBeNull();
    f.patch({ emailRelay: { version: 1, grant: authority } });
    await f.client.emailRelay();
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
  const f = await installationFixture(undefined, { emailConfiguration: true });
  try {
    f.patch({ emailRelay: { version: 1, grant: grant() } });
    await f.client.emailRelay();
    f.revoke();
    await expect(f.client.emailRelay()).rejects.toMatchObject({ code: "cloud.unavailable" });
    const unpaired = createCloudConnection({ ...f.options, readVenueId: async () => null });
    expect(await unpaired.emailRelay()).toBeNull();
  } finally {
    await f.close();
  }
});

it.each(["invalid_proof", "revoked", "revoked_reply"] as const)(
  "retains shared configuration handling for %s",
  async (failure) => {
    const f = await installationFixture(undefined, { emailConfiguration: true });
    try {
      f.patch({ emailRelay: { version: 1, grant: grant() } });
      await f.client.emailRelay();
      if (failure === "revoked_reply")
        f.patch({
          revokedAt: new Date().toISOString(),
          emailRelay: { version: 1, grant: grant() },
        });
      else f.fail(failure, failure === "invalid_proof" ? 401 : 403);
      await expect(f.client.emailRelay()).rejects.toMatchObject({ code: "cloud.unavailable" });
      const saved = JSON.parse(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"));
      if (failure === "invalid_proof") {
        expect(saved.lifecycle).not.toHaveProperty("lease");
        f.fail("");
        await f.client.emailRelay();
        expect(f.requests.slice(-2).map((v) => v[2])).toEqual(["renew", "configuration"]);
      } else expect(saved.lifecycle.revoked).toBe(true);
    } finally {
      await f.close();
    }
  },
);

it("does not hold the shared Cloud turn during the grant network read", async () => {
  const f = await installationFixture(undefined, { emailConfiguration: true });
  let release = () => {},
    entered = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending: Promise<unknown> | undefined;
  try {
    f.patch({ emailRelay: { version: 1, grant: grant() } });
    await f.client.emailRelay();
    let first = true;
    f.delay(async () => {
      if (first) {
        first = false;
        entered();
        await hold;
      }
    });
    pending = f.client.emailRelay();
    await started;
    const refreshError = await f.client.refresh().then(
      () => null,
      (e) => e.code,
    );
    release();
    await pending;
    expect(refreshError).toBeNull();
  } finally {
    release();
    await pending?.catch(() => {});
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
    emailConfiguration: true,
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
    expect(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8")).not.toContain(
      payload.token,
    );
    expect(f.requests.filter((v) => String(v[2]).startsWith("email-")).map((v) => v[2])).toEqual([
      "email-submit",
      "email-status",
    ]);
  } finally {
    await f.close();
  }
});

it.each([
  "refused",
  "unavailable",
  "lost",
  "bad_identity",
  "bad_revision",
  "backwards_revision",
  "deadline",
])("does not resubmit after %s and distinguishes a definite refusal", async (failure) => {
  const id = randomUUID(),
    payload = message(),
    controller = new AbortController();
  const f = await installationFixture(undefined, {
    emailConfiguration: true,
    email: async (v, _s, req, res) => {
      if (failure === "refused" || failure === "unavailable") {
        res.writeHead(failure === "refused" ? 429 : 503);
        res.end(
          JSON.stringify({
            error: failure === "refused" ? "allowance_exhausted" : "relay_unavailable",
          }),
        );
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
          state:
            failure === "backwards_revision" && v[2] === "email-status" ? "accepted" : "queued",
          statusRevision:
            failure === "bad_revision"
              ? 0
              : failure === "backwards_revision" && v[2] === "email-submit"
                ? 2
                : 1,
          expiresAt: payload.expiresAt,
          reason: null,
        }),
      );
    },
  });
  try {
    expect(await f.client.sendEmail(grant(), id, payload, controller.signal)).toEqual(
      failure === "refused" || failure === "unavailable"
        ? { status: "rejected", failureCode: "mail.relay_refused", serverRefused: true }
        : { status: "unknown", failureCode: "mail.relay_unknown" },
    );
    expect(f.requests.filter((v) => v[2] === "email-submit")).toHaveLength(1);
  } finally {
    await f.close();
  }
});

it("honours the relay wait before its first status read", async () => {
  const id = randomUUID(),
    payload = message();
  let submittedAt = 0;
  const f = await installationFixture(undefined, {
    emailConfiguration: true,
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

it("retries a lease failure before submission instead of claiming uncertain delivery", async () => {
  let submits = 0;
  const f = await installationFixture(undefined, {
    emailConfiguration: true,
    email: async (_v, _s, _req, res) => {
      submits++;
      res.end("{}");
    },
  });
  try {
    const authority = grant();
    f.patch({ emailRelay: { version: 1, grant: authority } });
    await f.client.emailRelay();
    const file = join(f.stateDir, "cloud/connection.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    delete saved.lifecycle.lease;
    await writeFile(file, JSON.stringify(saved));
    f.offline();
    expect(await f.client.sendEmail(authority, randomUUID(), message())).toEqual({
      status: "rejected",
      failureCode: "mail.relay_refused",
      serverRefused: true,
    });
    expect(submits).toBe(0);
  } finally {
    await f.close();
  }
});

it("keeps production Cloud out of both discovery and submission", async () => {
  const f = await installationFixture(undefined, {
    environment: "production",
    emailConfiguration: true,
    email: async (v, _s, _req, res) => {
      res.end(
        JSON.stringify({
          version: 1,
          messageId: v[4],
          state: "accepted",
          statusRevision: 1,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          reason: null,
        }),
      );
    },
  });
  try {
    await f.client.refresh();
    const before = f.requests.length;
    f.patch({ emailRelay: { version: 1, grant: grant() } });
    expect(await f.client.emailRelay()).toBeNull();
    const saved = JSON.parse(
      await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"),
    ) as SavedCloudState;
    expect(await sendCloudEmail(saved, grant(), randomUUID(), message())).toEqual({
      status: "rejected",
      failureCode: "mail.relay_refused",
      serverRefused: true,
    });
    expect(f.requests).toHaveLength(before);
  } finally {
    await f.close();
  }
});

it("ends queued Cloud delivery within the mail claim even without a caller stop", async () => {
  const id = randomUUID(),
    payload = message();
  const f = await installationFixture(undefined, {
    emailConfiguration: true,
    email: async (_v, _s, _req, res) => {
      res.end(
        JSON.stringify({
          version: 1,
          messageId: id,
          state: "queued",
          statusRevision: 1,
          expiresAt: payload.expiresAt,
          reason: null,
        }),
      );
    },
  });
  try {
    expect(await f.client.sendEmail(grant(), id, payload)).toEqual({
      status: "unknown",
      failureCode: "mail.relay_unknown",
    });
    expect(f.requests.filter((v) => v[2] === "email-submit")).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 45000);

it.each([
  { status: 200, code: undefined, expected: true, exchanges: ["grant"] },
  { status: 0, code: undefined, expected: true, exchanges: ["grant", "configuration"] },
  { status: 400, code: "pairing_unavailable", expected: false, exchanges: ["grant"] },
  { status: 401, code: "invalid_proof", expected: false, exchanges: ["grant"] },
  { status: 403, code: "relay_disabled", expected: false, exchanges: ["grant"] },
  { status: 403, code: "grant_unavailable", expected: false, exchanges: ["grant"] },
  { status: 409, code: "grant_conflict", expected: false, exchanges: ["grant"] },
])(
  "handles setup staff email consent with Cloud reply $status $code",
  async ({ status, code, expected, exchanges }) => {
    const requestId = "a826821a-36c3-4b94-b15c-b09ab11cf54d";
    const hint = { version: 1, grant: grant() };
    const f = await installationFixture(undefined, {
      emailConfiguration: true,
      setupEmail: async (values, saved, req, res, sent) => {
        expect(values.slice(1, 4)).toEqual([f.options.origin, "configuration", f.installationId]);
        expect(values[6]).toBe(
          JSON.stringify((saved as unknown as SavedCloudState).lifecycle!.lease),
        );
        expect(values[7]).toBe(
          '{"purpose":"waitron-cloud-setup-email-consent-v1","requestId":"a826821a-36c3-4b94-b15c-b09ab11cf54d","consent":true,"consentVersion":"local-v1"}',
        );
        expect(Object.keys(sent).sort()).toEqual(["payload", "signature"]);
        expect(req.headers).not.toHaveProperty("origin");
        expect(req.headers).not.toHaveProperty("cookie");
        if (status === 0) req.socket.destroy();
        else {
          res.writeHead(status);
          res.end(JSON.stringify(code ? { error: code } : { emailRelay: hint }));
        }
      },
    });
    try {
      f.patch({ emailRelay: hint });
      await f.client.emailRelay();
      const saved = JSON.parse(await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"));
      f.requests.length = 0;
      expect(cloudEmail.requestSetupCloudEmailGrant).toBeTypeOf("function");
      expect(await cloudEmail.requestSetupCloudEmailGrant(saved, requestId)).toBe(expected);
      expect(
        f.requests.map((values) => (String(values[7]).includes("consent") ? "grant" : values[2])),
      ).toEqual(exchanges);
    } finally {
      await f.close();
    }
  },
);
