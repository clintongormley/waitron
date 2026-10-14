import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:https";
import { connect, createServer as createNetServer, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { spawnLitestream } from "@waitron/stream";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";
import {
  gatedRequestHandler,
  gatedSpawn,
  startTransportGate,
  type TransportGate,
} from "./transport-gate.js";

const tls = mintSelfSignedServerCert({
  hostnames: ["localhost"],
  ipAddresses: ["127.0.0.1"],
  now: new Date(),
});

let target: Server | undefined;
let targetPort: number;
let targetRequests = 0;
let targetConnections = 0;

const LIST_XML =
  '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><Prefix></Prefix>' +
  "<KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>" +
  "<Contents><Key>one</Key><Size>3</Size></Contents></ListBucketResult>";

beforeAll(async () => {
  target = createServer({ key: tls.serverKeyPem, cert: tls.serverCertPem }, (req, res) => {
    targetRequests++;
    req.resume();
    req.on("end", () => {
      if (req.url?.includes("list-type=2")) {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(LIST_XML);
      } else {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("answered");
      }
    });
  });
  target.on("secureConnection", () => targetConnections++);
  const started = target;
  await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
  targetPort = (started.address() as { port: number }).port;
});

afterAll(async () => {
  const started = target;
  if (started === undefined) return;
  started.closeAllConnections();
  await new Promise<void>((resolve) => started.close(() => resolve()));
});

const gates: TransportGate[] = [];
afterEach(async () => {
  for (const gate of gates.splice(0)) await gate.close();
});

async function gate(
  allow = (host: string, port: number) => host === "127.0.0.1" && port === targetPort,
) {
  const started = await startTransportGate({ allow });
  gates.push(started);
  return started;
}

function handlerFor(g: TransportGate) {
  return gatedRequestHandler(g, { socketTimeoutMs: 20_000, ca: tls.caCertPem });
}

async function get(
  handler: ReturnType<typeof gatedRequestHandler>,
  path: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { response } = await handler.handle(
    {
      method: "GET",
      protocol: "https:",
      hostname: "127.0.0.1",
      port: targetPort,
      path,
      query: {},
      headers: { host: `127.0.0.1:${targetPort}` },
    } as unknown as Parameters<typeof handler.handle>[0],
    abortSignal ? { abortSignal } : {},
  );
  const chunks: Buffer[] = [];
  for await (const chunk of response.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return `${response.statusCode} ${Buffer.concat(chunks).toString()}`;
}

/** Settles with "unanswered" when `work` has not settled within `ms`. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | "unanswered"> {
  return Promise.race([work, delay(ms).then(() => "unanswered" as const)]);
}

/** Sends `head` straight to the gate and resolves with the first bytes it answers. */
function rawAsk(g: TransportGate, head: string): Promise<string> {
  const port = Number(new URL(g.url).port);
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(head));
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk.toString()));
    socket.on("close", () => resolve(answer));
    socket.on("error", reject);
  });
}

