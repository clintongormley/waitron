import { readFile } from "node:fs/promises";
import { connect, type AddressInfo, type Socket } from "node:net";
import { createServer, type TLSSocket } from "node:tls";
import type { Logger } from "./logger.js";

export interface StoreListenerDeps {
  port: number;
  host: string;
  certFile: string;
  keyFile: string;
  /** The venue authority, the only one whose client certificates are admitted. */
  caFile: string;
  /** The paired main box's own name, which the client certificate must carry. */
  peerHostname: string;
  /** Where versitygw listens on 127.0.0.1. */
  upstreamPort: number;
  log: Logger;
}

export interface StoreListener {
  port: number;
  close(): Promise<void>;
}

/** Why `socket`'s client is not the paired main box, or undefined when it is. */
function refusal(socket: TLSSocket, peerHostname: string): string | undefined {
  const cert = socket.getPeerX509Certificate();
  if (cert === undefined) return "no_certificate";
  if (!socket.authorized) return String(socket.authorizationError);
  const named = cert.checkHost(peerHostname, { subject: "never", wildcards: false });
  return named === peerHostname ? undefined : "name_mismatch";
}

/**
 * The spare's store as the venue's network sees it: TLS under the venue authority, admitting only
 * a client certificate for the paired main box, each admitted connection piped byte for byte to
 * versitygw on loopback. `rejectUnauthorized` is off so the refusal's reason reaches the log: with
 * it on, a client certificate from another authority, or a server leaf, reached the server only as
 * `ECONNRESET` (Node 26, 2026-11-12). Every refused socket is destroyed before a byte is piped.
 */
export async function startStoreListener(deps: StoreListenerDeps): Promise<StoreListener> {
  const server = createServer({
    cert: await readFile(deps.certFile, "utf8"),
    key: await readFile(deps.keyFile, "utf8"),
    ca: await readFile(deps.caFile, "utf8"),
    requestCert: true,
    rejectUnauthorized: false,
  });
  // `server.close` waits for open connections, and the main box holds its own open.
  const open = new Set<Socket>();
  const track = (socket: Socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
  };
  server.on("connection", track);
  server.on("secureConnection", (socket) => {
    const reason = refusal(socket, deps.peerHostname);
    if (reason !== undefined) {
      deps.log("warn", "spare.store_client_refused", { reason });
      socket.destroy();
      return;
    }
    const upstream = connect(deps.upstreamPort, "127.0.0.1");
    track(upstream);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.port, deps.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}
