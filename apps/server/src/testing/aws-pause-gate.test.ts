import {
  allowOwnedBucket,
  awaitDeniedPauseCheck,
  ownedBucketHosts,
  watchHeldConnect,
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
      elapsedMs: 2 * 250,
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
      awaitDeniedPauseCheck({ streamEvents, timeoutMs: 1_000, record, ...clock }),
    ).rejects.toThrow(/no refused pause check was logged within 1000 ms/);
    expect(record).toHaveBeenCalledWith({
      phase: "pause-check-denied",
      api: "ListObjectsV2",
      elapsedMs: 1_000,
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

describe("watchHeldConnect", () => {
  const entry = (sequence: number, held: boolean): SeenConnect => ({
    sequence,
    target: `${BUCKET}.s3.${REGION}.amazonaws.com:443`,
    held,
  });

  it("resolves with the first held CONNECT after the given sequence", async () => {
    const clock = fakeClock();
    const seen: SeenConnect[] = [entry(1, false), entry(2, true)];
    let polls = 0;
    const gate = {
      seen: () => {
        polls += 1;
        if (polls === 3) seen.push(entry(3, false), entry(4, true));
        return seen;
      },
    };
    await expect(watchHeldConnect(gate, 2, { timeoutMs: 10_000, ...clock })).resolves.toEqual({
      sequence: 4,
      elapsedMs: 2 * 250,
    });
  });

  it("rejects when no held CONNECT arrives after the sequence in time", async () => {
    const clock = fakeClock();
    const gate = { seen: () => [entry(1, true), entry(2, false)] };
    await expect(watchHeldConnect(gate, 1, { timeoutMs: 1_000, ...clock })).rejects.toThrow(
      /no CONNECT arrived at the gate while it held after sequence 1 within 1000 ms/,
    );
  });
});
