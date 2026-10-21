/**
 * Text in the brand colour reads `--wt-color-primary-text`; `--wt-color-primary` paints fills,
 * lines, outlines, icons and spinners (docs/developers/design-system.md → Colour). This guard
 * refuses every `color: var(--wt-color-primary…)` declaration outside `GRAPHIC_USES`.
 *
 * Weaker than its name: it reads TEXT — the string and template literals of each non-test `.ts`
 * file, the whole of each `.css` file and the `<style>` blocks of each `.html` file — and only
 * `color:` declarations. It misses:
 * - a rule that sets another token to the brand colour (`--wt-color-text: var(--wt-color-primary)`);
 * - `fill:`, `stroke:` (an SVG `<text>`) and `-webkit-text-fill-color`;
 * - a `var()` inside another function (`color-mix(…)`, `rgb(from …)`);
 * - `currentColor` or `inherit` from a parent painted in the brand colour;
 * - any colour set from script (`.style.color`, `style.setProperty`, `styleMap`, an SVG
 *   `fill="…"` attribute);
 * - an inline `style="…"` in an `.html` file;
 * - a literal holding `/*` before the declaration and `*\/` after it, which reads as a comment;
 * - an allowlisted selector whose element later shows text;
 * - files `git ls-files` does not list (a new file before `git add`, a coverage report), files
 *   outside `apps/` and `packages/`, files ending `.test.ts`, and `.js`/`.mjs` files.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");

// A per-call kill timeout for a hung `git` (Vitest's timer cannot interrupt a blocking child), and
// a per-test bound above it for the cases that list a tree.
const GIT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = 60_000;

// Git exports `GIT_DIR` to every hook and `.husky/pre-push` runs this suite; an inherited override
// would point `git` at another repository.
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

export type PrimaryColourDeclaration = { line: number; selector: string };
export type GraphicUse = { file: string; selector: string; draws: string };

export const GRAPHIC_USES: readonly GraphicUse[] = [
  {
    file: "apps/dashboard/src/widgets/device-home-preview.ts",
    selector: "wt-button.add wt-icon",
    draws: "the add tile's + icon",
  },
  {
    file: "apps/setup/src/screens/provisioning-screen.ts",
    selector: ".in-flight wt-spinner",
    draws: "the provisioning spinner's ring",
  },
  {
    file: "apps/till/src/widgets/card-waiting.ts",
    selector: "wt-spinner",
    draws: "the card-waiting spinner's ring",
  },
  {
    file: "packages/ui/src/components/wt-data-table.ts",
    selector: ".eye-toggle wt-icon",
    draws: "the column chooser's eye icon",
  },
  {
    file: "packages/ui/src/components/wt-number-stepper.ts",
    selector: "button",
    draws: "the − and + icons",
  },
];

const DECLARATION = /(?<![\w-])color\s*:\s*var\(\s*--wt-color-primary\s*[,)]/gi;

const blank = (text: string) => text.replace(/[^\n]/g, " ");

/** Blanks `<style…>`/`</style>` tags and CSS comments, newlines kept so offsets map to lines. */
function stripTagsAndComments(text: string): string {
  return text.replace(/<\/?style\b[^>]*>/gi, blank).replace(/\/\*[\s\S]*?\*\//g, blank);
}

/** The selector of the rule enclosing `at`: back to the unmatched `{`, then back to the previous
 * `{`, `}` or `;`; `""` when there is no `{`. */
function selectorAt(text: string, at: number): string {
  let depth = 0;
  let open = -1;
  for (let i = at - 1; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open === -1) return "";
  let from = open - 1;
  while (from >= 0 && !"{};".includes(text[from]!)) from--;
  return text
    .slice(from + 1, open)
    .replace(/\s+/g, " ")
    .trim();
}

function declarationsIn(text: string, lineOf: (offset: number) => number) {
  const cleaned = stripTagsAndComments(text);
  return [...cleaned.matchAll(DECLARATION)].map((match) => ({
    line: lineOf(match.index),
    selector: selectorAt(cleaned, match.index),
  }));
}

const lineCounter = (text: string) => (offset: number) => text.slice(0, offset).split("\n").length;

/** Every `color:` declaration in `source` that reads `var(--wt-color-primary…)` with nothing
 * after the name but `)` or a fallback. */
export function primaryColourDeclarations(
  source: string,
  kind: "ts" | "css" | "html",
): PrimaryColourDeclaration[] {
  if (kind === "css") return declarationsIn(source, lineCounter(source));
  if (kind === "html") {
    let kept = blank(source);
    for (const match of source.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi))
      kept = kept.slice(0, match.index) + match[0] + kept.slice(match.index + match[0].length);
    return declarationsIn(kept, lineCounter(kept));
  }
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const out: PrimaryColourDeclaration[] = [];
  const scan = (
    node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression,
  ) => {
    const start = node.getStart();
    let text = node.getText();
    // Each `${…}` goes WITH its delimiters, so a binding's braces never count as a rule's.
    if (ts.isTemplateExpression(node))
      for (const span of node.templateSpans) {
        const from = span.expression.getFullStart() - 2 - start;
        const to = span.literal.getStart() + 1 - start;
        text = text.slice(0, from) + blank(text.slice(from, to)) + text.slice(to);
      }
    text = " " + text.slice(1, -1) + " ";
    out.push(
      ...declarationsIn(
        text,
        (offset) => file.getLineAndCharacterOfPosition(start + offset).line + 1,
      ),
    );
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isStringLiteral(node) ||
      ts.isTemplateExpression(node)
    )
      scan(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out.sort((a, b) => a.line - b.line);
}

/** The files `git ls-files` lists under `apps/` and `packages/` in the repository at `root`:
 * `.ts` (not `.test.ts`), `.css` and `.html`, as paths relative to `root`. */
export function sourceFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: root,
    encoding: "utf8",
    env: isolatedGitEnv(),
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => /\.(ts|css|html)$/.test(file) && !file.endsWith(".test.ts"));
}

