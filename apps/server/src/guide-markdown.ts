export interface GuideSection {
  id: string;
  heading: string;
}

export interface GuideLink {
  page: string;
  id?: string;
}

export interface RenderedGuide {
  title: string;
  html: string;
  sections: GuideSection[];
  links: GuideLink[];
}

const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/;
const NOT_EMPHASIS = "an _ that is neither inside a word nor emphasis";
const NUMBERED_ITEM = /^\d+[.)] /;
const RULE_OR_UNDERLINE = /^(?:-+|=+|\*+|_+)$/;
const HTML_ENTITY = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/y;

interface SourceLine {
  text: string;
  line: number;
}

interface LineStart {
  offset: number;
  line: number;
}

interface InlineContext {
  text: string;
  starts: LineStart[];
  pages: ReadonlySet<string>;
  links: GuideLink[];
}

function fail(line: number, what: string): never {
  throw new Error(`guide markdown, line ${line}: ${what}`);
}

function shown(text: string): string {
  return JSON.stringify(text.length > 60 ? `${text.slice(0, 60)}…` : text);
}

function escapeHtml(text: string): string {
  let out = "";
  for (const character of text) {
    switch (character) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&#39;";
        break;
      default:
        out += character;
    }
  }
  return out;
}

function failAt(context: InlineContext, offset: number, what: string): never {
  let line = context.starts[0]!.line;
  for (const start of context.starts) {
    if (start.offset > offset) break;
    line = start.line;
  }
  fail(line, what);
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && WHITESPACE.test(character);
}

function insideWord(text: string, index: number): boolean {
  return isWordCharacter(text[index - 1]) && isWordCharacter(text[index + 1]);
}

function findBefore(text: string, needle: string, from: number, to: number): number {
  const found = text.indexOf(needle, from);
  return found === -1 || found + needle.length > to ? -1 : found;
}

function closingEmphasis(text: string, from: number, to: number): number {
  for (let index = text.indexOf("_", from); index !== -1 && index < to;) {
    const closes =
      index > from &&
      !isWhitespace(text[index - 1]) &&
      (index + 1 === to || !isWordCharacter(text[index + 1]));
    if (closes) return index;
    index = text.indexOf("_", index + 1);
  }
  return -1;
}

function linkTarget(context: InlineContext, target: string, offset: number): string {
  const hash = target.indexOf("#");
  const file = hash === -1 ? target : target.slice(0, hash);
  const id = hash === -1 ? undefined : target.slice(hash + 1);
  const page = file.endsWith(".md") ? file.slice(0, -3) : undefined;
  if (page === undefined || !context.pages.has(page)) {
    failAt(context, offset, `a link to ${shown(target)}, which is not another guide`);
  }
  if (id !== undefined && !SECTION_ID.test(id)) {
    failAt(context, offset, `a link to the section ${shown(id)}, which is not a section id`);
  }
  context.links.push(id === undefined ? { page } : { page, id });
  return id === undefined ? page : `${page}#${id}`;
}

