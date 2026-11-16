import { createServer, request as httpsRequest, Agent } from "node:https";
import type { RequestListener } from "node:http";
import { connect, type TLSSocket } from "node:tls";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { afterEach, expect, it } from "vitest";
import { attachRequestReceiveLimits } from "./request-receive-limits.js";
import { receiveSetupArchive } from "./setup-archive-upload.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";

const material = mintMtlsMaterial();
const SHORT = {
  ordinaryMs: 120,
  uploadMs: 700,
  headersMs: 500,
  idleMs: 180,
  checkMs: 5,
  minProgressBytes: 1024,
};
const closes: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function fixture(
  handle: (request: Request, dir: string) => Promise<Response> = async (request) =>
    new Response(await request.arrayBuffer()),
  limits: Partial<typeof SHORT> = {},
  native?: RequestListener,
) {
  const dir = await mkdtemp(join(tmpdir(), "receive-limits-"));
  closes.push(() => rm(dir, { recursive: true, force: true }));
  const server = createServer(
    { key: material.serverKeyPem, cert: material.serverCertPem, connectionsCheckingInterval: 5 },
    native ??
      getRequestListener(async (request) => {
        try {
          return await handle(request, dir);
        } catch {
          return new Response(null, { status: 400 });
        }
      }),
  );
  attachRequestReceiveLimits(server, { ...SHORT, ...limits });
  const bound = await retainHttpListener("127.0.0.1", server);
  closes.push(async () => {
    server.closeAllConnections();
    await bound.close();
  });
  const agent = new Agent({ ca: material.caPem, keepAlive: true, maxSockets: 1 });
  closes.push(() => agent.destroy());
  function start(path: string, method = "POST", length = 1280) {
    let client!: ReturnType<typeof httpsRequest>;
    let timer: ReturnType<typeof setTimeout>;
    const answer = new Promise<{ status: number; bytes: Buffer }>((resolve, reject) => {
      client = httpsRequest(
        {
          host: bound.host,
          port: bound.port,
          agent,
          path,
          method,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": length },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            clearTimeout(timer);
            resolve({ status: response.statusCode!, bytes: Buffer.concat(chunks) });
          });
          response.on("error", reject);
        },
      );
      timer = setTimeout(() => client.destroy(new Error("receive deadline did not answer")), 2000);
      client.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    void answer.catch(() => {});
    closes.push(() => {
      clearTimeout(timer);
      client.destroy();
    });
    return { client, answer };
  }
  async function raw() {
    const socket = connect({ host: bound.host, port: bound.port, ca: material.caPem });
    closes.push(() => {
      socket.destroy();
    });
    await once(socket, "secureConnect");
    return socket;
  }
  return { dir, server, start, raw };
}
async function paced(
  f: Awaited<ReturnType<typeof fixture>>,
  path: string,
  method = "POST",
  width = 2048,
  count = 20,
) {
  const { client, answer } = f.start(path, method, count * width);
  const chunks = Array.from({ length: count }, (_, index) => Buffer.alloc(width, index));
  for (const chunk of chunks) {
    if (client.destroyed) break;
    client.write(chunk);
    await delay(10);
  }
  if (!client.destroyed) client.end();
  return { ...(await answer), sent: Buffer.concat(chunks) };
}

it.each([
  ["/setup-api/restore/preview", "POST", 200],
  ["/setup-api/recovery/stage", "POST", 200],
  ["/setup-api/restore", "POST", 200],
  ["/setup-api/restore?selected=1", "POST", 200],
  ["/setup-api/restore", "PUT", 408],
  ["/setup-api/restore/other", "POST", 408],
  ["//setup-api/restore", "POST", 408],
  ["/setup-api/%72estore", "POST", 408],
  ["/api/handover/restore", "POST", 408],
  ["/setup-api/configuration", "POST", 408],
] as const)(
  "only archive POST paths receive the longer allowance: %s %s",
  async (path, method, status) => {
    const f = await fixture(async (request) => {
      await delay(50);
      return new Response(await request.arrayBuffer());
    });
    const result = await paced(f, path, method);
    expect(result.status).toBe(status);
    if (status === 200) expect(result.bytes).toEqual(result.sent);
  },
);

