import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  main,
  madridDate,
  nodeAsk,
  nodeRun,
  parseVersion,
  prepareRelease,
  releasedVersions,
  tagRelease,
} from "./waitron-release.mjs";

const SPAWN_TIMEOUT_MS = 30_000;
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS + 10_000 });

const HEAD_SHA = "1c57940203777e2a408258d34e363718c3d89181";
const OTHER_SHA = "d0e0923c5da1b576505e45e39e195906681e2ebc";
const NOW = new Date("2026-11-11T10:00:00Z");
const FILE = "packages/fiscal-verifactu/declarations/v1.0.0.md";
const LS_REMOTE = `${OTHER_SHA}\trefs/tags/v0.9.0\n${OTHER_SHA}\trefs/tags/pre-sqlite-migration\n`;
const PR_BODY =
  `Adds ${FILE}, the declaration for Waitron 1.0.0, ` +
  "which the producer read and signed with `pnpm release prepare`.";

const RUN_SUCCESS = '[{"status":"completed","conclusion":"success"}]\n';
const ON_MAIN = { "git rev-parse --abbrev-ref HEAD": "main\n" };

const tagPath = (version = "1.0.0") => [
  ["git", "rev-parse", "--abbrev-ref", "HEAD"],
  ["git", "status", "--porcelain", "--untracked-files=no"],
  ["git", "fetch", "origin", "main"],
  ["git", "rev-parse", "HEAD"],
  ["git", "rev-parse", "origin/main"],
  ["git", "cat-file", "-e", `HEAD:packages/fiscal-verifactu/declarations/v${version}.md`],
  ["pnpm", "--filter", "@waitron/fiscal-verifactu", "declaration", "check", "--version", version],
  ["git", "ls-remote", "--tags", "origin", "refs/tags/v*"],
  [
    "gh",
    "run",
    "list",
    "--workflow",
    "ci.yml",
    "--branch",
    "main",
    "--event",
    "push",
    "--commit",
    HEAD_SHA,
    "--json",
    "status,conclusion",
    "--limit",
    "1",
  ],
  ["git", "tag", "-a", `v${version}`, "-m", `Waitron ${version}`],
  ["git", "push", "origin", `v${version}`],
];

const happyPath = (version = "1.0.0", place = "Elche", date = "2026-11-11") => [
  ["git", "rev-parse", "--abbrev-ref", "HEAD"],
  ["git", "status", "--porcelain", "--untracked-files=no"],
  ["git", "fetch", "origin", "main"],
  ["git", "rev-parse", "HEAD"],
  ["git", "rev-parse", "origin/main"],
  ["git", "ls-remote", "--tags", "origin", "refs/tags/v*"],
  [
    "pnpm",
    "--filter",
    "@waitron/fiscal-verifactu",
    "declaration",
    "show",
    "--version",
    version,
    "--place",
    place,
    "--date",
    date,
  ],
  [
    "pnpm",
    "--filter",
    "@waitron/fiscal-verifactu",
    "declaration",
    "write",
    "--version",
    version,
    "--place",
    place,
    "--date",
    date,
  ],
  ["git", "add", `packages/fiscal-verifactu/declarations/v${version}.md`],
  ["git", "commit", "-s", "-m", `Release ${version}`],
  ["git", "push", "-u", "origin", `release/${version}`],
  [
    "gh",
    "pr",
    "create",
    "--base",
    "main",
    "--title",
    `Release ${version}`,
    "--body",
    `Adds packages/fiscal-verifactu/declarations/v${version}.md, the declaration for Waitron ${version}, ` +
      "which the producer read and signed with `pnpm release prepare`.",
  ],
];

function fakeRun(answers = {}) {
  const calls = [];
  const run = (file, args) => {
    const call = [file, ...args];
    calls.push(call);
    const key = call.join(" ");
    if (Object.hasOwn(answers, key)) {
      const answer = answers[key];
      if (answer instanceof Error) throw answer;
      return answer;
    }
    if (key === "git rev-parse --abbrev-ref HEAD") return "release/1.0.0\n";
    if (key === "git rev-parse HEAD" || key === "git rev-parse origin/main") return `${HEAD_SHA}\n`;
    if (key.startsWith("git ls-remote")) return LS_REMOTE;
    if (key.includes(" declaration show ")) return "THE DECLARATION TEXT\n";
    if (key.startsWith("gh run list")) return RUN_SUCCESS;
    return "";
  };
  return { run, calls };
}

