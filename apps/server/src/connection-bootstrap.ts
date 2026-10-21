import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { X509Certificate } from "node:crypto";
import {
  inspectBoxTls,
  repairBoxTls,
  readBoxPublicCa,
  type BoxTlsRepairDeps,
} from "./box-tls-repair.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";
import { trustDeviceForRequest } from "./detect-device.js";
import { connectionLocale } from "./connection-bootstrap-page.js";
import type { Logger } from "./logger.js";

export interface ConnectionBootstrapDeps extends BoxTlsRepairDeps {
  origins: string[];
  reachUrls: string[];
  onRepaired: () => Promise<void>;
  log: Logger;
  repairAllowed?: boolean;
  continuationRequired?: boolean;
}

async function emptyBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), 2000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        for (let i = 0; i < 16; i++) {
          const part = await reader.read();
          if (part.done) return true;
          if (part.value.byteLength > 0) return false;
        }
        return false;
      })(),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function mountConnectionBootstrap(
  app: Hono,
  deps: ConnectionBootstrapDeps,
  aliases = true,
): void {
  let transitioning = false;
  let transitionFailed = false;
  const publicPaths = aliases ? ["*"] : ["/setup/connection", "/setup-api/connection/repair"];
  for (const path of publicPaths)
    app.use(path, async (c, next) => {
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      await next();
    });
  app.on(
    "GET",
    aliases ? ["/", "/setup/connection", "/setup/trust"] : ["/setup/connection"],
    async (c) => {
      const status = await inspectBoxTls(deps);
      const html = renderTrustPage({
        caAvailable: status.caAvailable,
        caDownloadPath: "/ca.crt",
        httpsUrl: deps.reachUrls[0]!,
        reachUrls: deps.reachUrls,
        device: trustDeviceForRequest(c.req),
        connection: {
          ...status,
          repairAllowed: deps.repairAllowed,
          continuationRequired: transitionFailed || deps.continuationRequired,
        },
        locale: connectionLocale(c.req.query("lang") ?? c.req.header("accept-language")),
      });
      return c.html(html);
    },
  );
  if (aliases)
    app.on("GET", ["/ca.crt", "/setup-api/ca.crt"], async (c) => {
      const status = await inspectBoxTls(deps);
      if (status.caAvailable) {
        try {
          const pem = await readBoxPublicCa(deps.stateDir, deps.now());
          if (pem !== null && new X509Certificate(pem).fingerprint256 === status.fingerprint)
            return c.body(pem, 200, {
              "Content-Type": CA_CONTENT_TYPE,
              "Content-Disposition": `attachment; filename="${CA_FILENAME}"`,
            });
        } catch {
          // A failed public read cannot expose filesystem details on this unauthenticated surface.
        }
      }
      return c.json({ error: "no_box_ca" }, 404);
    });
  app.post("/setup-api/connection/repair", async (c) => {
    const request = c.req.raw;
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (
      deps.repairAllowed === false ||
      origin !== url.origin ||
      !deps.origins.includes(url.origin) ||
      (host !== null && host !== url.host) ||
      request.url.includes("?") ||
      ["cookie", "authorization", "proxy-authorization", "content-type"].some((name) =>
        request.headers.has(name),
      ) ||
      (request.headers.has("content-length") && request.headers.get("content-length") !== "0") ||
      !(await emptyBody(request))
    )
      return c.json({ error: "connection.refused" }, 403);
    try {
      const status = await repairBoxTls(deps);
      const outgoing = (c.env as Partial<HttpBindings> | undefined)?.outgoing;
      outgoing?.once("finish", () => {
        if (transitioning) return;
        transitioning = true;
        void deps.onRepaired().catch(() => {
          transitioning = false;
          transitionFailed = true;
          deps.log("warn", "connection.transition_failed");
        });
      });
      return c.json(status);
    } catch {
      return c.json({ error: "connection.repair_failed" }, 503);
    }
  });
}