/** A plain TCP target that counts what reaches it and reads only while `reading`. */
async function countingTarget() {
  const state = { received: 0, socket: undefined as Socket | undefined };
  const server = createNetServer((socket) => {
    state.socket = socket;
    socket.on("data", (chunk) => (state.received += chunk.length));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    state,
    async close() {
      state.socket?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Opens a CONNECT to `127.0.0.1:port` through the gate, with `head` sent in the same write;
 * resolves once the gate answers 200.
 */
function rawTunnel(g: TransportGate, port: number, head = ""): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(new URL(g.url).port), "127.0.0.1", () =>
      socket.write(`CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n${head}`),
    );
    let answer = "";
    const onData = (chunk: Buffer) => {
      answer += chunk.toString();
      if (!answer.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (/^HTTP\/1\.1 200 /.test(answer)) resolve(socket);
      else reject(new Error(answer));
    };
    socket.on("data", onData);
    socket.on("error", reject);
  });
}

describe("startTransportGate", () => {
  it("tunnels a request through the gated handler to the target", async () => {
    const g = await gate();
    const before = targetRequests;
    expect(await get(handlerFor(g), "/one")).toBe("200 answered");
    expect(targetRequests).toBe(before + 1);
    expect(g.forwarded()).toBe(1);
    expect(g.seen()).toEqual([{ sequence: 1, target: `127.0.0.1:${targetPort}`, held: false }]);
  });

  it("carries a real S3Client listing through the gate", async () => {
    const g = await gate();
    const client = new S3Client({
      endpoint: `https://127.0.0.1:${targetPort}`,
      forcePathStyle: true,
      region: "eu-north-1",
      credentials: { accessKeyId: "id", secretAccessKey: "secret" },
      requestHandler: handlerFor(g),
    });
    const listed = await client.send(new ListObjectsV2Command({ Bucket: "b" }));
    expect(listed.Contents?.map((object) => object.Key)).toEqual(["one"]);
    expect(g.forwarded()).toBe(1);
    client.destroy();
  });

  it("reuses one CONNECT for two sequential requests by default", async () => {
    const g = await gate();
    const handler = handlerFor(g);
    expect(await get(handler, "/first")).toBe("200 answered");
    expect(await get(handler, "/second")).toBe("200 answered");
    expect(g.seen()).toHaveLength(1);
  });

  it("opens a new CONNECT for each request when keep-alive is off", async () => {
    const g = await gate();
    const handler = gatedRequestHandler(g, {
      socketTimeoutMs: 20_000,
      ca: tls.caCertPem,
      keepAlive: false,
    });
    expect(await get(handler, "/first")).toBe("200 answered");
    expect(await get(handler, "/second")).toBe("200 answered");
    expect(g.seen().map((connect) => connect.sequence)).toEqual([1, 2]);
    expect(g.forwarded()).toBe(2);
  });

  it("holds a new CONNECT unanswered and undialled until release", async () => {
    const g = await gate();
    g.hold();
    const requestsBefore = targetRequests;
    const connectionsBefore = targetConnections;
    const answer = get(handlerFor(g), "/held");
    await g.waitForHeld(1, 5_000);
    expect(g.heldCount()).toBe(1);
    expect(await within(answer, 300)).toBe("unanswered");
    expect(targetConnections).toBe(connectionsBefore);
    expect(targetRequests).toBe(requestsBefore);
    expect(g.forwarded()).toBe(0);
    expect(g.seen()).toEqual([{ sequence: 1, target: `127.0.0.1:${targetPort}`, held: true }]);

    g.release();
    expect(await answer).toBe("200 answered");
    expect(g.heldCount()).toBe(0);
    expect(g.forwarded()).toBe(1);
  });

  it("stops an open keep-alive tunnel while held and resumes it on release", async () => {
    const g = await gate();
    const handler = handlerFor(g);
    expect(await get(handler, "/first")).toBe("200 answered");
    g.hold();
    const requestsBefore = targetRequests;
    const second = get(handler, "/second");
    expect(await within(second, 300)).toBe("unanswered");
    expect(targetRequests).toBe(requestsBefore);
    expect(g.heldCount()).toBe(0);
    expect(g.seen()).toHaveLength(1);

    g.release();
    expect(await second).toBe("200 answered");
    expect(g.seen()).toHaveLength(1);
  });

  it("keeps a tunnel stopped when its backed-up target drains while held", async () => {
    const tcp = await countingTarget();
    try {
      const g = await gate((_host, port) => port === tcp.port);
      const client = await rawTunnel(g, tcp.port);
      await vi.waitFor(() => expect(tcp.state.socket).toBeDefined());
      tcp.state.socket!.pause();
      const upload = Buffer.alloc(64 * 1024 * 1024, 1);
      client.write(upload);
      await delay(300);

      g.hold();
      tcp.state.socket!.resume();
      await delay(300);
      const whileHeld = tcp.state.received;
      await delay(300);
      expect(tcp.state.received).toBe(whileHeld);
      expect(tcp.state.received).toBeLessThan(upload.length);

      g.release();
      await vi.waitFor(() => expect(tcp.state.received).toBe(upload.length), { timeout: 5_000 });
      client.destroy();
    } finally {
      await tcp.close();
    }
  });

  it("stops a tunnel whose dial completes after a fresh hold, the CONNECT's own bytes included", async () => {
    const tcp = await countingTarget();
    try {
      const g = await gate((_host, port) => port === tcp.port);
      g.hold();
      const opened = rawTunnel(g, tcp.port, "early");
      await g.waitForHeld(1, 5_000);
      g.release();
      g.hold();
      const client = await opened;
      client.write("ping");
      await delay(300);
      expect(tcp.state.received).toBe(0);

      g.release();
      await vi.waitFor(() => expect(tcp.state.received).toBe(9), { timeout: 5_000 });
      client.destroy();
    } finally {
      await tcp.close();
    }
  });

  it("drops a held CONNECT whose caller aborted, and never dials it", async () => {
    const g = await gate();
    g.hold();
    const abort = new AbortController();
    const answer = get(handlerFor(g), "/aborted", abort.signal);
    await g.waitForHeld(1, 5_000);
    abort.abort();
    await expect(answer).rejects.toThrow();
    await vi.waitFor(() => expect(g.heldCount()).toBe(0), { timeout: 5_000 });

    g.release();
    expect(g.forwarded()).toBe(0);
  });

  it("refuses a target outside the allowlist with 403", async () => {
    const g = await gate();
    const answer = await rawAsk(g, "CONNECT 192.0.2.1:443 HTTP/1.1\r\nHost: 192.0.2.1:443\r\n\r\n");
    expect(answer).toMatch(/^HTTP\/1\.1 403 /);
    expect(g.refused()).toEqual(["192.0.2.1:443"]);
    expect(g.seen()).toEqual([]);
    expect(g.forwarded()).toBe(0);
  });

  it("answers any method but CONNECT with 405", async () => {
    const g = await gate();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      httpRequest(`${g.url}/anything`, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on("error", reject)
        .end();
    });
    expect(status).toBe(405);
    expect(g.forwarded()).toBe(0);
  });

  it("rejects waitForHeld naming its timeout", async () => {
    const g = await gate();
    await expect(g.waitForHeld(1, 50)).rejects.toThrow(/50 ms/);
  });

  it("close() rejects a pending waitForHeld at once and leaves no timer behind", async () => {
    const g = await gate();
    const timers = () =>
      process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
    const before = timers();
    const waiter = g.waitForHeld(1, 5_000).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await g.close();
    expect(timers()).toBe(before);
    expect(await within(waiter, 100)).toBe(
      "transport gate: closed while waiting for 1 held CONNECTs",
    );
    await expect(g.waitForHeld(1, 5_000)).rejects.toThrow(/closed/);
  });

  it("close() ends held CONNECTs and open tunnels, and can be called twice", async () => {
    const g = await gate();
    const handler = handlerFor(g);
    expect(await get(handler, "/open")).toBe("200 answered");
    g.hold();
    const onOpenTunnel = get(handler, "/on-open");
    const heldAnswer = get(handlerFor(g), "/held");
    await g.waitForHeld(1, 5_000);

    await g.close();
    await g.close();
    await expect(onOpenTunnel).rejects.toThrow();
    await expect(heldAnswer).rejects.toThrow();
    expect(g.forwarded()).toBe(1);
  });
});