async function prepare({ answers, answer = "yes", version = "1.0.0" } = {}) {
  const { run, calls } = fakeRun(answers);
  const printed = [];
  const prompts = [];
  const ask = async (prompt) => {
    prompts.push(prompt);
    return answer;
  };
  let error;
  try {
    await prepareRelease({
      version,
      place: "Elche",
      run,
      ask,
      now: NOW,
      print: (text) => printed.push(text),
    });
  } catch (caught) {
    error = caught;
  }
  return { calls, printed, prompts, error };
}

const forbidden = (calls) =>
  calls.filter(
    ([file, ...args]) =>
      args.includes("show") ||
      args.includes("write") ||
      (file === "git" && ["commit", "push", "add"].includes(args[0])) ||
      file === "gh",
  );

describe("parseVersion", () => {
  it("answers the three numbers", () => {
    expect(parseVersion("1.10.0")).toEqual([1, 10, 0]);
  });

  it.each(["1.0", "v1.0.0", "01.0.0", "1.0.0-rc.1", "", "1.0.0 "])("refuses %j", (text) => {
    expect(() => parseVersion(text)).toThrow(/is not a version/);
  });
});

describe("releasedVersions", () => {
  it("keeps v<major>.<minor>.<patch> tags only, sorted numerically", () => {
    const output = [
      `${OTHER_SHA}\trefs/tags/v1.10.0`,
      `${OTHER_SHA}\trefs/tags/vfoo`,
      `${OTHER_SHA}\trefs/tags/v1.9.0`,
      `${OTHER_SHA}\trefs/tags/pre-sqlite-migration`,
      `${OTHER_SHA}\trefs/tags/v1.9.0^{}`,
      "",
    ].join("\n");
    expect(releasedVersions(output)).toEqual(["1.9.0", "1.10.0"]);
  });
});

