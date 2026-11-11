import { readFileSync } from "node:fs";
import type { DeclarationProducer } from "../src/declaration/render.js";
import { prepareDeclarationSource } from "../src/declaration/source.js";

export const declarationSource = prepareDeclarationSource({
  template: readFileSync(new URL("../declarations/template.md", import.meta.url), "utf8"),
  functions: readFileSync(new URL("../declarations/functions.md", import.meta.url), "utf8"),
  version: "1.2.3",
  libraryVersion: "0.2.1",
  date: "2026-10-22",
  place: "Elche",
});

export const testProducer: DeclarationProducer = {
  name: "PRODUCER PERSON",
  taxId: "00000000T",
  address: "1 Example Street, 00000 Nowhere (Province), Spain",
};
