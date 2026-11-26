import { createServer, connect } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { S3Client } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

const HOST = "127.0.0.1";

const PROBE_TIMEOUT_MS = 5_000;

const CREDENTIALS = { accessKeyId: "waitronbench", secretAccessKey: "waitronbench" };
const BUCKET = "waitron-failover";

export async function createUnreachableStore(): Promise<{ store: Store; refusedWith: string }> {
  const port = await reservePort();
  const refusedWith = await probeRefusal(port);
  return { store: buildStore(port), refusedWith };
}

/**
 * A `Store`-shaped value whose endpoint accepts every connection and never answers. Litestream 0.5.18
 * gives up on a refused connection after 8 quick attempts and drops its read transaction before
 * retrying, so a side file that must grow needs a bucket that does not answer.
 */
export async function createSilentStore(): Promise<{ store: Store; refusedWith: string }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, HOST, () => resolve((server.address() as AddressInfo).port));
  });
  const base = buildStore(port);
  const stop = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await base.stop();
  };
  return { store: { ...base, stop }, refusedWith: "silent" };
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close(() => reject(new Error(`no port from listen(0) on ${HOST}`)));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Connect, and require the connection to be REFUSED. Anything that answers — and any other error —
 * is thrown rather than recorded, because both mean the scenario above is not measuring an offline
 * box.
 */
function probeRefusal(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: HOST, port });
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      reject(
        new Error(`${HOST}:${port} neither answered nor refused within ${PROBE_TIMEOUT_MS}ms`),
      );
    });
    socket.on("connect", () => {
      socket.destroy();
      reject(new Error(`${HOST}:${port} accepted a connection, so it is not an unreachable store`));
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(error.code);
      else
        reject(
          new Error(`${HOST}:${port} answered ${error.code ?? error.message}, not ECONNREFUSED`),
        );
    });
  });
}

function buildStore(port: number): Store {
  const endpoint = `http://${HOST}:${port}`;
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: CREDENTIALS,
  });

  return {
    endpoint,
    client,
    bucket: BUCKET,
    credentials: CREDENTIALS,
    // The three store operations THROW rather than answering. Nothing in S4 calls them; a later
    // caller that does must be told, because a quiet empty answer from a store that does not exist
    // is a wrong answer it would have no way to notice.
    putJson: () => unreachable("putJson", endpoint),
    getJson: () => unreachable("getJson", endpoint),
    listKeys: () => unreachable("listKeys", endpoint),
    async stop() {
      client.destroy();
    },
  };
}

function unreachable(operation: string, endpoint: string): never {
  throw new Error(
    `${operation} was called on the unreachable store at ${endpoint}; it holds no data and reaches nothing`,
  );
}
