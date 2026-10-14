// The stream's pause at the side-file limit against Amazon S3, in a bucket the rehearsal creates and
// then tries to remove. Runs only under `test:aws-rehearsal` with WAITRON_RUN_AWS_REHEARSAL=1; the
// runbook is docs/developers/aws-backup-rehearsal.md. The bucket cannot be frozen, so the
// rehearsal's clients reach it through local gates that hold their calls; while the stream is
// paused a bucket rule refuses the supervisor's pause check, and the gate then lets that check go.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createS3ObjectStore } from "@waitron/stream";
import {
  allowOwnedBucket,
  awaitDeniedPauseCheck,
  watchHeldConnect,
} from "./testing/aws-pause-gate.js";
import { withListingDenied } from "./testing/aws-listing-denial.js";
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { resolveLitestream } from "./testing/s3-test-server.js";
import {
  runStreamPauseScenario,
  STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS,
  STREAM_PAUSE_AWS_HELD_CHECK_WAIT_MS,
  STREAM_PAUSE_AWS_RESUME_WAIT_MS,
} from "./testing/stream-pause-scenario.js";
import {
  gatedRequestHandler,
  gatedSpawn,
  startTransportGate,
  type TransportGate,
} from "./testing/transport-gate.js";

// The supervisor logs a refused pause check once per pause (`stream.pause_check_failed`,
// packages/stream/src/supervisor.ts), so its held listing must not give up before the bucket rule
// refuses it. It is held from the pause through the paused sales, the wait for it at the gate
// (5 s at most), the rule's put and its negative control (60 s at most), so 120 s of inactivity
// exceeds the expected hold; a held request has been measured to be given up later than the
// setting, never earlier (transport-gate.ts). Should the hold pass the supervisor's 5-minute
// READ_DEADLINE_MS, it logs a timeout without using that once-only slot.
const SOCKET_TIMEOUT_MS = 120_000;

/** Slice 8a saw Litestream's first CONNECT one second after it started. */
const RESTART_CONNECT_WAIT_MS = 60_000;

