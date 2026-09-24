import { describe, expect, it } from "vitest";

/** Types the one `import.meta.glob` form this file calls, rather than adding `vite` as a
 * dependency for the `vite/client` types. */
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the source glob itself", () => {
  it("discovers backend.ts, clock.ts and the fake", () => {
    // Without this, every check below passes vacuously against an empty set.
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("backend.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("clock.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("fake-backend.ts"))).toBe(true);
  });
});

/**
 * Blanks block comments (preserving line numbers) and drops `//` line comments, so a comment may
 * cite the regime while the same word used in code still fails the scan.
 */
function stripComments(source: string): string {
  const blockBlanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return blockBlanked
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const strippedSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([path, source]) => [path, stripComments(source)]),
);

/**
 * Whether `source` mentions `term` as a word or as a sub-word of an identifier. `\bchain` alone
 * misses `verifyChainBeforeWrite`, which has no word boundary before "Chain", so a capitalised or
 * all-caps substring counts too. Deliberately not a case-insensitive substring test, which would
 * also match "unchained".
 */
function mentionsTerm(source: string, term: string): boolean {
  const capitalised = term.charAt(0).toUpperCase() + term.slice(1);
  const wholeWord = new RegExp(`\\b${term}`, "i");
  return (
    wholeWord.test(source) || source.includes(capitalised) || source.includes(term.toUpperCase())
  );
}

// Each term names a regime, its authority or one of its mechanisms, all of which belong on the
// other side of the `FiscalBackend` boundary.
const FORBIDDEN = [
  "chain",
  "huella",
  "hash",
  "fingerprint",
  "encadenamiento",
  "registro",
  "cadena",
  "verifactu",
  "ticketbai",
  "sif",
  "csv",
  "incidencia",
  "aeat",
];

describe("no regime vocabulary appears in packages/fiscal", () => {
  for (const term of FORBIDDEN) {
    it.each(Object.entries(strippedSources))(`%s does not mention "${term}"`, (_path, source) => {
      expect(mentionsTerm(source, term)).toBe(false);
    });
  }
});

describe("stripComments", () => {
  it("blanks a block comment's AEAT citation so it is not counted as a mention", () => {
    const source = "/**\n * AEAT appears to serve the value dynamically.\n */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(source), "aeat")).toBe(false);
  });

  it("still catches the same word used as a real identifier, not merely commented", () => {
    const source = 'export const aeatEndpoint = "https://example.com";';
    expect(mentionsTerm(stripComments(source), "aeat")).toBe(true);
  });

  it("drops a // line comment without mistaking a URL's // for one", () => {
    const source = 'const url = "https://example.com"; // see AEAT\'s published guidance';
    const stripped = stripComments(source);
    expect(stripped).toContain("https://example.com");
    expect(mentionsTerm(stripped, "aeat")).toBe(false);
  });
});

describe("the guard has teeth", () => {
  it("would reject the name this task's signature list originally carried", () => {
    // Why the method is `checkIntegrity`, not `verifyChainBeforeWrite`.
    expect(mentionsTerm("verifyChainBeforeWrite", "chain")).toBe(true);
  });

  it("would reject registerSif for the same reason", () => {
    expect(mentionsTerm("registerSif", "sif")).toBe(true);
  });

  it("does not reject ordinary prose that merely ends in the same letters", () => {
    // Without this, a helper flagging every substring would pass the two tests above too.
    expect(mentionsTerm("the chain of custody was never unchained", "chain")).toBe(true);
    expect(mentionsTerm("nothing here is unchained from anything else", "chain")).toBe(false);
  });
});