describe("madridDate", () => {
  it("answers the day in Madrid, not in UTC", () => {
    expect(madridDate(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
    expect(madridDate(new Date("2026-10-21T21:30:00Z"))).toBe("2026-10-21");
  });
});

describe("prepareRelease", () => {
  it("issues the happy path's commands in order and prints the declaration whole", async () => {
    const { calls, printed, prompts, error } = await prepare();
    expect(error).toBeUndefined();
    expect(calls).toEqual(happyPath());
    expect(printed.join("")).toContain("THE DECLARATION TEXT\n");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/yes/);
    expect(calls.at(-1).at(-1)).toBe(PR_BODY);
  });

  it("accepts an answer of yes surrounded by spaces", async () => {
    const { calls, error } = await prepare({ answer: "  yes \n" });
    expect(error).toBeUndefined();
    expect(calls).toEqual(happyPath());
  });

  it.each(["YES", "y", "", "yes please"])(
    "stops on the answer %j with nothing written",
    async (answer) => {
      const { calls, error } = await prepare({ answer });
      expect(error?.message).toMatch(/not signed/);
      expect(calls).toEqual(happyPath().slice(0, 7));
    },
  );

  it("stops before asking when show exits non-zero", async () => {
    const { calls, prompts, error } = await prepare({
      answers: {
        [happyPath()[6].join(" ")]: new Error("pnpm exited with status 1"),
      },
    });
    expect(error?.message).toMatch(/status 1/);
    expect(prompts).toEqual([]);
    expect(calls).toEqual(happyPath().slice(0, 7));
  });

  const refusals = [
    ["a version that does not parse", { version: "1.0" }, /is not a version/, 0],
    [
      "a branch other than release/<version>",
      { answers: { "git rev-parse --abbrev-ref HEAD": "main\n" } },
      /release\/1\.0\.0/,
      1,
    ],
    [
      "uncommitted changes",
      { answers: { "git status --porcelain --untracked-files=no": " M package.json\n" } },
      /uncommitted/,
      2,
    ],
    [
      "a HEAD that is not origin/main",
      { answers: { "git rev-parse origin/main": `${OTHER_SHA}\n` } },
      /origin\/main/,
      5,
    ],
    [
      "a version already tagged",
      {
        answers: { "git ls-remote --tags origin refs/tags/v*": `${OTHER_SHA}\trefs/tags/v1.0.0\n` },
      },
      /already released/,
      6,
    ],
    [
      "a version not above the highest released",
      {
        answers: { "git ls-remote --tags origin refs/tags/v*": `${OTHER_SHA}\trefs/tags/v1.0.1\n` },
      },
      /1\.0\.1/,
      6,
    ],
  ];

  it.each(refusals)(
    "refuses %s with nothing shown or written",
    async (_, options, message, count) => {
      const { calls, error } = await prepare(options);
      expect(error?.message).toMatch(message);
      expect(calls).toEqual(happyPath().slice(0, count));
      expect(forbidden(calls)).toEqual([]);
    },
  );

  it("orders versions numerically: with v1.9.0 released, 1.10.0 passes and 1.8.9 refuses", async () => {
    const answers = (version) => ({
      "git rev-parse --abbrev-ref HEAD": `release/${version}\n`,
      "git ls-remote --tags origin refs/tags/v*": `${OTHER_SHA}\trefs/tags/v1.9.0\n`,
    });
    const passes = await prepare({ version: "1.10.0", answers: answers("1.10.0") });
    expect(passes.error).toBeUndefined();
    expect(passes.calls).toEqual(happyPath("1.10.0"));
    const refuses = await prepare({ version: "1.8.9", answers: answers("1.8.9") });
    expect(refuses.error?.message).toMatch(/not above 1\.9\.0/);
    expect(forbidden(refuses.calls)).toEqual([]);
  });

  it("passes when nothing has been released yet", async () => {
    const { calls, error } = await prepare({
      answers: { "git ls-remote --tags origin refs/tags/v*": "" },
    });
    expect(error).toBeUndefined();
    expect(calls).toEqual(happyPath());
  });
});

describe("tagRelease", () => {
  const tag = async (answers = {}) => {
    const { run, calls } = fakeRun({ ...ON_MAIN, ...answers });
    let error;
    try {
      await tagRelease({ version: "1.0.0", run });
    } catch (caught) {
      error = caught;
    }
    return { calls, error };
  };
  const tagged = (calls) =>
    calls.filter(([file, command]) => file === "git" && ["tag", "push"].includes(command));
  const runList = tagPath()[8].join(" ");

  it("issues the happy path's commands in order", async () => {
    const { calls, error } = await tag();
    expect(error).toBeUndefined();
    expect(calls).toEqual(tagPath());
  });

  it.each([
    [
      "a branch other than main",
      { "git rev-parse --abbrev-ref HEAD": "release/1.0.0\n" },
      /branch main/,
      1,
    ],
    [
      "a declaration file missing from HEAD",
      { [tagPath()[5].join(" ")]: new Error("git cat-file exited with status 128") },
      /v1\.0\.0\.md is not committed/,
      6,
    ],
    [
      "a check that exits non-zero",
      { [tagPath()[6].join(" ")]: new Error("pnpm --filter exited with status 1") },
      /status 1/,
      7,
    ],
    [
      "a tag that already exists",
      { "git ls-remote --tags origin refs/tags/v*": `${OTHER_SHA}\trefs/tags/v1.0.0\n` },
      /already released/,
      8,
    ],
    [
      "a run still in progress",
      { [runList]: '[{"status":"in_progress","conclusion":""}]' },
      /in_progress/,
      9,
    ],
    [
      "a run that failed",
      { [runList]: '[{"status":"completed","conclusion":"failure"}]' },
      /failure/,
      9,
    ],
    ["no run at all", { [runList]: "[]" }, /no CI run/, 9],
  ])("refuses %s with no tag and no push", async (_, answers, message, count) => {
    const { calls, error } = await tag(answers);
    expect(error?.message).toMatch(message);
    expect(calls).toEqual(tagPath().slice(0, count));
    expect(tagged(calls)).toEqual([]);
  });
});

describe("main", () => {
  const deps = (overrides = {}) => {
    const { run, calls } = fakeRun();
    const errors = [];
    return {
      calls,
      errors,
      deps: {
        run,
        ask: async () => "yes",
        now: () => NOW,
        print: () => {},
        printError: (text) => errors.push(text),
        ...overrides,
      },
    };
  };

  it("runs prepare and answers 0", async () => {
    const { calls, deps: d } = deps();
    expect(await main(["prepare", "1.0.0", "--place", "Elche"], d)).toBe(0);
    expect(calls).toEqual(happyPath());
  });

  it("runs tag and answers 0", async () => {
    const { run, calls } = fakeRun(ON_MAIN);
    const { deps: d } = deps({ run });
    expect(await main(["tag", "1.0.0"], d)).toBe(0);
    expect(calls).toEqual(tagPath());
  });

  it.each([
    [[]],
    [["tag"]],
    [["tag", "1.0.0", "2.0.0"]],
    [["tag", "1.0.0", "--place", "Elche"]],
    [["prepare"]],
    [["prepare", "1.0.0"]],
    [["prepare", "1.0.0", "--place"]],
    [["prepare", "1.0.0", "2.0.0", "--place", "Elche"]],
    [["prepare", "1.0.0", "--place", "Elche", "--other", "x"]],
  ])("prints usage and answers 1 for %j, running nothing", async (argv) => {
    const { calls, errors, deps: d } = deps();
    expect(await main(argv, d)).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join("")).toMatch(/usage: pnpm release prepare <version> --place <place>/);
  });

  it("prints a refusal and answers 1", async () => {
    const { errors, deps: d } = deps({ ask: async () => "no" });
    expect(await main(["prepare", "1.0.0", "--place", "Elche"], d)).toBe(1);
    expect(errors.join("")).toMatch(/^release: .*not signed/);
  });
});