function renderInline(
  context: InlineContext,
  from: number,
  to: number,
  inEmphasis: boolean,
): string {
  const { text } = context;
  let out = "";
  let index = from;
  while (index < to) {
    const character = text[index]!;
    if (character === "`") {
      const close = findBefore(text, "`", index + 1, to);
      if (close === -1) failAt(context, index, "an unclosed `");
      out += `<code>${escapeHtml(text.slice(index + 1, close))}</code>`;
      index = close + 1;
    } else if (character === "*") {
      if (text[index + 1] !== "*") failAt(context, index, "a single * that is not part of **");
      if (isWhitespace(text[index + 2])) failAt(context, index, "an opening ** before a space");
      const close = findBefore(text, "**", index + 2, to);
      if (close === -1) failAt(context, index, "an unclosed **");
      if (close === index + 2) failAt(context, index, "an empty **");
      if (isWhitespace(text[close - 1])) failAt(context, close, "a closing ** after a space");
      out += `<strong>${renderInline(context, index + 2, close, inEmphasis)}</strong>`;
      index = close + 2;
    } else if (character === "!" && text[index + 1] === "[") {
      failAt(context, index, "an image");
    } else if (character === "[") {
      const close = findBefore(text, "]", index + 1, to);
      if (close === -1) failAt(context, index, "an unclosed [");
      if (text[close + 1] !== "(") failAt(context, index, "a [ that does not start a link");
      const end = findBefore(text, ")", close + 2, to);
      if (end === -1) failAt(context, index, "a link whose target is not closed with )");
      if (close === index + 1) failAt(context, index, "a link with no text");
      const href = linkTarget(context, text.slice(close + 2, end), index);
      out += `<a href="${escapeHtml(href)}">${renderInline(context, index + 1, close, inEmphasis)}</a>`;
      index = end + 1;
    } else if (character === "_" && !insideWord(text, index)) {
      if (inEmphasis) failAt(context, index, "emphasis inside emphasis");
      const opens =
        (index === from || text[index - 1] === " " || text[index - 1] === "(") &&
        !isWhitespace(text[index + 1]) &&
        text[index + 1] !== "_";
      const close = opens ? closingEmphasis(text, index + 1, to) : -1;
      if (close === -1) failAt(context, index, NOT_EMPHASIS);
      const inner = renderInline(context, index + 1, close, true);
      if (text[close - 1] === "_") failAt(context, close, NOT_EMPHASIS);
      out += `<em>${inner}</em>`;
      index = close + 1;
    } else {
      out += escapeHtml(character);
      index += 1;
    }
  }
  return out;
}

function renderLines(
  lines: readonly SourceLine[],
  pages: ReadonlySet<string>,
  links: GuideLink[],
): string {
  const starts: LineStart[] = [];
  let text = "";
  for (const { text: lineText, line } of lines) {
    if (starts.length > 0) text += " ";
    starts.push({ offset: text.length, line });
    text += lineText;
  }
  const context: InlineContext = { text, starts, pages, links };
  return renderInline(context, 0, text.length, false);
}

function refuseSourceShapes(text: string, line: number): void {
  if (text.includes("\\")) fail(line, "a backslash");
  if (text.includes("<!--")) fail(line, "an HTML comment");
  for (let index = text.indexOf("&"); index !== -1; index = text.indexOf("&", index + 1)) {
    HTML_ENTITY.lastIndex = index;
    if (HTML_ENTITY.test(text)) fail(line, "an HTML entity");
  }
  // An address cannot hold a space, so stopping at one keeps `<included menu>` as text and
  // keeps the scan linear: each stretch is read once, up to the next `<`.
  for (let index = text.indexOf("<"); index !== -1; index = text.indexOf("<", index + 1)) {
    let looksLikeAddress = false;
    for (let at = index + 1; at < text.length; at++) {
      const character = text[at];
      if (character === ">" && looksLikeAddress) fail(line, "an address in angle brackets");
      if (character === " " || character === ">" || character === "<") break;
      looksLikeAddress ||= character === ":" || character === "@";
    }
  }
}

function refuseHeadingFormatting(text: string, line: number): void {
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const formatting =
      character === "*" ||
      character === "`" ||
      character === "[" ||
      (character === "_" && !insideWord(text, index));
    if (formatting) fail(line, `formatting in a heading: ${shown(text)}`);
  }
}

function refuseBlockSyntax(text: string, line: number): void {
  const refused =
    text.startsWith("|") ||
    text.startsWith("```") ||
    text.startsWith(">") ||
    text.startsWith("* ") ||
    text.startsWith("+ ") ||
    text.startsWith(" ") ||
    text.startsWith("\t") ||
    RULE_OR_UNDERLINE.test(text) ||
    NUMBERED_ITEM.test(text);
  if (refused) fail(line, `a line outside the guide subset: ${shown(text)}`);
}

