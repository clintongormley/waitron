// Measurement 3 (slice-2 spec §8.1 item 3): which restore points survive the history window.
//
// Slice 2 ships L1 30s, L2 5m, L3 1h, one full copy a day, 168 hours kept (spec §4.4). A week cannot
// be run, so this runs a COMPRESSED schedule that keeps the ORDER of every interval but not their
// ratios, for three and a half windows, and reports which kind of file survives which boundary. The
// step from here to "hours" is an extrapolation and is labelled as one where it is recorded.
//
// Every level file ever seen is remembered (the listing is sampled every five seconds), so the probe
// can ask for a boundary whose file has since been merged away — the case that decides granularity.
//
// There is no pass/fail: it is a measurement. What would make it VOID, printed in advance:
// `snapshot-interval-applied=false` (fewer full copies than the schedule implies — the `snapshot:`
// block was ignored), `unmatched-keys>0` (the store layout is not the recorded `<level>/<min>-<max>.ltx`),
// `beyond-refused=false` (a restore past the newest transaction succeeded, so a refusal cannot be
// read as a missing point), or `latest-rows` differing from `sales` (the newest point is wrong).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LITESTREAM_VERSION, replicate, resolveLitestream, writeConfig } from "../litestream.ts";
import { openNode, recordSale } from "../model.ts";
import { startStore } from "../store.ts";
import type { Store } from "../store.ts";
import { listObjects, report, restoredRows, sleep, waitForAttach } from "./common.ts";
import type { StoredObject } from "./common.ts";

const PROBE = "m3-restore-points";
const PREFIX = "venues/v1/gen-1-box-a-20260923T000000Z";
/** Seconds. Production (spec §4.4): L1 30, L2 300, L3 3600, full copy 86400, kept 604800. */
const SCHEDULE = { l1: 2, l2: 10, l3: 30, snapshot: 60, retention: 180, l0Retention: 2 };
const GLOBAL_LINES = [
  `snapshot:`,
  `  interval: ${SCHEDULE.snapshot}s`,
  `  retention: ${SCHEDULE.retention}s`,
  `levels:`,
  `  - interval: ${SCHEDULE.l1}s`,
  `  - interval: ${SCHEDULE.l2}s`,
  `  - interval: ${SCHEDULE.l3}s`,
  `l0-retention: ${SCHEDULE.l0Retention}s`,
  `l0-retention-check-interval: 1s`,
];
const RUN_MS = 3.5 * SCHEDULE.retention * 1000;
const SALE_EVERY_MS = 250;
const SAMPLE_EVERY_MS = 5_000;
/** Candidates tried per level, spread evenly by age, so the run's restores stay bounded. */
const PER_LEVEL = 4;
/** The key shape the README's S3 section recorded on the pin: `<prefix>/0000/<min>-<max>.ltx`. */
const LTX = /\/(\d{4})\/([0-9a-f]{16})-([0-9a-f]{16})\.ltx$/;

type LevelFile = { key: string; level: number; maxTxid: string; createdAt: number };

function parse(object: StoredObject): LevelFile | null {
  const match = LTX.exec(object.key);
  if (match === null) return null;
  return {
    key: object.key,
    level: Number(match[1]),
    maxTxid: match[3]!,
    createdAt: object.lastModified.getTime(),
  };
}

function evenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from(
    { length: count },
    (_unused, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]!,
  );
}

