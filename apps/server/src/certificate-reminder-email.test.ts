import { createServer, type AddressInfo, type Socket } from "node:net";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createCertificateReminderSender } from "./certificate-reminder-email.js";

type Reply = "accepted" | "recipient-refused" | "lost-ack" | "silent";

async function smtpRig(reply: Reply) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  let dataReceived!: () => void;
  const received = new Promise<void>((resolve) => {
    dataReceived = resolve;
  });
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 certificate-test ESMTP\r\n");
    let buffer = "";
    let data: string[] | undefined;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf("\r\n"); end !== -1; end = buffer.indexOf("\r\n")) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line !== ".") {
            data.push(line);
            continue;
          }
          messages.push(data.join("\r\n"));
          data = undefined;
          dataReceived();
          if (reply === "lost-ack") socket.destroy();
          else if (reply === "accepted") socket.end("250 accepted\r\n");
        } else if (line.startsWith("RCPT")) {
          socket.write(reply === "recipient-refused" ? "550 unknown\r\n" : "250 ok\r\n");
        } else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    smtp: {
      url: `smtp://127.0.0.1:${(server.address() as AddressInfo).port}`,
      from: "venue@example.test",
    },
    messages,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function decode(message: string) {
  const [headers, ...body] = message.split("\r\n\r\n");
  const value = body.join("\r\n\r\n");
  if (headers!.includes("Content-Transfer-Encoding: base64"))
    return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf8");
  return value
    .replace(/=\r\n/g, "")
    .replace(/(?:=[\dA-F]{2})+/g, (part) =>
      Buffer.from(part.replaceAll("=", ""), "hex").toString("utf8"),
    );
}

const message = {
  recipient: "manager@example.test",
  subject: "El certificado de la AEAT caduca el 25 oct 2026",
  text: "El certificado de la AEAT caduca el 25 oct 2026, dentro de 60 día(s).",
};

describe("certificate reminder SMTP", () => {
  it("sends one plain message with the given subject and text", async () => {
    const rig = await smtpRig("accepted");
    try {
      expect(await createCertificateReminderSender()({ ...message, smtp: rig.smtp })).toBe("sent");
      expect(rig.messages).toHaveLength(1);
      const raw = rig.messages[0]!;
      expect(raw).toContain("From: venue@example.test");
      expect(raw).toContain("To: manager@example.test");
      expect(raw).toContain(`Subject: ${message.subject}`);
      expect(decode(raw)).toBe(message.text);
    } finally {
      await rig.close();
    }
  });

  it.each([
    ["recipient-refused", "rejected"],
    ["lost-ack", "unknown"],
  ] as const)("reports %s as %s", async (reply, expected) => {
    const rig = await smtpRig(reply);
    try {
      expect(await createCertificateReminderSender()({ ...message, smtp: rig.smtp })).toBe(
        expected,
      );
    } finally {
      await rig.close();
    }
  });

  it("gives up on a silent server at 30 seconds as unknown", async () => {
    const rig = await smtpRig("silent");
    let expire: (() => void) | undefined;
    const realTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 30_000 && expire === undefined) expire = fn as () => void;
      return realTimeout(fn, ms, ...args);
    }) as typeof setTimeout);
    try {
      const sending = createCertificateReminderSender()({ ...message, smtp: rig.smtp });
      await rig.received;
      expire!();
      expect(await sending).toBe("unknown");
    } finally {
      spy.mockRestore();
      await rig.close();
    }
  });
});

it.each([
  ["accepted", "sent", []],
  ["data-refused", "rejected", ["email.test_refused"]],
  ["lost-ack", "unknown", ["email.test_refused"]],
] as const)(
  "reports structured certificate failure without changing %s outcome",
  async (reply, expected, reasons) => {
    const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
    const rig = await diagnosticRig(reply);
    const failures: unknown[] = [];
    try {
      expect(
        await createCertificateReminderSender({ onFailure: (reason) => failures.push(reason) })({
          ...message,
          smtp: rig.config,
        }),
      ).toBe(expected);
      expect(failures).toEqual(reasons);
      expect(JSON.stringify(failures)).not.toContain("secret-smtp-password");
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  },
);

it.each(["venue@example.test", { name: "Harbour Kitchen", address: "venue@example.test" }])(
  "keeps the certificate sender envelope %j and message",
  async (from) => {
    const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
    const rig = await diagnosticRig("accepted");
    const reminder = {
      ...message,
      subject: "Certificate expires soon",
      text: "Renew the certificate before expiry.",
    };
    try {
      expect(
        await createCertificateReminderSender()({ ...reminder, smtp: { ...rig.config, from } }),
      ).toBe("sent");
      expect(rig.messages[0]).toContain(
        typeof from === "string"
          ? "From: venue@example.test"
          : "From: Harbour Kitchen <venue@example.test>",
      );
      expect(rig.messages[0]).toContain(`Subject: ${reminder.subject}`);
      expect(decode(rig.messages[0]!)).toBe(reminder.text);
    } finally {
      await rig.close();
    }
  },
);

it("reports a reminder deadline as unknown with only its safe diagnostic", async () => {
  const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
  const rig = await diagnosticRig("silent");
  const failures: unknown[] = [];
  const realTimeout = globalThis.setTimeout;
  let expire!: () => void;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === 30_000 && expire === undefined) expire = fn as () => void;
    return realTimeout(fn, ms, ...args);
  }) as typeof setTimeout);
  try {
    const sending = createCertificateReminderSender({
      onFailure: (reason) => failures.push(reason),
    })({ ...message, smtp: rig.config });
    await rig.dataReceived;
    expire();
    expect(await sending).toBe("unknown");
    expect(failures).toEqual(["email.test_timeout"]);
    await rig.connectionClosed;
    expect(rig.sockets.size).toBe(0);
  } finally {
    spy.mockRestore();
    await rig.close();
  }
});

it("keeps a rejected certificate outcome if its diagnostic callback throws", async () => {
  const { smtpRig: diagnosticRig } = await import("./testing/smtp-settings-fixture.js");
  const rig = await diagnosticRig("data-refused");
  try {
    expect(
      await createCertificateReminderSender({
        onFailure: () => {
          throw new Error("diagnostic failed");
        },
      })({ ...message, smtp: rig.config }),
    ).toBe("rejected");
  } finally {
    await rig.close();
  }
});
