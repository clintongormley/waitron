import {
  allowOwnedBucket,
  awaitDeniedPauseCheck,
  ownedBucketHosts,
  gateRefusedEvents,
  restartWatch,
} from "./aws-pause-gate.js";
import type { SeenConnect } from "./transport-gate.js";

const BUCKET = "waitron-rehearsal-waitron-aaaaaaaaaaaa";
const REGION = "eu-north-1";

describe("allowOwnedBucket", () => {
  const allow = allowOwnedBucket(BUCKET, REGION);

  it("names only the owned bucket's virtual-hosted name in the region", () => {
    expect(ownedBucketHosts(BUCKET, REGION)).toEqual([`${BUCKET}.s3.${REGION}.amazonaws.com`]);
  });

  it("admits the owned bucket's host on 443", () => {
    expect(allow(`${BUCKET}.s3.${REGION}.amazonaws.com`, 443)).toBe(true);
    expect(allow(`${BUCKET}.S3.EU-NORTH-1.amazonaws.com`, 443)).toBe(true);
  });

  it.each([
    [`${BUCKET}.s3.${REGION}.amazonaws.com`, 80],
    [`${BUCKET}.s3.${REGION}.amazonaws.com`, 8443],
    [`s3.${REGION}.amazonaws.com`, 443],
    ["s3.amazonaws.com", 443],
    [`${BUCKET}.s3.amazonaws.com`, 443],
    [`${BUCKET}.s3.eu-west-1.amazonaws.com`, 443],
    [`other-bucket.s3.${REGION}.amazonaws.com`, 443],
    [`x${BUCKET}.s3.${REGION}.amazonaws.com`, 443],
    [`${BUCKET}.s3.${REGION}.amazonaws.com.evil.example`, 443],
    [`${BUCKET}.s3-accelerate.amazonaws.com`, 443],
    [`${BUCKET}.s3.dualstack.${REGION}.amazonaws.com`, 443],
    [`sts.${REGION}.amazonaws.com`, 443],
    ["169.254.169.254", 80],
    ["127.0.0.1", 443],
  ])("refuses %s:%i", (host, port) => {
    expect(allow(host, port)).toBe(false);
  });
});

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe("awaitDeniedPauseCheck", () => {
  it("records the logged 403 refusal, taken from the event", async () => {
    const clock = fakeClock();
    const answers = [
      [{ event: "stream.paused" }],
      [{ event: "stream.paused" }],
      [
        { event: "stream.paused" },
        {
          event: "stream.pause_check_failed",
          errorCode: "backup.stream_request_failed",
          status: 403,
          errorName: "AccessDenied",
        },
      ],
    ];
    const record = vi.fn();
    await awaitDeniedPauseCheck({
      streamEvents: async () => answers.shift() ?? [],
      timeoutMs: 60_000,
      record,
      ...clock,
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      phase: "pause-check-denied",
      api: "ListObjectsV2",
      httpStatus: 403,
      errorName: "AccessDenied",
      elapsedMs: 2_000,
      outcome: "ok",
    });
  });

  it("fails at once on a refusal that is not AccessDenied's 403, recording what was logged", async () => {
    const clock = fakeClock();
    const record = vi.fn();
    const streamEvents = vi.fn(async () => [
      {
        event: "stream.pause_check_failed",
        errorCode: "backup.stream_request_failed",
        status: 500,
        errorName: "InternalError",
      },
    ]);
    await expect(
      awaitDeniedPauseCheck({ streamEvents, timeoutMs: 60_000, record, ...clock }),
    ).rejects.toThrow(/status 500, InternalError/);
    expect(streamEvents).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      phase: "pause-check-denied",
      api: "ListObjectsV2",
      httpStatus: 500,
      errorName: "InternalError",
      elapsedMs: 0,
      outcome: "failed",
    });
  });

  it("fails on a 403 not named AccessDenied", async () => {
    const record = vi.fn();
    await expect(
      awaitDeniedPauseCheck({
        streamEvents: async () => [
          { event: "stream.pause_check_failed", status: 403, errorName: "SignatureDoesNotMatch" },
        ],
        timeoutMs: 60_000,
        record,
        ...fakeClock(),
      }),
    ).rejects.toThrow(/status 403, SignatureDoesNotMatch/);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  });

  it("fails on a refusal with no status, such as the read deadline's timeout", async () => {
    const clock = fakeClock();
    const record = vi.fn();
    await expect(
      awaitDeniedPauseCheck({
        streamEvents: async () => [{ event: "stream.pause_check_failed", errorCode: "timeout" }],
        timeoutMs: 60_000,
        record,
        ...clock,
      }),
    ).rejects.toThrow(/timeout/);
    expect(record).toHaveBeenCalledWith({
      phase: "pause-check-denied",
      api: "ListObjectsV2",
      elapsedMs: 0,
      outcome: "failed",
    });
  });

  it("records failed and throws when no refusal is logged within the budget", async () => {
    const clock = fakeClock();
    const record = vi.fn();
    const streamEvents = vi.fn(async () => [{ event: "stream.paused" }]);
    await expect(
      awaitDeniedPauseCheck({ streamEvents, timeoutMs: 4_000, record, ...clock }),
    ).rejects.toThrow(/no refused pause check was logged within 4000 ms/);
    expect(record).toHaveBeenCalledWith({
      phase: "pause-check-denied",
      api: "ListObjectsV2",
      elapsedMs: 4_000,
      outcome: "failed",
    });
    expect(streamEvents).toHaveBeenCalledTimes(5);
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    const streamEvents = vi.fn(async () => {
      controller.abort(new Error("stopped from outside"));
      return [];
    });
    await expect(
      awaitDeniedPauseCheck({
        streamEvents,
        timeoutMs: 60_000,
        record: vi.fn(),
        signal: controller.signal,
        ...clock,
      }),
    ).rejects.toThrow("stopped from outside");
    expect(streamEvents).toHaveBeenCalledTimes(1);
  });
});

