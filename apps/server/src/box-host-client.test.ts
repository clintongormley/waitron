import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boxHostClient, DEFAULT_SET_MS, DEFAULT_STATUS_MS } from "./box-host-client.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const undo of cleanups.splice(0).reverse()) await undo();
});

/** A stand-in for the host's handler: `reply` answers the one line it reads, or never answers. */
async function host(
  reply: (line: string, socket: Socket) => void,
): Promise<{ path: string; lines: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "box-host-"));
  const path = join(dir, "box.sock");
  const lines: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const end = buffered.indexOf("\n");
      if (end === -1) return;
      const line = buffered.slice(0, end);
      lines.push(line);
      reply(line, socket);
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });
  return { path, lines };
}

const answer = (json: unknown) => (_line: string, socket: Socket) =>
  socket.end(`${JSON.stringify(json)}\n`);

const STATUS = {
  ok: true,
  service: "on",
  unit: "chrony.service",
  synchronised: false,
  lastSyncAt: 1793425000123,
  nowMs: 1793425411088,
};

describe("boxHostClient().clockStatus", () => {
  it("reads the host's time service state", async () => {
    const h = await host(answer(STATUS));
    expect(await boxHostClient({ socketPath: h.path }).clockStatus()).toEqual({
      available: true,
      service: "on",
      unit: "chrony.service",
      synchronised: false,
      lastSyncAt: new Date(1793425000123).toISOString(),
    });
    expect(h.lines).toEqual(["clock.status"]);
  });

  it("reads a host whose time service never synchronised and runs no unit", async () => {
    const h = await host(answer({ ...STATUS, service: "stopped", unit: null, lastSyncAt: null }));
    expect(await boxHostClient({ socketPath: h.path }).clockStatus()).toMatchObject({
      available: true,
      service: "stopped",
      unit: null,
      lastSyncAt: null,
    });
  });

  it("answers missing at once when no socket is there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "box-host-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const started = performance.now();
    expect(await boxHostClient({ socketPath: join(dir, "box.sock") }).clockStatus()).toEqual({
      available: false,
      reason: "missing",
    });
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("answers timeout at its limit when the host never answers", async () => {
    const h = await host(() => {});
    const started = performance.now();
    expect(await boxHostClient({ socketPath: h.path, statusMs: 200 }).clockStatus()).toEqual({
      available: false,
      reason: "timeout",
    });
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(190);
    expect(took).toBeLessThan(1000);
  });

  for (const [name, text] of [
    ["not JSON", "clock is fine\n"],
    ["JSON of the wrong shape", `${JSON.stringify({ ...STATUS, service: "maybe" })}\n`],
    ["a unit that is not a name", `${JSON.stringify({ ...STATUS, unit: 5 })}\n`],
    [
      "a synchronised that is not true or false",
      `${JSON.stringify({ ...STATUS, synchronised: "no" })}\n`,
    ],
    [
      "a last synchronisation that is not a time",
      `${JSON.stringify({ ...STATUS, lastSyncAt: -1 })}\n`,
    ],
    ["a JSON list", "[]\n"],
    ["JSON null", "null\n"],
    ["an answer that is neither yes nor no", `${JSON.stringify({ ok: "maybe" })}\n`],
    ["an answer after a line that is not one", `Failed to set time\n${JSON.stringify(STATUS)}\n`],
    ["no end of line", JSON.stringify(STATUS)],
  ] as const) {
    it(`answers malformed for ${name}`, async () => {
      const h = await host((_line, socket) => socket.end(text));
      expect(await boxHostClient({ socketPath: h.path }).clockStatus()).toEqual({
        available: false,
        reason: "malformed",
      });
    });
  }

  it("answers malformed, and stops reading, for a reply over 4 KiB", async () => {
    let closed = false;
    const h = await host((_line, socket) => {
      socket.on("close", () => (closed = true));
      socket.write("x".repeat(5000));
    });
    expect(await boxHostClient({ socketPath: h.path }).clockStatus()).toEqual({
      available: false,
      reason: "malformed",
    });
    await expect.poll(() => closed).toBe(true);
  });

  it("waits two seconds by default", () => {
    expect(DEFAULT_STATUS_MS).toBe(2_000);
  });
});

describe("boxHostClient().setClock", () => {
  it("sends one clock.set line of ids and answers the readings before and after", async () => {
    const h = await host(answer({ ok: true, beforeMs: 1793425411088, afterMs: 1793425531620 }));
    const answered = await boxHostClient({ socketPath: h.path }).setClock({
      targetMs: 1793425531250,
      requester: { source: "aeat", incidentId: "12", personId: null },
    });
    expect(answered).toEqual({ available: true, beforeMs: 1793425411088, afterMs: 1793425531620 });
    expect(h.lines).toEqual([
      'clock.set 1793425531250 {"source":"aeat","incidentId":"12","personId":null}',
    ]);
  });

  it("answers refused with the host's reason", async () => {
    const h = await host(answer({ ok: false, reason: "synchronised" }));
    expect(
      await boxHostClient({ socketPath: h.path }).setClock({
        targetMs: 1793425531250,
        requester: {},
      }),
    ).toEqual({ available: false, reason: "refused", refusal: "synchronised" });
  });

  it("answers malformed for a reading that is not a time", async () => {
    const h = await host(answer({ ok: true, beforeMs: 1793425411088, afterMs: "later" }));
    expect(
      await boxHostClient({ socketPath: h.path }).setClock({
        targetMs: 1793425531250,
        requester: {},
      }),
    ).toEqual({ available: false, reason: "malformed" });
  });

  it("answers missing when no socket is there", async () => {
    const dir = mkdtempSync(join(tmpdir(), "box-host-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(
      await boxHostClient({ socketPath: join(dir, "box.sock") }).setClock({
        targetMs: 1793425531250,
        requester: {},
      }),
    ).toEqual({ available: false, reason: "missing" });
  });

  it("answers malformed for a host refusal without a reason", async () => {
    const h = await host(answer({ ok: false }));
    expect(
      await boxHostClient({ socketPath: h.path }).setClock({
        targetMs: 1793425531250,
        requester: {},
      }),
    ).toEqual({ available: false, reason: "malformed" });
  });

  for (const targetMs of [1793425531250.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN]) {
    it(`answers malformed without connecting for a target of ${targetMs}`, async () => {
      const h = await host(answer({ ok: true, beforeMs: 1, afterMs: 2 }));
      expect(
        await boxHostClient({ socketPath: h.path }).setClock({ targetMs, requester: {} }),
      ).toEqual({
        available: false,
        reason: "malformed",
      });
      expect(h.lines).toEqual([]);
    });
  }

  it("answers timeout at its own limit", async () => {
    const h = await host(() => {});
    expect(
      await boxHostClient({ socketPath: h.path, setMs: 200 }).setClock({
        targetMs: 1793425531250,
        requester: {},
      }),
    ).toEqual({ available: false, reason: "timeout" });
  });

  it("waits longer by default than the host's 15-second limit on a request", () => {
    expect(DEFAULT_SET_MS).toBe(20_000);
    expect(DEFAULT_SET_MS).toBeGreaterThan(15_000);
  });
});
