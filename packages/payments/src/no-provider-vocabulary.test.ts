import { describe, expect, it } from "vitest";

/**
 * Declared locally rather than through a `vite/client` reference, which would add a `vite`
 * dependency for one type.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

// Weaker than the suite's name: it scans the non-test `.ts` files under `src/` only, and never
// reads a comment.
const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("the source glob itself", () => {
  it("discovers provider.ts, store.ts and the fake", () => {
    // Without this, every check below passes vacuously against an empty set.
    const names = Object.keys(sources);
    expect(names.some((n) => n.endsWith("provider.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("store.ts"))).toBe(true);
    expect(names.some((n) => n.endsWith("fake-provider.ts"))).toBe(true);
  });
});

/**
 * A mention inside a COMMENT must not trip the guard, while the same word in code must. A copy of
 * packages/fiscal/src/no-regime-vocabulary.test.ts's `stripComments`.
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
 * A deliberately blunt case-insensitive substring test: every FORBIDDEN term is banned in every
 * casing and compound form, and none is an English fragment that needs word boundaries. Even
 * "terminal state" is intentionally banned (use `finalState`).
 */
function mentionsTerm(source: string, term: string): boolean {
  return source.toLowerCase().includes(term.toLowerCase());
}

// "reader" is deliberately NOT here: a card reader is provider-neutral vocabulary this package owns,
// and a provider-specific reader still trips its provider's token (`stripeReader`).
const FORBIDDEN = [
  "stripe",
  "adyen",
  "sumup",
  "paymentintent",
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
    expect(mentionsTerm("the terminates soon", "terminal")).toBe(false);
  });

  it("blanks a comment mention so it is not counted", () => {
    const source =
      "/**\n * The Stripe adapter lives in packages/payments-stripe.\n */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(source), "stripe")).toBe(false);

    const inlineSource = "/* Stripe adapter lives elsewhere */\nexport const x = 1;";
    expect(mentionsTerm(stripComments(inlineSource), "stripe")).toBe(false);
  });
});
