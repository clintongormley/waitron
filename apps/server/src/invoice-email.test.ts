import { createServer, type Socket, type AddressInfo } from "node:net";
import { once } from "node:events";
import { createServer as createTlsServer } from "node:tls";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { setTimeout as deadline } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createInvoiceEmailSender, createRoutedInvoiceEmailSender } from "./invoice-email.js";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  putCredential,
  deleteCredential,
} from "@waitron/credentials";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";

type Reply =
  | "accepted"
  | "recipient-refused"
  | "data-refused"
  | "lost-ack"
  | "silent"
  | "temporary-recipient-refused"
  | "temporary-data-refused";

const tls = mintSelfSignedServerCert({
  hostnames: ["localhost"],
  ipAddresses: ["127.0.0.1"],
  now: new Date(),
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

async function smtpRig(reply: Reply, secure = false) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  let received!: () => void;
  let closed!: () => void;
  const connectionClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const dataReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const handle = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      closed();
    });
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.write("220 invoice-test ESMTP\r\n");
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
          received();
          if (reply === "lost-ack") socket.destroy();
          else if (reply === "data-refused") socket.write("550 secret-smtp-password rejected\r\n");
          else if (reply === "temporary-data-refused")
            socket.write("451 secret-smtp-password temporarily refused\r\n");
          else if (reply === "accepted") socket.write("250 accepted\r\n");
        } else if (line.startsWith("EHLO") || line.startsWith("HELO")) {
          socket.write("250 invoice-test\r\n");
        } else if (line.startsWith("RCPT")) {
          socket.write(
            reply === "recipient-refused"
              ? "550 secret-smtp-password unknown recipient\r\n"
              : reply === "temporary-recipient-refused"
                ? "450 secret-smtp-password temporarily refused\r\n"
                : "250 recipient ok\r\n",
          );
        } else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  };
  const server = secure
    ? createTlsServer({ key: tls.serverKeyPem, cert: tls.serverCertPem }, handle)
    : createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    config: {
      url: `${secure ? "smtps" : "smtp"}://127.0.0.1:${(server.address() as AddressInfo).port}`,
      from: "venue@example.test",
    },
    messages,
    dataReceived,
    connectionClosed,
    sockets,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function attachmentText(message: string) {
  const pdfPart = message.split("Content-Type: application/pdf")[1]!;
  expect(pdfPart).toBeDefined();
  expect(pdfPart).toContain("Content-Disposition: attachment");
  const base64 = pdfPart.split("\r\n\r\n")[1]!.split("\r\n--")[0]!;
  const bytes = Buffer.from(base64.replace(/\s/g, ""), "base64");
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    return content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" ");
  } finally {
    await loading.destroy();
  }
}

