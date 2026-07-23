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
  it("discovers provider.ts, store.ts and the fake", () => {
    // Without this, every check below passes vacuously against an empty set — the exact shape
    // of vacuous test this project has already shipped seven of.
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("provider.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("store.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("fake-provider.ts"))).toBe(true);
  });
});

/**
 * Blanks `/* ... *\/` block comments to equivalent whitespace (preserving line numbers) and drops
 * trailing `// ...` line comments, mirroring packages/db/src/english-only.ts's
 * `blankBlockComments`/`dropLineComment` helpers exactly, and packages/fiscal/src/
 * no-regime-vocabulary.test.ts's own `stripComments` verbatim: a legitimate mention of provider/SDK
 * vocabulary inside a COMMENT (`provider.ts`'s own doc comments cite "the terminal" when explaining
 * why no method takes a transaction handle across a network call) must not trip a vocabulary guard,
 * while the same word used as a real identifier must still fail it.
 *
 * Not imported from `@waitron/db`: neither helper is exported from `english-only.ts` (both are
 * private, unexported functions), and `english-only.ts` itself is not re-exported from
 * `@waitron/db`'s public barrel. Reaching them would mean either exporting a test-scanning helper
 * through a package's PRODUCTION surface for the sake of one test file in a different package, or a
 * deep, non-barrel import that reaches past exactly the kind of encapsulation this package's own
 * barrel deliberately enforces elsewhere. Neither is worth it for two small, self-contained regexes,
 * so they are replicated verbatim here instead.
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
 * Whether `source` mentions `term` as any part of an identifier, in any casing.
 *
 * A deliberately blunt case-insensitive substring test — stronger than the sibling
 * packages/fiscal/src/no-regime-vocabulary.test.ts's boundary-aware matcher, and correct for THIS
 * package: every FORBIDDEN term is provider/SDK vocabulary we want gone in every casing and every
 * compound form — whole words (`terminal`), lowercase-led compounds (`stripeClient`), PascalCase
 * compounds (`PaymentIntent`, `ConnectionToken`), and acronym-adjacent compounds (`APIStripeClient`,
 * `NFCReader`) alike. Comments are stripped from `source` before this runs, so a legitimate mention
 * in prose never reaches here. Unlike fiscal's `chain` (a fragment of ordinary words like
 * `unchained`), none of these terms is an English fragment that needs boundary nuance — and even
 * the CS-legitimate "terminal state" is intentionally banned here (use `finalState`), so bluntness
 * is the intended behaviour, not a compromise.
 */
function mentionsTerm(source: string, term: string): boolean {
  return source.toLowerCase().includes(term.toLowerCase());
}

// Provider/SDK vocabulary. A second provider (Adyen, SumUp) brings its own names and its own
// tables and must touch nothing in this neutral package; a term here naming a Stripe/terminal
// concept has leaked across the boundary this guard exists to hold.
const FORBIDDEN = [
  "stripe",
  "adyen",
  "sumup",
  "paymentintent",
  "readerid",
  "reader",
  "terminal",
  "connectiontoken",
  "acquirer",
];

describe("no provider vocabulary appears in packages/payments", () => {
  for (const term of FORBIDDEN) {
    it.each(Object.entries(strippedSources))(`%s does not mention "${term}"`, (_path, source) => {
      expect(mentionsTerm(source, term)).toBe(false);
    });
  }
});

describe("the guard has teeth", () => {
  it("rejects a Stripe identifier", () => {
    expect(mentionsTerm("const stripeClient = makeClient();", "stripe")).toBe(true);
    expect(mentionsTerm("createPaymentIntent(amount)", "paymentintent")).toBe(true);
  });

  it("rejects PascalCase compounds, including a required-compound term", () => {
    expect(mentionsTerm("createPaymentIntent(amount)", "paymentintent")).toBe(true);
    expect(mentionsTerm("getConnectionToken()", "connectiontoken")).toBe(true);
  });

  it("rejects acronym-adjacent compounds, where the letter before the term is itself upper-case", () => {
    expect(mentionsTerm("class NFCReader {}", "reader")).toBe(true);
    expect(mentionsTerm("new APIStripeClient()", "stripe")).toBe(true);
    expect(mentionsTerm("function POSTerminalHandler(){}", "terminal")).toBe(true);
    expect(mentionsTerm("PSPAcquirerGateway", "acquirer")).toBe(true);
  });

  it("rejects any casing of the term", () => {
    expect(mentionsTerm("STRIPE_KEY", "stripe")).toBe(true);
    expect(mentionsTerm("stripeClient", "stripe")).toBe(true);
  });

  it("matches a banned term embedded in prose, but not a mere lookalike suffix", () => {
    expect(mentionsTerm("the terminal state of the payment", "terminal")).toBe(true);
    expect(mentionsTerm("this is the final settled amount", "terminal")).toBe(false);
  });

  it("does not reject prose containing a longer word that merely starts with the term", () => {
    expect(mentionsTerm("the reads were already done", "reader")).toBe(false);
  });

  it("blanks a comment mention so it is not counted", () => {
    const source =
      "/**\n * The Stripe adapter lives in packages/payments-stripe.\n */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(source), "stripe")).toBe(false);

    const inlineSource = "/* Stripe adapter lives elsewhere */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(inlineSource), "stripe")).toBe(false);
  });
});
