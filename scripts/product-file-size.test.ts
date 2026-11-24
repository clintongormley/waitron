import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import limits from "./product-file-size-limits.json";

type Limits = Readonly<Record<string, number>>;

const repoRoot = join(import.meta.dirname, "..");
const defaultLimit = 1_000;
const limitStep = 250;
const capApproval = "Add or raise a limit only with the watcher's or owner's approval.";
const gitLocationOverrides = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];
const catalogueAndGeneratedFiles = new Set([
  "apps/dashboard/src/i18n/alert-messages.ts",
  "apps/dashboard/src/i18n/codes.ts",
  "apps/till/src/i18n/codes.ts",
  "packages/reporting/src/dr303-layout.ts",
]);

function sizeProblems(files: ReadonlyMap<string, number>, limits: Limits): string[] {
  const problems: string[] = [];
  for (const [file, lines] of files) {
    const listedCap = limits[file];
    const cap = listedCap ?? defaultLimit;
    const size = `${file}: ${lines} lines, limit ${cap}.`;
    if (lines > cap) {
      problems.push(`${size} Move code into a new file. ${capApproval}`);
      continue;
    }
    if (listedCap === undefined) continue;
    const shouldLower = cap - lines > limitStep;
    if (lines < defaultLimit || (shouldLower && lines === defaultLimit)) {
      problems.push(`${size} Remove its limit entry.`);
    } else if (shouldLower) {
      problems.push(`${size} Lower the limit to ${Math.ceil(lines / limitStep) * limitStep}.`);
    }
  }
  for (const file of Object.keys(limits)) {
    if (!files.has(file))
      problems.push(`${file}: no tracked product file. Remove its limit entry.`);
  }
  return problems;
}

function isProductFile(file: string): boolean {
  const relative = /^(?:apps|packages)\/[^/]+\/src\/(.+\.ts)$/.exec(file)?.[1];
  return (
    relative !== undefined &&
    !/\.(?:test|test-helpers|test-support|test-fixture|fixtures)\.ts$/.test(relative) &&
    !/(?:^|\/)(?:testing\/|test-helpers\.ts$)/.test(relative) &&
    !/(?:^|\/)(?:strings\.ts$|i18n\/strings\/)/.test(relative) &&
    !/^packages\/country-[^/]+\/src\/demo\//.test(file) &&
    !catalogueAndGeneratedFiles.has(file)
  );
}

function lineCount(source: string): number {
  return source.split("\n").length - Number(source === "" || source.endsWith("\n"));
}

function sourceFiles(): string[] {
  const env = { ...process.env };
  for (const name of gitLocationOverrides) delete env[name];
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(isProductFile);
}

it("keeps tracked product files within their limits and shrinks stale allowances", () => {
  const files = new Map<string, number>();
  for (const file of sourceFiles()) {
    const location = join(repoRoot, file);
    if (lstatSync(location, { throwIfNoEntry: false })?.isFile()) {
      files.set(file, lineCount(readFileSync(location, "utf8")));
    }
  }
  const problems = sizeProblems(files, limits);
  expect(problems, problems.join("\n")).toEqual([]);
}, 60_000);

const product = "apps/server/src/orders.ts";

it.each([
  { lines: 749, cap: undefined, problems: [] },
  { lines: 1_000, cap: undefined, problems: [] },
  {
    lines: 1_001,
    cap: undefined,
    problems: [
      `${product}: 1001 lines, limit 1000. Move code into a new file. Add or raise a limit only with the watcher's or owner's approval.`,
    ],
  },
  { lines: 1_500, cap: 1_500, problems: [] },
  {
    lines: 1_501,
    cap: 1_500,
    problems: [
      `${product}: 1501 lines, limit 1500. Move code into a new file. Add or raise a limit only with the watcher's or owner's approval.`,
    ],
  },
  { lines: 1_250, cap: 1_500, problems: [] },
  {
    lines: 1_249,
    cap: 1_500,
    problems: [`${product}: 1249 lines, limit 1500. Lower the limit to 1250.`],
  },
  { lines: 1_000, cap: 1_250, problems: [] },
  {
    lines: 1_000,
    cap: 1_500,
    problems: [`${product}: 1000 lines, limit 1500. Remove its limit entry.`],
  },
  {
    lines: 999,
    cap: 1_250,
    problems: [`${product}: 999 lines, limit 1250. Remove its limit entry.`],
  },
])("checks $lines lines against cap $cap", ({ lines, cap, problems }) => {
  expect(
    sizeProblems(new Map([[product, lines]]), cap === undefined ? {} : { [product]: cap }),
  ).toEqual(problems);
});

it("requires removing a limit when its product file is gone", () => {
  expect(sizeProblems(new Map(), { [product]: 1_250 })).toEqual([
    `${product}: no tracked product file. Remove its limit entry.`,
  ]);
});

it.each([
  "apps/server/scripts/orders.ts",
  "apps/server/src/orders.mts",
  "apps/server/src/orders.test.ts",
  "packages/db/src/testing/venue-db.ts",
  "apps/dashboard/src/widgets/test-helpers.ts",
  "apps/server/src/orders.test-helpers.ts",
  "apps/server/src/orders.test-support.ts",
  "apps/server/src/orders.test-fixture.ts",
  "packages/shared/src/set-menu-bill.fixtures.ts",
  "apps/dashboard/src/i18n/strings.ts",
  "apps/setup/src/i18n/strings/finish.ts",
  "apps/dashboard/src/i18n/codes.ts",
  "apps/till/src/i18n/codes.ts",
  "apps/dashboard/src/i18n/alert-messages.ts",
  "packages/country-es/src/demo/products.ts",
  "packages/reporting/src/dr303-layout.ts",
])("leaves %s outside the product scan", (file) => {
  expect(isProductFile(file)).toBe(false);
});

it.each([
  "packages/fiscal-verifactu/src/filing-cases.ts",
  "packages/ui/src/popup-helpers.ts",
  "apps/server/src/test-page.ts",
  "apps/dashboard/src/i18n/locale-controller.ts",
  "apps/till/src/i18n/help-strings.ts",
  "packages/fiscal-verifactu/src/dashboard/conflict-recovery-strings.ts",
  "packages/printing/src/glyphs.ts",
  "packages/country-es/src/starter-content.ts",
])("scans %s as product code", (file) => {
  expect(isProductFile(file)).toBe(true);
});

it.each([
  ["", 0],
  ["// Comment\n\nexport {};\n", 3],
  ["export {};\r\n// Last line", 2],
] as const)("counts physical lines in %j", (source, lines) => {
  expect(lineCount(source)).toBe(lines);
});

it("lists this checkout's product files when the caller points Git elsewhere", () => {
  try {
    for (const name of gitLocationOverrides) vi.stubEnv(name, "/poisoned");
    expect(sourceFiles()).toContain("packages/ui/src/popup-helpers.ts");
  } finally {
    vi.unstubAllEnvs();
  }
}, 60_000);
