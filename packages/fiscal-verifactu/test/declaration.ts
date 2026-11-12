import { readFileSync } from "node:fs";
import type { DeclarationProducer } from "../src/declaration/render.js";
import { prepareDeclarationSource } from "../src/declaration/source.js";

export function declarationSourceFor(
  version: string,
  { date = "2026-10-22", releasable = false }: { date?: string; releasable?: boolean } = {},
): string {
  const template = readFileSync(new URL("../declarations/template.md", import.meta.url), "utf8");
  return prepareDeclarationSource({
    template: releasable ? template.replace(/^<!-- release-blocker: .* -->\n/gm, "") : template,
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
