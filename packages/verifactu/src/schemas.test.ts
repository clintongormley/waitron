import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NS_LR, NS_LRC, NS_SF } from "./xml/serialize.js";

const SCHEMA_DIR = fileURLToPath(new URL("../schemas/", import.meta.url));

const NAMESPACED = [
  ["SuministroInformacion.xsd", NS_SF],
  ["SuministroLR.xsd", NS_LR],
  ["ConsultaLR.xsd", NS_LRC],
] as const;

const ALL_FILES = [
  "SuministroInformacion.xsd",
  "SuministroLR.xsd",
  "ConsultaLR.xsd",
  "RespuestaSuministro.xsd",
  "RespuestaConsultaLR.xsd",
  "SistemaFacturacion.wsdl",
] as const;

describe("committed AEAT primary sources", () => {
  it.each(ALL_FILES)("%s is present on disk", (file) => {
    // These were lost twice to gitignored worktree teardown. This assertion is what makes a
    // third loss fail CI instead of being discovered months later by someone opening a task step
    // that says "verify against the XSD".
    expect(() => readFileSync(SCHEMA_DIR + file)).not.toThrow();
  });

  it.each(NAMESPACED)("%s declares the targetNamespace the serialiser emits", (file, ns) => {
    // Plan 1 flagged these URIs as transcribed rather than verified. A wrong namespace produces
    // a SOAP fault rather than a validation error, which is tedious to diagnose from the response
    // and would reject every submission.
    const xsd = readFileSync(SCHEMA_DIR + file, "utf8");
    expect(/targetNamespace\s*=\s*"([^"]+)"/.exec(xsd)?.[1]).toBe(ns);
  });

  it.each(ALL_FILES)("%s matches the checksum recorded in README.md", (file) => {
    // Distinguishes "AEAT published a revision" from "someone edited a primary source to make a
    // test pass". Both look identical in a diff.
    const readme = readFileSync(SCHEMA_DIR + "README.md", "utf8");
    const sha = createHash("sha256")
      .update(readFileSync(SCHEMA_DIR + file))
      .digest("hex");
    expect(readme).toContain(sha);
  });
});
