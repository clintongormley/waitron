import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./move-ts-declarations.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "move-ts-declarations-"));
  writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"module":"NodeNext"}}');
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
});

afterEach(() => {
  rmSync(root, { recursive: true });
});

function write(file, text) {
  writeFileSync(join(root, file), text);
}

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

async function move(source, targets, keep = []) {
  write(
    "moves.json",
    JSON.stringify({ tsconfig: "tsconfig.json", moves: [{ source, targets, keep }] }),
  );
  return main(["moves.json"], root);
}

describe("move-ts-declarations", () => {
  it("takes a moved function's alias, body and comment to their new homes", async () => {
    const declaration = [
      "// The order in this tuple is part of the return value.",
      "export function parts(total: number) {",
      "  return [total, total + 1] as const;",
      "}",
    ].join("\n");
    write("original.ts", `${declaration}\n\nexport const stay = 2;\n`);
    write(
      "consumer.ts",
      'import { parts as split, stay } from "./original.js";\n\nexport const value = split(stay);\n',
    );

    await move("original.ts", { "parts.ts": ["parts"] }, ["stay"]);

    expect(read("parts.ts")).toBe(`${declaration}\n`);
    expect(read("original.ts")).toBe("export const stay = 2;\n");
    expect(read("consumer.ts")).toBe(
      'import { stay } from "./original.js";\nimport { parts as split } from "./parts.js";\n\nexport const value = split(stay);\n',
    );
  });

  it("uses the branch's named destination for a declaration added between existing ones", async () => {
    write(
      "original.ts",
      "export function read() {\n  return branchAmount;\n}\n\nconst branchAmount = 75;\n\nexport const keepHere = 1;\n",
    );
    write(
      "consumer.ts",
      'export { read as renamed, keepHere as retained } from "./original.js";\n',
    );

    await move("original.ts", { "reading.ts": ["read"], "branch.ts": ["branchAmount"] }, [
      "keepHere",
    ]);

    expect(read("original.ts")).toBe("export const keepHere = 1;\n");
    expect(read("reading.ts")).toBe(
      'import { branchAmount } from "./branch.js";\n\nexport function read() {\n  return branchAmount;\n}\n',
    );
    expect(read("branch.ts")).toBe("export const branchAmount = 75;\n");
    expect(read("consumer.ts")).toBe(
      'export { keepHere as retained } from "./original.js";\nexport { read as renamed } from "./reading.js";\n',
    );
  });

  it("keeps a titled test block byte for byte while importing its fixture", async () => {
    const block =
      'describe("receipts", () => {\n  it("prints the amount", () => {\n    expect(amount).toBe(75);\n  });\n});';
    write("original.test.ts", `const amount = 75;\n\n${block}\n`);

    await move("original.test.ts", { "receipt.test.ts": ["describe:receipts"] }, ["amount"]);

    expect(read("receipt.test.ts")).toBe(
      `import { amount } from "./original.test.js";\n\n${block}\n`,
    );
    expect(read("original.test.ts")).toBe("export const amount = 75;\n");
  });

  it.each([
    ["a missing declaration", ["absent"], ["read"], /missing.*absent/i],
    ["an unmapped declaration", ["read"], [], /unmapped.*amount/i],
  ])("refuses %s before changing any file", async (_label, names, keep, error) => {
    const source = "export function read() {\n  return amount;\n}\n\nconst amount = 75;\n";
    write("original.ts", source);

    await expect(move("original.ts", { "reading.ts": names }, keep)).rejects.toThrow(error);

    expect(read("original.ts")).toBe(source);
    expect(() => read("reading.ts")).toThrow(/ENOENT/);
  });

  it("refuses formatting that would change a moved body and leaves the files alone", async () => {
    const source = "export function pounds() { return 7 }\n";
    write("original.ts", source);

    await expect(move("original.ts", { "pounds.ts": ["pounds"] })).rejects.toThrow(/pounds.*body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("pounds.ts")).toThrow(/ENOENT/);
  });

  it("allows Prettier to wrap a signature after TypeScript adds export", async () => {
    const declaration = [
      "// A long parameter list exercises signature formatting when the function becomes public.",
      "function charge(firstAmount: number, secondAmount: number, thirdAmount: number, fourthAmount: number) {",
      "  return firstAmount + secondAmount + thirdAmount + fourthAmount;",
      "}",
    ].join("\n");
    write("original.ts", `${declaration}\n\nexport const total = charge(1, 2, 3, 4);\n`);

    await move("original.ts", { "charge.ts": ["charge"] }, ["total"]);

    expect(read("charge.ts")).toBe(
      [
        "// A long parameter list exercises signature formatting when the function becomes public.",
        "export function charge(",
        "  firstAmount: number,",
        "  secondAmount: number,",
        "  thirdAmount: number,",
        "  fourthAmount: number,",
        ") {",
        "  return firstAmount + secondAmount + thirdAmount + fourthAmount;",
        "}\n",
      ].join("\n"),
    );
  });

  it("keeps an inline object type when adding export wraps its members", async () => {
    write(".prettierrc.json", '{"printWidth":100,"trailingComma":"all"}');
    const body = "{\n  return group.displayNumber;\n}";
    write(
      "original.ts",
      `function groupNumberIdentity(group: { displayNumber: number; numberPartyId: string | null }): number ${body}\n\nexport const number = groupNumberIdentity({ displayNumber: 7, numberPartyId: null });\n`,
    );

    await move("original.ts", { "numbers.ts": ["groupNumberIdentity"] }, ["number"]);

    expect(read("numbers.ts")).toBe(
      `export function groupNumberIdentity(group: {\n  displayNumber: number;\n  numberPartyId: string | null;\n}): number ${body}\n`,
    );
  });

  it("drops an intermediate import when two declarations move to the same destination", async () => {
    write(
      "original.ts",
      "const base = 7;\n\nexport const stay = 4;\n\nexport function total() {\n  return base + 20;\n}\n",
    );
    write(
      "consumer.ts",
      'import { total } from "./original.js";\n\nexport const charge = total();\n',
    );

    await move("original.ts", { "amounts.ts": ["total", "base"] }, ["stay"]);

    expect(read("amounts.ts")).toBe(
      "const base = 7;\n\nexport function total() {\n  return base + 20;\n}\n",
    );
    expect(read("consumer.ts")).toContain('import { total } from "./amounts.js";');
  });

  it("checks the implementation body when moving overloads", async () => {
    const source = [
      "export function read(value: string): string;",
      "export function read(value: number): number;",
      "export function read(value: string | number) { return value }\n",
    ].join("\n");
    write("original.ts", source);

    await expect(move("original.ts", { "reading.ts": ["read"] })).rejects.toThrow(/read.*body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("reading.ts")).toThrow(/ENOENT/);
  });

  it("moves related declarations together even when another declaration separates them", async () => {
    write(
      "original.ts",
      [
        "export function bump() {",
        "  return advance();",
        "}",
        "",
        "export const limit = 7;",
        "",
        "export function advance() {",
        "  return limit + 1;",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "ticket.ts": ["bump", "advance"] }, ["limit"]);

    expect(read("ticket.ts")).toContain('import { limit } from "./original.js";');
    expect(read("ticket.ts")).not.toContain("import { advance");
    expect(read("original.ts")).toBe("export const limit = 7;\n");
  });

  it("checks the body bytes of a function stored in a const", async () => {
    const source = "export const bump = (step: number) => {  return step; };\n";
    write("original.ts", source);

    await expect(move("original.ts", { "bump.ts": ["bump"] })).rejects.toThrow(/bump.*body/i);
    expect(read("original.ts")).toBe(source);
    expect(() => read("bump.ts")).toThrow(/ENOENT/);
  });

  it("imports the binding referenced only by a shorthand property", async () => {
    write("amounts.ts", "export const fired = 7;\n");
    write(
      "original.ts",
      [
        'import { fired } from "./amounts.js";',
        "",
        "export function ticket() {",
        "  return { fired };",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "ticket.ts": ["ticket"] });

    expect(read("ticket.ts")).toBe(
      [
        'import { fired } from "./amounts.js";',
        "",
        "export function ticket() {",
        "  return { fired };",
        "}\n",
      ].join("\n"),
    );
  });

  it("keeps the shorthand property when its binding moves out", async () => {
    write(
      "original.ts",
      ["const fired = 7;", "", "export function ticket() {", "  return { fired };", "}\n"].join(
        "\n",
      ),
    );

    await move("original.ts", { "amounts.ts": ["fired"] }, ["ticket"]);

    expect(read("amounts.ts")).toBe("export const fired = 7;\n");
    expect(read("original.ts")).toBe(
      'import { fired } from "./amounts.js";\n\nexport function ticket() {\n  return { fired };\n}\n',
    );
  });

  it("refuses a declaration assigned to both the source and a destination", async () => {
    const source = "export const fired = 7;\n";
    write("original.ts", source);

    await expect(move("original.ts", { "amounts.ts": ["fired"] }, ["fired"])).rejects.toThrow(
      /fired.*more than once/i,
    );
    expect(read("original.ts")).toBe(source);
    expect(() => read("amounts.ts")).toThrow(/ENOENT/);
  });

  it("compiles a split with the Server's module settings", async () => {
    const compilerOptions = {
      module: "ESNext",
      moduleResolution: "Bundler",
      verbatimModuleSyntax: true,
    };
    write("tsconfig.json", JSON.stringify({ compilerOptions }));
    write(
      "original.ts",
      [
        "export interface Row {",
        "  price: number;",
        "}",
        "",
        "export const fees = { small: { price: 7 } };",
        "",
        "export function fee(row: Row) {",
        "  return row.price;",
        "}",
        "",
        "export function readFee(size: keyof typeof fees): number {",
        "  return fee(fees[size]);",
        "}\n",
      ].join("\n"),
    );

    await move("original.ts", { "ticket.ts": ["Row", "fee"], "fees.ts": ["fees"] }, ["readFee"]);

    const program = ts.createProgram(
      [join(root, "original.ts")],
      ts.convertCompilerOptionsFromJson(compilerOptions, root).options,
    );
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map(
          ({ code, messageText }) =>
            `${code}: ${ts.flattenDiagnosticMessageText(messageText, "\n")}`,
        ),
    ).toEqual([]);
  });
});
