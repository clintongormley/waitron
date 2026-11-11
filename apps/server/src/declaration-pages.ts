import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationVersion } from "@waitron/db";
import type { LegalAbout } from "@waitron/shared";
import type { Context, Hono } from "hono";
import { boxPageAnswer, renderBoxPage } from "./guide-pages.js";
import { DECLARATION_LINK_WORDS, DECLARATION_PAGE_WORDS } from "./i18n/declaration-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { escapeHtml } from "./recovery-surface.js";

export type DeclarationFolder =
  | {
      kind: "release";
      version: string;
      releasedOn: string;
      body: string;
      pdf: Uint8Array<ArrayBuffer>;
      text: string;
    }
  | { kind: "none" }
  | { kind: "damaged"; file: string };

export interface DeclarationPagesDeps {
  /** The folder holding the release's four files; defaults to `declarationRoot()`. */
  root?: string;
  build?: string;
}

/** `/app/declaration/` in the image, beside the bundle, as the guides are found. */
export function declarationRoot(): string {
  return fileURLToPath(new URL("./declaration/", import.meta.url));
}

function realDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function releaseFrom(json: string): { version: string; releasedOn: string } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { version, releasedOn } = value as Record<string, unknown>;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) return undefined;
  if (typeof releasedOn !== "string" || !realDate(releasedOn)) return undefined;
  return { version, releasedOn };
}

/** The text between the renderer's `<body>` and `</body>` lines (`renderDeclaration`). */
function bodyOf(html: string): string | undefined {
  const open = "<body>\n";
  const close = "\n</body>";
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (start < 0 || end < 0 || html.indexOf(open, start + 1) >= 0) return undefined;
  if (html.indexOf(close, end + 1) >= 0 || end < start + open.length) return undefined;
  return html.slice(start + open.length, end);
}

async function read(root: string, file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(join(root, file));
  } catch {
    return undefined;
  }
}

export async function readDeclarationFolder(root: string): Promise<DeclarationFolder> {
  try {
    if (!(await stat(root)).isDirectory()) return { kind: "damaged", file: "." };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "damaged", file: "." };
  }
  const json = await read(root, "release.json");
  const release = json === undefined ? undefined : releaseFrom(json.toString("utf8"));
  if (release === undefined) return { kind: "damaged", file: "release.json" };
  const html = await read(root, "declaration.html");
  const body = html === undefined ? undefined : bodyOf(html.toString("utf8"));
  if (body === undefined) return { kind: "damaged", file: "declaration.html" };
  const pdf = await read(root, "declaration.pdf");
  if (pdf === undefined) return { kind: "damaged", file: "declaration.pdf" };
  const text = (await read(root, "declaration.txt"))?.toString("utf8");
  // A release.json from another render names a version its declaration does not.
  if (text === undefined || !text.includes(release.version)) {
    return { kind: "damaged", file: "declaration.txt" };
  }
  return { kind: "release", ...release, body, pdf: new Uint8Array(pdf), text };
}

function languageOf(c: Context): "en" | "es" {
  return resolveLoginLocale(c.req.header("Accept-Language"), "en-GB").startsWith("es")
    ? "es"
    : "en";
}

function wordsPage(c: Context, title: string, text: string | undefined, status: 404 | 500) {
  c.header("Vary", "Accept-Language");
  const body = `<h1>${escapeHtml(title)}</h1>${text === undefined ? "" : `\n<p>${escapeHtml(text)}</p>`}`;
  return boxPageAnswer(c, renderBoxPage(languageOf(c), title, body), status);
}

function fileName(version: string, ext: "pdf" | "txt"): string {
  return `waitron-${version}-declaration.${ext}`;
}

export function mountDeclarationPages(app: Hono, deps: DeclarationPagesDeps, log: Logger): void {
  const root = deps.root ?? declarationRoot();
  const build = deps.build ?? applicationVersion(process.env);

  async function folder(): Promise<DeclarationFolder> {
    const found = await readDeclarationFolder(root);
    if (found.kind === "damaged") log("warn", "declaration.folder_damaged", { file: found.file });
    return found;
  }

  function withRelease(
    serve: (c: Context, release: Extract<DeclarationFolder, { kind: "release" }>) => Response,
  ) {
    return async (c: Context) => {
      const found = await folder();
      if (found.kind === "release") return serve(c, found);
      const words = DECLARATION_PAGE_WORDS[languageOf(c)];
      return found.kind === "none"
        ? wordsPage(c, words.noneTitle, words.none, 404)
        : wordsPage(c, words.damagedTitle, words.damaged, 500);
    };
  }

  app.get(
    "/legal/declaration",
    withRelease((c, release) => {
      const link = (ext: "pdf" | "txt", label: string) =>
        `<a href="/legal/declaration.${ext}" download="${escapeHtml(fileName(release.version, ext))}">${escapeHtml(label)}</a>`;
      const body = `${release.body}
<p>${link("pdf", DECLARATION_LINK_WORDS.downloadPdf)} · ${link("txt", DECLARATION_LINK_WORDS.downloadText)}</p>`;
      const title = `${DECLARATION_LINK_WORDS.title} ${release.version}`;
      return boxPageAnswer(c, renderBoxPage("es", title, body), 200);
    }),
  );

  for (const [ext, type] of [
    ["pdf", "application/pdf"],
    ["txt", "text/plain; charset=utf-8"],
  ] as const) {
    app.get(
      `/legal/declaration.${ext}`,
      withRelease((c, release) =>
        c.body(ext === "pdf" ? release.pdf : release.text, 200, {
          "Content-Type": type,
          "Content-Disposition": `inline; filename="${fileName(release.version, ext)}"`,
          "Cache-Control": "no-cache",
        }),
      ),
    );
  }

  app.get("/legal/about", async (c) => {
    const found = await folder();
    const answer: LegalAbout = {
      release:
        found.kind === "release" ? { version: found.version, releasedOn: found.releasedOn } : null,
      build,
    };
    return c.json(answer);
  });

  const notFound = (c: Context) =>
    wordsPage(c, DECLARATION_PAGE_WORDS[languageOf(c)].notFoundTitle, undefined, 404);
  app.get("/legal", notFound);
  app.get("/legal/*", notFound);
}
