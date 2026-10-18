import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { GUIDE_LANGUAGES, GUIDE_PAGES, guideRoot, readGuide } from "./guide-catalogue.js";
import { renderGuide } from "./guide-markdown.js";
import type { Logger } from "./logger.js";
import { escapeHtml } from "./recovery-surface.js";

type GuideLanguage = (typeof GUIDE_LANGUAGES)[number];
type GuidePage = (typeof GUIDE_PAGES)[number];

export interface GuidePagesDeps {
  /** The folder holding `<language>/<page>.md`; defaults to `guideRoot()`. Injected by tests. */
  root?: string;
}

/** Copies of `packages/ui-core/src/tokens/*.css`, as [light, dark] or one value; `scripts/guide-page-tokens.test.ts` compares them. */
export const GUIDE_PAGE_TOKENS: Readonly<Record<string, readonly [string, string] | string>> = {
  "--wt-color-bg": ["#f7f7f8", "#101216"],
  "--wt-color-surface-sunken": ["#d6d9e0", "#101216"],
  "--wt-color-border": ["#d6d9e0", "#333945"],
  "--wt-color-text": ["#16181d", "#eceef2"],
  "--wt-color-text-muted": ["#5c626e", "#a1a7b3"],
  "--wt-color-primary": ["#1f6feb", "#4c8dff"],
  "--wt-color-primary-text": ["#1a5fd0", "#78a9ff"],
  "--wt-color-focus": ["#1f6feb", "#4c8dff"],
  "--wt-color-highlight": ["#fff3b0", "#614a0f"],
  "--wt-color-on-highlight": ["#241500", "#fff3b0"],
  "--wt-space-1": "4px",
  "--wt-space-2": "8px",
  "--wt-space-3": "12px",
  "--wt-space-4": "16px",
  "--wt-space-5": "24px",
  "--wt-space-6": "32px",
  "--wt-radius-md": "8px",
  "--wt-focus-ring": "2px solid var(--wt-color-focus)",
  "--wt-focus-offset": "2px",
  "--wt-font-family": 'system-ui, -apple-system, "Segoe UI", sans-serif',
  "--wt-font-size-md": "14px",
  "--wt-font-size-lg": "18px",
  "--wt-font-size-xl": "22px",
};

/** The `localStorage` key the apps save the chosen theme under (`packages/ui/src/theme-choice.ts`). */
export const GUIDE_THEME_KEY = "waitron-theme";

const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(GUIDE_THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;

interface GuideWords {
  trail: string;
  names: Record<GuidePage, string>;
  notFoundTitle: string;
  notFound: string;
  brokenTitle: string;
  broken: string;
}

/** English is required, so only a translation carries the line saying its page fell back to English. */
const GUIDE_TEXT: { en: GuideWords; es: GuideWords & { missingTwin: string } } = {
  en: {
    trail: "Waitron guide",
    names: {
      products: "Products",
      modifiers: "Modifiers",
      "content-and-images": "Languages and photos",
    },
    notFoundTitle: "Page not found",
    notFound: "There is no guide page at this address.",
    brokenTitle: "Page unavailable",
    broken: "This guide page could not be shown.",
  },
  es: {
    trail: "Guía de Waitron",
    names: {
      products: "Productos",
      modifiers: "Modificadores",
      "content-and-images": "Idiomas y fotos",
    },
    missingTwin: "Esta página aún no está en español. Se muestra en inglés.",
    notFoundTitle: "Página no encontrada",
    notFound: "No hay ninguna página de la guía en esta dirección.",
    brokenTitle: "Página no disponible",
    broken: "No se ha podido mostrar esta página de la guía.",
  },
};

function tokenDeclarations(): string {
  return Object.entries(GUIDE_PAGE_TOKENS)
    .map(([name, value]) =>
      typeof value === "string"
        ? `${name}: ${value};`
        : `${name}: light-dark(${value[0]}, ${value[1]});`,
    )
    .join("\n");
}

const STYLE = `:root {
color-scheme: light dark;
${tokenDeclarations()}
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
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

function page(lang: GuideLanguage, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Waitron</title>
<style>${STYLE}</style>
<script>${THEME_SCRIPT}</script>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function answer(c: Context, html: string, status: 200 | 404 | 500): Response {
  return c.html(html, status, { "Cache-Control": "no-cache", "Content-Security-Policy": CSP });
}

function notFound(c: Context, lang: GuideLanguage): Response {
  const text = GUIDE_TEXT[lang];
  const links = GUIDE_PAGES.map(
    (name) => `<li><a href="/help/${lang}/${name}">${escapeHtml(text.names[name])}</a></li>`,
  ).join("");
  const body = `<p class="trail">${escapeHtml(text.trail)}</p>
<h1>${escapeHtml(text.notFoundTitle)}</h1>
<p>${escapeHtml(text.notFound)}</p>
<ul>${links}</ul>`;
  return answer(c, page(lang, text.notFoundTitle, body), 404);
}

function broken(c: Context, lang: GuideLanguage): Response {
  const text = GUIDE_TEXT[lang];
  const body = `<p class="trail">${escapeHtml(text.trail)}</p>
<h1>${escapeHtml(text.brokenTitle)}</h1>
<p>${escapeHtml(text.broken)}</p>`;
  return answer(c, page(lang, text.brokenTitle, body), 500);
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
        notice = `<p class="notice" lang="${lang}">${escapeHtml(GUIDE_TEXT[lang].missingTwin)}</p>\n`;
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

    const shownText = GUIDE_TEXT[shownLang];
    const body = `<p class="trail">${escapeHtml(shownText.trail)} › ${escapeHtml(shownText.names[name])}</p>
${notice}${rendered.html}`;
    return answer(c, page(shownLang, rendered.title, body), 200);
  });

  app.get("/help/*", (c) => {
    const first = c.req.path.split("/")[2];
    return notFound(c, GUIDE_LANGUAGES.find((candidate) => candidate === first) ?? "en");
  });
}
