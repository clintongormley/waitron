import { en, es } from "./i18n/strings.js";

const activateImmediately = 'self.addEventListener("install", () => self.skipWaiting());';

const retryScript = `
document.querySelector("a").href = "http://" + location.hostname + "/setup/trust?app=till";
async function retry() {
  try {
    const reply = await fetch(location.href, {
      headers: { Accept: "text/html" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(4000)
    });
    if (reply.type === "opaqueredirect" || reply.status < 500) {
      location.reload();
      return;
    }
  } catch {}
  setTimeout(retry, 5000);
}
setTimeout(retry, 5000);
`;

function page(language: "en" | "es", words: typeof es, styles: string): string {
  return `<!doctype html>
<html lang="${language}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${words["offline.title"]}</title>
<style>${styles}</style>
<main>
  <h1>${words["offline.title"]}</h1>
  <p>${words["offline.wifi"]}</p>
  <p>${words["offline.already_on_wifi"]}</p>
  <p><a target="_blank" rel="noopener">${words["trust.open_setup"]}</a></p>
  <p>${words["offline.opens_itself"]}</p>
</main>
<script>${retryScript}</script>
</html>`;
}

export function buildOfflineWorker(styles: string): string {
  return `${activateImmediately}
const pages = ${JSON.stringify({ en: page("en", en, styles), es: page("es", es, styles) })};
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  const { origin, pathname } = new URL(request.url);
  if (origin !== self.location.origin ||
      !(pathname === "/till/" || pathname === "/till/tabs" || pathname.startsWith("/till/tabs/"))) return;
  event.respondWith(fetch(request, { cache: "no-store" }).catch(() => {
    const language = navigator.languages
      .map((value) => value.split("-")[0].toLowerCase())
      .find((value) => value === "en" || value === "es") ?? "en";
    return new Response(pages[language], {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }));
});
`;
}

export function buildRetiredOfflineWorker(): string {
  return `${activateImmediately}
self.addEventListener("activate", (event) => event.waitUntil(self.registration.unregister()));
`;
}
