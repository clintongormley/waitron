// The stream's pause at the side-file limit against Amazon S3, in a bucket the rehearsal creates and
// then tries to remove. Runs only under `test:aws-rehearsal` with WAITRON_RUN_AWS_REHEARSAL=1; the
// runbook is docs/developers/aws-backup-rehearsal.md. The bucket cannot be frozen, so the
// rehearsal's clients reach it through local gates that hold their calls; while the stream is
// paused a bucket rule refuses the supervisor's pause check, and the gate then lets that check go.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createS3ObjectStore, TICK_MS } from "@waitron/stream";
import {
  allowOwnedBucket,
  awaitDeniedPauseCheck,
  watchHeldConnect,
} from "./testing/aws-pause-gate.js";
import { withListingDenied } from "./testing/aws-listing-denial.js";
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { AWS_REHEARSAL_LIMITS } from "./testing/aws-rehearsal-limits.js";
import { resolveLitestream } from "./testing/s3-test-server.js";
import { runStreamPauseScenario } from "./testing/stream-pause-scenario.js";
import {
  gatedRequestHandler,
  gatedSpawn,
  startTransportGate,
  type TransportGate,
} from "./testing/transport-gate.js";

// The supervisor logs a refused pause check once per pause (`stream.pause_check_failed`,
// packages/stream/src/supervisor.ts), so its held listing must not give up before the bucket rule
// refuses it. It is held from the pause through the paused sales, the rule's put and its negative
// control (60 s at most), so 120 s of inactivity exceeds the expected hold; a held request has been
// measured to be given up later than the setting, never earlier (transport-gate.ts). Should the hold
// pass the supervisor's 5-minute READ_DEADLINE_MS, it logs a timeout without using that once-only slot.
const SOCKET_TIMEOUT_MS = 120_000;

// After a refused check the supervisor asks again only after TICK_MS, and the rule's removal may
// take up to the control budget to reach every AWS front end.
const RESUME_WAIT_MS = TICK_MS + AWS_REHEARSAL_LIMITS.denialControlMs + 30_000;

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
        // The stores share one gate and Litestream has its own, so a CONNECT the second one sees
        // can only be Litestream's.
        const storeGate = await startTransportGate({ allow });
        gates.push(storeGate);
        const litestreamGate = await startTransportGate({ allow });
        gates.push(litestreamGate);
        const gatedStore = () =>
          createS3ObjectStore(bucket, {
            requestHandler: gatedRequestHandler(storeGate, { socketTimeoutMs: SOCKET_TIMEOUT_MS }),
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
              storeGate.hold();
              litestreamGate.hold();
            },
            resume: () => {
              storeGate.release();
              litestreamGate.release();
            },
          },
          store: gatedStore(),
          serverSeams: {
            store: gatedStore(),
            spawn: gatedSpawn(litestreamGate, (pid) => {
              spawned.push(pid);
              ctx.trackChild(pid);
            }),
          },
          resumeWaitMs: RESUME_WAIT_MS,
          whilePaused: async (paused) => {
            const restart = await restartCheck;
            if (restart === undefined) throw new Error("step 7's restart was never watched");
            record({
              phase: "restart-through-gate",
              ...(restart.ok ? { elapsedMs: restart.elapsedMs } : {}),
              outcome: restart.ok ? "ok" : "failed",
            });
            if (!restart.ok) throw restart.error;

            // Weaker than it reads: the step-6 control's listing shares this gate and may still be
            // held, so this cannot single out the supervisor's.
            const held = storeGate.heldCount();
            record({
              phase: "pause-check-held",
              count: held,
              outcome: held >= 1 ? "ok" : "failed",
            });
            expect(held, "no bucket call is held at the gate while paused").toBeGreaterThanOrEqual(
              1,
            );

            const events = await paused.streamEvents();
            const pausedAt = events.find((line) => line.event === "stream.paused")?.at;
            await withListingDenied(ctx, paused.pauseListingPrefix, async () => {
              storeGate.release();
              const heldMs = Date.now() - Date.parse(String(pausedAt));
              record({
                phase: "held-pause-check",
                ...(Number.isFinite(heldMs) && heldMs >= 0 ? { elapsedMs: heldMs } : {}),
                outcome: "ok",
              });
              await awaitDeniedPauseCheck({
                streamEvents: paused.streamEvents,
                timeoutMs: AWS_REHEARSAL_LIMITS.denialControlMs,
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
