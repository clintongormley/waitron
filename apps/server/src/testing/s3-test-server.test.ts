// The S3 test server the stream loop and pause tests run, against the real pinned versitygw.
// Without it the cases that start one are reported SKIPPED; with CI=true or
// WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS them, as in `stream-loop.e2e.test.ts`.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createS3ObjectStore } from "@waitron/stream";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type TestContext } from "vitest";
import { freePort } from "./free-ports.js";
import {
  PORT_ATTEMPTS,
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

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "waitron-s3-test-server-"));
  });
  afterEach(async () => {
    vi.mocked(freePort).mockClear();
    await Promise.all(started.splice(0).map((server) => server.stop()));
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
    try {
      await expect(start(bin)).rejects.toThrow(
        new RegExp(`127\\.0\\.0\\.1:${portOf(first)}.*address already in use`, "s"),
      );
      expect(vi.mocked(freePort)).toHaveBeenCalledTimes(PORT_ATTEMPTS + 1);
    } finally {
      vi.mocked(freePort).mockReset();
      vi.mocked(freePort).mockImplementation(
        (await vi.importActual<typeof import("./free-ports.js")>("./free-ports.js")).freePort,
      );
    }
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
});
