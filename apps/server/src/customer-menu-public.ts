import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import { isCustomerMenuAddress } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { startCloudTlsListener } from "./cloud-remote.js";
import { CUSTOMER_PHOTOS, type createPublicMenuView } from "./customer-menu-public-view.js";
import { escapeHtml } from "./html-page.js";
import type { Logger } from "./logger.js";

const PREFIX = "/_customer-menu/";
const SLOT = '<script type="application/json" id="customer-menu-data">';
const ICONS = new Set(["favicon.ico", "favicon.svg", "apple-touch-icon.png"]);
const SHORT_CACHE = "public, max-age=60";
const LONG_CACHE = "public, max-age=31536000, immutable";
const MAX_REPLY_BYTES = 2 * 1024 * 1024;
const MAX_ACTIVE = 8;
const MAX_PER_SECOND = 120;
const REQUEST_MS = 4000;
type PublicView = Pick<ReturnType<typeof createPublicMenuView>, "read" | "readPhoto">;

export function createCustomerMenuApp(
  root: string,
  view: PublicView,
  allowed: (request: Request) => Promise<boolean>,
  log: Logger,
  serving = () => true,
) {
  const index = readFileSync(join(root, "index.html"), "utf8");
  if (!index.includes(SLOT)) throw new Error("Customer menu snapshot slot missing");
  const assets = new Map<string, string>();
  for (const entry of readdirSync(root, { withFileTypes: true }))
    if (entry.isFile() && ICONS.has(entry.name)) assets.set(PREFIX + entry.name, entry.name);
  for (const entry of readdirSync(join(root, "assets"), { withFileTypes: true }))
    if (entry.isFile()) assets.set(PREFIX + "assets/" + entry.name, "assets/" + entry.name);

  const app = new Hono();
  let active = 0;
  let count = 0;
  let windowUntil = 0;
  app.all("*", async (c) => {
    const { method, url } = c.req.raw;
    const { pathname } = new URL(url);
    c.header("Cache-Control", "no-store");
    if ((method !== "GET" && method !== "HEAD") || !serving()) return c.notFound();
    const asset = assets.get(pathname);
    const photo = pathname.startsWith(CUSTOMER_PHOTOS);
    const [empty, address, language, extra] = pathname.split("/");
    const page =
      pathname === "/" ||
      (empty === "" &&
        extra === undefined &&
        address !== undefined &&
        isCustomerMenuAddress(address) &&
        (language === undefined || /^[a-z0-9-]+$/i.test(language)));
    if (!page && asset === undefined && !photo) return c.notFound();
    const query = url.includes("?");
    if (query && !page) return c.notFound();

    const now = performance.now();
    if (now >= windowUntil) {
      windowUntil = now + 1000;
      count = 0;
    }
    if (active >= MAX_ACTIVE || count >= MAX_PER_SECOND)
      return c.body(null, 429, { "Retry-After": "1" });
    count++;
    active++;

    const redirect = (path: string) =>
      c.body(null, 302, {
        Location: path,
        "Cache-Control": SHORT_CACHE,
      });
    const reply = (data: string | Uint8Array, contentType: string, cache: string) => {
      if (!serving()) return c.notFound();
      if (Buffer.byteLength(data) > MAX_REPLY_BYTES) return c.body(null, 503);
      return new Response(typeof data === "string" ? data : new Uint8Array(data), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": cache,
          "X-Content-Type-Options": "nosniff",
        },
      });
    };
    const send = async () => {
      if (!(await allowed(c.req.raw)) || !serving()) return c.notFound();
      if (asset !== undefined) {
        const bytes = await readFile(join(root, asset));
        return reply(
          bytes,
          getMimeType(asset) ?? "application/octet-stream",
          asset.startsWith("assets/") ? LONG_CACHE : SHORT_CACHE,
        );
      }
      if (photo) {
        const bytes = await view.readPhoto(pathname);
        return bytes === null ? c.notFound() : reply(bytes, "image/webp", LONG_CACHE);
      }
      const { menus } = await view.read();
      if (!serving()) return c.notFound();
      if (pathname === "/") {
        const entries = [...menus.values()].map((snapshots) => snapshots.values().next().value!);
        const first = entries[0];
        if (!first) return c.notFound();
        if (query) return redirect(pathname);
        if (entries.length === 1) return redirect(`/${first.address}/${first.defaultLanguage}`);
        const links = entries
          .map(
            (s) =>
              `<li><a href="/${s.address}/${s.defaultLanguage}">${escapeHtml(s.menu.name)}</a></li>`,
          )
          .join("");
        return reply(
          `<!doctype html><html lang="${first.defaultLanguage}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Menus</title><ul>${links}</ul></html>`,
          "text/html; charset=UTF-8",
          SHORT_CACHE,
        );
      }
      const snapshots = menus.get(address!);
      if (language === undefined) {
        const first = snapshots?.values().next().value;
        return first
          ? redirect(query ? pathname : `/${first.address}/${first.defaultLanguage}`)
          : c.notFound();
      }
      const snapshot = snapshots?.get(language);
      if (!snapshot) return c.notFound();
      if (query) return redirect(pathname);
      const html = index
        .replace('<html lang="en">', () => `<html lang="${language}">`)
        .replace("<title>Menu</title>", () => `<title>${escapeHtml(snapshot.menu.name)}</title>`)
        .replace(SLOT, () => SLOT + JSON.stringify(snapshot).replaceAll("<", "\\u003c"));
      return reply(html, "text/html; charset=UTF-8", SHORT_CACHE);
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = send()
      .catch((error) => {
        if (codeOf(error) === "image.busy") return c.body(null, 429, { "Retry-After": "1" });
        log("warn", "server.customer_menu_read_failed", { errorCode: codeOf(error) });
        return c.body(null, 503);
      })
      .finally(() => {
        active--;
      });
    try {
      return await Promise.race([
        work,
        new Promise<Response>((resolve) => {
          timer = setTimeout(() => resolve(c.body(null, 503)), REQUEST_MS);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
  return app;
}

export function startCustomerMenuListener(
  config: { root: string; socketPath: string; stateDir: string },
  view: PublicView,
  log: Logger,
  admitted: () => Promise<boolean>,
  serving?: () => boolean,
) {
  return startCloudTlsListener(
    config.stateDir,
    { socketPath: config.socketPath },
    "customer-menu",
    log,
    (hostname) => {
      const app = createCustomerMenuApp(
        config.root,
        view,
        async (request) => request.headers.get("host") === hostname() && (await admitted()),
        log,
        serving,
      );
      return (request, { incoming }) => {
        const socket = incoming.socket;
        const name = hostname();
        if (
          !(socket instanceof TLSSocket) ||
          name === undefined ||
          Reflect.get(socket, "servername") !== name
        )
          return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
        return app.fetch(request);
      };
    },
  );
}
