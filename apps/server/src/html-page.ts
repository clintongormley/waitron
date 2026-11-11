import type { SupportedLocale } from "@waitron/shared";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A whole page: `title` as its heading, then `body`, which is HTML the caller has escaped. */
export function renderDocument(
  locale: SupportedLocale,
  title: string,
  body: string,
  head = "",
): string {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}<title>${escapeHtml(title)}</title>
<style>:root { color-scheme: light dark; } h1, h2, p { overflow-wrap: anywhere; }</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}</body>
</html>
`;
}
