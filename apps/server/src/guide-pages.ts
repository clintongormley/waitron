import { createHash } from "node:crypto";
import { PAGE_THEME_SCRIPT as THEME_SCRIPT, PAGE_THEME_STYLE } from "./page-theme.js";
import type { Context, Hono } from "hono";
import { GUIDE_LANGUAGES, GUIDE_PAGES, guideRoot, readGuide } from "./guide-catalogue.js";
import { renderGuide } from "./guide-markdown.js";
import { GUIDE_FRAME_WORDS } from "./i18n/guide-pages.js";
import type { Logger } from "./logger.js";
import { escapeHtml } from "./html-page.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";
import type { SupportedLocale } from "@waitron/shared";

type GuideLanguage = (typeof GUIDE_LANGUAGES)[number];

export interface GuidePagesDeps {
  /** The folder holding `<language>/<page>.md`; defaults to `guideRoot()`. Injected by tests. */
  root?: string;
}

import { fixedFontValue, GUIDE_PAGE_TOKENS } from "./html-page-tokens.js";
export { GUIDE_PAGE_TOKENS } from "./html-page-tokens.js";

export { GUIDE_THEME_KEY } from "./page-theme.js";

const scriptSource = (script: string): string =>
  `'sha256-${createHash("sha256").update(script).digest("base64")}'`;

/** What a page's inline scripts beyond the theme script need from its policy. */
export interface BoxPageScripts {
  /** Allowed by their hashes. */
  inline: readonly string[];
  /** Lets them fetch from the page's own origin. */
  connectSelf: boolean;
  /** Lets the page's forms post to its own origin. */
  formSelf?: boolean;
}

const policy = ({ inline, connectSelf, formSelf }: BoxPageScripts): string =>
  `default-src 'none'; style-src 'unsafe-inline'; script-src ${[THEME_SCRIPT, ...inline].map(scriptSource).join(" ")}; ${connectSelf ? "connect-src 'self'; " : ""}base-uri 'none'; form-action ${formSelf === true ? "'self'" : "'none'"}; frame-ancestors 'self'`;

const CSP = policy({ inline: [], connectSelf: false });

function tokenDeclarations(): string {
  return Object.entries(GUIDE_PAGE_TOKENS)
    .map(([name, value]) =>
      typeof value === "string"
        ? `${name}: ${fixedFontValue(name, value)};`
        : `${name}: light-dark(${value[0]}, ${value[1]});`,
    )
    .join("\n");
}

const STYLE = `:root {
color-scheme: light dark;
${tokenDeclarations()}
}
${PAGE_THEME_STYLE}
body {
margin: 0;
background: var(--wt-color-bg);
color: var(--wt-color-text);
font-family: var(--wt-font-family);
font-size: var(--wt-font-size-md);
line-height: 1.5;
}
main {
max-width: 680px;
margin: 0 auto;
padding: var(--wt-space-5) var(--wt-space-5) var(--wt-space-6);
}
h1 { font-size: var(--wt-font-size-xl); margin: var(--wt-space-2) 0 var(--wt-space-4); }
h2 { font-size: var(--wt-font-size-lg); margin: 0 0 var(--wt-space-2); }
.trail, .notice { color: var(--wt-color-text-muted); margin: 0 0 var(--wt-space-2); }
section {
margin: var(--wt-space-4) 0;
padding: var(--wt-space-2) var(--wt-space-3);
border-radius: var(--wt-radius-md);
}
section:target {
scroll-margin-top: var(--wt-space-4);
background: var(--wt-color-highlight);
color: var(--wt-color-on-highlight);
border-inline-start: var(--wt-space-1) solid var(--wt-color-primary);
}
a { color: var(--wt-color-primary-text); overflow-wrap: anywhere; }
a:focus-visible { outline: var(--wt-focus-ring); outline-offset: var(--wt-focus-offset); }
code {
background: var(--wt-color-surface-sunken);
border: 1px solid var(--wt-color-border);
border-radius: var(--wt-radius-md);
padding: 0 var(--wt-space-1);
overflow-wrap: anywhere;
}
ul { padding-inline-start: var(--wt-space-5); }
@media (max-width: 480px) {
main { padding-inline: var(--wt-space-4); }
}`;

