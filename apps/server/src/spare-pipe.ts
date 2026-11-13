import { readFile } from "node:fs/promises";
import {
  connect,
  createServer as createTcpServer,
  isIP,
  type AddressInfo,
  type Socket,
} from "node:net";
import { connect as connectTls, createServer, type TLSSocket } from "node:tls";
import { AppError, isAppError } from "@waitron/shared";
import { lookupBoxName, RememberedAnswers, type BoxAddresses } from "./box-lookup.js";
import "./errors.js";
import type { Logger } from "./logger.js";

const LISTENER = "spare_store";
const REFUSAL_LOG_INTERVAL_MS = 60_000;

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
  /** Milliseconds, for spacing the refusal lines; `Date.now` when absent. */
  now?: () => number;
}

export interface StoreListener {
  port: number;
  close(): Promise<void>;
}

/**
 * Logs a refusal at most once per reason per {@link REFUSAL_LOG_INTERVAL_MS}, each line carrying how
 * many were refused for that reason since the last, so a scanner on the venue's network cannot fill
 * the log.
 */
function refusalLog(log: Logger, now: () => number): (reason: string) => void {
  const last = new Map<string, { at: number; refused: number }>();
  return (reason) => {
    const at = now();
    const entry = last.get(reason);
    if (entry !== undefined && at - entry.at < REFUSAL_LOG_INTERVAL_MS) {
      entry.refused += 1;
      return;
    }
    log("warn", "spare.store_client_refused", { reason, refused: (entry?.refused ?? 0) + 1 });
    last.set(reason, { at, refused: 0 });
  };
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
  const refused = refusalLog(deps.log, deps.now ?? Date.now);
  server.on("secureConnection", (socket) => {
    const reason = refusal(socket, deps.peerHostname);
    if (reason !== undefined) {
      refused(reason);
      socket.destroy();
      return;
    }
    const upstream = connect(deps.upstreamPort, "127.0.0.1");
    track(upstream);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  const code = (error: NodeJS.ErrnoException) => error.code ?? "unknown";
  await new Promise<void>((resolve, reject) => {
    const bindFailed = (error: NodeJS.ErrnoException) =>
      reject(
        new AppError("server.listen_failed", {
          listener: LISTENER,
          port: deps.port,
          code: code(error),
        }),
      );
    server.once("error", bindFailed);
    server.listen(deps.port, deps.host, () => {
      server.off("error", bindFailed);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  server.on("error", (error: NodeJS.ErrnoException) =>
    deps.log("warn", "server.listen_failed", { listener: LISTENER, port, code: code(error) }),
  );
  deps.log("info", "server.listening", { listener: LISTENER, port });
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}

export interface StorePipeDeps {
  /** The spare's store, `https://<its name>:<port>`, as its pair link holds it. */
  storeUrl: string;
  /** The venue authority, the only one whose certificate the spare's store may present. */
  authorityPem: string;
  clientCertFile: string;
  clientKeyFile: string;
  /** The addresses a host name answers to; the venue network's answer, kept while it lives, when absent. */
  lookup?: (hostname: string) => Promise<BoxAddresses>;
  log: Logger;
}

export interface StorePipe {
  /** Where Litestream and the object store speak plain HTTP, on this box's loopback. */
  loopbackUrl: string;
  /** Why the last connection could not reach the spare's store; null once one does. */
  problem(): { reason: string; since: string } | null;
  close(): Promise<void>;
}

/**
 * The main box's end of the link to its spare's store: a loopback port whose every connection is
 * carried over TLS pinned to the venue authority, under this box's client certificate, to the first
 * of the store host's addresses that completes the handshake. The client files are read for each
 * connection, so a reissued pair is picked up without a restart.
 */
export async function startStorePipe(deps: StorePipeDeps): Promise<StorePipe> {
  const store = new URL(deps.storeUrl);
  const host = store.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = Number(store.port || 443);
  const remembered = new RememberedAnswers();
  const lookup = deps.lookup ?? ((name: string) => lookupBoxName(name, { remembered }));
  let problem: { reason: string; since: string } | null = null;
  const refused = (reason: string) => {
    if (problem?.reason === reason) return;
    deps.log("warn", "stream.spare_store_refused", { reason });
    problem = { reason, since: new Date().toISOString() };
  };
  const reasonOf = (error: unknown) =>
    isAppError(error) ? error.code : ((error as NodeJS.ErrnoException).code ?? "unknown");

  const reach = async (): Promise<TLSSocket | undefined> => {
    let addresses: string[];
    try {
      ({ addresses } = await lookup(host));
    } catch (error) {
      refused(reasonOf(error));
      return undefined;
    }
    const [cert, key] = await Promise.all([
      readFile(deps.clientCertFile, "utf8"),
      readFile(deps.clientKeyFile, "utf8"),
    ]);
    for (const address of addresses) {
      const reached = await new Promise<TLSSocket | string>((resolve) => {
        const socket = connectTls({
          host: address,
          port,
          ...(isIP(host) === 0 ? { servername: host } : {}),
          ca: deps.authorityPem,
          cert,
          key,
          rejectUnauthorized: true,
        });
        const failed = (error: NodeJS.ErrnoException) => {
          socket.destroy();
          resolve(error.code ?? "unknown");
        };
        socket.once("error", failed);
        socket.once("secureConnect", () => {
          socket.off("error", failed);
          resolve(socket);
        });
      });
      if (typeof reached !== "string") return reached;
      refused(reached);
    }
    return undefined;
  };

  const open = new Set<Socket>();
  const track = (socket: Socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
  };
  const server = createTcpServer({ pauseOnConnect: true }, (local) => {
    track(local);
    local.on("error", () => local.destroy());
    void reach().then(
      (remote) => {
        if (remote === undefined || local.destroyed) {
          remote?.destroy();
          local.destroy();
          return;
        }
        problem = null;
        track(remote);
        remote.on("error", () => local.destroy());
        local.on("error", () => remote.destroy());
        local.pipe(remote).pipe(local);
        local.resume();
      },
      (error: unknown) => {
        refused(reasonOf(error));
        local.destroy();
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const loopbackPort = (server.address() as AddressInfo).port;
  return {
    loopbackUrl: `http://127.0.0.1:${loopbackPort}`,
    problem: () => problem,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}
