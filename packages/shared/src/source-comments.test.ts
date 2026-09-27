import { describe, expect, it } from "vitest";
import { blankComments, blankCommentsAndLiterals, mapComments } from "./source-comments.js";

/** Every word after which a `/` opens a regular expression. */
const KEYWORDS_BEFORE_A_REGEX = [
  "return",
  "typeof",
  "instanceof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
  "default",
];

/** Every span `mapComments` hands to its callback, in order. */
function spans(source: string): string[] {
  const found: string[] = [];
  mapComments(source, (comment) => {
    found.push(comment);
    return comment;
  });
  return found;
}

describe("mapComments", () => {
  it("replaces each comment with what the callback returns and leaves the code alone", () => {
    const source = "a /* x */ b // y\nc";
    expect(mapComments(source, (comment) => comment.toUpperCase())).toBe("a /* X */ b // Y\nc");
    expect(mapComments(source, () => "")).toBe("a  b \nc");
  });

  it("returns a source with no comment unchanged, and never calls the callback", () => {
    expect(spans("const a = 1;\nconst b = 2;\n")).toEqual([]);
    expect(mapComments("const a = 1;", () => "!")).toBe("const a = 1;");
    expect(mapComments("", () => "!")).toBe("");
  });

  it("finds a line comment up to its line's end, and a block comment up to its `*/`", () => {
    expect(spans("a // c\nb")).toEqual(["// c"]);
    expect(spans("a /* c\nd */ b")).toEqual(["/* c\nd */"]);
    expect(spans("/* one */ a /* two */ // three")).toEqual(["/* one */", "/* two */", "// three"]);
  });

  it("does not read a `/*` inside a line comment as a block comment's opener", () => {
    const source = "// reads drizzle/meta/*_snapshot.json\nconst q = 1;\n/* real */";
    expect(spans(source)).toEqual(["// reads drizzle/meta/*_snapshot.json", "/* real */"]);
  });

  it("does not read a comment opener inside a string as a comment", () => {
    expect(spans('const o = "/*";\nconst q = 1;\nconst c = "*/";')).toEqual([]);
    expect(spans("const o = '/*';\nconst q = 1; // c")).toEqual(["// c"]);
    expect(spans("const p = 'a//b'; const q = 1;")).toEqual([]);
    expect(spans('const url = "https://example.com"; // c')).toEqual(["// c"]);
  });

  it("does not read a comment opener inside a template literal as a comment", () => {
    expect(spans("const p = `a//b`; // c")).toEqual(["// c"]);
    expect(spans("const q = `${'/*'}`; const later = 1; // */")).toEqual(["// */"]);
    // The template resumes after its `${…}`, so the `//` inside it is still not a comment.
    expect(spans("const p = `${root}//x`; // c")).toEqual(["// c"]);
  });

  it("finds a comment inside a template's `${…}` part", () => {
    expect(spans("const t = `${a /* c */}`;")).toEqual(["/* c */"]);
  });

  it("does not end a template's `${…}` part at a brace nested inside it", () => {
    expect(spans("const t = `${ { a: 1 }.a // c\n}`;")).toEqual(["// c"]);
    expect(spans("const t = `${ { a: { b: 1 } }.a }/*`; // c")).toEqual(["// c"]);
  });

  it("opens a `${…}` part only at a `$` followed by a `{`", () => {
    expect(spans("const t = `cost: $5 /* c`; // d")).toEqual(["// d"]);
    expect(spans("const t = `x{y} /* c`; // d")).toEqual(["// d"]);
    expect(spans("const t = `x{ /* c */ }`;")).toEqual([]);
  });

  it("leaves a closed `${…}` part behind, so a later brace in code opens no template", () => {
    expect(spans("function f() { return `${a}`; } /* c */")).toEqual(["/* c */"]);
  });

  it("steps over a template nested inside a `${…}` part", () => {
    expect(spans("const t = `${`in ${x} //`} /*`; // c")).toEqual(["// c"]);
  });

  it("leaves braces in code outside any template alone", () => {
    expect(spans("function f() { return { a: 1 }; }\n`/*`; // c")).toEqual(["// c"]);
  });

  it("does not read a comment opener inside a regular expression as a comment", () => {
    expect(spans("const o = /[/*]/;\nconst q = 1;\n/* r */")).toEqual(["/* r */"]);
    // A `/` inside a character class does not end the expression.
    expect(spans("const t = /[/]/*1; // c")).toEqual(["// c"]);
    // An escaped `/` does not end it either.
    expect(spans("const t = /a\\/*b/; // c")).toEqual(["// c"]);
    // Only a `]` ends the class.
    expect(spans("const t = /[a/ /*]/; // c")).toEqual(["// c"]);
    // A `]` ends the class, so a later `/` does.
    expect(spans("const t = /[a]/ /* c */")).toEqual(["/* c */"]);
    // At the very start of the source a `/` opens an expression.
    expect(spans("/\\/*/.test(s); // c")).toEqual(["// c"]);
  });

  it.each(KEYWORDS_BEFORE_A_REGEX)("opens a regular expression after the keyword `%s`", (word) => {
    expect(spans(`${word} /\\/*/; // c`)).toEqual(["// c"]);
    expect(spans(`x = ${word} /\\/*/; // c`)).toEqual(["// c"]);
    expect(spans(`x=!${word} /\\/*/; // c`)).toEqual(["// c"]);
  });

  it("opens a regular expression after a keyword and a non-ASCII space", () => {
    expect(spans("return\u00a0/\\/*/; // c")).toEqual(["// c"]);
  });

  it("does not end a string or template at an escaped quote or backtick", () => {
    expect(spans('const s = "say \\"/*\\""; // c')).toEqual(["// c"]);
    expect(spans("const s = 'it\\'s /*'; // c")).toEqual(["// c"]);
    expect(spans("const t = `a\\`b /* c`; // d")).toEqual(["// d"]);
  });

  it("ends an unterminated string at its line, and an unterminated comment or template at the end", () => {
    expect(spans('const s = "unclosed\n// c')).toEqual(["// c"]);
    expect(spans("const s = 'unclosed\n// c")).toEqual(["// c"]);
    expect(spans("/* c")).toEqual(["/* c"]);
    expect(spans("const t = `a // b")).toEqual([]);
    expect(spans("const t = `a ${b // c")).toEqual(["// c"]);
    expect(spans('const s = "unclosed')).toEqual([]);
    expect(spans('const s = "ends in a backslash\\')).toEqual([]);
    expect(spans("const t = `ends in a backslash\\")).toEqual([]);
  });

  it("ends an unterminated regular expression at its line", () => {
    expect(spans("const r = /abc\n// c")).toEqual(["// c"]);
    expect(spans("const r = /abc")).toEqual([]);
    expect(spans("const r = /ab\\")).toEqual([]);
  });

  it("reads a slash after a value as division, not as a regular expression", () => {
    for (const value of [
      "total",
      "count(ok)",
      "list[0]",
      '"4"',
      "'4'",
      "`4`",
      "/4/",
      "cafè",
      "value!",
      "value++",
      "value--",
      "obj.return",
      "obj?.return",
      "x.in",
      "x.default",
      "(a)",
      "await (p)",
    ]) {
      expect(spans(`const h = ${value} / 2; // c`), value).toEqual(["// c"]);
    }
    expect(spans("const o = { if: (a) / 2 }; // c")).toEqual(["// c"]);
  });

  it("reads a property named like a keyword as a value, then a later keyword afresh", () => {
    expect(spans("const v = obj.value\nreturn /\\/*/.test(s); // c")).toEqual(["// c"]);
    expect(spans("const v = obj.typeof\nreturn /\\/*/.test(s); // c")).toEqual(["// c"]);
  });

  it.each(["if", "while", "for", "with"])(
    "opens a regular expression after the parenthesised head of `%s`",
    (head) => {
      expect(spans(`${head} (ok) /\\/*/.test(v);\n// c`)).toEqual(["// c"]);
      expect(spans(`${head} (check(ok)) /\\/*/.test(v);\n// c`)).toEqual(["// c"]);
    },
  );

  it("opens a regular expression after the parenthesised head of `for await`", () => {
    expect(spans("for await (x of y) /\\/*/.test(s);\n// c")).toEqual(["// c"]);
    expect(spans("for /* a */ await\n(x of y) /\\/*/.test(s);\n// c")).toEqual(["/* a */", "// c"]);
  });

  it("reads a slash after `export default` and a value as division, and after `default:` as a regular expression", () => {
    expect(spans("export default total / 2; // c")).toEqual(["// c"]);
    expect(spans("export default (a) / 2; // c")).toEqual(["// c"]);
    expect(spans("switch (k) { default: /\\/*/.test(s); } // c")).toEqual(["// c"]);
  });

  it("reads a slash after the parenthesised call of any other name as division", () => {
    expect(spans("iff (ok) / 2; // c")).toEqual(["// c"]);
    expect(spans("if (f(ok) / 2) {} // c")).toEqual(["// c"]);
  });

  it("opens a regular expression after a closing brace", () => {
    expect(spans("if (ok) {}\n/\\/*/.test(v);\n// c")).toEqual(["// c"]);
  });

  it.each(["const m = [...await /\\/*/.exec(s)];", "f(...typeof /\\/*/);"])(
    "opens a regular expression after a keyword that follows a spread: %s",
    (spread) => {
      expect(spans(`${spread}\n// c`)).toEqual(["// c"]);
    },
  );

  it("opens a regular expression at the start of a template's `${…}` part", () => {
    expect(spans('const s = String.raw`${/\\/*/.source}` + "`"; // c')).toEqual(["// c"]);
  });

  it("opens a regular expression after a prefix `!`, `+` or other operator", () => {
    expect(spans("!/\\/*/.test(s); // c")).toEqual(["// c"]);
    expect(spans("return!/\\/*/.test(s); // c")).toEqual(["// c"]);
    expect(spans("value\n!/\\/*/.test(s); // c")).toEqual(["// c"]);
    expect(spans("x\u00a0!/a\\/*b/\n// c")).toEqual(["// c"]);
    expect(spans("const n = 1 + /\\/*/.source.length; // c")).toEqual(["// c"]);
    expect(spans("const n = a++ + /\\/*/.source.length; // c")).toEqual(["// c"]);
    expect(spans("f({ /a\\/*b/ })\n// c")).toEqual(["// c"]);
  });

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ])("ends a line comment and a regular expression at line terminator %s", (_name, terminator) => {
    expect(spans(`// note${terminator}const q = 1;`)).toEqual(["// note"]);
    expect(spans(`const r = /abc${terminator}// c`)).toEqual(["// c"]);
  });

  it("ends a string at a carriage return, but not at U+2028, and continues it after an escaped line end", () => {
    expect(spans('const s = "unclosed\r// c')).toEqual(["// c"]);
    expect(spans('const s = "a\u2028/*"; // c')).toEqual(["// c"]);
    expect(spans('const s = "a\\\r\n/*"; // c')).toEqual(["// c"]);
    expect(spans('const s = "a\\\n/*"; // c')).toEqual(["// c"]);
    expect(spans('const s = "a\\\r/*"; // c')).toEqual(["// c"]);
  });

  it.each([..."azAZ09_$é"])("reads `%s` as part of a name, so a slash after it divides", (char) => {
    expect(spans(`${char} / 2; // c`)).toEqual(["// c"]);
  });

  it.each([..."{@[:\x7f"])(
    "reads `%s` as punctuation, so a slash after it opens an expression",
    (char) => {
      expect(spans(`${char} /a\\/*b/ ;\n// c`)).toEqual(["// c"]);
    },
  );

  it.each([
    ["tab", "\t"],
    ["vertical tab", "\v"],
    ["form feed", "\f"],
    ["carriage return", "\r"],
    ["no-break space", "\u00a0"],
  ])("reads a %s as a space, so a slash after a name and it divides", (_name, space) => {
    expect(spans(`a${space}/ 2; // c`)).toEqual(["// c"]);
  });

  it.each([
    ["backspace", "\b"],
    ["shift out", "\x0e"],
  ])("reads a %s as punctuation, not a space", (_name, control) => {
    expect(spans(`a${control}/ 2; // c`)).toEqual([]);
  });
});

