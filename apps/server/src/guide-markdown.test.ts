import { describe, expect, it } from "vitest";

import { renderGuide } from "./guide-markdown.js";

const PAGES = ["products", "modifiers", "content-and-images"] as const;

function render(markdown: string) {
  return renderGuide(markdown, PAGES);
}

describe("renderGuide", () => {
  it("renders the title, the opening paragraphs and one section per level-2 heading", () => {
    const guide = render(
      [
        "# Products",
        "",
        "What a product is,",
        "in two lines.",
        "",
        "A second opening paragraph.",
        "",
        "## Give a product a name {#names}",
        "",
        "Type the name.",
        "",
        "## Add variants {#variants}",
        "",
        "Variants have prices.",
        "",
      ].join("\n"),
    );

    expect(guide.title).toBe("Products");
    expect(guide.html).toBe(
      [
        "<h1>Products</h1>",
        "<p>What a product is, in two lines.</p>",
        "<p>A second opening paragraph.</p>",
        '<section id="names" aria-labelledby="names-heading"><h2 id="names-heading">Give a product a name</h2>',
        "<p>Type the name.</p>",
        "</section>",
        '<section id="variants" aria-labelledby="variants-heading"><h2 id="variants-heading">Add variants</h2>',
        "<p>Variants have prices.</p>",
        "</section>",
      ].join("\n"),
    );
    expect(guide.sections).toEqual([
      { id: "names", heading: "Give a product a name" },
      { id: "variants", heading: "Add variants" },
    ]);
    expect(guide.links).toEqual([]);
  });

  it("joins a paragraph's lines before reading bold, so bold may cross a line break", () => {
    const guide = render(
      "# T\n\nsuch as **Coffee,\nsingle** and **Coffee, double**. Each variant.\n",
    );

    expect(guide.html).toBe(
      "<h1>T</h1>\n<p>such as <strong>Coffee, single</strong> and <strong>Coffee, double</strong>. Each variant.</p>",
    );
  });

  it("renders a bullet list whose items continue on indented lines", () => {
    const guide = render(
      [
        "# T",
        "",
        "Two optional names sit beside it:",
        "",
        "- A **customer-facing name**, under **Descriptors**. This is",
        "  what a diner reads.",
        "- A **kitchen name**, under **Kitchen**.",
        "  Leave it blank.",
        "",
        "After the list.",
      ].join("\n"),
    );

    expect(guide.html).toBe(
      [
        "<h1>T</h1>",
        "<p>Two optional names sit beside it:</p>",
        "<ul><li>A <strong>customer-facing name</strong>, under <strong>Descriptors</strong>. This is what a diner reads.</li>" +
          "<li>A <strong>kitchen name</strong>, under <strong>Kitchen</strong>. Leave it blank.</li></ul>",
        "<p>After the list.</p>",
      ].join("\n"),
    );
  });

  it("renders emphasis only between word boundaries", () => {
    const guide = render(
      "# T\n\nThis is _rare_, (_quite_) and **_bold too_** but snake_case_name and a_b stay text. _A snake_case here_ and a _dangling one.\n",
    );

    expect(guide.html).toBe(
      "<h1>T</h1>\n<p>This is <em>rare</em>, (<em>quite</em>) and <strong><em>bold too</em></strong> but snake_case_name and a_b stay text. <em>A snake_case here</em> and a _dangling one.</p>",
    );
  });

  it("renders code spans and escapes what is inside them", () => {
    const guide = render("# T\n\nType `a<b>` and **`x & y`**.\n");

    expect(guide.html).toBe(
      "<h1>T</h1>\n<p>Type <code>a&lt;b&gt;</code> and <strong><code>x &amp; y</code></strong>.</p>",
    );
  });

  it("escapes angle brackets, ampersands and quotes in text", () => {
    const line =
      "**<included menu> folder in <including menu>**, and its link opens the including menu's";
    const guide = render(`# T\n\n${line}\n\nA & B "quoted".\n`);

    expect(guide.html).toBe(
      "<h1>T</h1>\n" +
        "<p><strong>&lt;included menu&gt; folder in &lt;including menu&gt;</strong>, and its link opens the including menu&#39;s</p>\n" +
        "<p>A &amp; B &quot;quoted&quot;.</p>",
    );
    expect(guide.html).not.toContain("<included");
  });

  it("turns a link to another guide into a link to its page, keeping the section", () => {
    const guide = render(
      "# T\n\nSee [modifiers](modifiers.md) and [**the units**](products.md#units).\n",
    );

    expect(guide.html).toBe(
      '<h1>T</h1>\n<p>See <a href="modifiers">modifiers</a> and <a href="products#units"><strong>the units</strong></a>.</p>',
    );
  });

  it("records every link in links", () => {
    const guide = render(
      [
        "# T",
        "",
        "[a](products.md) and [b](content-and-images.md#languages).",
        "",
        "## S {#s}",
        "",
        "- [c](products.md)",
      ].join("\n"),
    );

    expect(guide.links).toEqual([
      { page: "products" },
      { page: "content-and-images", id: "languages" },
      { page: "products" },
    ]);
  });

  it("shortens a long refused line in the message", () => {
    const row = `| ${"a".repeat(100)} |`;

    expect(() => render(`# T\n\n${row}\n`)).toThrow(`"${row.slice(0, 60)}…"`);
  });

  it.each([
    ["a level-2 heading with no id", "# T\n\n## Heading\n", 3, "without {#id}"],
    ["an id with a capital", "# T\n\n## Heading {#Units}\n", 3, "not a section id"],
    ["an id with a space", "# T\n\n## Heading {#two words}\n", 3, "not a section id"],
    ["a duplicate id", "# T\n\n## A {#a}\n\n## B {#a}\n", 5, "a second time"],
    ["a level-3 heading", "# T\n\n### Deeper\n", 3, "other than level 2"],
    ["a second level-1 heading", "# T\n\n# Again\n", 3, "second level-1"],
    ["no level-1 heading first", "Intro.\n\n# T\n", 1, "must start with"],
    [
      "a heading with no space after the hashes",
      "# T\n\n##Heading {#h}\n",
      3,
      "other than level 2",
    ],
    ["a table row", "# T\n\n| a | b |\n", 3, "outside the guide subset"],
    ["a code fence", "# T\n\n```\ncode\n```\n", 3, "outside the guide subset"],
    ["a quotation", "# T\n\n> quoted\n", 3, "outside the guide subset"],
    ["a numbered list", "# T\n\n1. first\n", 3, "outside the guide subset"],
    ["a star bullet", "# T\n\n* item\n", 3, "outside the guide subset"],
    ["a plus bullet", "# T\n\n+ item\n", 3, "outside the guide subset"],
    ["an indented code block", "# T\n\n    code\n", 3, "outside the guide subset"],
    [
      "a list followed directly by an unindented line",
      "# T\n\n- item\nnot indented\n",
      4,
      "not indented by two spaces",
    ],
    ["a nested list", "# T\n\n- item\n  - nested\n", 4, "a nested list"],
    ["an image", "# T\n\n![x](y.png)\n", 3, "an image"],
    ["a web link", "# T\n\n[x](https://example.com)\n", 3, "not another guide"],
    ["a link to a page not in the list", "# T\n\n[x](other.md)\n", 3, "not another guide"],
    ["a link with a bad section id", "# T\n\n[x](products.md#Bad Id)\n", 3, "not a section id"],
    ["a bracket that starts no link", "# T\n\n[x] alone\n", 3, "does not start a link"],
    ["an unclosed link target", "# T\n\n[x](products.md\n", 3, "not closed with )"],
    ["an unclosed bracket", "# T\n\n[x\n", 3, "an unclosed ["],
    ["an unclosed bold", "# T\n\nfirst line\nsecond **line\n", 4, "an unclosed **"],
    ["an unclosed code span", "# T\n\na `b\n", 3, "an unclosed `"],
    ["a lone star", "# T\n\na *lone* star\n", 3, "a single *"],
    ["a section id ending -heading", "# T\n\n## Units {#units-heading}\n", 3, 'ends "-heading"'],
    ["an empty heading", "# T\n\n## {#a}\n", 3, "no text"],
    ["an empty guide", "\n\n", 1, "an empty guide"],
  ])("refuses %s", (_name, markdown, line, found) => {
    expect(() => render(markdown)).toThrow(`line ${line}: `);
    expect(() => render(markdown)).toThrow(found);
  });
});
