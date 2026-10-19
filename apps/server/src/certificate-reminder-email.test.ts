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
