import { createServer } from "node:https";
import type { IncomingMessage as HttpRequest, ServerResponse as HttpResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import type { FixtureAuthority } from "./certificate-fixtures.js";

export async function startDiagnosticServer(
  authority: FixtureAuthority,
  answer: (request: HttpRequest, response: HttpResponse) => void,
) {
  const sockets = new Set<Socket>();
  const bodies: string[] = [];
  const clientNames: (string | null)[] = [];
  let requests = 0;
  let arrived!: () => void;
  let disconnected!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const connectionClosed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const server = createServer(
    {
      key: authority.serverKeyPem,
      cert: authority.serverCertPem,
      ca: authority.caPem,
      requestCert: true,
      rejectUnauthorized: true,
    },
    (request, response) => {
      requests += 1;
      const name = (request.socket as TLSSocket).getPeerCertificate().subject?.CN;
      clientNames.push(Array.isArray(name) ? (name[0] ?? null) : (name ?? null));
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        bodies.push(body);
        answer(request, response);
        arrived();
      });
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      disconnected();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `https://127.0.0.1:${port}`,
    requests: () => requests,
    bodies,
    clientNames,
    requestArrived,
    connectionClosed,
    openConnections: () => sockets.size,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
