import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationVersion } from "@waitron/db";
import type { LegalAbout } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import type { Context, Hono } from "hono";
import { boxPageAnswer, renderBoxPage } from "./guide-pages.js";
import { escapeHtml } from "./html-page.js";
import { DECLARATION_LINK_WORDS, DECLARATION_PAGE_WORDS } from "./i18n/declaration-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";

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
  | Damaged;

type Damaged = { kind: "damaged"; file: string; code?: string };

export interface DeclarationPagesDeps {
  /** The folder holding the release's four files; defaults to `declarationRoot()`. */
  root?: string;
  build?: string;
  /** The venue database's kept declarations; absent where no venue database is open. Asked per
   * request, because `bootServer` mounts the pages before it opens the venue. */
  kept?: () => KeptDeclarations | undefined;
}

export interface KeptDeclarations {
  versions(): Promise<string[]>;
  text(version: string): Promise<string | null>;
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

/** Whether the text has one `1.c)` line (`renderDeclaration`'s version item) ending `: <version>`. */
function declares(text: string, version: string): boolean {
  const lines = text.split("\n").filter((line) => line.startsWith("1.c) "));
  return lines.length === 1 && lines[0]!.endsWith(`: ${version}`);
}

function damaged(file: string, error?: unknown): Damaged {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? { kind: "damaged", file, code } : { kind: "damaged", file };
}

async function read(root: string, file: string): Promise<Buffer | Damaged> {
  try {
    return await readFile(join(root, file));
  } catch (error) {
    return damaged(file, error);
  }
}

export async function readDeclarationFolder(root: string): Promise<DeclarationFolder> {
  try {
    if (!(await stat(root)).isDirectory()) return damaged(".");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return damaged(".", error);
  }
  const json = await read(root, "release.json");
  if (!Buffer.isBuffer(json)) return json;
  const release = releaseFrom(json.toString("utf8"));
  if (release === undefined) return damaged("release.json");
  const html = await read(root, "declaration.html");
  if (!Buffer.isBuffer(html)) return html;
  const body = bodyOf(html.toString("utf8"));
  if (body === undefined) return damaged("declaration.html");
  const pdf = await read(root, "declaration.pdf");
  if (!Buffer.isBuffer(pdf)) return pdf;
  const txt = await read(root, "declaration.txt");
  if (!Buffer.isBuffer(txt)) return txt;
  const text = txt.toString("utf8");
  if (!declares(text, release.version)) return damaged("declaration.txt");
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

function parts(version: string): number[] {
  return version.split(".").map(Number);
}

/** The kept versions below `running`, lowest first, compared part by part as numbers. */
function earlierVersions(kept: readonly string[], running: string): string[] {
  const order = (a: string, b: string) => {
    const [x, y] = [parts(a), parts(b)];
    const at = x.findIndex((part, i) => part !== y[i]);
    return at < 0 ? 0 : x[at]! - y[at]!;
  };
  return kept.filter((version) => order(version, running) < 0).sort(order);
}

function fileName(version: string, ext: "pdf" | "txt"): string {
  return `waitron-${version}-declaration.${ext}`;
}

export function mountDeclarationPages(app: Hono, deps: DeclarationPagesDeps, log: Logger): void {
  const root = deps.root ?? declarationRoot();
  const build = deps.build ?? applicationVersion(process.env);

  async function folder(): Promise<DeclarationFolder> {
    const found = await readDeclarationFolder(root);
    if (found.kind === "damaged") {
      const { file, code } = found;
      log("warn", "declaration.folder_damaged", code === undefined ? { file } : { file, code });
    }
    return found;
  }

  function withRelease(
    serve: (
      c: Context,
      release: Extract<DeclarationFolder, { kind: "release" }>,
    ) => Response | Promise<Response>,
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

  const notFound = (c: Context) =>
    wordsPage(c, DECLARATION_PAGE_WORDS[languageOf(c)].notFoundTitle, undefined, 404);

  async function earlier(running: string): Promise<string[]> {
    const reader = deps.kept?.();
    if (reader === undefined) return [];
    try {
      return earlierVersions(await reader.versions(), running);
    } catch (error) {
      log("warn", "declaration.kept_read_failed", { errorCode: codeOf(error) });
      return [];
    }
  }

  app.get(
    "/legal/declaration",
    withRelease(async (c, release) => {
      const link = (ext: "pdf" | "txt", label: string) =>
        `<a href="/legal/declaration.${ext}" download="${escapeHtml(fileName(release.version, ext))}">${escapeHtml(label)}</a>`;
      const versions = await earlier(release.version);
      const list =
        versions.length === 0
          ? ""
          : `
<h2>${escapeHtml(DECLARATION_LINK_WORDS.earlierTitle)}</h2>
<ul>
${versions.map((v) => `<li><a href="/legal/declaration/${escapeHtml(v)}.txt">Waitron ${escapeHtml(v)}</a></li>`).join("\n")}
</ul>`;
      const body = `${release.body}
<p>${link("pdf", DECLARATION_LINK_WORDS.downloadPdf)} · ${link("txt", DECLARATION_LINK_WORDS.downloadText)}</p>${list}`;
      const title = `${DECLARATION_LINK_WORDS.title} ${release.version}`;
      return boxPageAnswer(c, renderBoxPage("es", title, body), 200);
    }),
  );

  app.get("/legal/declaration/:file", async (c) => {
    const version = /^(\d+\.\d+\.\d+)\.txt$/.exec(c.req.param("file"))?.[1];
    const reader = deps.kept?.();
    if (version === undefined || reader === undefined) return notFound(c);
    const text = await reader.text(version);
    if (text === null) return notFound(c);
    return c.body(text, 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="${fileName(version, "txt")}"`,
      "Cache-Control": "no-cache",
    });
  });

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

  app.get("/legal", notFound);
  app.get("/legal/*", notFound);
}