function scanFiles(root: string, files: readonly string[]) {
  const found = new Map<string, PrimaryColourDeclaration[]>();
  for (const file of files) {
    const kind = file.endsWith(".css") ? "css" : file.endsWith(".html") ? "html" : "ts";
    const declarations = primaryColourDeclarations(readFileSync(join(root, file), "utf8"), kind);
    if (declarations.length > 0) found.set(file, declarations);
  }
  return found;
}

export function unlistedDeclarations(
  found: ReadonlyMap<string, readonly PrimaryColourDeclaration[]>,
  allowed: readonly GraphicUse[],
): { offenders: string[]; stale: string[] } {
  const counts = new Map<GraphicUse, number>(allowed.map((use) => [use, 0]));
  const offenders: string[] = [];
  for (const [file, declarations] of found)
    for (const { line, selector } of declarations) {
      const use = allowed.find((entry) => entry.file === file && entry.selector === selector);
      if (use === undefined) offenders.push(`${file}:${line} ${selector}`);
      else counts.set(use, counts.get(use)! + 1);
    }
  const stale = [...counts]
    .filter(([, n]) => n !== 1)
    .map(([use, n]) => `${use.file} ${use.selector} (found ${n})`);
  return { offenders: offenders.sort(), stale };
}

describe("primaryColourDeclarations refuses", () => {
  it.each([
    [".a { color: var(--wt-color-primary); }", "css", 1, ".a"],
    [".a{color:var(--wt-color-primary)}", "css", 1, ".a"],
    [".a { color : var( --wt-color-primary ) }", "css", 1, ".a"],
    [".a { color: var(--wt-color-primary, #000); }", "css", 1, ".a"],
    [".a { COLOR: var(--wt-color-primary); }", "css", 1, ".a"],
    [".a { color: var(--wt-color-primary) !important; }", "css", 1, ".a"],
    ["/* note */\n.b,\n.c { color: var(--wt-color-primary); }", "css", 3, ".b, .c"],
    ["@media (x) { .m { color: var(--wt-color-primary); } }", "css", 1, ".m"],
    ["css`.s { ${x}\n color: var(--wt-color-primary); }`", "ts", 2, ".s"],
    ["css`.tone-${t} { color: var(--wt-color-primary) }`", "ts", 1, ".tone-"],
    [
      "html`${ok ? html`<style>.n { color: var(--wt-color-primary) }</style>` : nothing}`",
      "ts",
      1,
      ".n",
    ],
    [
      '<input accept="image/*">\n<style>\n  .h { color: var(--wt-color-primary); }\n</style>\n<p>a */ b</p>',
      "html",
      3,
      ".h",
    ],
    [
      'const accept = "image/*";\ncss`.x { color: var(--wt-color-primary); }`;\nconst g = "a/*/b";',
      "ts",
      2,
      ".x",
    ],
    ['html`<a style="color: var(--wt-color-primary)">`', "ts", 1, ""],
  ] as const)("%s", (source, kind, line, selector) => {
    expect(primaryColourDeclarations(source, kind)).toEqual([{ line, selector }]);
  });
});

