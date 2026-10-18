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
const NUMBERED_ITEM = /^\d+\. /;

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

function lineAt(context: InlineContext, offset: number): number {
  let line = context.starts[0]!.line;
  for (const start of context.starts) {
    if (start.offset > offset) break;
    line = start.line;
  }
  return line;
}

function findBefore(text: string, needle: string, from: number, to: number): number {
  const found = text.indexOf(needle, from);
  return found === -1 || found + needle.length > to ? -1 : found;
}

function closingEmphasis(text: string, from: number, to: number): number {
  for (let index = text.indexOf("_", from); index !== -1 && index < to;) {
    const closes =
      index > from &&
      text[index - 1] !== " " &&
      (index + 1 === to || !WORD_CHARACTER.test(text[index + 1]!));
    if (closes) return index;
    index = text.indexOf("_", index + 1);
  }
  return -1;
}

function linkTarget(context: InlineContext, target: string, line: number): string {
  const hash = target.indexOf("#");
  const file = hash === -1 ? target : target.slice(0, hash);
  const id = hash === -1 ? undefined : target.slice(hash + 1);
  const page = file.endsWith(".md") ? file.slice(0, -3) : undefined;
  if (page === undefined || !context.pages.has(page)) {
    fail(line, `a link to ${shown(target)}, which is not another guide`);
  }
  if (id !== undefined && !SECTION_ID.test(id)) {
    fail(line, `a link to the section ${shown(id)}, which is not a section id`);
  }
  context.links.push(id === undefined ? { page } : { page, id });
  return id === undefined ? page : `${page}#${id}`;
}

function renderInline(context: InlineContext, from: number, to: number): string {
  const { text } = context;
  let out = "";
  let index = from;
  while (index < to) {
    const character = text[index]!;
    const line = lineAt(context, index);
    if (character === "`") {
      const close = findBefore(text, "`", index + 1, to);
      if (close === -1) fail(line, "an unclosed `");
      out += `<code>${escapeHtml(text.slice(index + 1, close))}</code>`;
      index = close + 1;
    } else if (character === "*") {
      if (text[index + 1] !== "*") fail(line, "a single * that is not part of **");
      const close = findBefore(text, "**", index + 2, to);
      if (close === -1) fail(line, "an unclosed **");
      out += `<strong>${renderInline(context, index + 2, close)}</strong>`;
      index = close + 2;
    } else if (character === "!" && text[index + 1] === "[") {
      fail(line, "an image");
    } else if (character === "[") {
      const close = findBefore(text, "]", index + 1, to);
      if (close === -1) fail(line, "an unclosed [");
      if (text[close + 1] !== "(") fail(line, "a [ that does not start a link");
      const end = findBefore(text, ")", close + 2, to);
      if (end === -1) fail(line, "a link whose target is not closed with )");
      const href = linkTarget(context, text.slice(close + 2, end), line);
      out += `<a href="${escapeHtml(href)}">${renderInline(context, index + 1, close)}</a>`;
      index = end + 1;
    } else if (
      character === "_" &&
      (index === from || text[index - 1] === " " || text[index - 1] === "(") &&
      text[index + 1] !== " "
    ) {
      const close = closingEmphasis(text, index + 1, to);
      if (close === -1) {
        out += "_";
        index += 1;
      } else {
        out += `<em>${renderInline(context, index + 1, close)}</em>`;
        index = close + 1;
      }
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
  return renderInline(context, 0, text.length);
}

function refuseBlockSyntax(text: string, line: number): void {
  const refused =
    text.startsWith("|") ||
    text.startsWith("```") ||
    text.startsWith(">") ||
    text.startsWith("* ") ||
    text.startsWith("+ ") ||
    text.startsWith(" ") ||
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

  while (index < lines.length) {
    const text = lines[index]!;
    const line = index + 1;
    if (text === "") {
      index += 1;
      continue;
    }
    refuseBlockSyntax(text, line);

    if (title === undefined) {
      if (!text.startsWith("# "))
        fail(line, `the guide must start with "# Title", found ${shown(text)}`);
      title = text.slice(2).trim();
      blocks.push(`<h1>${renderLines([{ text: title, line }], pageSet, links)}</h1>`);
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
      if (heading === "") fail(line, "a level-2 heading with no text");
      if (!SECTION_ID.test(id))
        fail(line, `the section id ${shown(id)}, which is not a section id`);
      if (id.endsWith("-heading")) fail(line, `the section id ${shown(id)}, which ends "-heading"`);
      if (ids.has(id)) fail(line, `the section id ${shown(id)} a second time`);
      ids.add(id);
      if (sections.length > 0) blocks.push("</section>");
      sections.push({ id, heading });
      blocks.push(
        `<section id="${id}" aria-labelledby="${id}-heading"><h2 id="${id}-heading">${renderLines([{ text: heading, line }], pageSet, links)}</h2>`,
      );
      index += 1;
    } else if (text.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index]!.startsWith("- ")) {
        const item: SourceLine[] = [{ text: lines[index]!.slice(2), line: index + 1 }];
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
          const continuedText = continued.slice(2);
          if (continuedText.startsWith("- ")) fail(continuedLine, "a nested list");
          refuseBlockSyntax(continuedText, continuedLine);
          item.push({ text: continuedText, line: continuedLine });
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
