import { readFileSync } from "node:fs";
import type { DeclarationProducer } from "../src/declaration/render.js";
import { prepareDeclarationSource } from "../src/declaration/source.js";

export const TEST_RELEASE_BLOCKER = "A test's stand-in for an unfinished item.";

/** The template with one release blocker line put back at its top. */
export function withReleaseBlocker(template: string): string {
  return `<!-- release-blocker: ${TEST_RELEASE_BLOCKER} -->\n${template}`;
}

export function declarationSourceFor(
  version: string,
  {
    date = "2026-10-22",
    releasable = false,
    blocked = false,
  }: { date?: string; releasable?: boolean; blocked?: boolean } = {},
): string {
  const real = readFileSync(new URL("../declarations/template.md", import.meta.url), "utf8");
  const template = releasable ? real.replace(/^<!-- release-blocker: .* -->\n/gm, "") : real;
  return prepareDeclarationSource({
    template: blocked ? withReleaseBlocker(template) : template,
    functions: readFileSync(new URL("../declarations/functions.md", import.meta.url), "utf8"),
    version,
    libraryVersion: "0.2.1",
    date,
    place: "Elche",
  });
}

export const declarationSource = declarationSourceFor("1.2.3");

export const testProducer: DeclarationProducer = {
  name: "PRODUCER PERSON",
  taxId: "00000000T",
  address: "1 Example Street, 00000 Nowhere (Province), Spain",
};