describe("the real wrappers", () => {
  it("nodeRun answers a command's standard output", () => {
    expect(nodeRun(process.execPath, ["-e", "process.stdout.write('out')"])).toBe("out");
  });

  it("nodeRun throws naming the command and its status, never its output", () => {
    expect(() =>
      nodeRun(process.execPath, ["-e", "process.stdout.write('SECRET'); process.exit(3)"]),
    ).toThrow(/exited with status 3/);
    try {
      nodeRun(process.execPath, ["-e", "process.stdout.write('SECRET'); process.exit(3)"]);
    } catch (error) {
      expect(error.message).not.toContain("SECRET");
    }
  });

  it("nodeRun names the signal that ended a command", () => {
    expect(() => nodeRun(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"])).toThrow(
      /exited with status SIGKILL/,
    );
  });

  it("nodeAsk prints the prompt and answers one line", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks = [];
    output.on("data", (chunk) => chunks.push(chunk));
    const answer = nodeAsk("Sign? ", input, output);
    input.write("yes\nmore\n");
    expect(await answer).toBe("yes");
    expect(Buffer.concat(chunks).toString()).toBe("Sign? ");
  });

  it("nodeAsk answers an empty line when the input ends first", async () => {
    const input = new PassThrough();
    const answer = nodeAsk("Sign? ", input, new PassThrough());
    input.end();
    expect(await answer).toBe("");
  });
});

// The stand-ins are written once for the file: executing a freshly written file is much slower on
// macOS than executing it again. What a case varies travels in the environment.
const STUB_BIN = mkdtempSync(join(tmpdir(), "waitron-release-bin-"));
afterAll(() => rmSync(STUB_BIN, { recursive: true, force: true }));
const STUB = `#!/bin/sh
printf '%s' "$(basename "$0")" >> "$WT_CALLS"
for argument in "$@"; do printf '\\037%s' "$argument" >> "$WT_CALLS"; done
printf '\\036' >> "$WT_CALLS"
case "$(basename "$0") $*" in
  "git rev-parse --abbrev-ref HEAD") echo "\${WT_BRANCH:-release/1.0.0}" ;;
  "gh run list"*) echo '[{"status":"completed","conclusion":"success"}]' ;;
  "git rev-parse HEAD"|"git rev-parse origin/main") echo ${HEAD_SHA} ;;
  "git ls-remote"*) printf '${OTHER_SHA}\\trefs/tags/v0.9.0\\n' ;;
  *" declaration show "*) echo THE DECLARATION TEXT ;;
esac
`;
for (const name of ["git", "gh", "pnpm"]) {
  writeFileSync(join(STUB_BIN, name), STUB);
  chmodSync(join(STUB_BIN, name), 0o755);
}

function runEntryPoint(argv, extraEnv, input) {
  const calls = join(STUB_BIN, `calls-${process.pid}`);
  writeFileSync(calls, "");
  const env = { ...process.env, PATH: `${STUB_BIN}:${process.env.PATH}`, WT_CALLS: calls };
  Object.assign(env, extraEnv);
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
  ]) {
    delete env[name];
  }
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "waitron-release.mjs"), ...argv],
    {
      env,
      input,
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
    },
  );
  const recorded = readFileSync(calls, "utf8")
    .split("\u001e")
    .filter(Boolean)
    .map((call) => call.split("\u001f"));
  return { result, recorded };
}

describe("the entry point", () => {
  it("runs prepare end to end through the real wrappers with yes on standard input", () => {
    const { result, recorded } = runEntryPoint(
      ["prepare", "1.0.0", "--place", "Elche"],
      {},
      "yes\n",
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("THE DECLARATION TEXT\n");
    expect(recorded).toEqual(happyPath("1.0.0", "Elche", madridDate(new Date())));
  });

  it("runs tag end to end through the real wrappers", () => {
    const { result, recorded } = runEntryPoint(["tag", "1.0.0"], { WT_BRANCH: "main" }, "");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(recorded).toEqual(tagPath());
  });
});
