import { describe, expect, it, vi } from "vitest";
import { startServer, type StartedServer } from "../boot.js";
import { closeBoxes, TestBox } from "./spare-join-scenario.js";

vi.mock("../boot.js", () => ({ startServer: vi.fn() }));
vi.mock("../box-env.js", () => ({ loadBoxEnv: vi.fn(async () => ({})) }));

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fakeServer(close: () => Promise<void> = async () => {}): StartedServer & {
  close: ReturnType<typeof vi.fn>;
} {
  return { close: vi.fn(close) } as unknown as StartedServer & { close: ReturnType<typeof vi.fn> };
}

function testBox(port: number): TestBox {
  return new TestBox(
    { root: "/nowhere", state: "/nowhere/state", venue: "/nowhere/venue" },
    port,
    {},
    {},
  );
}

async function turns(count = 10): Promise<void> {
  for (let i = 0; i < count; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("the two-box harness's close", () => {
  it("waits for a start still running, then closes the server that start returns", async () => {
    const booting = deferred<StartedServer>();
    vi.mocked(startServer).mockReturnValueOnce(booting.promise);
    const box = testBox(1);
    const starting = box.start();
    const startResult = starting.then(
      () => "started",
      (error: unknown) => (error as Error).constructor.name,
    );
    let closed = false;
    const closing = box.close().then((failures) => {
      closed = true;
      return failures;
    });
    await turns();
    expect(closed).toBe(false);

    const server = fakeServer();
    booting.resolve(server);
    expect(await closing).toEqual([]);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(await startResult).toBe("ClosedWhileStarting");
  });

  it("reports a late server's close failure", async () => {
    const booting = deferred<StartedServer>();
    vi.mocked(startServer).mockReturnValueOnce(booting.promise);
    const box = testBox(1);
    void box.start().catch(() => {});
    const closing = box.close();
    const refusal = new Error("close refused");
    booting.resolve(
      fakeServer(async () => {
        throw refusal;
      }),
    );
    expect(await closing).toEqual([refusal]);
  });

  it("asks every box to close at once, so one stalled close does not keep another open", async () => {
    const stalled = deferred<void>();
    const first = fakeServer(() => stalled.promise);
    const second = fakeServer();
    vi.mocked(startServer).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const boxes = [testBox(1), testBox(2)];
    for (const box of boxes) await box.start();

    const closing = closeBoxes(boxes);
    await turns();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(boxes).toEqual([]);
    stalled.resolve();
    expect(await closing).toEqual([]);
  });

  it("returns every box's close failure", async () => {
    const one = new Error("first refused");
    const two = new Error("second refused");
    vi.mocked(startServer)
      .mockResolvedValueOnce(
        fakeServer(async () => {
          throw one;
        }),
      )
      .mockResolvedValueOnce(
        fakeServer(async () => {
          throw two;
        }),
      );
    const boxes = [testBox(1), testBox(2)];
    for (const box of boxes) await box.start();
    expect(await closeBoxes(boxes)).toEqual([one, two]);
  });
});
