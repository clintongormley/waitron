/**
 * A `Store`-shaped value whose endpoint points at a closed local port, so that `writeConfig`
 * (`litestream.ts`) can be used unchanged to configure a litestream that cannot reach anything.
 *
 * It is for the OFFLINE half of S4 (`scenarios/s4_offline_load.ts`), and it VERIFIES its own premise
 * rather than assuming it: a scenario whose "offline" arm was quietly online would measure nothing
 * at all, and both answers would look alike (`CLAUDE.md` §1). The verification is a real TCP
 * connection to the endpoint, which has to be refused.
 */
import { createServer, connect } from "node:net";
import { S3Client } from "@aws-sdk/client-s3";
import type { Store } from "./store.ts";

/** The loopback host, which is the only place a port can be reserved and then vacated here. */
const HOST = "127.0.0.1";

/** How long the refusal probe is given to answer before the premise is reported as unestablished. */
const PROBE_TIMEOUT_MS = 5_000;

/** Values only litestream's config expansion ever sees; no request is ever signed with them. */
const CREDENTIALS = { accessKeyId: "waitronbench", secretAccessKey: "waitronbench" };
const BUCKET = "waitron-failover";

/**
 * A store at `http://127.0.0.1:<port>` where `<port>` was bound, read and released, plus the error
 * code the refusal probe actually got back.
 *
 * Binding a port and closing it is preferred over hard-coding a low port such as 1: the kernel hands
 * out a port nothing on this host is using, which is a weaker thing to assume than that a well-known
 * number is free. What ESTABLISHES the refusal either way is the probe, not the choice of port.
 *
 * The claim the probe supports is narrow: this endpoint refused a connection AT THE MOMENT OF THE
 * PROBE. Nothing stops another process binding that port a second later, and nothing here watches
 * for it.
 */
export async function createUnreachableStore(): Promise<{ store: Store; refusedWith: string }> {
  const port = await reservePort();
  const refusedWith = await probeRefusal(port);
  return { store: buildStore(port), refusedWith };
}

/** Bind an ephemeral port, read which one it was, and give it back. */
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
    // A connection that neither completes nor is refused would otherwise hang the scenario: a
    // firewall that drops SYNs, rather than answering RST, is the shape this bounds.
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
  // A real client, because the `Store` type holds one — and nothing in S4 ever sends a command
  // through it. It is constructed rather than faked so that a later caller reaching for it gets a
  // client that fails the way a client fails, not a type error at a cast.
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
      // There is no container to stop. Destroying the client is not a teardown of anything this
      // module started — it releases an SDK client nothing ever sent a command through, so that a
      // caller treating this like a real store leaves nothing behind.
      client.destroy();
    },
  };
}

function unreachable(operation: string, endpoint: string): never {
  throw new Error(
    `${operation} was called on the unreachable store at ${endpoint}; it holds no data and reaches nothing`,
  );
}