describe("invoice SMTP transport", () => {
  it("routes successive invoices through rotated stored credentials without restarting the sender", async () => {
    await seedTenant(suite.db);
    const first = await smtpRig("accepted");
    const second = await smtpRig("accepted");
    try {
      const send = createRoutedInvoiceEmailSender({
        db: suite.db,
        ring,
        config: { onboardingIntent: "live", devMode: false },
      });
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, ring, { purpose: "email.smtp", value: first.config }),
      );
      expect(await send({ recipient: "first@example.test", document: fixture })).toEqual({
        status: "sent",
      });
      await withTransaction(suite.db, (tx) =>
        putCredential(tx, ring, {
          purpose: "email.smtp",
          value: { ...second.config, from: "new@example.test" },
        }),
      );
      expect(
        await send({ recipient: "second@example.test", document: { ...fixture, duplicate: true } }),
      ).toEqual({ status: "sent" });
      expect(first.messages).toHaveLength(1);
      expect(first.messages[0]).toContain("To: first@example.test");
      expect(second.messages).toHaveLength(1);
      expect(second.messages[0]).toContain("To: second@example.test");
      expect(second.messages[0]).toContain("From: new@example.test");
      expect(await attachmentText(second.messages[0]!)).toContain("DUPLICADO");
      await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: "email.smtp" }));
      expect(await send({ recipient: "third@example.test", document: fixture })).toEqual({
        status: "failed",
        failureCode: "transport_failed",
      });
      expect(first.messages).toHaveLength(1);
      expect(second.messages).toHaveLength(1);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("reports a live invoice with no SMTP configuration as a certain failure", async () => {
    await seedTenant(suite.db);
    const send = createRoutedInvoiceEmailSender({
      db: suite.db,
      ring,
      config: { onboardingIntent: "live", devMode: false },
    });
    expect(await send({ recipient: "customer@example.test", document: fixture })).toEqual({
      status: "failed",
      failureCode: "transport_failed",
    });
  });
  it.each([false, true])(
    "implicit TLS validates certificates with test trust override=%s",
    async (trustTestCertificate) => {
      const rig = await smtpRig("accepted", true);
      try {
        const config = {
          ...rig.config,
          url: rig.config.url + (trustTestCertificate ? "?tls.rejectUnauthorized=false" : ""),
        };
        expect(
          await createInvoiceEmailSender(config)({
            recipient: "customer@example.test",
            document: fixture,
          }),
        ).toEqual(
          trustTestCertificate
            ? { status: "sent" }
            : { status: "unknown", failureCode: "transport_failed" },
        );
        expect(rig.messages).toHaveLength(trustTestCertificate ? 1 : 0);
        if (trustTestCertificate)
          expect(await attachmentText(rig.messages[0]!)).toContain("Factura FF/1");
      } finally {
        await rig.close();
      }
    },
  );
  it.each([
    ["es-ES", false, "Factura FF/1", "Factura FF/1", "DUPLICADO"],
    ["en-GB", true, "Factura FF/1", "Factura FF/1", "DUPLICADO"],
  ] as const)(
    "sends a readable %s PDF with duplicate=%s after SMTP acceptance",
    async (invoiceLocale, duplicate, subject, caption, marker) => {
      const rig = await smtpRig("accepted");
      try {
        const send = createInvoiceEmailSender(rig.config);
        expect(
          await send({
            recipient: "customer@example.test",
            document: { ...fixture, invoiceLocale, duplicate },
          }),
        ).toEqual({ status: "sent" });
        expect(rig.messages).toHaveLength(1);
        const message = rig.messages[0]!;
        expect(message).toContain("From: venue@example.test");
        expect(message).toContain("To: customer@example.test");
        expect(message).toContain(`Subject: ${subject}`);
        const text = await attachmentText(message);
        expect(text).toContain(caption);
        expect(text).toContain("B11223344");
        expect(text).toContain(invoiceLocale === "es-ES" ? "19,69" : "19.69");
        if (duplicate) expect(text).toContain(marker);
        else expect(text).not.toContain(marker);
      } finally {
        await rig.close();
      }
    },
  );

  it.each(["recipient-refused", "data-refused"] as const)(
    "returns a sanitised certain refusal for %s",
    async (reply) => {
      const rig = await smtpRig(reply);
      try {
        expect(
          await createInvoiceEmailSender(rig.config)({
            recipient: "customer@example.test",
            document: fixture,
          }),
        ).toEqual({ status: "failed", failureCode: "transport_failed" });
        expect(rig.messages).toHaveLength(reply === "data-refused" ? 1 : 0);
      } finally {
        await rig.close();
      }
    },
  );

  it("keeps a lost final SMTP acknowledgement unknown", async () => {
    const rig = await smtpRig("lost-ack");
    try {
      expect(
        await createInvoiceEmailSender(rig.config)({
          recipient: "customer@example.test",
          document: fixture,
        }),
      ).toEqual({ status: "unknown", failureCode: "transport_failed" });
      expect(rig.messages).toHaveLength(1);
    } finally {
      await rig.close();
    }
  });

  it("ends an unanswered SMTP attempt after 30 seconds with an unknown outcome", async () => {
    const rig = await smtpRig("silent");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const sending = createInvoiceEmailSender(rig.config)({
        recipient: "customer@example.test",
        document: fixture,
      });
      await rig.dataReceived;
      let settled = false;
      void sending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await sending).toEqual({ status: "unknown", failureCode: "timeout" });
      expect(rig.messages).toHaveLength(1);
      const abort = new AbortController();
      const closeResult = await Promise.race([
        rig.connectionClosed.then(() => "closed"),
        deadline(1_000, "still open", { signal: abort.signal }),
      ]);
      abort.abort();
      expect(closeResult).toBe("closed");
      expect(rig.sockets.size).toBe(0);
    } finally {
      vi.useRealTimers();
      await rig.close();
    }
  });
});

it.each(["temporary-recipient-refused", "temporary-data-refused"] as const)(
  "classifies a real SMTP %s as failed so the worker can retry it",
  async (reply) => {
    const rig = await smtpRig(reply);
    try {
      const outcome = await createInvoiceEmailSender(rig.config)({
        recipient: "customer@example.test",
        document: fixture,
      });
      expect(outcome).toEqual({ status: "failed", failureCode: "transport_failed" });
      expect(rig.messages).toHaveLength(reply === "temporary-data-refused" ? 1 : 0);
      await rig.connectionClosed;
      expect(rig.sockets.size).toBe(0);
    } finally {
      await rig.close();
    }
  },
);