/** The guides' page look, shared with the `/legal/*` pages. */
export function renderBoxPage(
  lang: GuideLanguage,
  title: string,
  body: string,
  extraStyle = "",
): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Waitron</title>
<style>${STYLE}${extraStyle}</style>
<script>${THEME_SCRIPT}</script>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

const LOGO_PAGE_STYLE = `
.logo svg { display: block; }
p, li { overflow-wrap: anywhere; }`;

/** `renderBoxPage` under the Waitron logo, for a page read in a sign-in locale. */
export function renderLogoBoxPage(locale: SupportedLocale, title: string, body: string): string {
  return renderBoxPage(
    locale.startsWith("es") ? "es" : "en",
    title,
    `<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>\n${body}`,
    LOGO_PAGE_STYLE,
  );
}

export function boxPageAnswer(
  c: Context,
  html: string,
  status: 200 | 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503,
  cache: "no-cache" | "no-store" = "no-cache",
  scripts?: BoxPageScripts,
): Response {
  return c.html(html, status, {
    "Cache-Control": cache,
    "Content-Security-Policy": scripts === undefined ? CSP : policy(scripts),
  });
}

function notFound(c: Context, lang: GuideLanguage): Response {
  const text = GUIDE_FRAME_WORDS[lang];
  const links = GUIDE_PAGES.map(
    (name) => `<li><a href="/help/${lang}/${name}">${escapeHtml(text.names[name])}</a></li>`,
  ).join("");
  const body = `<p class="trail">${escapeHtml(text.trail)}</p>
<h1>${escapeHtml(text.notFoundTitle)}</h1>
<p>${escapeHtml(text.notFound)}</p>
<ul>${links}</ul>`;
  return boxPageAnswer(c, renderBoxPage(lang, text.notFoundTitle, body), 404);
}

function broken(c: Context, lang: GuideLanguage): Response {
  const text = GUIDE_FRAME_WORDS[lang];
  const body = `<p class="trail">${escapeHtml(text.trail)}</p>
<h1>${escapeHtml(text.brokenTitle)}</h1>
<p>${escapeHtml(text.broken)}</p>`;
  return boxPageAnswer(c, renderBoxPage(lang, text.brokenTitle, body), 500);
}

export function mountGuidePages(app: Hono, deps: GuidePagesDeps, log: Logger): void {
  const root = deps.root ?? guideRoot();

  app.get("/help/:lang/:page", (c) => {
    const requestedLang = c.req.param("lang");
    const requestedPage = c.req.param("page");
    // The file read below uses these list strings, never the request's.
    const lang = GUIDE_LANGUAGES.find((candidate) => candidate === requestedLang);
    const name = GUIDE_PAGES.find((candidate) => candidate === requestedPage);
    if (lang === undefined || name === undefined) {
      return notFound(c, lang ?? "en");
    }

    let shownLang: GuideLanguage = lang;
    let notice = "";
    let markdown;
    try {
      markdown = readGuide(root, lang, name);
      if (markdown === undefined && lang !== "en") {
        shownLang = "en";
        notice = `<p class="notice" lang="${lang}">${escapeHtml(GUIDE_FRAME_WORDS[lang].missingTwin)}</p>\n`;
        markdown = readGuide(root, "en", name);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      log("error", "guide.read_failed", { lang: shownLang, page: name, code });
      return broken(c, lang);
    }
    if (markdown === undefined) {
      log("error", "guide.page_missing", { lang: shownLang, page: name });
      return broken(c, lang);
    }

    let rendered;
    try {
      rendered = renderGuide(markdown, GUIDE_PAGES);
    } catch {
      log("error", "guide.render_failed", { lang: shownLang, page: name });
      return broken(c, lang);
    }

    const shownText = GUIDE_FRAME_WORDS[shownLang];
    const body = `<p class="trail">${escapeHtml(shownText.trail)} › ${escapeHtml(shownText.names[name])}</p>
${notice}${rendered.html}`;
    return boxPageAnswer(c, renderBoxPage(shownLang, rendered.title, body), 200);
  });

  app.get("/help/*", (c) => {
    const first = c.req.path.split("/")[2];
    return notFound(c, GUIDE_LANGUAGES.find((candidate) => candidate === first) ?? "en");
  });
}