describe("mapComments' known wrong guesses", () => {
  // Each is named in the doc comment on `mapComments`; a case failing here means that text is stale.
  it("reads a regular expression after a word it does not list as a division", () => {
    expect(spans("class P extends /\\/*/.constructor {}\n// c")).toEqual([
      "/*/.constructor {}\n// c",
    ]);
  });

  it("reads a division after a name spelled like a listed word as a regular expression", () => {
    expect(spans("of / 2; // c")).toEqual([]);
  });

  it("reads a division after a `!` parted from its value by a space as a regular expression", () => {
    expect(spans("const h = total ! / 2; // c")).toEqual([]);
  });
});

describe("blankComments", () => {
  it("replaces every character of a comment but its newlines with a space", () => {
    expect(blankComments("a // c\nb")).toBe("a     \nb");
    expect(blankComments("a /* c\nd */ b")).toBe("a     \n     b");
  });

  it("keeps every line where it was", () => {
    const source = "/**\n * doc\n */\nconst a = 1; // note\n/* x */ const b = 2;";
    const blanked = blankComments(source);
    expect(blanked.split("\n")).toHaveLength(source.split("\n").length);
    expect(blanked.split("\n")[3]).toBe("const a = 1;        ");
    expect(blanked.split("\n")[4]).toBe("        const b = 2;");
  });

  it("leaves code after a `/*` inside a line comment or a string in place", () => {
    expect(blankComments("// see a/*b\nconst x = aeat;\n/* c */")).toBe(
      "           \nconst x = aeat;\n       ",
    );
    expect(blankComments('const s = "/*"; const x = aeat; // */')).toBe(
      'const s = "/*"; const x = aeat;      ',
    );
  });
});