async function main(): Promise<void> {
  const litestream = await resolveLitestream();
  if (!litestream) {
    report(PROBE, "NOT-RUN", {
      reason: `litestream ${LITESTREAM_VERSION} not found; run setup:litestream`,
    });
    process.exitCode = 1;
    return;
  }
  const bin = litestream.bin;
  const help = spawnSync(bin, ["restore", "-h"], { encoding: "utf8" });
  const txidSupported = `${help.stdout}${help.stderr}`.includes("-txid");

  const store: Store = await startStore();
  const dir = mkdtempSync(join(tmpdir(), "waitron-m3-"));
  try {
    const dbPath = join(dir, "venue.db");
    const node = openNode("box-a", dbPath);
    const config = writeConfig({
      dbPath,
      store,
      prefix: PREFIX,
      configPath: join(dir, "m3.yml"),
      globalLines: GLOBAL_LINES,
    });
    const seen = new Map<string, LevelFile>();
    let unmatched = 0;
    let firstUnmatched = "none";
    let sales = 0;
    const daemon = replicate(bin, config);
    try {
      await waitForAttach(dbPath);
      const started = Date.now();
      let nextSample = started;
      while (Date.now() - started < RUN_MS) {
        recordSale(node, 1000 + (sales % 997));
        sales += 1;
        if (Date.now() >= nextSample) {
          nextSample += SAMPLE_EVERY_MS;
          const counts = new Map<number, number>();
          for (const object of await listObjects(store, `${PREFIX}/`)) {
            if (object.key.endsWith("/opened.json")) continue;
            const file = parse(object);
            if (file === null) {
              unmatched += 1;
              if (firstUnmatched === "none") firstUnmatched = object.key;
              continue;
            }
            if (!seen.has(file.key)) seen.set(file.key, file);
            counts.set(file.level, (counts.get(file.level) ?? 0) + 1);
          }
          const t = Math.round((Date.now() - started) / 1000);
          console.log(
            `t=${t}s ${[...counts]
              .sort(([a], [b]) => a - b)
              .map(([level, n]) => `L${level}=${n}`)
              .join(" ")}`,
          );
        }
        await sleep(SALE_EVERY_MS);
      }
    } finally {
      daemon.kill();
      await daemon.exited;
      node.close();
    }

    const now = Date.now();
    const surviving = new Set(
      (await listObjects(store, `${PREFIX}/`))
        .map((object) => parse(object)?.key)
        .filter((key): key is string => key !== undefined),
    );
    const all = [...seen.values()].sort((a, b) => a.createdAt - b.createdAt);
    const ageS = (file: LevelFile) => Math.round((now - file.createdAt) / 1000);
    const snapshotsSeen = all.filter((file) => file.level === 9).length;
    const snapshotIntervalApplied =
      snapshotsSeen >= Math.floor(RUN_MS / 1000 / SCHEDULE.snapshot) - 1;
    const survivingSnapshots = all.filter((file) => file.level === 9 && surviving.has(file.key));
    const oldestSnapshotAge = survivingSnapshots.length === 0 ? null : ageS(survivingSnapshots[0]!);

    const detail: Record<string, string | number | boolean | null> = {
      version: litestream.version,
      schedule: JSON.stringify(SCHEDULE),
      "run-s": RUN_MS / 1000,
      sales,
      "txid-flag-on-pin": txidSupported,
      "unmatched-keys": unmatched,
      "first-unmatched": firstUnmatched,
      "l9-files-seen": snapshotsSeen,
      "snapshot-interval-applied": snapshotIntervalApplied,
      "oldest-surviving-l9-age-s": oldestSnapshotAge,
      "retention-applied":
        oldestSnapshotAge !== null &&
        oldestSnapshotAge <= SCHEDULE.retention + SCHEDULE.snapshot + 30,
    };
    for (const level of [0, 1, 2, 3]) {
      const alive = all.filter((file) => file.level === level && surviving.has(file.key));
      detail[`L${level}-seen`] = all.filter((file) => file.level === level).length;
      detail[`L${level}-surviving`] = alive.length;
      detail[`L${level}-oldest-surviving-age-s`] = alive.length === 0 ? null : ageS(alive[0]!);
    }

    let restores = 0;
    const out = () => join(dir, `r-${(restores += 1)}.db`);
    const latest = await restoredRows(bin, config, dbPath, out());
    detail["latest-rows"] = latest === "no-backup" ? 0 : latest.length;
    let beyondRefused: boolean | null = null;
    if (txidSupported) {
      const maxTxid = all.reduce((max, file) => (file.maxTxid > max ? file.maxTxid : max), "0");
      const beyond = (BigInt(`0x${maxTxid}`) + 16n).toString(16).padStart(16, "0");
      beyondRefused =
        (await restoredRows(bin, config, dbPath, out(), ["-txid", beyond])) === "no-backup";
      for (const level of [1, 2, 3, 9]) {
        for (const [label, files] of [
          ["surviving", all.filter((file) => file.level === level && surviving.has(file.key))],
          ["gone", all.filter((file) => file.level === level && !surviving.has(file.key))],
        ] as const) {
          const tried = evenly(files, PER_LEVEL);
          const results: string[] = [];
          for (const file of tried) {
            const rows = await restoredRows(bin, config, dbPath, out(), ["-txid", file.maxTxid]);
            results.push(
              `${ageS(file)}s:${rows === "no-backup" ? "refused" : `rows${rows.length}`}`,
            );
          }
          detail[`L${level}-${label}-boundaries`] =
            results.length === 0 ? "none" : results.join(",");
        }
      }
    }
    detail["beyond-refused"] = beyondRefused;

    const voided =
      !snapshotIntervalApplied ||
      unmatched > 0 ||
      beyondRefused === false ||
      detail["latest-rows"] !== sales;
    report(PROBE, voided ? "VOID" : "MEASURED", detail);
  } finally {
    try {
      await store.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

await main().catch((error: unknown) => {
  report(PROBE, "VOID", { reason: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
