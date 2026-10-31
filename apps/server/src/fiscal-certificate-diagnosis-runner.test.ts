import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Duplex, PassThrough } from "node:stream";
import { createServer, createConnection, type AddressInfo, type Socket } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import {
  diagnosisFrame,
  diagnosisJson,
  readDiagnosisFrames,
} from "./fiscal-certificate-diagnosis-runtime.js";
import { serveCertificateDiagnosisChannel } from "./fiscal-certificate-diagnosis-dispatch.js";
import type { FiscalCertificateJson, FiscalCertificateSeat } from "@waitron/fiscal";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const runners: ReturnType<typeof createCertificateDiagnosisRunner>[] = [];
afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner?.stop()));
  vi.useRealTimers();
  vi.mocked(spawn).mockRestore();
});
const signal = () => new AbortController().signal;
function runner(options = {}) {
  const value = createCertificateDiagnosisRunner({ fiscalId: "fixture", ...options });
  runners.push(value);
  return value;
}
function controlledChild() {
  const channel = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 123456,
    kill: vi.fn(() => true),
    stdio: [null, null, null, channel],
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
  return { channel, child };
}

describe("certificate diagnosis admission", () => {
  it.each([
    ["normal", { outcome: "completed", value: { value: "selected" } }],
    [
      "progress-crash",
      {
        outcome: "interrupted",
        reason: "unavailable",
        lastProgress: { stage: "response", category: "http-response", httpStatus: 403 },
      },
    ],
  ])("retains %s output delivered after the exact child's exit", async (mode, expected) => {
    const root = await mkdtemp(join(tmpdir(), "diagnosis-exit-output-"));
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    let exited = false;
    vi.mocked(spawn).mockImplementationOnce((...args) => {
      const child = actual.spawn(...args);
      const channel = child.stdio[3] as Duplex;
      channel.pause();
      child.once("exit", () => {
        exited = true;
        setImmediate(() => channel.resume());
      });
      return child;
    });
    const value = runner({
      entry: new URL("./testing/certificate-diagnosis-child.ts", import.meta.url),
      execArgv: ["--import", import.meta.resolve("tsx")],
    });
    try {
      await expect(
        value.attempt(
          async (runChild, abort) => ({
            result: await runChild({ mode, marker: join(root, "child"), value: "selected" }, abort),
          }),
          signal(),
        ),
      ).resolves.toEqual({ result: expected });
      expect(exited).toBe(true);
      await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["end", "close", "bound", "cancel"])(
    "keeps an exited child's unread pipe bounded through %s",
    async (terminal) => {
      vi.useFakeTimers();
      const { child, channel } = controlledChild();
      const value = runner({ workMs: 1_000, cleanupMs: 200 });
      const controller = new AbortController();
      let settled = false;
      const pending = value.attempt(
        async (runChild, abort) => ({ result: await runChild(null, abort) }),
        controller.signal,
      );
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const answer =
        terminal === "cancel"
          ? expect(pending).rejects.toMatchObject({
              code: "fiscal.certificate_diagnosis_unavailable",
            })
          : expect(pending).resolves.toEqual({
              result: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
            });
      child.emit("exit", 0);
      await vi.advanceTimersByTimeAsync(199);
      expect(settled).toBe(false);
      await expect(value.attempt(async () => "early", signal())).rejects.toMatchObject({
        code: "fiscal.certificate_diagnosis_busy",
      });
      if (terminal === "cancel") controller.abort();
      else if (terminal === "bound") await vi.advanceTimersByTimeAsync(1);
      else channel.emit(terminal);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      await answer;
      expect(channel.destroyed).toBe(true);
      expect(child.kill).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
    },
  );

  it("keeps an independent child cancellation active while its exited pipe drains", async () => {
    const { child, channel } = controlledChild();
    const value = runner();
    const controller = new AbortController();
    const pending = value.attempt(
      async (runChild) => ({ result: await runChild(null, controller.signal) }),
      signal(),
    );
    child.emit("exit", 0);
    controller.abort("session-expired");
    channel.emit("data", Buffer.from('{"type":"result","value":{"selected":true}}\n'));
    channel.emit("end");
    await expect(pending).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
    });
    expect(child.kill).not.toHaveBeenCalled();
    await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
  });

  it("closes an exited child's unread pipe when its caller finishes without awaiting it", async () => {
    vi.useFakeTimers();
    const { child, channel } = controlledChild();
    const value = runner();
    let finish!: () => void;
    let childResult!: Promise<unknown>;
    const pending = value.attempt(async (runChild, abort) => {
      childResult = runChild(null, abort);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return "caller";
    }, signal());
    child.emit("exit", 0);
    finish();
    await expect(pending).resolves.toBe("caller");
    expect(channel.destroyed).toBe(true);
    await expect(childResult).resolves.toEqual({
      outcome: "interrupted",
      reason: "unavailable",
      lastProgress: null,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
    await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
  });

  it("refuses further frames after a result delivered after child exit", async () => {
    const { child, channel } = controlledChild();
    const value = runner();
    const pending = value.attempt(
      async (runChild, abort) => ({ result: await runChild(null, abort) }),
      signal(),
    );
    child.emit("exit", 0);
    channel.emit("data", Buffer.from('{"type":"result","value":{"selected":true}}\n'));
    channel.emit("data", Buffer.from('{"type":"progress","value":"PRIVATE LATE"}\n'));
    channel.emit("end");
    await expect(pending).resolves.toEqual({
      result: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
    });
    expect(channel.destroyed).toBe(true);
  });

  it("delivers a result already read at exit without waiting for its pipe to close", async () => {
    vi.useFakeTimers();
    const { child, channel } = controlledChild();
    const value = runner();
    let settled = false;
    const pending = value.attempt(
      async (runChild, abort) => ({ result: await runChild(null, abort) }),
      signal(),
    );
    void pending.then(() => {
      settled = true;
    });
    channel.emit("data", Buffer.from('{"type":"result","value":{"selected":true}}\n'));
    child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await expect(pending).resolves.toEqual({
      result: { outcome: "completed", value: { selected: true } },
    });
    expect(channel.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("discards output arriving after the work deadline while an exited pipe drains", async () => {
    vi.useFakeTimers();
    const { child, channel } = controlledChild();
    const value = runner({ workMs: 100, cleanupMs: 200 });
    const pending = value.attempt(
      async (runChild, abort) => ({ result: await runChild(null, abort) }),
      signal(),
    );
    child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(100);
    channel.emit("data", Buffer.from('{"type":"result","value":{"selected":true}}\n'));
    await expect(pending).resolves.toEqual({
      result: { outcome: "interrupted", reason: "deadline", lastProgress: null },
    });
    expect(channel.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("refuses a second attempt before calling its authorization or material reader", async () => {
    const value = runner();
    let finish!: () => void;
    const held = value.attempt(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { result: "first" };
    }, signal());
    const second = vi.fn(async () => ({ result: "second" }));
    await expect(value.attempt(second, signal())).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_busy",
      params: {},
    });
    expect(second).not.toHaveBeenCalled();
    finish();
    await expect(held).resolves.toEqual({ result: "first" });
    await expect(value.attempt(second, signal())).resolves.toEqual({ result: "second" });
  });

  it("does no work for an already cancelled request or after shutdown", async () => {
    const value = runner();
    const work = vi.fn(async () => null);
    await expect(value.attempt(work, AbortSignal.abort())).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
      params: {},
    });
    await value.stop();
    await expect(value.attempt(work, signal())).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
      params: {},
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("uses thirty seconds of monotonic work and two seconds of cleanup by default", async () => {
    vi.useFakeTimers();
    let now = 0;
    const value = runner({ monotonicNow: () => now });
    let attemptSignal!: AbortSignal;
    const held = value
      .attempt(async (_child, abort) => {
        attemptSignal = abort;
        return new Promise(() => {});
      }, signal())
      .catch((error: unknown) => error);
    now = 29_999;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(attemptSignal.aborted).toBe(false);
    vi.setSystemTime(new Date("2000-01-01"));
    now = 30_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(attemptSignal.aborted).toBe(true);
    expect(attemptSignal.reason).toBe("deadline");
    now = 32_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await held).toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
      params: {},
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late work result and removes its request listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const value = runner({ workMs: 20, cleanupMs: 20 });
    let complete!: (value: { late: boolean }) => void;
    const held = value.attempt(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      controller.signal,
    );
    const rejected = expect(held).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_unavailable",
    });
    controller.abort();
    await rejected;
    complete({ late: true });
    await expect(value.attempt(async () => ({ next: true }), signal())).resolves.toEqual({
      next: true,
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("rejects work that crossed the total monotonic budget before the timer could run", async () => {
    let now = 0;
    const value = runner({ monotonicNow: () => now });
    await expect(
      value.attempt(async () => {
        now = 32_001;
        return { late: true };
      }, signal()),
    ).rejects.toMatchObject({ code: "fiscal.certificate_diagnosis_unavailable" });
  });

  it("does not spawn when synchronous parent work exhausted the work budget", async () => {
    let now = 0;
    const value = runner({ monotonicNow: () => now, entry: new URL("file:///unused.js") });
    const spawning = vi.mocked(spawn).mockClear();
    const result = await value.attempt(async (runChild, abort) => {
      now = 30_001;
      return { result: await runChild(null, abort) };
    }, signal());
    expect(result).toEqual({
      result: { outcome: "interrupted", reason: "deadline", lastProgress: null },
    });
    expect(spawning).not.toHaveBeenCalled();
  });

  it("preserves a domain refusal from work and releases admission", async () => {
    const value = runner();
    const refusal = new Error("domain refusal");
    await expect(
      value.attempt(async () => {
        throw refusal;
      }, signal()),
    ).rejects.toBe(refusal);
    await expect(value.attempt(async () => null, signal())).resolves.toBeNull();
  });

  it("retains admission when the OS has not reported the recorded child's exit", async () => {
    const channel = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 123456,
      kill: vi.fn(() => true),
      stdio: [null, null, null, channel],
    });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    const value = runner({ workMs: 20, cleanupMs: 40, entry: new URL("file:///fixture.js") });
    const held = value.attempt(
      async (runChild, abort) => ({ result: await runChild(null, abort) }),
      signal(),
    );
    await expect(held).rejects.toMatchObject({ code: "fiscal.certificate_diagnosis_unavailable" });
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    const work = vi.fn(async () => null);
    await expect(value.attempt(work, signal())).rejects.toMatchObject({
      code: "fiscal.certificate_diagnosis_busy",
    });
    expect(work).not.toHaveBeenCalled();
    child.emit("exit", null, "SIGKILL");
    await expect(value.attempt(async () => "reaped", signal())).resolves.toBe("reaped");
    expect(channel.listenerCount("data")).toBe(0);
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
  });

  it("removes all timers after cancellation without a child", async () => {
    vi.useFakeTimers();
    const value = runner();
    const controller = new AbortController();
    const held = value.attempt(() => new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(held).rejects.toMatchObject({ code: "fiscal.certificate_diagnosis_unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps supervising a child after its caller has already thrown", async () => {
    const channel = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 123456,
      kill: vi.fn(() => true),
      stdio: [null, null, null, channel],
    });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
    const value = runner({ workMs: 1_000, cleanupMs: 200, entry: new URL("file:///fixture.js") });
    const refusal = new Error("caller refusal");
    await expect(
      value.attempt(async (runChild, abort) => {
        void runChild(null, abort);
        throw refusal;
      }, signal()),
    ).rejects.toBe(refusal);
    let stopReturned = false;
    const stop = value.stop().then(() => {
      stopReturned = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stopReturned).toBe(false);
    child.emit("exit", null, "SIGTERM");
    await stop;
    expect(stopReturned).toBe(true);
  });

  it("releases a failed spawn that never acquired a process id", async () => {
    const channel = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      kill: vi.fn(() => false),
      stdio: [null, null, null, channel],
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      queueMicrotask(() => child.emit("error", new Error("PRIVATE SPAWN FAILURE")));
      return child as unknown as ChildProcess;
    });
    const value = runner({ workMs: 20, cleanupMs: 40, entry: new URL("file:///fixture.js") });
    await expect(
      value.attempt(async (runChild, abort) => ({ result: await runChild(null, abort) }), signal()),
    ).resolves.toEqual({
      result: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
    });
    await expect(value.attempt(async () => "next", signal())).resolves.toBe("next");
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("bounded child envelopes", () => {
  it("rejects non-JSON objects, accessor execution, deep recursion and nonfinite numbers", () => {
    const getter = vi.fn(() => "PRIVATE");
    expect(diagnosisJson(Object.defineProperty({}, "secret", { get: getter }))).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    for (const value of [undefined, NaN, Infinity, () => {}, new Date(), 1n])
      expect(diagnosisJson(value)).toBe(false);
    let deep: unknown = null;
    for (let index = 0; index < 34; index++) deep = [deep];
    expect(diagnosisJson(deep)).toBe(false);
    expect(diagnosisJson({ list: [true, false, null, 1, "x"] })).toBe(true);
    expect(diagnosisFrame({ value: "é" }, 14)).toBeNull();
    expect(diagnosisFrame({ value: "x" }, 14)).toBe('{"value":"x"}\n');
  });

  it("parses fragmented UTF-8 frames and removes its listeners", () => {
    const stream = new PassThrough();
    const values: unknown[] = [];
    const invalid = vi.fn();
    const remove = readDiagnosisFrames(
      stream,
      32,
      (value, bytes) => values.push({ value, bytes }),
      invalid,
    );
    const frame = Buffer.from('{"x":"é"}\ntrue\n');
    stream.write(frame.subarray(0, 7));
    stream.write(frame.subarray(7));
    expect(values).toEqual([
      { value: { x: "é" }, bytes: 11 },
      { value: true, bytes: 5 },
    ]);
    expect(invalid).not.toHaveBeenCalled();
    remove();
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    stream.destroy();
  });

  it.each(["too-large", "bad-json", "io-error"])(
    "stops reading after %s without returning an unchecked object",
    (mode) => {
      const stream = new PassThrough();
      const receive = vi.fn(),
        invalid = vi.fn();
      const remove = readDiagnosisFrames(stream, 16, receive, invalid);
      if (mode === "too-large") {
        stream.write(JSON.stringify("x".repeat(17)) + "\n");
      } else if (mode === "bad-json") stream.write("invalid\n");
      else stream.emit("error", new Error("PRIVATE"));
      stream.write("null\n");
      expect(invalid).toHaveBeenCalledTimes(1);
      expect(receive).not.toHaveBeenCalled();
      remove();
      stream.destroy();
    },
  );
});

describe("the production child dispatcher", () => {
  async function pair() {
    const server = createServer();
    const accepted = new Promise<Socket>((resolve) => server.once("connection", resolve));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const peer = createConnection({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
    });
    const channel = await accepted;
    const ended = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    return {
      channel,
      peer,
      async close() {
        channel.destroy();
        peer.destroy();
        await ended;
      },
    };
  }
  async function conversation(
    frames: unknown[],
    seat: Pick<FiscalCertificateSeat, "diagnoseInChild"> = {
      diagnoseInChild: async () => ({ result: "selected" }),
    },
  ) {
    const sockets = await pair();
    const { channel, peer } = sockets;
    const answers: unknown[] = [];
    const remove = readDiagnosisFrames(
      peer,
      16_384,
      (value) => answers.push(value),
      () => {},
    );
    const select = vi.fn(() => seat);
    const done = serveCertificateDiagnosisChannel(channel, select);
    const peerClosed = new Promise<void>((resolve) => peer.once("close", () => resolve()));
    for (const frame of frames) peer.write(JSON.stringify(frame) + "\n");
    const result = await done;
    await peerClosed;
    remove();
    await sockets.close();
    return { result, answers, select };
  }
  const start = { type: "run", fiscalId: "fixture", input: { selected: true } };

  it("dispatches one selected material and sends only bounded JSON progress and a final result", async () => {
    const work = vi.fn(
      async (
        input: FiscalCertificateJson,
        _abort: AbortSignal,
        report: (value: FiscalCertificateJson) => void,
      ) => {
        report({ stage: "local" });
        return { selected: input };
      },
    );
    const result = await conversation([start], { diagnoseInChild: work });
    expect(result.result).toEqual({ interrupted: false });
    expect(result.answers).toEqual([
      { type: "progress", value: { stage: "local" } },
      { type: "result", value: { selected: { selected: true } } },
    ]);
    expect(result.select).toHaveBeenCalledExactlyOnceWith("fixture");
    expect(work).toHaveBeenCalledWith(
      { selected: true },
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it.each([
    null,
    [],
    {},
    { ...start, endpoint: "PRIVATE" },
    { ...start, fiscalId: 3 },
    { ...start, input: "x".repeat(200_000) },
    { type: "abort", reason: "PRIVATE" },
  ])("rejects invalid input %# before selecting a module", async (frame) => {
    const result = await conversation([frame]);
    expect(result.result).toEqual({ interrupted: true });
    expect(result.select).not.toHaveBeenCalled();
    expect(result.answers).toEqual([]);
  });

  it.each(["missing", "throws", "oversized", "progress-big", "progress-many"])(
    "closes %s without exposing a raw failure",
    async (mode) => {
      const seat: Pick<FiscalCertificateSeat, "diagnoseInChild"> =
        mode === "missing"
          ? {}
          : {
              diagnoseInChild: async (_input, _abort, report) => {
                if (mode === "throws") throw new Error("PRIVATE FAILURE");
                if (mode === "oversized") return "PRIVATE".repeat(3_000);
                if (mode === "progress-big") report("PRIVATE".repeat(200));
                if (mode === "progress-many")
                  for (let i = 0; i < 17; i++) report({ stage: "local" });
                return null;
              },
            };
      const result = await conversation([start], seat);
      expect(result.result).toEqual({ interrupted: true });
      expect(JSON.stringify(result.answers)).not.toContain("PRIVATE");
      expect(
        result.answers.filter((answer) => (answer as { type: string }).type === "result"),
      ).toEqual([]);
    },
  );

  it("aborts a running task on parent disconnect and removes channel listeners", async () => {
    const sockets = await pair();
    const { channel, peer } = sockets;
    const endListeners = channel.listeners("end");
    let signal!: AbortSignal;
    const held = serveCertificateDiagnosisChannel(channel, () => ({
      diagnoseInChild: async (_input, abort) => {
        signal = abort;
        return new Promise(() => {});
      },
    }));
    peer.write(JSON.stringify(start) + "\n");
    await vi.waitFor(() => expect(signal).toBeDefined());
    peer.end();
    await expect(held).resolves.toEqual({ interrupted: true });
    expect(signal.aborted).toBe(true);
    expect(channel.listenerCount("data")).toBe(0);
    expect(channel.listeners("end")).toEqual(endListeners);
    await sockets.close();
  });

  it("carries cooperative deadline cancellation without returning late evidence", async () => {
    let reason: unknown;
    const result = await conversation([start, { type: "abort", reason: "deadline" }], {
      diagnoseInChild: (_input, signal) =>
        new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              reason = signal.reason;
              resolve({ late: true });
            },
            { once: true },
          ),
        ),
    });
    expect(reason).toBe("deadline");
    expect(result.result).toEqual({ interrupted: true });
    expect(result.answers).toEqual([]);
  });
});
