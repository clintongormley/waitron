// The S3 test server the stream loop and pause tests run. The cases that start the real pinned
// versitygw are reported SKIPPED without it; with CI=true or WAITRON_REQUIRE_STREAM_BINARIES=1 a
// missing binary FAILS them, as in `stream-loop.e2e.test.ts`. The cases that start a stub, or
// Node itself, in its place run everywhere.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createS3ObjectStore } from "@waitron/stream";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type TestContext } from "vitest";
import { freePort } from "./free-ports.js";
import {
  PORT_ATTEMPTS,
  PROBE_TIMEOUT_MS,
  READY_TIMEOUT_MS,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./s3-test-server.js";

vi.mock("./free-ports.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./free-ports.js")>();
  return { ...real, freePort: vi.fn(real.freePort) };
});

const INSTALL = "node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";
/** Far above a listing from a running server on loopback, which takes milliseconds. */
const UNANSWERED_MS = 1_000;

const versitygw = await resolveVersitygw(process.env);
if (!versitygw.ok && !REQUIRED) {
  console.warn(
    `S3 test server versitygw cases SKIPPED: ${versitygw.reason}. Install with: ${INSTALL}`,
  );
}

function versitygwBin(ctx: TestContext): string {
  if (versitygw.ok) return versitygw.bin;
  if (REQUIRED) throw new Error(`versitygw is required here: ${versitygw.reason}. ${INSTALL}`);
  ctx.skip(`${versitygw.reason} — install with: ${INSTALL}`);
  throw new Error("unreachable: ctx.skip throws");
}

const portOf = (server: S3TestServer) => Number(new URL(server.endpoint).port);

function listing(server: S3TestServer): Promise<"answered" | "refused" | "unanswered"> {
  const store = createS3ObjectStore({ ...server, prefix: "probe/" });
  return Promise.race([
    store.list("").then(
      () => "answered" as const,
      () => "refused" as const,
    ),
    delay(UNANSWERED_MS).then(() => "unanswered" as const),
  ]);
}

describe("startS3TestServer", () => {
  let scratch: string;
  const started: S3TestServer[] = [];
  const start = async (bin: string) => {
    const server = await startS3TestServer({ bin, root: await mkdtemp(join(scratch, "s3-")) });
    started.push(server);
    return server;
  };
  /** An executable started in versitygw's place; it is handed versitygw's flags. */
  const stub = async (name: string, script: string) => {
    const path = join(scratch, name);
    await writeFile(path, script, { mode: 0o755 });
    return path;
  };

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "waitron-s3-test-server-"));
  });
  afterEach(async () => {
    vi.mocked(freePort).mockReset();
    await Promise.all(started.splice(0).map((server) => server?.stop()));
  });
  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("comes up on a port of its own when the port it drew is already served by another one", async (ctx) => {
    const bin = versitygwBin(ctx);
    const first = await start(bin);
    vi.mocked(freePort).mockResolvedValueOnce(portOf(first));

    const second = await start(bin);

    expect(second.endpoint).not.toBe(first.endpoint);
    expect(await listing(second)).toBe("answered");
    second.pause();
    const pending = listing(second);
    expect(await listing(first)).toBe("answered");
    expect(await pending).toBe("unanswered");
    second.resume();
    expect(await listing(second)).toBe("answered");
  });

  it("gives up, naming the port and the server's words, when every port it draws is taken", async (ctx) => {
    const bin = versitygwBin(ctx);
    const first = await start(bin);
    vi.mocked(freePort).mockResolvedValue(portOf(first));

    await expect(start(bin)).rejects.toThrow(
      new RegExp(`127\\.0\\.0\\.1:${portOf(first)}.*address already in use`, "s"),
    );
    expect(vi.mocked(freePort)).toHaveBeenCalledTimes(PORT_ATTEMPTS + 1);
    expect(await listing(first)).toBe("answered");
  });

  it("refuses to pause or resume a server that has exited, with its log", async (ctx) => {
    const server = await start(versitygwBin(ctx));
    await server.stop();

    expect(() => server.pause()).toThrow(/exited.*VersityGW/s);
    expect(() => server.resume()).toThrow(/exited.*VersityGW/s);
  });

  it("does not try another port when the server exits for any other reason", async () => {
    // Node refuses versitygw's flags and exits: a start that fails, but not for its port.
    await expect(start(process.execPath)).rejects.toThrow(/exited with 9 .*bad option/s);
    expect(vi.mocked(freePort)).toHaveBeenCalledTimes(1);
  });

  it("recognises a lost port from words that arrive after the server's process has exited", async () => {
    // The words come from a process the stub leaves behind holding its output open, so they
    // always arrive after the stub's own exit.
    const bin = await stub(
      "loses-port-after-exit",
      `#!/bin/sh\n{ sleep 0.2; echo "listen tcp: bind: address already in use" >&2; } &\nexit 1\n`,
    );

    await expect(start(bin)).rejects.toThrow(`lost every one of the ${PORT_ATTEMPTS} ports`);
    expect(vi.mocked(freePort)).toHaveBeenCalledTimes(PORT_ATTEMPTS);
  });

  it("spends one deadline across every port it tries", async () => {
    // Each start loses its port 4s in: three of them outlast the deadline, five do not fit in one.
    const bin = await stub(
      "loses-port-late",
      `#!${process.execPath}\nsetTimeout(() => process.stderr.write("bind: address already in use\\n", () => process.exit(1)), 4000);\n`,
    );
    const began = Date.now();

    await expect(start(bin)).rejects.toThrow(
      new RegExp(`did not answer on .* within ${READY_TIMEOUT_MS}ms`),
    );
    expect(Date.now() - began).toBeLessThan(READY_TIMEOUT_MS + 4_000);
    expect(vi.mocked(freePort).mock.calls.length).toBeLessThan(PORT_ATTEMPTS);
  });

  it("does not report ready on an answer that comes after the deadline", async () => {
    // Refuses every listing until shortly before the deadline, then holds each one until after it,
    // for less than one probe's own timeout.
    const answerAt = Date.now() + READY_TIMEOUT_MS + 500;
    const holdFrom = answerAt - (PROBE_TIMEOUT_MS - 100);
    const bin = await stub(
      "answers-late",
      `#!${process.execPath}
const [host, port] = process.argv[process.argv.indexOf("--port") + 1].split(":");
process.getBuiltinModule("node:http").createServer((req, res) => {
  if (Date.now() < ${holdFrom}) return res.writeHead(503).end();
  setTimeout(() => res.writeHead(200, { "content-type": "application/xml" }).end(
    '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>waitron-loop</Name><KeyCount>0</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>',
  ), ${answerAt} - Date.now());
}).listen(Number(port), host);
`,
    );

    await expect(start(bin)).rejects.toThrow(/did not answer on/);
  });
});
