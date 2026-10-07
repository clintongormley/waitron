import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import { smtpRig, smtpTestTls } from "./testing/smtp-settings-fixture.js";

function mount(sendEmailTest?: SetupDeps["sendEmailTest"]) {
  const app = new Hono();
  const logs: unknown[] = [];
  mountSetup(app, { environment: "preproduction", sendEmailTest }, (...line) => logs.push(line));
  return { app, logs };
}
const email = {
  server: "127.0.0.1",
  port: 465,
  encryption: "tls",
  from: "venue@example.test",
};
function request(app: Hono, body: unknown) {
  return app.request("/setup-api/email-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function body(settings: unknown = email) {
  return {
    mode: "live",
    email: settings,
    venue: { admin: { email: " ADMIN@example.test " } },
    recipient: "attacker@example.test",
  };
}

describe("setup wizard email test", () => {
  it.each(["accepted", "recipient-refused", "data-refused", "lost-ack", "silent"] as const)(
    "reports a real SMTP %s without storing or exposing proposed settings",
    async (reply) => {
      const rig = await smtpRig(reply, true);
      try {
        const { app, logs } = mount((config, recipient) =>
          sendSmtpTestMessage(config, recipient, {
            ca: smtpTestTls.caCertPem,
            timeoutMs: reply === "silent" ? 500 : 5000,
          }),
        );
        const port = Number(new URL(rig.config.url).port);
        const res = await request(app, body({ ...email, port }));
        expect(res.status).toBe(200);
        const result = await res.json();
        expect(result).toEqual(
          reply === "accepted"
            ? { accepted: true }
            : {
                accepted: false,
                code: reply === "silent" ? "email.test_timeout" : "email.test_refused",
              },
        );
        if (reply === "accepted") {
          expect(rig.messages).toHaveLength(1);
          expect(rig.messages[0]).toContain("To: admin@example.test");
          expect(rig.messages[0]).toContain("From: venue@example.test");
          expect(rig.messages[0]).not.toContain("attacker@example.test");
          expect(rig.messages[0]).not.toContain("Content-Disposition: attachment");
        }
        expect(JSON.stringify({ result, logs })).not.toMatch(
          /127\.0\.0\.1|admin@example|venue@example|secret-smtp-password/,
        );
        await rig.connectionClosed;
        expect(rig.sockets.size).toBe(0);
      } finally {
        await rig.close();
      }
    },
  );
  it("uses the real default sender and refuses a plaintext server before any mail", async () => {
    const rig = await smtpRig("accepted");
    try {
      const { app } = mount();
      const res = await request(
        app,
        body({ ...email, port: Number(new URL(rig.config.url).port), encryption: "starttls" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: false, code: "email.test_refused" });
      expect(rig.messages).toHaveLength(0);
    } finally {
      await rig.close();
    }
  });
  it.each([
    [null, "body"],
    [[], "body"],
    ["secret-input", "body"],
    [{ ...body(), mode: "demo" }, "mode"],
    [{ ...body(), mode: "prepare" }, "mode"],
    [{ ...body(), mode: null }, "mode"],
    [{ ...body(), email: undefined }, "email"],
    [{ ...body(), email: null }, "email"],
    [{ ...body(), email: [] }, "email"],
    [{ ...body(), venue: null }, "admin.email"],
    [{ ...body(), venue: { admin: null } }, "admin.email"],
    [{ ...body(), venue: { admin: { email: null } } }, "admin.email"],
  ])("refuses invalid setup envelope %j before SMTP", async (input, field) => {
    const { app, logs } = mount(async () => {
      throw new Error("must not send");
    });
    const res = await request(app, input);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field } },
    });
    expect(JSON.stringify(logs)).not.toContain("secret-input");
  });
  it("refuses a malformed administrator address without repeating it", async () => {
    const { app, logs } = mount(async () => {
      throw new Error("must not send");
    });
    const res = await request(app, {
      ...body(),
      venue: { admin: { email: "secret-invalid-address" } },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "person.email_invalid", params: {} } });
    expect(JSON.stringify(logs)).not.toContain("secret-invalid-address");
  });
  it("reports field validation without exposing the SMTP password", async () => {
    const { app, logs } = mount(async () => {
      throw new Error("must not send");
    });
    const res = await request(app, body({ ...email, password: "secret-smtp-password" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "email.settings_invalid", params: { field: "user" } },
    });
    expect(JSON.stringify(logs)).not.toContain("secret-smtp-password");
  });
  it("redacts unexpected transport errors", async () => {
    const { app, logs } = mount(async () => {
      throw new Error("smtp://user:secret-smtp-password@mail.example.test");
    });
    const res = await request(app, body());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "server.internal" } });
    expect(JSON.stringify(logs)).not.toContain("secret-smtp-password");
  });
});

it("refuses overlapping email and fiscal tests and releases the setup latch after timeout", async () => {
  const rig = await smtpRig("silent", true);
  let first: Promise<Response> | undefined;
  try {
    const { app } = mount((config, recipient) =>
      sendSmtpTestMessage(config, recipient, { ca: smtpTestTls.caCertPem, timeoutMs: 1500 }),
    );
    const payload = body({ ...email, port: Number(new URL(rig.config.url).port) });
    first = Promise.resolve(request(app, payload));
    await rig.dataReceived;
    const overlapping = await request(app, payload);
    expect(overlapping.status).toBe(409);
    expect(await overlapping.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    const fiscal = await app.request("/setup-api/fiscal-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(fiscal.status).toBe(409);
    expect(await fiscal.json()).toEqual({
      error: { code: "setup.already_provisioning", params: {} },
    });
    expect((await first).status).toBe(200);
    const after = await request(app, payload);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ accepted: false, code: "email.test_timeout" });
    expect(rig.messages).toHaveLength(2);
  } finally {
    if (first !== undefined) await first;
    await rig.close();
  }
});
