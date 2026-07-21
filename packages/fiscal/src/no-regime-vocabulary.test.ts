import { describe, expect, it } from "vitest";

/**
 * See packages/fiscal/src/no-hardcoded-margin.test.ts for why this narrow `ImportMeta.glob` type
 * is declared locally rather than pulled in via a `vite/client` triple-slash reference: this
 * package deliberately carries no dependency beyond `@waitron/db`, `@waitron/shared` and
 * `vitest`, and adding `vite` solely for a type reference would be a dependency bought for a
 * comment.
 */
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
    // Without this, every check below passes vacuously against an empty set — the exact shape
    // of vacuous test this project has already shipped seven of.
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("backend.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("clock.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("fake-backend.ts"))).toBe(true);
  });
});

/**
 * Blanks `/* ... *\/` block comments to equivalent whitespace (preserving line numbers) and drops
 * trailing `// ...` line comments, mirroring packages/db/src/english-only.ts's
 * `blankBlockComments`/`dropLineComment` helpers exactly — that file already solved the problem
 * this one has: a legitimate citation of the regime's own authority inside a COMMENT (`clock.ts`'s
 * "AEAT appears to serve the value dynamically", explaining why `degradedAfterSeconds` has no
 * hardcoded default) must not trip a vocabulary guard, while the same word used as a real
 * identifier must still fail it. Before this function existed, the guard scanned raw file text
 * and that citation would have tripped it — which is why an earlier version of this file dropped
 * "aeat" from `FORBIDDEN` entirely rather than fixing the scan. See the comment above `FORBIDDEN`
 * for why that was the wrong fix and has been reverted.
 *
 * Not imported from `@waitron/db`: neither helper is exported from `english-only.ts` (both are
 * private, unexported functions), and `english-only.ts` itself is not re-exported from
 * `@waitron/db`'s public barrel (`packages/db/src/index.ts` re-exports the client, schema and
 * migration surface, not this file). Reaching them would mean either exporting a test-scanning
 * helper through a package's PRODUCTION surface for the sake of one test file in a different
 * package, or a deep, non-barrel import (`@waitron/db/src/english-only.js`) that reaches past
 * exactly the kind of encapsulation this package's own barrel deliberately enforces elsewhere (see
 * `backend.ts`'s comment on why the fake is not re-exported from `index.ts`). Neither is worth it
 * for two small, self-contained regexes, so they are replicated verbatim here instead.
 */
function stripComments(source: string): string {
  const blockBlanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return blockBlanked
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/**
 * What the scan below actually checks — every discovered file's source with comments stripped, so
 * a legitimate comment mention never counts as a leak while real code still does.
 */
const strippedSources: Record<string, string> = Object.fromEntries(
  Object.entries(sources).map(([path, source]) => [path, stripComments(source)]),
);

/**
 * Whether `source` mentions `term` as an identifier component, not merely as a raw substring.
 *
 * A plain `\bterm\b` word-boundary regex is not enough: `\b` fires only at a transition between
 * a word character and a non-word character, which a camelCase or PascalCase identifier never
 * has at an internal sub-word start. `verifyChainBeforeWrite` — the exact name this guard exists
 * to reject — has no non-letter character before "Chain", so `/\bchain/i` does not match it; this
 * was caught in this test file's own red phase (`.toMatch(/\bchain/)` failed against the
 * lowercased literal before this helper existed). A second, capitalised-substring check closes
 * that gap: an internal capital letter is how a compound identifier marks a new sub-word, so
 * checking for `Chain` (and, for the all-caps-acronym compounding style, `CHAIN`) as a plain
 * substring catches `verifyChainBeforeWrite`, `ChainVerification` and `IsCHAINed` alike, while the
 * original word-boundary check still does its job for a whole, standalone word regardless of its
 * casing — `SIF`, `Sif` or `sif` on its own.
 *
 * This is deliberately NOT a blanket case-insensitive substring test. `\bchain` alone (not
 * capitalised) rejects "unchained" in ordinary prose, exactly as intended: "chain" there is not a
 * new sub-word, it is the tail of "un" + "chained", and nothing before it signals a compound
 * identifier.
 */
function mentionsTerm(source: string, term: string): boolean {
  const capitalised = term.charAt(0).toUpperCase() + term.slice(1);
  const wholeWord = new RegExp(`\\b${term}`, "i");
  return (
    wholeWord.test(source) || source.includes(capitalised) || source.includes(term.toUpperCase())
  );
}

// Chaining is a regime requirement, not a POS one (spec §2). A second backend — TicketBAI,
// Italy's SdI, Portugal's ATCUD — brings its own tables and its own vocabulary and touches
// nothing in this package. Every term below names a mechanism that belongs on the other side of
// the boundary; `verifyChainBeforeWrite`, from an earlier draft of this task's signature list,
// fails on the first of them, which is why it is `checkIntegrity` instead.
//
// "aeat" IS on this list. An earlier version of this file dropped it entirely, reasoning that
// `clock.ts` (Task 10) legitimately cites what AEAT does ("AEAT appears to serve the value
// dynamically") to explain why `degradedAfterSeconds` has no hardcoded default, and that keeping
// "aeat" forbidden would fail the build on that comment. That was the wrong fix for a real
// problem: the SCAN, not the word, was at fault — it read raw file text, comments included. With
// `stripComments` (above) blanking comments before any term is checked, `clock.ts`'s citation no
// longer counts as a mention, and "aeat" goes back on the list where it belongs: naming the one
// authority every mechanism below answers to is exactly the kind of leak this guard exists to
// catch, and a reviewer planting `export const aeatEndpoint = "..."` as real code must still fail
// this test. Every other word below names a STRUCTURE (a hash chain, a device registration)
// rather than merely citing who publishes the rule that a structure-free design still has to
// satisfy — "aeat" is the only entry that names an authority rather than a mechanism, which is
// exactly why it was the one term this scan-level bug could silently disarm.
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
    // The exact shape of clock.ts's real comment: a legitimate citation of the authority, not a
    // mechanism leaking into the interface.
    const source = "/**\n * AEAT appears to serve the value dynamically.\n */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(source), "aeat")).toBe(false);
  });

  it("still catches the same word used as a real identifier, not merely commented", () => {
    // The reviewer's planted line, verbatim in shape — proof that blanking comments does not
    // blind the guard to the same term appearing as real code.
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
    // Pinned as an executable statement of the naming decision, so a future reader who wonders
    // why the method is not called verifyChainBeforeWrite gets an answer from the test suite
    // rather than from a commit message. Uses the same `mentionsTerm` helper the real scan uses,
    // rather than a bare `\bchain` regex — see the helper's own doc comment for why the bare
    // regex does not, in fact, match this exact string.
    expect(mentionsTerm("verifyChainBeforeWrite", "chain")).toBe(true);
  });

  it("would reject registerSif for the same reason", () => {
    expect(mentionsTerm("registerSif", "sif")).toBe(true);
  });

  it("does not reject ordinary prose that merely ends in the same letters", () => {
    // The negative case `mentionsTerm` exists to preserve — see its doc comment. Without this,
    // a helper that flagged every substring regardless of case boundary would "pass" the two
    // tests above just as well as the correct one, and nothing here would tell them apart.
    expect(mentionsTerm("the chain of custody was never unchained", "chain")).toBe(true);
    expect(mentionsTerm("nothing here is unchained from anything else", "chain")).toBe(false);
  });
});
