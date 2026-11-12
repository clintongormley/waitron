import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { isMainScript } from "../is-main-script.mjs";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG = /^refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const USAGE =
  "usage: pnpm release prepare <version> --place <place>\n       pnpm release tag <version>\n";
// The push runs the pre-push hook, which typechecks; that can take minutes.
const COMMAND_TIMEOUT_MS = 20 * 60_000;
const SHOWN = { show: true };

export function parseVersion(text) {
  // 50: the most a record's `SistemaInformatico.Version` holds (`isReleaseVersion` in @waitron/shared).
  const match = text.length <= 50 ? VERSION.exec(text) : null;
  if (!match) throw new Error(`${JSON.stringify(text)} is not a version like 1.2.3`);
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const [left, right] = [parseVersion(a), parseVersion(b)];
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function releasedVersions(lsRemoteOutput) {
  return lsRemoteOutput
    .split("\n")
    .map((line) => TAG.exec(line.split("\t")[1] ?? "")?.[1])
    .filter((version) => version !== undefined)
    .sort(compareVersions);
}

export function madridDate(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function declarationArgs(subcommand, version, place, date) {
  const args = ["--filter", "@waitron/fiscal-verifactu", "declaration", subcommand];
  if (subcommand === "check") return [...args, "--version", version];
  return [...args, "--version", version, "--place", place, "--date", date];
}

function onCleanBranchAtOriginMain(run, branch) {
  const git = (...args) => run("git", args).trim();
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== branch) {
    throw new Error(`run this on the branch ${branch}`);
  }
  if (git("status", "--porcelain", "--untracked-files=no") !== "")
    throw new Error("the worktree has uncommitted changes");
  git("fetch", "origin", "main");
  const head = git("rev-parse", "HEAD");
  if (head !== git("rev-parse", "origin/main")) {
    throw new Error(`${branch} must point at origin/main`);
  }
  return head;
}

function refuseUnlessNextVersion(run, version) {
  const released = releasedVersions(run("git", ["ls-remote", "--tags", "origin", "refs/tags/v*"]));
  if (released.includes(version)) throw new Error(`${version} is already released`);
  const highest = released.at(-1);
  if (highest !== undefined && compareVersions(version, highest) <= 0) {
    throw new Error(`${version} is not above ${highest}, the highest released version`);
  }
}

const declarationFile = (version) => `packages/fiscal-verifactu/declarations/v${version}.md`;

export async function prepareRelease({ version, place, run, ask, now, print }) {
  parseVersion(version);
  const branch = `release/${version}`;
  onCleanBranchAtOriginMain(run, branch);
  refuseUnlessNextVersion(run, version);

  const date = madridDate(now);
  print(run("pnpm", declarationArgs("show", version, place, date)));
  const answer = await ask(`Type yes to sign the declaration for Waitron ${version}: `);
  if (answer.trim() !== "yes")
    throw new Error("the declaration was not signed; nothing was written");

  const file = declarationFile(version);
  run("pnpm", declarationArgs("write", version, place, date));
  run("git", ["add", file]);
  run("git", ["commit", "-s", "-m", `Release ${version}`]);
  run("git", ["push", "-u", "origin", branch], SHOWN);
  run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      "main",
      "--title",
      `Release ${version}`,
      "--body",
      `Adds ${file}, the declaration for Waitron ${version}, ` +
        "which the producer read and signed with `pnpm release prepare`.",
    ],
    SHOWN,
  );
}

export async function tagRelease({ version, run }) {
  parseVersion(version);
  const head = onCleanBranchAtOriginMain(run, "main");
  const file = declarationFile(version);
  try {
    run("git", ["cat-file", "-e", `HEAD:${file}`]);
  } catch {
    throw new Error(`${file} is not committed on main; land the release pull request first`);
  }
  run("pnpm", declarationArgs("check", version));
  refuseUnlessNextVersion(run, version);

  const runs = JSON.parse(
    run("gh", [
      "run",
      "list",
      "--workflow",
      "ci.yml",
      "--branch",
      "main",
      "--event",
      "push",
      "--commit",
      head,
      "--json",
      "status,conclusion",
      "--limit",
      "1",
    ]),
  );
  if (runs.length !== 1) throw new Error(`no CI run on main for ${head}`);
  const [{ status, conclusion }] = runs;
  if (status !== "completed" || conclusion !== "success") {
    throw new Error(`main's CI run for ${head} is ${status}, ${conclusion || "no conclusion"}`);
  }

  const tag = `v${version}`;
  run("git", ["tag", "-a", tag, "-m", `Waitron ${version}`]);
  try {
    run("git", ["push", "origin", tag], SHOWN);
  } catch (error) {
    try {
      run("git", ["tag", "-d", tag]);
    } catch {
      throw new Error(
        `${error.message}; ${tag} is still on this machine: delete it with git tag -d ${tag} before trying again`,
        { cause: error },
      );
    }
    throw error;
  }
}

// No option's value (a pull request's body, a place) may reach a message.
function stepName(file, args) {
  const words = args[0] === "--filter" ? args.slice(2) : args;
  const end = words.findIndex((word) => word.startsWith("-"));
  return [basename(file), ...words.slice(0, end === -1 ? undefined : end)].join(" ");
}

function outcome(error, timeout) {
  if (error.code === "ETIMEDOUT") return `did not finish within ${timeout / 1000} seconds`;
  if (error.status === null && error.signal === null) return `could not start (${error.code})`;
  return `exited with status ${error.status ?? error.signal}`;
}

// Standard error, and a shown call's standard output, go straight to the terminal so a refusal's
// own words reach the signer. The error thrown here never carries a command's output, which for
// the declaration commands can hold the producer's settings.
export function nodeRun(file, args, { show = false, timeout = COMMAND_TIMEOUT_MS } = {}) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      timeout,
      // At the timeout, a command that ignores the default SIGTERM keeps this call waiting.
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", show ? "inherit" : "pipe", "inherit"],
    });
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- the caught error holds the command's output.
    throw new Error(`${stepName(file, args)} ${outcome(error, timeout)}`);
  }
}

export function nodeAsk(prompt, input = process.stdin, output = process.stdout) {
  output.write(prompt);
  const lines = createInterface({ input, terminal: false });
  return new Promise((resolve) => {
    let answer = "";
    lines.once("line", (line) => {
      answer = line;
      lines.close();
    });
    lines.once("close", () => resolve(answer));
  });
}

const NODE_DEPS = {
  run: nodeRun,
  ask: nodeAsk,
  now: Date.now,
  print: process.stdout.write.bind(process.stdout),
  printError: process.stderr.write.bind(process.stderr),
};

function parse(argv) {
  const [command, ...rest] = argv;
  if (command !== "prepare" && command !== "tag") return null;
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: command === "prepare" ? { place: { type: "string" } } : {},
    });
    if (positionals.length !== 1) return null;
    if (command === "tag") return { release: tagRelease, version: positionals[0] };
    if (values.place === undefined) return null;
    return { release: prepareRelease, version: positionals[0], place: values.place };
  } catch {
    return null;
  }
}

export async function main(argv, deps = NODE_DEPS) {
  const args = parse(argv);
  if (args === null) {
    deps.printError(USAGE);
    return 1;
  }
  try {
    const { release, ...inputs } = args;
    await release({ ...inputs, ...deps, now: deps.now() });
    return 0;
  } catch (error) {
    deps.printError(`release: ${error.message}\n`);
    return 1;
  }
}

if (isMainScript(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