describe("primaryColourDeclarations does not refuse", () => {
  it.each([
    [".a { background-color: var(--wt-color-primary); }", "css"],
    [".a { background: var(--wt-color-primary); }", "css"],
    [".a { border-color: var(--wt-color-primary); }", "css"],
    [".a { outline-color: var(--wt-color-primary); }", "css"],
    [".a { accent-color: var(--wt-color-primary); }", "css"],
    [".a { fill: var(--wt-color-primary); }", "css"],
    [".a { stroke: var(--wt-color-primary); }", "css"],
    [".a { color: var(--wt-color-primary-text); }", "css"],
    [".a { color: var(--wt-color-primary-hover); }", "css"],
    [".a { --wt-color-text: var(--wt-color-primary); }", "css"],
    [".a { --x-color: var(--wt-color-primary); }", "css"],
    ["/* color: var(--wt-color-primary) */ .a { color: red; }", "css"],
    ["// color: var(--wt-color-primary)\nconst s = 1;", "ts"],
    ['<p style="color: var(--wt-color-primary)">x</p>', "html"],
  ] as const)("%s", (source, kind) => {
    expect(primaryColourDeclarations(source, kind)).toEqual([]);
  });
});

describe("unlistedDeclarations", () => {
  const use: GraphicUse = { file: "a.ts", selector: ".icon", draws: "an icon" };

  it("passes a listed declaration", () => {
    expect(
      unlistedDeclarations(new Map([["a.ts", [{ line: 3, selector: ".icon" }]]]), [use]),
    ).toEqual({ offenders: [], stale: [] });
  });

  it("refuses the same selector in another file", () => {
    expect(
      unlistedDeclarations(
        new Map([
          ["a.ts", [{ line: 3, selector: ".icon" }]],
          ["b.ts", [{ line: 7, selector: ".icon" }]],
        ]),
        [use],
      ),
    ).toEqual({ offenders: ["b.ts:7 .icon"], stale: [] });
  });

  it("calls an entry stale when its selector matches twice in its file", () => {
    expect(
      unlistedDeclarations(
        new Map([
          [
            "a.ts",
            [
              { line: 3, selector: ".icon" },
              { line: 9, selector: ".icon" },
            ],
          ],
        ]),
        [use],
      ),
    ).toEqual({ offenders: [], stale: ["a.ts .icon (found 2)"] });
  });

  it("calls an entry stale when nothing matches it", () => {
    expect(unlistedDeclarations(new Map(), [use])).toEqual({
      offenders: [],
      stale: ["a.ts .icon (found 0)"],
    });
  });
});

describe("sourceFiles", () => {
  it(
    "reads tracked files only, never an untracked coverage report",
    () => {
      const root = mkdtempSync(join(tmpdir(), "primary-coloured-text-"));
      try {
        const git = (...args: string[]) =>
          execFileSync(
            "git",
            [
              "-c",
              "user.name=t",
              "-c",
              "user.email=t@example.com",
              "-c",
              "commit.gpgsign=false",
              "-c",
              "core.hooksPath=/dev/null",
              ...args,
            ],
            { cwd: root, env: isolatedGitEnv(), timeout: GIT_SPAWN_TIMEOUT_MS, stdio: "pipe" },
          );
        const rule = ".probe { color: var(--wt-color-primary); }";
        mkdirSync(join(root, "packages/x/src"), { recursive: true });
        writeFileSync(join(root, "packages/x/src/a.ts"), `css\`${rule}\`;\n`);
        git("init", "-q");
        git("add", "packages/x/src/a.ts");
        git("commit", "-q", "-m", "fixture");
        mkdirSync(join(root, "packages/x/coverage"));
        const report = `<style>${rule}</style>\n`;
        writeFileSync(join(root, "packages/x/coverage/a.ts.html"), report);

        // The untracked report would be refused if it were read.
        expect(primaryColourDeclarations(report, "html")).toHaveLength(1);
        const files = sourceFiles(root);
        expect(files).toEqual(["packages/x/src/a.ts"]);
        expect([...scanFiles(root, files).keys()]).toEqual(["packages/x/src/a.ts"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});

describe("the tree", () => {
  let tree: { files: string[]; found: Map<string, PrimaryColourDeclaration[]> } | undefined;
  const scanned = () => {
    if (tree === undefined) {
      const files = sourceFiles(repoRoot);
      tree = { files, found: scanFiles(repoRoot, files) };
    }
    return tree;
  };

  it(
    "reaches both roots",
    () => {
      for (const root of ["apps", "packages"])
        expect(scanned().files.some((file) => file.startsWith(`${root}/`))).toBe(true);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "reads a .css file and an .html file",
    () => {
      expect(scanned().files).toContain("packages/ui-core/src/tokens/colors.css");
      expect(scanned().files).toContain("apps/dashboard/index.html");
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "reads no .test.ts file",
    () => {
      expect(scanned().files.filter((file) => file.endsWith(".test.ts"))).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "every graphic use is found exactly once",
    () => {
      expect(unlistedDeclarations(scanned().found, GRAPHIC_USES).stale).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "no text is painted in the button colour",
    () => {
      expect(
        unlistedDeclarations(scanned().found, GRAPHIC_USES).offenders,
        "Text in the brand colour reads --wt-color-primary-text (docs/developers/design-system.md → Colour). An icon, line or spinner may keep --wt-color-primary: add it to GRAPHIC_USES with what it draws.",
      ).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
