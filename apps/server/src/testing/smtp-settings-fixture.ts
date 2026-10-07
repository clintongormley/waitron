import { createServer, type Socket, type AddressInfo } from "node:net";
import { once } from "node:events";
import { createServer as createTlsServer } from "node:tls";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";

type Reply = "accepted" | "recipient-refused" | "data-refused" | "lost-ack" | "silent";

export const smtpTestTls = mintSelfSignedServerCert({
  hostnames: ["localhost"],
  ipAddresses: ["127.0.0.1"],
  now: new Date(),
});

export async function smtpRig(reply: Reply, secure = false) {
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
          else if (reply === "accepted") socket.write("250 accepted\r\n");
        } else if (line.startsWith("EHLO") || line.startsWith("HELO")) {
          socket.write("250 invoice-test\r\n");
        } else if (line.startsWith("RCPT")) {
          socket.write(
            reply === "recipient-refused"
              ? "550 secret-smtp-password unknown recipient\r\n"
              : "250 recipient ok\r\n",
          );
        } else if (line === "DATA") {
          data = [];
          socket.write("354 send message\r\n");
        } else if (line === "STARTTLS") {
          socket.write("454 TLS unavailable\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  };
  const server = secure
    ? createTlsServer({ key: smtpTestTls.serverKeyPem, cert: smtpTestTls.serverCertPem }, handle)
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
