import type { SupportedLocale } from "@waitron/shared";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isHttpsAddress(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** A paragraph linking `text` to `url`, or nothing unless `url` is an `https://` address. */
export function httpsLinkLine(url: string | null | undefined, text: string): string {
  return url != null && isHttpsAddress(url)
    ? `<p><a href="${escapeHtml(url)}">${escapeHtml(text)}</a></p>`
    : "";
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
