import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMEABLE_TOKENS } from "./theme.js";

// Guard: every allowlisted theme token MUST be a real `--wt-*` token declared by the design-system
// registry, so the allowlist can never drift onto a phantom (the earlier draft allowlisted four
// non-existent names — theme.ts). NB staleness caveat: a ui-SIDE removal only re-runs this when
// @waitron/layouts is in scope; the unfiltered `main` merge is the backstop (CLAUDE.md §2).
function declaredTokens(): Set<string> {
  const dir = fileURLToPath(new URL("../../ui/src/tokens/", import.meta.url));
  const css =
    readFileSync(dir + "colors.css", "utf8") + readFileSync(dir + "structure.css", "utf8");
  return new Set([...css.matchAll(/(--wt-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

describe("THEMEABLE_TOKENS registry consistency", () => {
  it("allowlists only real --wt-* tokens from the design-system registry", () => {
    const declared = declaredTokens();
    const phantom = THEMEABLE_TOKENS.filter((t) => !declared.has(t));
    expect(phantom).toEqual([]);
  });
});
