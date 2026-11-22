import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { PRINT_AGENT_VARIABLES } from "../apps/print-agent/src/config.js";
import {
  ENVIRONMENT_VARIABLES,
  PRINT_AGENT_ONLY_NAMES,
} from "../packages/shared/src/environment-variables.js";
import { run } from "./a1308/env7-read-through-list.mjs";

const renameScript = fileURLToPath(new URL("./a1308/env7-read-through-list.mjs", import.meta.url));

it("rewrites only tracked TypeScript reads and makes no further changes on a second run", () => {
  expect(existsSync(renameScript)).toBe(true);
  const root = mkdtempSync(join(tmpdir(), "waitron-env-rewrite-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  const source = "apps/server/src/config.ts";
  const test = "apps/server/src/config.test.ts";
  const sharedSource = "packages/shared/src/producer.ts";
  const unsupportedSource = "packages/standalone/src/config.ts";
  const contents = [
    "const byDot = process.env.WAITRON_ENV;",
    'const byKey = env["WAITRON_HTTP_PORT"];',
    'env.WAITRON_ENV = "dev";',
    'delete env["WAITRON_HTTP_PORT"];',
    'const fixture = { WAITRON_ENV: "dev" };',
    "// env.WAITRON_ENV is the deployment environment.",
  ].join("\n");
  mkdirSync(join(root, "apps/server/src"), { recursive: true });
  writeFileSync(
    join(root, "apps/server/package.json"),
    '{"dependencies":{"@waitron/shared":"workspace:*"}}',
  );
  writeFileSync(join(root, source), contents);
  writeFileSync(join(root, test), contents);
  mkdirSync(join(root, "packages/shared/src"), { recursive: true });
  writeFileSync(join(root, "packages/shared/package.json"), "{}");
  writeFileSync(join(root, sharedSource), "const value = process.env.WAITRON_ENV;\n");
  git("init", "--quiet");
  git("add", ".");
  expect(run(root)).toEqual([source, sharedSource]);
  expect(readFileSync(join(root, sharedSource), "utf8")).toBe(
    'import { readVariable } from "./environment-variables.js";\n' +
      'const value = readVariable(process.env, "WAITRON_ENV");\n',
  );
  const rewritten = readFileSync(join(root, source), "utf8");
  expect(rewritten).toBe(
    'import { readVariable } from "@waitron/shared";\n' +
      contents
        .replace("process.env.WAITRON_ENV", 'readVariable(process.env, "WAITRON_ENV")')
        .replace(
          'const byKey = env["WAITRON_HTTP_PORT"];',
          'const byKey = readVariable(env, "WAITRON_HTTP_PORT");',
        ),
  );
  expect(readFileSync(join(root, test), "utf8")).toBe(contents);
  expect(run(root)).toEqual([]);
  expect(readFileSync(join(root, source), "utf8")).toBe(rewritten);
  mkdirSync(join(root, "packages/standalone/src"), { recursive: true });
  writeFileSync(join(root, "packages/standalone/package.json"), "{}");
  writeFileSync(join(root, unsupportedSource), contents);
  writeFileSync(join(root, source), contents);
  git("add", ".");
  expect(() => run(root)).toThrow("packages/standalone has no @waitron/shared dependency");
  expect(readFileSync(join(root, source), "utf8")).toBe(contents);
  expect(readFileSync(join(root, unsupportedSource), "utf8")).toBe(contents);
});

const CODE_NAMES = new Set([
  "WAITRON_ARGV",
  "WAITRON_BACKUP",
  "WAITRON_BACKUP_VERIFICATION_RUNTIME",
  "WAITRON_CHOICES",
  "WAITRON_DEFAULTS",
  "WAITRON_HOUR_RELEASE",
  "WAITRON_ID_SISTEMA",
  "WAITRON_KEY",
  "WAITRON_LAYOUTS",
  "WAITRON_LOCKUP_DARK_URL",
  "WAITRON_LOCKUP_URL",
  "WAITRON_MANAGEMENT",
  "WAITRON_PAYLOAD",
  "WAITRON_SUMUP_AFFILIATE",
  "WAITRON_THEME_ANSWER",
  "WAITRON_TILL",
  "WAITRON_TLS",
]);

const TEST_DATA = new Set([
  "WAITRON_AGENT_NAME",
  "WAITRON_BACKUP_BUCKET",
  "WAITRON_BACKUP_DIR",
  "WAITRON_BACKUP_ENABLED",
  "WAITRON_BACKUP_INTERVAL_SECONDS",
  "WAITRON_BACKUP_PADDING",
  "WAITRON_BACKUP_SCHEDULE",
  "WAITRON_BACKUP_STALE_AFTER_MS",
  "WAITRON_BACKUP_TEST_AGE",
  "WAITRON_BACKUP_TEST_COUNT",
  "WAITRON_BACKUP_TEST_FOLDER",
  "WAITRON_BACKUP_TEST_INTERVAL",
  "WAITRON_BACKUP_X",
  "WAITRON_CERT_CHECK",
  "WAITRON_DARK_BG",
  "WAITRON_DARK_PRIMARY",
  "WAITRON_LIGHT_BG",
  "WAITRON_LIGHT_PRIMARY",
  "WAITRON_LOG_LEVEL",
  "WAITRON_MAX_TICK_MS",
  "WAITRON_MEDIA_DIR",
  "WAITRON_MIGRATIONS_DATABASE_URL",
  "WAITRON_NOT_A_THING",
  "WAITRON_PRIVACY_NOTICE_URL",
  "WAITRON_PROBE",
  "WAITRON_PRODUCER",
  "WAITRON_SH",
  "WAITRON_SPARE_SPACE_DIR",
  "WAITRON_STDIN_CHUNK_READ",
  "WAITRON_STREAM_TEST_SENTINEL",
  "WAITRON_TEST_MARK",
  "WAITRON_TEST_SECRET",
  "WAITRON_TEST_TRADING",
  ...["SERIES", "TILL"].map((part) => `WAITRON_TILL_${part}_ID`),
  "WAITRON_TOKEN",
  "WAITRON_TUNNEL_BOX_ID",
  "WAITRON_TUNNEL_POOL_SIZE",
  "WAITRON_TUNNEL_RELAY_URL",
  "WAITRON_TUNNEL_TOKEN",
  "WAITRON_VAULT_MASTER_KEY",
]);

const RETIRED_ACCOUNT_KEY_TESTS = new Map([
  ["apps/server/src/cloud-locked-entry.test.ts", 1],
  ["apps/server/src/emergency-copy-placement.test.ts", 2],
]);

const root = fileURLToPath(new URL("..", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
const matches = execFileSync(
  "git",
  [
    "grep",
    "-I",
    "-n",
    "-o",
    "-E",
    "WAITRON_[A-Z0-9_]*[A-Z0-9]",
    "--",
    ":!docs",
    ":!*.md",
    ":!scripts/a1308",
    ":!scripts/environment-variables.test.ts",
  ],
  { cwd: root, env, encoding: "utf8" },
)
  .trimEnd()
  .split("\n")
  .map((line) => {
    const [path, position, name] = line.split(":") as [string, string, string];
    return { path, position, name };
  });

it("requires every Waitron name in tracked source to be declared or recognised", () => {
  const accountKeyUses = new Map<string, number>();
  const unknown: string[] = [];
  for (const { path, position, name } of matches) {
    if (Object.hasOwn(ENVIRONMENT_VARIABLES, name) || Object.hasOwn(PRINT_AGENT_VARIABLES, name))
      continue;
    if (CODE_NAMES.has(name)) continue;
    if (
      TEST_DATA.has(name) &&
      (/\.test\.[cm]?[jt]s$/.test(path) || /\/(?:test|testing)\//.test(path))
    )
      continue;
    if (name === "WAITRON_ACCOUNT_KEY" && RETIRED_ACCOUNT_KEY_TESTS.has(path)) {
      const uses = (accountKeyUses.get(path) ?? 0) + 1;
      accountKeyUses.set(path, uses);
      if (uses <= RETIRED_ACCOUNT_KEY_TESTS.get(path)!) continue;
    }
    unknown.push(`${path}:${position}: ${name}`);
  }
  expect(unknown).toEqual([]);
});

it("requires each declared name to be used outside the inventory or its tests", () => {
  const inventory = [
    "packages/shared/src/environment-variables.ts",
    "packages/shared/src/environment-variables.test.ts",
    "apps/print-agent/src/config.ts",
    "apps/print-agent/src/config.test.ts",
  ];
  const used = new Set(
    matches.filter(({ path }) => !inventory.includes(path)).map(({ name }) => name),
  );
  expect(Object.keys(ENVIRONMENT_VARIABLES).filter((name) => !used.has(name))).toEqual([]);
});

it("agrees on the print agent's own names and on the kinds both programs read", () => {
  const own = Object.keys(PRINT_AGENT_VARIABLES).filter(
    (name) => !Object.hasOwn(ENVIRONMENT_VARIABLES, name),
  );
  expect(own.sort()).toEqual([...PRINT_AGENT_ONLY_NAMES].sort());
  for (const name of ["WAITRON_STATE_DIR", "WAITRON_BOX_ADDRESSES", "WAITRON_HTTP_PORT"] as const) {
    expect(PRINT_AGENT_VARIABLES[name].kind, name).toBe(ENVIRONMENT_VARIABLES[name].kind);
  }
});

it("reports the number of product variables", () => {
  const product = Object.values(ENVIRONMENT_VARIABLES).filter(
    ({ source }) => source !== "test" && source !== "development",
  );
  console.info(`Waitron product variables: ${product.length + PRINT_AGENT_ONLY_NAMES.length}`);
});
