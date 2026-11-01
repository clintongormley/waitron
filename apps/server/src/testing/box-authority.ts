import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureBoxSecrets } from "../box-secrets.js";

/** A box's authority and the leaf it signed, minted as a real box mints its own. */
export interface BoxAuthority {
  caPem: string;
  certPem: string;
  keyPem: string;
}

export async function mintBoxAuthority(): Promise<BoxAuthority> {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-box-authority-"));
  try {
    const files = await ensureBoxSecrets({
      stateDir,
      hostnames: ["localhost"],
      now: () => new Date(),
    });
    return {
      caPem: await readFile(files.caCertFile, "utf8"),
      certPem: await readFile(files.certFile, "utf8"),
      keyPem: await readFile(files.keyFile, "utf8"),
    };
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

export interface SeenRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface BoxServer {
  url: string;
  requests: SeenRequest[];
  close: () => Promise<void>;
}

/**
 * An https server presenting `authority`'s leaf. Every request that reaches it is recorded, so a
 * test can tell a refusal at the certificate (nothing recorded) from one after the request.
 */
export async function startBoxServer(
  authority: BoxAuthority,
  answer: (req: SeenRequest) => { status: number; body: string; contentType?: string },
): Promise<BoxServer> {
  const requests: SeenRequest[] = [];
  const server: Server = createServer(
    { key: authority.keyPem, cert: authority.certPem },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const seen: SeenRequest = {
          method: req.method ?? "",
          path: req.url ?? "",
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        requests.push(seen);
        const out = answer(seen);
        res.writeHead(out.status, { "content-type": out.contentType ?? "application/json" });
        res.end(out.body);
      });
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://localhost:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export interface SilentServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * A server that accepts every connection and never answers. Given an authority it completes the
 * TLS handshake under that authority's leaf and reads the request first; without one it never sends
 * a byte, so a TLS client waits in the handshake.
 */
export async function startSilentServer(authority?: BoxAuthority): Promise<SilentServer> {
  if (authority !== undefined) {
    const server: Server = createServer(
      { key: authority.keyPem, cert: authority.certPem },
      () => {},
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as AddressInfo).port,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
  }
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
