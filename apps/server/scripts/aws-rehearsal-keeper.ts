// The keeper's process. The rehearsal runner starts it through `--launch`
// (`startKeeper`, src/testing/aws-rehearsal-keeper-start.ts); a person never runs it.
//
// Usage: node --import <tsx loader> scripts/aws-rehearsal-keeper.ts [--launch] --journal <path>
//   --launch  starts the keeper in a session of its own, its stdin this process's, and exits, so the
//             keeper is outside the runner's process tree and group and a Ctrl-C to the run's
//             process group does not reach it.
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  journalFileName,
  readJournal,
  writeJournal,
} from "../src/testing/aws-rehearsal-journal.js";
import { runKeeper, terminalPrinter } from "../src/testing/aws-rehearsal-keeper.js";

const USAGE =
  "usage: node --import <tsx loader> scripts/aws-rehearsal-keeper.ts [--launch] --journal <path>";

export function parseKeeperArgs(
  argv: readonly string[],
): { launch: boolean; journal: string } | null {
  const launch = argv[0] === "--launch";
  const rest = launch ? argv.slice(1) : argv;
  if (rest.length !== 2 || rest[0] !== "--journal" || rest[1] === "") return null;
  return { launch, journal: rest[1]! };
}

/** Settles on end-of-file on stdin, whose writing end only the runner holds. */
function stdinEnded(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.once("end", () => resolve());
    process.stdin.once("close", () => resolve());
    process.stdin.once("error", () => resolve());
    process.stdin.resume();
  });
}

/** Writes the keeper's pid and readiness into the journal; the runner creates nothing before it. */
function markReady(journalPath: string): void {
  const journal = readJournal(readFileSync(journalPath, "utf8"), { tmpdir: tmpdir() });
  if (basename(journalPath) !== journalFileName(journal.runId)) return;
  writeJournal(dirname(journalPath), { ...journal, keeperPid: process.pid, ready: true });
}

async function keep(journalPath: string): Promise<number> {
  // A closing terminal does not stop it; a SIGTERM sent to it directly does.
  process.on("SIGHUP", () => {});
  process.on("SIGTERM", () => process.exit(143));
  const ended = stdinEnded();
  try {
    markReady(journalPath);
  } catch {
    // Not ready: the runner refuses to create a bucket, and runKeeper says why the journal is refused.
  }
  return runKeeper(journalPath, {
    waitForRunnerEnd: () => ended,
    print: terminalPrinter(process.stdout),
  });
}

function launch(journalPath: string): void {
  const child = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), "--journal", journalPath],
    { detached: true, stdio: "inherit", env: process.env },
  );
  child.unref();
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const args = parseKeeperArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exit(2);
  }
  if (args.launch) {
    launch(args.journal);
    process.exit(0);
  }
  // runKeeper's ceiling timer would hold the process open after it returns.
  process.exit(await keep(args.journal));
}
