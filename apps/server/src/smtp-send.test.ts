import { describe, expect, it, vi } from "vitest";
import { sendSmtpMessage } from "./smtp-send.js";
import { smtpRig, smtpTestTls } from "./testing/smtp-settings-fixture.js";

const message = { to: "admin@example.test", subject: "Test subject", text: "Test body" };

describe("owned SMTP send", () => {
  it.each([
    ["accepted", { status: "sent" }],
    ["recipient-refused", { status: "rejected", reason: "email.test_refused" }],
    ["data-refused", { status: "rejected", reason: "email.test_refused" }],
    ["lost-ack", { status: "unknown", reason: "email.test_refused" }],
    ["silent", { status: "unknown", reason: "email.test_timeout" }],
  ] as const)(
    "closes the socket and reports %s without provider details",
    async (reply, expected) => {
      const rig = await smtpRig(reply, true);
      try {
        expect(
          await sendSmtpMessage(rig.config, message, {
            ca: smtpTestTls.caCertPem,
            timeoutMs: reply === "silent" ? 100 : 2000,
          }),
        ).toEqual(expected);
        await rig.connectionClosed;
        expect(rig.sockets.size).toBe(0);
      } finally {
        await rig.close();
      }
    },
  );

  it("keeps an accepted send accepted if transport cleanup throws", async () => {
    let closed = false;
    expect(
      await sendSmtpMessage({ url: "smtp://localhost", from: "venue@example.test" }, message, {
        transport: {
          sendMail: async () => ({}),
          close: () => {
            closed = true;
            throw new Error("private-cleanup");
          },
        },
      }),
    ).toEqual({ status: "sent" });
    expect(closed).toBe(true);
  });

  it("uses the default deadline and consumes a late rejected send", async () => {
    vi.useFakeTimers();
    let reject!: (error: unknown) => void;
    let closed = false;
    const result = sendSmtpMessage(
      { url: "smtp://localhost", from: "venue@example.test" },
      message,
      {
        transport: {
          sendMail: () =>
            new Promise((_resolve, fail) => {
              reject = fail;
            }),
          close: () => {
            closed = true;
          },
        },
      },
    );
    let done = false;
    void result.then(() => {
      done = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(29_999);
      expect(done).toBe(false);
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toEqual({ status: "unknown", reason: "email.test_timeout" });
      expect(closed).toBe(true);
      reject(new Error("late-provider-secret"));
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([400, 599])(
    "keeps structured SMTP reply %s rejected independently of diagnostics",
    async (responseCode) => {
      expect(
        await sendSmtpMessage({ url: "smtp://localhost", from: "venue@example.test" }, message, {
          transport: {
            sendMail: async () => {
              throw { responseCode, code: "EAUTH", message: "secret-password" };
            },
            close() {},
          },
        }),
      ).toEqual({ status: "rejected", reason: "email.test_refused" });
    },
  );
});

describe("SMTP wire diagnostics", () => {
  it.each([454, 502] as const)(
    "reports STARTTLS reply %s without sending credentials",
    async (starttls) => {
      const rig = await smtpRig("accepted", false, { starttls });
      try {
        const url = new URL(rig.config.url);
        url.username = "operator";
        url.password = "secret-smtp-password";
        url.searchParams.set("requireTLS", "true");
        expect(await sendSmtpMessage({ ...rig.config, url: url.href }, message)).toEqual({
          status: "rejected",
          reason: "email.test_starttls_refused",
        });
        expect(rig.authentications).toEqual([]);
        expect(rig.messages).toEqual([]);
        await rig.connectionClosed;
        expect(rig.sockets.size).toBe(0);
      } finally {
        await rig.close();
      }
    },
  );

  it("upgrades to trusted STARTTLS before authenticating and sending", async () => {
    const rig = await smtpRig("accepted", false, { starttls: true });
    try {
      const url = new URL(rig.config.url);
      url.username = "operator";
      url.password = "secret-smtp-password";
      url.searchParams.set("requireTLS", "true");
      expect(
        await sendSmtpMessage({ ...rig.config, url: url.href }, message, {
          ca: smtpTestTls.caCertPem,
        }),
      ).toEqual({ status: "sent" });
      expect(rig.authentications).toEqual(["\u0000operator\u0000secret-smtp-password"]);
      expect(rig.messages).toHaveLength(1);
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  });

  it.each([
    ["login-refused", "operator", "email.test_login_refused"],
    ["login-required", "", "email.test_login_required"],
  ] as const)(
    "reports %s from the SMTP reply without provider text",
    async (reply, user, reason) => {
      const rig = await smtpRig(reply, true);
      try {
        const url = new URL(rig.config.url);
        url.username = user;
        url.password = user ? "secret-smtp-password" : "";
        expect(
          await sendSmtpMessage({ ...rig.config, url: url.href }, message, {
            ca: smtpTestTls.caCertPem,
          }),
        ).toEqual({ status: "rejected", reason });
        await rig.connectionClosed;
        expect(rig.sockets.size).toBe(0);
      } finally {
        await rig.close();
      }
    },
  );

  it("refuses an untrusted TLS chain despite insecure URL options", async () => {
    const rig = await smtpRig("accepted", true);
    try {
      expect(
        await sendSmtpMessage(
          {
            ...rig.config,
            url: rig.config.url + "?tls.rejectUnauthorized=false&logger=true&debug=true",
          },
          message,
        ),
      ).toEqual({ status: "unknown", reason: "email.test_certificate_untrusted" });
      expect(rig.messages).toEqual([]);
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  });

  it("checks the hostname even with a trusted fixture authority", async () => {
    const { smtpWrongHostTls } = await import("./testing/smtp-settings-fixture.js");
    const rig = await smtpRig("accepted", true, { wrongHostname: true });
    try {
      expect(
        await sendSmtpMessage(rig.config, message, { ca: smtpWrongHostTls.caCertPem }),
      ).toEqual({ status: "unknown", reason: "email.test_certificate_untrusted" });
      expect(rig.messages).toEqual([]);
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  });

  it("diagnoses implicit TLS against plaintext SMTP", async () => {
    const rig = await smtpRig("accepted");
    try {
      expect(
        await sendSmtpMessage(
          { ...rig.config, url: rig.config.url.replace("smtp:", "smtps:") },
          message,
        ),
      ).toEqual({ status: "unknown", reason: "email.test_tls_refused" });
      expect(rig.messages).toEqual([]);
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  });

  it("closes a connection that never sends its SMTP greeting", async () => {
    const rig = await smtpRig("no-greeting");
    try {
      expect(await sendSmtpMessage(rig.config, message, { timeoutMs: 100 })).toEqual({
        status: "unknown",
        reason: "email.test_timeout",
      });
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  });

  it("reports a closed local port as refused", async () => {
    const rig = await smtpRig("accepted");
    await rig.close();
    expect(await sendSmtpMessage(rig.config, message, { timeoutMs: 2000 })).toEqual({
      status: "unknown",
      reason: "email.test_connection_refused",
    });
  });

  it("reports an invalid hostname as missing rather than a deadline", async () => {
    expect(
      await sendSmtpMessage(
        { url: "smtp://a987-smtp.invalid:587", from: "venue@example.test" },
        message,
        { timeoutMs: 5000 },
      ),
    ).toEqual({ status: "unknown", reason: "email.test_host_not_found" });
  });

  it.each(["not a URL", "https://localhost"])(
    "contains invalid connection input %s",
    async (url) => {
      expect(await sendSmtpMessage({ url, from: "venue@example.test" }, message)).toEqual({
        status: "unknown",
        reason: "email.test_refused",
      });
    },
  );

  it("contains a synchronous transport refusal and closes before resolving", async () => {
    let closed = false;
    expect(
      await sendSmtpMessage({ url: "smtp://localhost", from: "venue@example.test" }, message, {
        transport: {
          sendMail() {
            throw new Error("provider-secret");
          },
          close() {
            closed = true;
          },
        },
      }),
    ).toEqual({ status: "unknown", reason: "email.test_refused" });
    expect(closed).toBe(true);
  });
});

it("does not let URL logging options disclose the SMTP conversation", async () => {
  const rig = await smtpRig("data-refused", true);
  const spies = [
    vi.spyOn(console, "log"),
    vi.spyOn(console, "info"),
    vi.spyOn(console, "debug"),
    vi.spyOn(console, "error"),
  ];
  try {
    expect(
      await sendSmtpMessage(
        { ...rig.config, url: rig.config.url + "?logger=true&debug=true" },
        message,
        { ca: smtpTestTls.caCertPem },
      ),
    ).toEqual({ status: "rejected", reason: "email.test_refused" });
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
  } finally {
    for (const spy of spies) spy.mockRestore();
    await rig.close();
  }
});

it("reaches a configured bracketed IPv6 relay address", async () => {
  const { createServer, Socket } = await import("node:net");
  const { once } = await import("node:events");
  const { parseEmailSettings } = await import("@waitron/provisioning");
  const sockets = new Set<InstanceType<typeof Socket>>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.end("421 temporarily unavailable\r\n");
  });
  server.listen(0, "::1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("missing listener");
    const config = parseEmailSettings({
      server: "[::1]",
      port: address.port,
      encryption: "starttls",
      from: "venue@example.test",
    });
    expect(await sendSmtpMessage(config, message, { timeoutMs: 2000 })).toEqual({
      status: "rejected",
      reason: "email.test_refused",
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
