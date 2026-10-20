import { expect, test } from "vitest";

// Weaker than its name: it reads source text, so an import built at run time or a global reached
// through another name passes it.
const sources = import.meta.glob(["./*.ts", "!./*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SPECIFIER =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
const TOKEN_TEXT = ["../tokens/colors.css?raw", "../tokens/structure.css?raw"];
const DOM = /\b(document|window|customElements)\s*\.|\bgetComputedStyle\s*\(|\bHTMLElement\b/;

const specifiers = (text: string) =>
  [...text.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2] ?? match[3]!);

test("the theme sources were found", () => {
  expect(Object.keys(sources)).toContain("./waitron.ts");
  expect(Object.keys(sources)).toContain("./defaults.ts");
});

test("every theme source imports only its siblings, and only waitron.ts the token text", () => {
  for (const [path, text] of Object.entries(sources)) {
    for (const specifier of specifiers(text)) {
      const allowed =
        /^\.\/[a-z0-9-]+\.js$/.test(specifier) ||
        (path === "./waitron.ts" && TOKEN_TEXT.includes(specifier));
      expect(allowed, `${path} imports ${specifier}`).toBe(true);
    }
  }
});

test("no theme source imports waitron.js", () => {
  for (const [path, text] of Object.entries(sources)) {
    expect(specifiers(text), path).not.toContain("./waitron.js");
  }
});

test("no theme source touches the page", () => {
  for (const [path, text] of Object.entries(sources)) expect(DOM.test(text), path).toBe(false);
});
