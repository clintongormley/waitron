import { createServer, type AddressInfo, type Socket } from "node:net";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";

type Reply = "accepted" | "recipient-refused" | "data-refused" | "lost-ack" | "silent";
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
async function smtpRig(reply: Reply) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const dataReceived = gate();
  const connectionClosed = gate();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      connectionClosed.resolve();
    });
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 attendance-test ESMTP\r\n");
    let buffer = "";
    let data: string[] | undefined;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line !== ".") {
            data.push(line);
            continue;
          }
          messages.push(data.join("\r\n"));
          data = undefined;
          dataReceived.resolve();
          if (reply === "lost-ack") socket.destroy();
          else if (reply === "data-refused") socket.write("451 private-smtp-detail refused\r\n");
          else if (reply === "accepted") socket.end("250 accepted\r\n");
        } else if (line.startsWith("EHLO") || line.startsWith("HELO")) {
          socket.write("250 attendance-test\r\n");
        } else if (line.startsWith("RCPT")) {
          socket.write(
            reply === "recipient-refused" ? "550 private-detail unknown\r\n" : "250 ok\r\n",
          );
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
    dataReceived: dataReceived.promise,
    connectionClosed: connectionClosed.promise,
    sockets,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
const message = {
  recipient: "worker@example.test",
  locale: "en" as const,
  businessDay: "2026-01-05",
  locationName: "Madrid",
  missingKinds: ["in", "out"] as const,
};
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

describe("missing-attendance SMTP", () => {
  it.each([
    ["accepted", "sent"],
    ["recipient-refused", "rejected"],
    ["data-refused", "rejected"],
    ["lost-ack", "unknown"],
  ] as const)("reports %s as %s through the real transport", async (reply, expected) => {
    const { createAttendanceEmailSender } = await import("./attendance-email.js");
    const rig = await smtpRig(reply);
    try {
      expect(await createAttendanceEmailSender()({ ...message, smtp: rig.smtp })).toBe(expected);
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
      expect(rig.messages).toHaveLength(reply === "recipient-refused" ? 0 : 1);
    } finally {
      await rig.close();
    }
  });

  it.each([
    ["en", ["in", "out"], "clock in or out", "next clock-in"],
    ["en", ["out"], "clock out", "next clock-in"],
    ["en", ["in"], "clock in", "next clock-in"],
    ["es", ["in"], "fichar la entrada", "próximo fichaje"],
    ["es", ["out"], "fichar la salida", "próximo fichaje"],
    ["es", ["in", "out"], "fichar la entrada o la salida", "próximo fichaje"],
  ] as const)(
    "sends one localized plain message for %s %s",
    async (locale, missingKinds, missing, action) => {
      const { createAttendanceEmailSender } = await import("./attendance-email.js");
      const rig = await smtpRig("accepted");
      try {
        expect(
          await createAttendanceEmailSender()({ ...message, locale, missingKinds, smtp: rig.smtp }),
        ).toBe("sent");
        expect(rig.messages).toHaveLength(1);
        const raw = rig.messages[0]!;
        expect(raw).toContain("From: venue@example.test");
        expect(raw).toContain("To: worker@example.test");
        expect(decode(raw)).toContain("2026-01-05");
        expect(decode(raw)).toContain("Madrid");
        expect(decode(raw)).toContain(missing);
        expect(decode(raw)).toContain(action);
        expect(raw).not.toContain("Content-Disposition: attachment");
        expect(decode(raw)).not.toMatch(/https?:|unconfirmed|sin confirmar/i);
      } finally {
        await rig.close();
      }
    },
  );

  it("expires a silent DATA exchange at 30 seconds and closes its real socket", async () => {
    const { createAttendanceEmailSender } = await import("./attendance-email.js");
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
      const sending = createAttendanceEmailSender()({ ...message, smtp: rig.smtp });
      await rig.dataReceived;
      expect(expire).toBeTypeOf("function");
      expire!();
      expect(await sending).toBe("unknown");
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
      expect(rig.messages).toHaveLength(1);
    } finally {
      spy.mockRestore();
      await rig.close();
    }
  });
});