/** Throws `Error` naming the line number and what it found for anything outside the subset. */
export function renderGuide(markdown: string, pages: readonly string[]): RenderedGuide {
  const pageSet = new Set(pages);
  const lines = markdown.split("\n").map((text) => text.trimEnd());
  const blocks: string[] = [];
  const sections: GuideSection[] = [];
  const links: GuideLink[] = [];
  const ids = new Set<string>();
  let title: string | undefined;
  let index = 0;

  const isBlank = (at: number) => at >= lines.length || lines[at] === "";
  lines.forEach((text, at) => refuseSourceShapes(text, at + 1));

  while (index < lines.length) {
    const text = lines[index]!;
    const line = index + 1;
    if (text === "") {
      index += 1;
      continue;
    }
    if (title === undefined) {
      if (!text.startsWith("# "))
        fail(line, `the guide must start with "# Title", found ${shown(text)}`);
      title = text.slice(2).trim();
      if (title.includes("{#")) fail(line, "an id on the title");
      refuseHeadingFormatting(title, line);
      blocks.push(`<h1>${escapeHtml(title)}</h1>`);
      index += 1;
    } else if (text.startsWith("#")) {
      if (text.startsWith("# ")) fail(line, "a second level-1 heading");
      if (!text.startsWith("## ")) fail(line, `a heading other than level 2: ${shown(text)}`);
      const rest = text.slice(3);
      const open = rest.lastIndexOf("{#");
      if (open === -1 || (open > 0 && rest[open - 1] !== " ") || !rest.endsWith("}")) {
        fail(line, `a level-2 heading without {#id}: ${shown(text)}`);
      }
      const id = rest.slice(open + 2, -1);
      const heading = rest.slice(0, open).trim();
      if (heading.includes("{#")) fail(line, `a second {# in a heading: ${shown(text)}`);
      if (heading === "") fail(line, "a level-2 heading with no text");
      refuseHeadingFormatting(heading, line);
      if (!SECTION_ID.test(id))
        fail(line, `the section id ${shown(id)}, which is not a section id`);
      if (id.endsWith("-heading")) fail(line, `the section id ${shown(id)}, which ends "-heading"`);
      if (ids.has(id)) fail(line, `the section id ${shown(id)} a second time`);
      ids.add(id);
      if (sections.length > 0) blocks.push("</section>");
      sections.push({ id, heading });
      blocks.push(
        `<section id="${id}" aria-labelledby="${id}-heading"><h2 id="${id}-heading">${escapeHtml(heading)}</h2>`,
      );
      index += 1;
    } else if (text.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index]!.startsWith("- ")) {
        const item: SourceLine[] = [];
        const addItemLine = (itemText: string, itemLine: number) => {
          if (itemText.startsWith("- ")) fail(itemLine, "a nested list");
          refuseBlockSyntax(itemText, itemLine);
          item.push({ text: itemText, line: itemLine });
        };
        addItemLine(lines[index]!.slice(2), index + 1);
        index += 1;
        while (!isBlank(index) && !lines[index]!.startsWith("- ")) {
          const continued = lines[index]!;
          const continuedLine = index + 1;
          if (!continued.startsWith("  ") || continued[2] === " ") {
            fail(
              continuedLine,
              `a line after a list item that is not indented by two spaces: ${shown(continued)}`,
            );
          }
          addItemLine(continued.slice(2), continuedLine);
          index += 1;
        }
        items.push(`<li>${renderLines(item, pageSet, links)}</li>`);
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
    } else {
      const paragraph: SourceLine[] = [];
      while (!isBlank(index) && (paragraph.length === 0 || !/^(#|- )/.test(lines[index]!))) {
        const paragraphText = lines[index]!;
        refuseBlockSyntax(paragraphText, index + 1);
        paragraph.push({ text: paragraphText, line: index + 1 });
        index += 1;
      }
      blocks.push(`<p>${renderLines(paragraph, pageSet, links)}</p>`);
    }
  }

  if (title === undefined) fail(1, "an empty guide, with no level-1 heading");
  if (sections.length > 0) blocks.push("</section>");
  return { title, html: blocks.join("\n"), sections, links };
}
