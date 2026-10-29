import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Duplex, PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { createCertificateDiagnosisRunner } from "./fiscal-certificate-diagnosis-runner.js";
import {
  certificateDiagnosisRuntime,
  diagnosisFrame,
  readDiagnosisFrames,
} from "./fiscal-certificate-diagnosis-runtime.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: vi.fn(),
}));
const runners: ReturnType<typeof createCertificateDiagnosisRunner>[] = [];
afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner?.stop()));
  vi.resetAllMocks();
});
function runner() {
  const value = createCertificateDiagnosisRunner({
    fiscalId: "fixture",
    workMs: 200,
    cleanupMs: 30,
  });
  runners.push(value);
  return value;
}

it.each([16, 17])(
  "the parent accepts at most sixteen child progress frames independently of the child's own limit (%s)",
  async (count) => {
    const channel = new Duplex({
      read() {},
      write(_data, _encoding, callback) {
        callback();
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 123456,
      stdio: [null, null, null, channel],
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const value = runner();
    const pending = value.attempt(
      async (runChild, signal) => ({ result: await runChild(null, signal) }),
      new AbortController().signal,
    );
    for (let index = 0; index < count; index++)
      channel.emit(
        "data",
        Buffer.from(JSON.stringify({ type: "progress", value: { step: index } }) + "\n"),
      );
    channel.emit("data", Buffer.from('{"type":"result","value":{"selected":true}}\n'));
    child.emit("exit", 0);
    await expect(pending).resolves.toEqual({
      result:
        count === 16
          ? { outcome: "completed", value: { selected: true } }
          : { outcome: "interrupted", reason: "unavailable", lastProgress: { step: 15 } },
    });
    await expect(value.attempt(async () => "next", new AbortController().signal)).resolves.toBe(
      "next",
    );
  },
);

it("uses the adjacent shipped child without a source loader", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  const runtime = certificateDiagnosisRuntime();
  expect(runtime.entry.pathname).toMatch(/\/fiscal-certificate-diagnosis\.js$/);
  expect(runtime.execArgv).toEqual([]);
});
it("rejects invalid output before serializing it and stops within the current frame batch", () => {
  expect(diagnosisFrame(new Date(), 1_000)).toBeNull();
  const stream = new PassThrough();
  const received: unknown[] = [];
  let failures = 0;
  const remove = readDiagnosisFrames(
    stream,
    100,
    (value) => {
      received.push(value);
      stream.emit("error", new Error("PRIVATE"));
    },
    () => {
      failures++;
    },
  );
  try {
    stream.write("true\nfalse\n");
    stream.write("null\n");
    stream.emit("error", new Error("PRIVATE AGAIN"));
    expect(received).toEqual([true]);
    expect(failures).toBe(1);
  } finally {
    remove();
    stream.destroy();
  }
});
it.each(["runtime", "spawn"])(
  "a synchronous %s failure produces fixed interruption and frees admission",
  async (mode) => {
    if (mode === "runtime")
      vi.mocked(existsSync).mockImplementation(() => {
        throw new Error("PRIVATE");
      });
    else
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error("PRIVATE");
      });
    const value = runner();
    await expect(
      value.attempt(
        async (runChild, signal) => ({ result: await runChild(null, signal) }),
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      result: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
    });
    await expect(value.attempt(async () => "next", new AbortController().signal)).resolves.toBe(
      "next",
    );
  },
);
it("a synchronous caller throw retains its refusal and releases admission", async () => {
  const value = runner();
  const refusal = new Error("caller refusal");
  await expect(
    value.attempt(() => {
      throw refusal;
    }, new AbortController().signal),
  ).rejects.toBe(refusal);
  await expect(value.attempt(async () => "next", new AbortController().signal)).resolves.toBe(
    "next",
  );
});

it.each(["record", "keys", "write", "spawn-event", "late-frame"])(
  "%s cannot publish unvalidated evidence or hold admission after child exit",
  async (mode) => {
    let writes = 0;
    const channel = new Duplex({
      read() {},
      write(_data, _encoding, callback) {
        writes++;
        callback(mode === "write" && writes === 1 ? new Error("PRIVATE") : undefined);
      },
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 123456,
      stdio: [null, null, null, channel],
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit("exit", null));
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
    const value = runner();
    const pending = value.attempt(
      async (runChild, signal) => ({ result: await runChild(null, signal) }),
      new AbortController().signal,
    );
    if (mode === "record") channel.push("null\n");
    if (mode === "keys") channel.push('{"type":"result","value":{},"private":"PRIVATE"}\n');
    if (mode === "spawn-event") child.emit("error", new Error("PRIVATE"));
    if (mode === "late-frame") {
      channel.push('{"type":"result","value":{"selected":true}}\n');
      channel.push('{"type":"progress","value":"PRIVATE LATE"}\n');
    }
    await expect(pending).resolves.toEqual({
      result: { outcome: "interrupted", reason: "unavailable", lastProgress: null },
    });
    expect(channel.destroyed).toBe(true);
    expect(child.listenerCount("error")).toBe(0);
    await expect(value.attempt(async () => "next", new AbortController().signal)).resolves.toBe(
      "next",
    );
  },
);

it("shutdown retains a recorded non-exiting child through supervision and targets only that child", async () => {
  const channel = new Duplex({
    read() {},
    write(_data, _encoding, callback) {
      callback();
    },
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 123456,
    stdio: [null, null, null, channel],
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  const value = runner();
  const pending = value.attempt(
    async (runChild, signal) => ({ result: await runChild(null, signal) }),
    new AbortController().signal,
  );
  const refused = expect(pending).rejects.toMatchObject({
    code: "fiscal.certificate_diagnosis_unavailable",
  });
  await value.stop();
  await refused;
  expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"], ["SIGKILL"]]);
  child.emit("exit", null);
  expect(channel.destroyed).toBe(true);
});
it("a late caller rejection cannot clear a newer attempt", async () => {
  const value = runner();
  const abort = new AbortController();
  let reject!: (error: unknown) => void;
  const pending = value.attempt(
    () =>
      new Promise((_yes, no) => {
        reject = no;
      }),
    abort.signal,
  );
  const refused = expect(pending).rejects.toMatchObject({
    code: "fiscal.certificate_diagnosis_unavailable",
  });
  abort.abort();
  await refused;
  let finish!: (value: string) => void;
  const next = value.attempt(
    () =>
      new Promise((yes) => {
        finish = yes;
      }),
    new AbortController().signal,
  );
  reject(new Error("PRIVATE LATE"));
  await new Promise<void>((done) => setImmediate(done));
  await expect(
    value.attempt(async () => "wrong", new AbortController().signal),
  ).rejects.toMatchObject({ code: "fiscal.certificate_diagnosis_busy" });
  finish("next");
  await expect(next).resolves.toBe("next");
});