describe("blankCommentsAndLiterals", () => {
  it("blanks comments and the text of strings, keeping the quotes", () => {
    expect(blankCommentsAndLiterals("f(\"a}b\", '{c'); // d")).toBe("f(\"   \", '  ');     ");
    expect(blankCommentsAndLiterals('const s = "";')).toBe('const s = "";');
  });

  it("blanks a template's text but keeps its backticks and the code in its `${…}` parts", () => {
    expect(blankCommentsAndLiterals("`a}${x /* c */}b{`;")).toBe("`  ${x        }  `;");
    expect(blankCommentsAndLiterals("`${`in}${y}`}{`")).toBe("`${`   ${y}`} `");
  });

  it("blanks a regular expression's text but keeps its slashes and flags", () => {
    expect(blankCommentsAndLiterals("const r = /}[/]/g;")).toBe("const r = /    /g;");
  });

  it("blanks an unterminated string or regular expression to its line's end, and a template to the end", () => {
    expect(blankCommentsAndLiterals('f("a}\ng();')).toBe('f("  \ng();');
    expect(blankCommentsAndLiterals("const r = /a}\ng();")).toBe("const r = /  \ng();");
    expect(blankCommentsAndLiterals("const t = `a}\ng();")).toBe("const t = `  \n    ");
    expect(blankCommentsAndLiterals("const t = `a\\")).toBe("const t = `  ");
  });

  it("keeps every line where it was, including a string's escaped line end", () => {
    const source = 'const s = "a\\\n}";\nconst t = `\n{`;\ng(); // c';
    const blanked = blankCommentsAndLiterals(source);
    expect(blanked).toBe('const s = "  \n ";\nconst t = `\n `;\ng();     ');
  });

  it("leaves code outside comments and literals alone", () => {
    const source = "function f(a) { return { b: a / 2 }; }";
    expect(blankCommentsAndLiterals(source)).toBe(source);
  });
});