describe("gatedSpawn", () => {
  const printKeys = ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))"];

  it("adds only HTTPS_PROXY to the child's environment and reports its pid", async () => {
    const g = await gate();
    const plain = spawnLitestream(process.execPath, printKeys, { EXTRA: "1" });
    await plain.exited;
    const pids: number[] = [];
    const gated = gatedSpawn(g, (pid) => pids.push(pid))(process.execPath, printKeys, {
      EXTRA: "1",
    });
    await gated.exited;

    const plainKeys = JSON.parse(plain.output()) as string[];
    const gatedKeys = JSON.parse(gated.output()) as string[];
    expect(gatedKeys.filter((key) => !plainKeys.includes(key))).toEqual(["HTTPS_PROXY"]);
    expect(plainKeys.filter((key) => !gatedKeys.includes(key))).toEqual([]);
    expect(pids).toEqual([gated.pid]);
  });

  it("stops the child and rethrows when reporting its pid throws", async () => {
    const g = await gate();
    let pid: number | undefined;
    expect(() =>
      gatedSpawn(g, (childPid) => {
        pid = childPid;
        throw new Error("tracking refused");
      })(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {}),
    ).toThrow("tracking refused");
    expect(pid).toBeDefined();
    const alive = () => {
      try {
        process.kill(pid!, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      await vi.waitFor(() => expect(alive()).toBe(false), { timeout: 5_000 });
    } finally {
      if (alive()) process.kill(pid!, "SIGKILL");
    }
  });

  it("hands the gate's url as HTTPS_PROXY", async () => {
    const g = await gate();
    const child = gatedSpawn(g)(
      process.execPath,
      ["-e", "process.stdout.write(process.env.HTTPS_PROXY ?? '')"],
      {},
    );
    await child.exited;
    expect(child.output()).toBe(g.url);
  });
});
