import { describe, expect, it } from "vitest";
import { formatEnvFile, parseEnvFile } from "./env-file.js";

describe("parseEnvFile", () => {
  it("splits on the first `=`, keeping a value's own `=` and `#`", () => {
    expect(parseEnvFile("KEY=AQ==\nHASHED=ab#cd\n")).toEqual({ KEY: "AQ==", HASHED: "ab#cd" });
  });

  it("skips blank lines, comment lines and lines with no `=`, and trims each line", () => {
    expect(parseEnvFile("\n  # a comment\nno equals sign\n  PADDED=x  \r\n")).toEqual({
      PADDED: "x",
    });
  });

  it("takes a value verbatim: no quotes, `export` prefix or inline comment is interpreted", () => {
    expect(parseEnvFile('export QUOTED="q"\nINLINE=v #c\n')).toEqual({
      "export QUOTED": '"q"',
      INLINE: "v #c",
    });
  });

  it("lets a later line win over an earlier one", () => {
    expect(parseEnvFile("A=1\nA=2\n")).toEqual({ A: "2" });
  });
});

describe("formatEnvFile", () => {
  it("writes one line per entry, in insertion order, values verbatim", () => {
    expect(formatEnvFile({ B: "2", A: "x=y" })).toBe("B=2\nA=x=y\n");
  });

  it("reads back through parseEnvFile as every value parseEnvFile produced", () => {
    const read = parseEnvFile(
      '  export Q="q" \nK=ab#cd\nINLINE=v #c\nLEAD=  x\n=empty name\nTAB\t=t\nCR=v\r\n',
    );
    expect(parseEnvFile(formatEnvFile(read))).toEqual(read);
  });
});
