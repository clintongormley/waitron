// The keeper: run in its own process beside an Amazon S3 rehearsal, it cleans up after a run that
// was killed, from the journal the run left (design D8–D10).
import { appendFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GetObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { createBucketClient, nameOf } from "@waitron/stream";
import {
  type AdminClient,
  assertCleanupCommandFits,
  assertRehearsalOptIn,
  call,
  carriedRemaining,
  containedLog,
  loadRehearsalProfile,
  namesRun,
  type RehearsalProfile,
  receiptFailureCause,
  removeScratch,
  runScope,
  stopChildren,
  teardownOwnedBucket,
  unplannedFailure,
} from "./aws-rehearsal.js";
import {
  type AwsReceiptOwnership,
  type AwsReceiptRemaining,
  cleanupCommandFor,
  createReceiptLog,
  receiptFileName,
  type TeardownEntry,
  writeReceipt,
} from "./aws-rehearsal-receipt.js";
import { processStartTime, type RehearsalJournal, readJournal } from "./aws-rehearsal-journal.js";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";
import { AWS_REHEARSAL_NONCE_KEY, createRequestPlan } from "./aws-request-plan.js";
import { installSendGate, markRunnerClient, setSendGateStrict } from "./aws-send-gate.js";

/** How long a keeper waits, on a journal still `creating`, for a create that may yet land. */
export const KEEPER_GRACE_MS = 30_000;

// After stop-child, which the keeper runs in every state.
const BUCKET_STEPS = [
  "abort-upload",
  "remove-policy",
  "delete-objects",
  "delete-bucket",
] as const satisfies readonly TeardownEntry["step"][];

export interface KeeperDeps {
  env: Readonly<Record<string, string | undefined>>;
  readFile(path: string): Promise<string>;
  /** The folder the run's scratch root must sit in (design D8a). */
  tmpdir: string;
  /** Settles when the runner has ended: on its pipe's end-of-file in the keeper process. */
  waitForRunnerEnd(): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  createAdminClient(profile: RehearsalProfile, endpoint: string | undefined): AdminClient;
  /** The terminal, when the runner had one. */
  print(line: string): void;
  /** Every printed line and every note; `aws-rehearsal-<runId>-keeper.log` by default. */
  log(line: string): void;
  processStartTime(pid: number): string | null;
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  removeDir(path: string): Promise<void>;
  graceMs: number;
  childGraceMs?: number;
}

/** Beside the journal, which the runner writes in its receipt folder. */
export function keeperLogPath(journalPath: string): string {
  const name = basename(journalPath);
  return name.endsWith("-journal.json")
    ? join(dirname(journalPath), `${name.slice(0, -"-journal.json".length)}-keeper.log`)
    : `${journalPath}.keeper.log`;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultDeps(journalPath: string): Omit<KeeperDeps, "waitForRunnerEnd"> {
  const logPath = keeperLogPath(journalPath);
  return {
    env: process.env,
    readFile: (path) => readFile(path, "utf8"),
    tmpdir: tmpdir(),
    sleep: (ms) => delay(ms),
    now: Date.now,
    createAdminClient: (profile, endpoint) =>
      createBucketClient({
        region: profile.region,
        bucket: "",
        prefix: "",
        accessKeyId: profile.accessKeyId,
        secretAccessKey: profile.secretAccessKey,
        ...(endpoint === undefined ? {} : { endpoint }),
      }),
    print: (line) => process.stdout.write(`${line}\n`),
    log: (line) => appendFileSync(logPath, `${line}\n`, { mode: 0o600 }),
    processStartTime,
    isAlive: processAlive,
    kill: (pid, signal) => process.kill(pid, signal),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    graceMs: KEEPER_GRACE_MS,
  };
}

/** What a message may say about an error: a refusal's or failure's own words, else its name. */
function describe(error: unknown): string {
  if (error instanceof AwsRehearsalRefused) return error.message;
  if (error instanceof Error && error.name === "AwsRehearsalFailed") return error.message;
  return `the keeper stopped on ${nameOf(error)}`;
}

interface Lines {
  /** To the terminal and the log. */
  say(line: string): void;
  /** To the log alone. */
  note(line: string): void;
}

async function readJournalAt(
  path: string,
  deps: Pick<KeeperDeps, "readFile" | "tmpdir">,
): Promise<RehearsalJournal> {
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch {
    throw new AwsRehearsalRefused("journal-refused", "the journal could not be read");
  }
  return readJournal(text, { tmpdir: deps.tmpdir });
}

interface BucketOutcome {
  ownership: AwsReceiptOwnership;
  remaining: AwsReceiptRemaining;
  /** A bucket the keeper may not delete because nothing proves this run made it. */
  unknown: string | null;
}

const NOTHING: AwsReceiptRemaining = { bucket: null, uploadIds: [] };

/**
 * Runs the keeper for the journal at `journalPath` and returns its exit status: 0 when the run
 * finished or nothing was left, 1 otherwise. Never throws.
 */
export async function runKeeper(
  journalPath: string,
  overrides: Partial<KeeperDeps> & Pick<KeeperDeps, "waitForRunnerEnd">,
): Promise<number> {
  const deps: KeeperDeps = { ...defaultDeps(journalPath), ...overrides };
  const note = (line: string): void => {
    try {
      deps.log(line);
    } catch {
      // The terminal line, when there is one, still says it.
    }
  };
  const lines: Lines = {
    note,
    say(line) {
      try {
        deps.print(line);
      } catch {
        // The log still holds it.
      }
      note(line);
    },
  };
  const end = (status: number): number => {
    note(`exit ${status}`);
    return status;
  };
  try {
    const first = await readJournalAt(journalPath, deps);
    note(`waiting for run ${first.runId} to end`);
    const ended = await Promise.race([
      deps.waitForRunnerEnd().then(
        () => true,
        () => true,
      ),
      deps.sleep(first.keeperCeilingMs).then(() => false),
    ]);
    if (!ended) {
      const latest = await readJournalAt(journalPath, deps).catch(() => first);
      lines.say(
        `gave up waiting: the run did not end within ${first.keeperCeilingMs} ms; nothing done`,
      );
      const left = [
        ...journalLeft(latest),
        ...liveTracked(latest, deps).map((pid) => `process ${pid}`),
        ...(latest.scratchRoot === null ? [] : [`folder ${latest.scratchRoot}`]),
      ];
      if (left.length > 0) {
        lines.say("may be left:");
        for (const line of left) lines.say(line);
      }
      return end(1);
    }
    const journal = await readJournalAt(journalPath, deps);
    if (journal.state === "finished") {
      note("the run finished; nothing to do");
      return end(0);
    }
    note(`the run ended with its journal ${journal.state}; cleaning up`);
    return end(await act(journal, deps, lines));
  } catch (error) {
    lines.say(describe(error));
    return end(1);
  }
}

function sayLeft(lines: Lines, left: readonly string[]): void {
  if (left.length === 0) {
    lines.say("nothing left behind");
  } else {
    lines.say("left behind:");
    for (const line of left) lines.say(line);
  }
}

/** The bucket and uploads the journal says may still exist when the keeper sends nothing. */
function journalLeft(journal: RehearsalJournal): string[] {
  const { state, bucket } = journal;
  if (state !== "owned" && state !== "creating") return [];
  return [
    state === "owned" ? `bucket ${bucket}` : `bucket ${bucket} (ownership unknown)`,
    ...(state === "owned" ? journal.uploads.map(({ uploadId }) => `upload ${uploadId}`) : []),
  ];
}

function liveTracked(journal: RehearsalJournal, deps: KeeperDeps): number[] {
  return matchingPids(journal, deps, { say: () => {}, note: () => {} }).filter((pid) =>
    deps.isAlive(pid),
  );
}

/**
 * Stops the journal's tracked children whose start time still matches, in every state: the runner
 * writes `deleted` once its bucket is gone even when stopping a child failed. Sends no request.
 */
async function stopTracked(
  journal: RehearsalJournal,
  deps: KeeperDeps,
  lines: Lines,
): Promise<{ entry: TeardownEntry; left: number[] }> {
  const pids = matchingPids(journal, deps, lines);
  const entry = await stopChildren(
    pids,
    {
      isAlive: deps.isAlive,
      kill: deps.kill,
      sleep: deps.sleep,
      now: deps.now,
      teardownMs: journal.teardownMs,
      ...(deps.childGraceMs === undefined ? {} : { childGraceMs: deps.childGraceMs }),
    },
    AbortSignal.timeout(journal.teardownMs),
  );
  return { entry, left: entry.outcome === "failed" ? pids.filter((pid) => deps.isAlive(pid)) : [] };
}

async function removeJournalScratch(
  journal: RehearsalJournal,
  deps: KeeperDeps,
): Promise<{ entry: TeardownEntry | null; left: string | null }> {
  if (journal.scratchRoot === null) return { entry: null, left: null };
  const entry = await removeScratch(true, journal.scratchRoot, deps.removeDir, false);
  return { entry, left: entry.outcome === "failed" ? journal.scratchRoot : null };
}

async function act(journal: RehearsalJournal, deps: KeeperDeps, lines: Lines): Promise<number> {
  const { runId, region, bucket, receiptDir } = journal;
  let profile: RehearsalProfile;
  let log: ReturnType<typeof createReceiptLog>;
  try {
    assertRehearsalOptIn(deps.env);
    profile = await loadRehearsalProfile(deps.env, deps);
    if (profile.region !== region) {
      throw new AwsRehearsalRefused(
        "region-mismatch",
        "the journal's region must equal AWS_REGION",
      );
    }
    assertCleanupCommandFits(region, runId, receiptDir);
    log = createReceiptLog({ runId, region, ...journal.header }, profile, "interrupted");
  } catch (error) {
    // Nothing can be sent, but the scratch folder holding the run's secrets is still removed.
    lines.say(describe(error));
    const stopped = await stopTracked(journal, deps, lines);
    const scratch = await removeJournalScratch(journal, deps);
    sayLeft(lines, [
      ...journalLeft(journal),
      ...stopped.left.map((pid) => `process ${pid}`),
      ...(scratch.left === null ? [] : [`folder ${scratch.left}`]),
    ]);
    return 1;
  }
  const receiptPath = join(receiptDir, receiptFileName(runId, "interrupted"));
  const contained = containedLog(log);
  const { record } = contained;
  record({ scenario: "lifecycle", phase: "interrupted", outcome: "failed" });
  const stopped = await stopTracked(journal, deps, lines);
  contained.teardown(stopped.entry);

  installSendGate();
  setSendGateStrict(true);
  const client = deps.createAdminClient(profile, journal.endpoint);
  markRunnerClient(client);
  const requests = runScope(
    createRequestPlan({ bucket, apis: [], prefixes: () => new Set() }),
    record,
    lines.say,
  );
  try {
    const marker = (): Promise<{ error?: unknown; output?: GetObjectCommandOutput }> =>
      call<GetObjectCommandOutput>(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: AWS_REHEARSAL_NONCE_KEY }),
        "GetObject",
        "ownership",
        { now: deps.now, record },
        { objectRole: "ownership-nonce" },
        AbortSignal.timeout(journal.teardownMs),
      );
    const gone = (outcome: { error?: unknown }): boolean =>
      outcome.error !== undefined && nameOf(outcome.error) === "NoSuchBucket";
    const skipBucketSteps = (): void => {
      for (const step of BUCKET_STEPS) contained.teardown({ step, outcome: "skipped" });
    };

    const unknown: BucketOutcome = {
      ownership: { state: "unowned-candidate", bucket: null, candidate: bucket },
      remaining: NOTHING,
      unknown: bucket,
    };
    const outcome = await requests.scope.run(async (): Promise<BucketOutcome> => {
      const owned = { state: "owned", bucket } as const;
      switch (journal.state) {
        case "owned": {
          const read = await marker();
          if (gone(read)) {
            lines.note(`${bucket} is already gone`);
            skipBucketSteps();
            return { ownership: owned, remaining: NOTHING, unknown: null };
          }
          // No marker: a run killed between its create's answer and the marker's write.
          if (read.error === undefined || nameOf(read.error) !== "NoSuchKey") {
            let text: string | undefined;
            try {
              text = await read.output?.Body?.transformToString();
            } catch {
              text = undefined;
            }
            if (read.error !== undefined || text === undefined || !namesRun(text, runId)) {
              lines.note(`${bucket}'s ownership marker is unreadable or names another run`);
              return unknown;
            }
          }
          const teardown = await teardownOwnedBucket(
            client,
            { bucket, runId, uploads: journal.uploads, pids: [] },
            {
              isAlive: deps.isAlive,
              kill: deps.kill,
              sleep: deps.sleep,
              now: deps.now,
              teardownMs: journal.teardownMs,
              ...(deps.childGraceMs === undefined ? {} : { childGraceMs: deps.childGraceMs }),
              record,
            },
          );
          for (const entry of teardown.entries) {
            if (entry.step !== "stop-child") contained.teardown(entry);
          }
          const failed = (step: TeardownEntry["step"]): boolean =>
            teardown.entries.some((entry) => entry.step === step && entry.outcome === "failed");
          // teardownOwnedBucket names the bucket after any failed step; only a failed delete leaves it.
          return {
            ownership: owned,
            remaining: failed("delete-bucket") ? teardown.remaining : NOTHING,
            unknown: null,
          };
        }
        case "deleted":
          skipBucketSteps();
          return { ownership: owned, remaining: NOTHING, unknown: null };
        case "creating": {
          lines.note(`waiting ${deps.graceMs} ms for a create that may still land`);
          await deps.sleep(deps.graceMs);
          if (gone(await marker())) {
            return {
              ownership: { state: "not-created", bucket: null },
              remaining: NOTHING,
              unknown: null,
            };
          }
          return unknown;
        }
        default:
          return {
            ownership: {
              state: journal.state === "collision" ? "collision" : "not-created",
              bucket: null,
            },
            remaining: NOTHING,
            unknown: null,
          };
      }
    });

    const scratch = await removeJournalScratch(journal, deps);
    if (scratch.entry !== null) contained.teardown(scratch.entry);
    const folderLeft = scratch.left;

    const remaining = carriedRemaining(outcome.remaining, profile, contained);
    requests.finished();
    let receiptFailed = false;
    try {
      const receipt = log.finish({
        finishedAt: new Date(deps.now()).toISOString(),
        ownership: outcome.ownership,
        remaining,
        cleanupCommand: remaining.bucket === null ? null : cleanupCommandFor(region, receiptPath),
      });
      lines.say(await writeReceipt(receiptDir, receipt, profile, "interrupted"));
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "EEXIST") {
        lines.say(`${receiptPath} already exists; not overwritten`);
      } else {
        receiptFailed = true;
        lines.say(`interrupted receipt not written (${receiptFailureCause(error)})`);
      }
    }

    const left = [
      ...(remaining.bucket === null ? [] : [`bucket ${remaining.bucket}`]),
      ...(outcome.unknown === null ? [] : [`bucket ${outcome.unknown} (ownership unknown)`]),
      ...remaining.uploadIds.map((id) => `upload ${id}`),
      ...stopped.left.map((pid) => `process ${pid}`),
      ...(folderLeft === null ? [] : [`folder ${folderLeft}`]),
    ];
    sayLeft(lines, left);
    const unplanned = unplannedFailure(requests.close());
    if (unplanned !== undefined) lines.say(unplanned.message);
    return left.length > 0 || receiptFailed || unplanned !== undefined || contained.refused() > 0
      ? 1
      : 0;
  } finally {
    requests.close();
    client.destroy?.();
  }
}

/** A pid is signalled only while its start time still matches the one the journal recorded. */
function matchingPids(journal: RehearsalJournal, deps: KeeperDeps, lines: Lines): number[] {
  const pids: number[] = [];
  for (const { pid, startTime } of journal.pids) {
    if (startTime === null) {
      lines.note(`pid ${pid} has no recorded start time; not signalled`);
    } else if (deps.processStartTime(pid) !== startTime) {
      lines.note(`pid ${pid} is gone or is another process now; not signalled`);
    } else {
      pids.push(pid);
    }
  }
  return pids;
}