describe("restartWatch", () => {
  const entry = (sequence: number, held: boolean): SeenConnect => ({
    sequence,
    target: `${BUCKET}.s3.${REGION}.amazonaws.com:443`,
    held,
  });

  /**
   * A gate whose record changes at the fake clock's times: each `[atMs, change]` runs once, at the
   * first read of the record at or after `atMs`.
   */
  function timelineGate(
    clock: { now(): number },
    initial: SeenConnect[],
    timeline: [number, (seen: SeenConnect[]) => void][],
    refused: string[] = [],
  ) {
    const seen = [...initial];
    const pending = [...timeline];
    return {
      seen: () => {
        while (pending.length > 0 && pending[0]![0] <= clock.now()) pending.shift()![1](seen);
        return seen;
      },
      refused: () => refused,
    };
  }

  it("ignores a CONNECT the old Litestream opens before the replacement starts", async () => {
    const clock = fakeClock();
    let watch: ReturnType<typeof restartWatch> | undefined = undefined;
    const gate = timelineGate(
      clock,
      [entry(1, false), entry(2, true)],
      [
        // Just after the watch starts, the Litestream being killed opens one more.
        [100, (seen) => seen.push(entry(3, true))],
        // The supervisor starts the replacement about a second later; it connects after that.
        [1_000, () => watch?.childStarted()],
        [1_500, (seen) => seen.push(entry(4, true))],
      ],
    );
    watch = restartWatch(gate);
    await expect(watch.watch({ timeoutMs: 10_000, ...clock })).resolves.toEqual({
      elapsedMs: 1_500,
    });
  });

  it("counts only a held CONNECT after the replacement started", async () => {
    const clock = fakeClock();
    let watch: ReturnType<typeof restartWatch> | undefined = undefined;
    const gate = timelineGate(
      clock,
      [entry(1, true)],
      [
        [250, () => watch?.childStarted()],
        [500, (seen) => seen.push(entry(2, false))],
        [750, (seen) => seen.push(entry(3, true))],
      ],
    );
    watch = restartWatch(gate);
    await expect(watch.watch({ timeoutMs: 10_000, ...clock })).resolves.toEqual({
      elapsedMs: 750,
    });
  });

  it("fails naming that no replacement started when none did", async () => {
    const clock = fakeClock();
    const gate = timelineGate(
      clock,
      [entry(1, true)],
      [[250, (seen) => seen.push(entry(2, true))]],
    );
    await expect(restartWatch(gate).watch({ timeoutMs: 1_000, ...clock })).rejects.toThrow(
      /^no new Litestream started within 1000 ms of the watch's start$/,
    );
  });

  it("fails naming the missing CONNECT when the replacement started but never reached the gate", async () => {
    const clock = fakeClock();
    let watch: ReturnType<typeof restartWatch> | undefined = undefined;
    const gate = timelineGate(clock, [entry(1, true)], [[250, () => watch?.childStarted()]]);
    watch = restartWatch(gate);
    await expect(watch.watch({ timeoutMs: 1_000, ...clock })).rejects.toThrow(
      /^a new Litestream started, but no CONNECT reached the held gate after it within 1000 ms of the watch's start$/,
    );
  });

  it("names the hosts the gate refused when the watch fails", async () => {
    const clock = fakeClock();
    let watch: ReturnType<typeof restartWatch> | undefined = undefined;
    const gate = timelineGate(
      clock,
      [],
      [[250, () => watch?.childStarted()]],
      [`s3.${REGION}.amazonaws.com:443`, "sts.amazonaws.com:443"],
    );
    watch = restartWatch(gate);
    await expect(watch.watch({ timeoutMs: 1_000, ...clock })).rejects.toThrow(
      `within 1000 ms of the watch's start; the gate refused a CONNECT to s3.${REGION}.amazonaws.com:443, sts.amazonaws.com:443`,
    );
  });

  it("stops when the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped from outside"));
    const clock = fakeClock();
    const gate = timelineGate(clock, [], []);
    await expect(
      restartWatch(gate).watch({ timeoutMs: 1_000, signal: controller.signal, ...clock }),
    ).rejects.toThrow("stopped from outside");
  });
});

describe("gateRefusedEvents", () => {
  it("records one event per gate, failed where the gate refused a host", () => {
    expect(
      gateRefusedEvents([
        ["server", { refused: () => [] }],
        ["litestream", { refused: () => ["s3.eu-north-1.amazonaws.com:443", "x:443"] }],
      ]),
    ).toEqual([
      { phase: "gate-refused", objectRole: "server", count: 0, outcome: "ok" },
      { phase: "gate-refused", objectRole: "litestream", count: 2, outcome: "failed" },
    ]);
  });

  it("records nothing when no gate was started", () => {
    expect(gateRefusedEvents([])).toEqual([]);
  });
});