describe("AWS rehearsal: the stream pause against Amazon S3", () => {
  const rehearsal = rehearsalLifecycle();
  let scratch: string | undefined;

  // A test that hit its time limit is still running: stop it and wait for its teardown and receipt
  // before its working folder goes.
  afterAll(async () => {
    try {
      await rehearsal?.stop();
    } finally {
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });

  it("a paused stream's held bucket check is refused by a bucket rule, and streaming resumes once it goes", async () => {
    const litestream = await resolveLitestream(process.env);
    if (!litestream.ok) {
      throw new Error(
        `the AWS stream pause rehearsal cannot run: ${litestream.reason}. Install with: node scripts/setup-litestream.mjs`,
      );
    }
    const folder = await mkdtemp(join(tmpdir(), "waitron-aws-stream-pause-"));
    scratch = folder;
    await rehearsal.run(async (ctx) => {
      const record = (event: object) => ctx.record({ scenario: "pause", ...event });
      const bucket = ctx.bucketConfig(ctx.prefix("pause"));
      const allow = allowOwnedBucket(ctx.bucket, ctx.region);
      const gates: TransportGate[] = [];
      try {
        // One gate per client, so a CONNECT a gate sees can only be its own client's.
        const serverGate = await startTransportGate({ allow });
        gates.push(serverGate);
        const scenarioGate = await startTransportGate({ allow });
        gates.push(scenarioGate);
        const litestreamGate = await startTransportGate({ allow });
        gates.push(litestreamGate);
        const scenarioStore = createS3ObjectStore(bucket, {
          requestHandler: gatedRequestHandler(scenarioGate, {
            socketTimeoutMs: SOCKET_TIMEOUT_MS,
          }),
        });
        // Without keep-alive every server call opens its own CONNECT, so a server call held at the
        // gate is always a held CONNECT; a reused tunnel would hold it without the gate counting it.
        const serverStore = createS3ObjectStore(bucket, {
          requestHandler: gatedRequestHandler(serverGate, {
            socketTimeoutMs: SOCKET_TIMEOUT_MS,
            keepAlive: false,
          }),
        });
        const spawned: number[] = [];

        // Started as step 7 kills Litestream: the one the supervisor starts in its place must reach
        // the held gate.
        let restartCheck:
          Promise<{ ok: true; elapsedMs: number } | { ok: false; error: unknown }> | undefined;
        const watchRestart = (): void => {
          const last = litestreamGate.seen().at(-1)?.sequence ?? 0;
          const spawnedBefore = spawned.length;
          restartCheck = watchHeldConnect(litestreamGate, last, {
            timeoutMs: RESTART_CONNECT_WAIT_MS,
            signal: ctx.signal,
          }).then(
            ({ elapsedMs }) => {
              if (spawned.length > spawnedBefore) return { ok: true as const, elapsedMs };
              return {
                ok: false as const,
                error: new Error(
                  "a CONNECT arrived at the held gate, but no new Litestream started",
                ),
              };
            },
            (error: unknown) => ({ ok: false as const, error }),
          );
        };

        await runStreamPauseScenario({
          bucket,
          scratch: folder,
          litestreamBin: litestream.bin,
          describeTransport: () => `Amazon S3, region ${ctx.region}, through a local gate`,
          signal: ctx.signal,
          record: (event) => {
            record(event);
            // The scenario records the freeze control as it starts step 7, just before the kill.
            if (event.phase === "freeze-control" && event.outcome === "ok") watchRestart();
          },
          freeze: {
            pause: async () => {
              for (const gate of gates) gate.hold();
            },
            resume: () => {
              for (const gate of gates) gate.release();
            },
          },
          store: scenarioStore,
          serverSeams: {
            store: serverStore,
            spawn: gatedSpawn(litestreamGate, (pid) => {
              spawned.push(pid);
              ctx.trackChild(pid);
            }),
          },
          resumeWaitMs: STREAM_PAUSE_AWS_RESUME_WAIT_MS,
          whilePaused: async (paused) => {
            const restart = await restartCheck;
            if (restart === undefined) throw new Error("step 7's restart was never watched");
            record({
              phase: "restart-through-gate",
              ...(restart.ok ? { elapsedMs: restart.elapsedMs } : {}),
              outcome: restart.ok ? "ok" : "failed",
            });
            if (!restart.ok) throw restart.error;

            // A held server call, not necessarily the pause check: TLS hides which call it is. The
            // logged 403 that follows the rule is what ties the refusal to the pause check.
            const events = await paused.streamEvents();
            const pausedAt = events.find((line) => line.event === "stream.paused")?.at;
            if (pausedAt === undefined) throw new Error("the server never logged stream.paused");
            const heldStarted = Date.now();
            const heldWait = await serverGate
              .waitForHeld(1, STREAM_PAUSE_AWS_HELD_CHECK_WAIT_MS)
              .then(
                () => undefined,
                (error: unknown) => error,
              );
            const held = serverGate.heldCount();
            record({
              phase: "pause-check-held",
              count: held,
              elapsedMs: Date.now() - heldStarted,
              outcome: heldWait === undefined ? "ok" : "failed",
            });
            if (heldWait !== undefined) throw heldWait;

            await withListingDenied(ctx, paused.pauseListingPrefix, async () => {
              serverGate.release();
              const heldMs = Date.now() - Date.parse(String(pausedAt));
              record({
                phase: "held-pause-check",
                ...(Number.isFinite(heldMs) && heldMs >= 0 ? { elapsedMs: heldMs } : {}),
                outcome: "ok",
              });
              await awaitDeniedPauseCheck({
                streamEvents: paused.streamEvents,
                timeoutMs: STREAM_PAUSE_AWS_DENIED_CHECK_WAIT_MS,
                record,
                signal: ctx.signal,
              });
            });
          },
        });

        const refused = gates.flatMap((gate) => gate.refused());
        record({
          phase: "gate-refused",
          count: refused.length,
          outcome: refused.length === 0 ? "ok" : "failed",
        });
        expect(refused, "a client asked the gate for a host outside the owned bucket").toEqual([]);
      } finally {
        await Promise.allSettled(gates.map((gate) => gate.close()));
      }
    });
  });
});