it("stalled uploads abort the receiver and remove partial staging", async () => {
  let finished!: () => void;
  const received = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const f = await fixture(async (request, dir) => {
    try {
      const upload = await receiveSetupArchive(request, dir);
      await upload.dispose();
      return new Response("unexpected");
    } finally {
      finished();
    }
  });
  const { client, answer } = f.start("/setup-api/restore");
  client.write(Buffer.alloc(64));
  const interrupted = await Promise.race([
    answer,
    delay(400).then(() => {
      throw new Error("stalled upload reached the outer ceiling instead");
    }),
  ]);
  expect(interrupted.status).toBe(408);
  await received;
  expect(await readdir(f.dir)).toEqual([]);
});

it("a trickle below the progress floor still times out", async () => {
  const result = await paced(await fixture(), "/setup-api/restore", "POST", 1, 40);
  expect(result.status).toBe(408);
});

it("continued progress cannot evade the native upload ceiling", async () => {
  const f = await fixture(undefined, { uploadMs: 100, headersMs: 50 });
  expect((await paced(f, "/setup-api/restore")).status).toBe(408);
});

it("an early response does not remove protection from its incomplete body", async () => {
  const f = await fixture(undefined, { uploadMs: 60_000 }, (_request, response) => {
    response.writeHead(409);
    response.end();
  });
  const { client, answer } = f.start("/ordinary");
  client.write("partial");
  expect((await answer).status).toBe(409);
  await Promise.race([
    once(client.socket!, "close"),
    delay(400).then(() => {
      throw new Error("early response removed receive protection");
    }),
  ]);
  expect(client.socket!.destroyed).toBe(true);
});

async function rawReply(socket: TLSSocket) {
  let text = "";
  socket.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  const timer = setTimeout(() => socket.destroy(new Error("header deadline did not close")), 2000);
  try {
    await once(socket, "close");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

it("ordinary timing includes time spent sending headers", async () => {
  const f = await fixture(undefined, { ordinaryMs: 300 });
  const socket = await f.raw();
  const reply = rawReply(socket);
  socket.write("POST /ordinary HTTP/1.1\r\nHost: localhost\r\n");
  await delay(180);
  socket.write("Content-Length: 10000\r\n\r\nx");
  const afterHeaders = performance.now();
  expect(await reply).toContain("408 Request Timeout");
  expect(performance.now() - afterHeaders).toBeLessThan(240);
});

it("incomplete headers retain their native deadline", async () => {
  const f = await fixture(undefined, { headersMs: 50 });
  const socket = await f.raw();
  const reply = rawReply(socket);
  socket.write("POST /setup-api/restore HTTP/1.1\r\nHost: local");
  expect(await reply).toContain("408 Request Timeout");
});

it("completed bodies permit delayed responses and keepalive gets fresh ordinary limits", async () => {
  const f = await fixture(async (request) => {
    await delay(350);
    return new Response(await request.arrayBuffer());
  });
  const first = f.start("/setup-api/restore", "POST", 1);
  first.client.end("a");
  expect((await first.answer).bytes.toString()).toBe("a");
  const quick = f.start("/ordinary", "POST", 20);
  quick.client.write("a".repeat(10));
  await delay(30);
  quick.client.end("b".repeat(10));
  const answered = await quick.answer;
  expect(quick.client.socket).toBe(first.client.socket);
  expect(answered.status).toBe(200);
  expect(answered.bytes.toString()).toBe("a".repeat(10) + "b".repeat(10));
  expect((await paced(f, "/ordinary")).status).toBe(408);
});

it("quick completed requests do not accumulate connection-close listeners", async () => {
  const f = await fixture(undefined, { checkMs: 10_000 });
  const sockets = new Set();
  const counts: number[] = [];
  f.server.on("request", (request) => {
    sockets.add(request.socket);
    counts.push(request.socket.listenerCount("close"));
  });
  for (let index = 0; index < 15; index++) {
    const { client, answer } = f.start("/ordinary", "GET", 0);
    client.end();
    expect((await answer).status).toBe(200);
  }
  expect(sockets.size).toBe(1);
  expect(counts).toHaveLength(15);
  expect(counts.at(-1)).toBeLessThanOrEqual(counts[0]!);
});
