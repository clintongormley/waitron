import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nodes } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { readPeerNames, renderWaitingPage, waitingPageRoute } from "./waiting-page.js";

async function page(names: readonly (string | null)[], language: string): Promise<string> {
  const app = new Hono();
  waitingPageRoute(
    () => Promise.resolve(names),
    () => {},
  )(app);
  const res = await app.request("/", { headers: { "accept-language": language } });
  expect(res.headers.get("cache-control")).toBe("no-store");
  return res.text();
}

describe("the waiting page", () => {
  it("speaks Spanish to a Spanish browser", async () => {
    const html = await page(["Spare"], "es-ES");
    expect(html).toContain("<h1>Este equipo está esperando a Spare</h1>");
    expect(html).toContain(
      "No hará ventas ni enviará nada a Hacienda hasta saber si <strong>Spare</strong> ha pasado a llevar el local. Vuelve a comprobarlo cada 15 segundos.",
    );
  });

  it("names every box it waits for, escaped", async () => {
    const html = await page(["Bar <b>", "Terrace"], "en-GB");
    expect(html).toContain("<h1>This box is waiting for Bar &lt;b&gt; and Terrace</h1>");
  });

  it("a name read that fails still answers the page, waiting for the other box", async () => {
    const log = vi.fn();
    const app = new Hono();
    waitingPageRoute(() => Promise.reject(new Error("database is closed")), log)(app);
    const res = await app.request("/", { headers: { "accept-language": "en-GB" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>This box is waiting for the other box</h1>");
    expect(log).toHaveBeenCalledWith("warn", "waiting_page.names_failed", expect.any(Object));
  });

  it("a carry-on form that fails to draw is logged, and the page still answers with a line to reload", async () => {
    for (const [language, line] of [
      [
        "en-GB",
        "The form to carry on as the main box could not be shown. Reload this page to try again.",
      ],
      [
        "es-ES",
        "No se ha podido mostrar el formulario para seguir como equipo principal. Vuelve a cargar esta página para intentarlo.",
      ],
    ] as const) {
      const log = vi.fn();
      const app = new Hono();
      waitingPageRoute(
        () => Promise.resolve(["Spare"]),
        log,
        () => Promise.reject(new Error("node.db is closed")),
      )(app);
      const res = await app.request("/", { headers: { "accept-language": language } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain(
        language === "en-GB"
          ? "<h1>This box is waiting for Spare</h1>"
          : "<h1>Este equipo está esperando a Spare</h1>",
      );
      expect(html).toContain(`<p>${line}</p>`);
      expect(log).toHaveBeenCalledWith("warn", "waiting_page.section_failed", {
        errorCode: "unknown",
        errno: null,
      });
    }
  });

  it("a carry-on form that fails with an app error logs its reason in place of an errno", async () => {
    const log = vi.fn();
    const app = new Hono();
    waitingPageRoute(
      () => Promise.resolve(["Spare"]),
      log,
      () =>
        Promise.reject(
          new AppError("shared.invalid_id", { kind: "DeviceId", value: "x" }, { reason: "r" }),
        ),
    )(app);
    expect((await app.request("/")).status).toBe(200);
    expect(log).toHaveBeenCalledWith("warn", "waiting_page.section_failed", {
      errorCode: "shared.invalid_id",
      reason: "r",
    });
  });

  it("marks its answer as the waiting page, so an open page can tell when the wait has ended", async () => {
    const app = new Hono();
    waitingPageRoute(
      () => Promise.resolve(["Spare"]),
      () => {},
    )(app);
    const res = await app.request("/");
    expect(res.headers.get("x-waitron-waiting")).toBe("1");
  });

  it("asks every 5 seconds whether it is still the waiting page, and leaves for the box's page once not", () => {
    const html = renderWaitingPage("Spare", "en-GB");
    expect(html).toContain("<script>");
    expect(html).toContain('fetch("/", { cache: "no-store" })');
    expect(html).toContain('response.headers.get("x-waitron-waiting") === null');
    expect(html).toContain('location.replace("/")');
    expect(html).toContain("5000");
  });

  it("with no box to name, waits for the other box", async () => {
    expect(await page([], "en-GB")).toContain("<h1>This box is waiting for the other box</h1>");
  });

  it("a box with no name is the other box, never its id", async () => {
    expect(await page([null, null], "es-ES")).toContain(
      "<h1>Este equipo está esperando a otro equipo</h1>",
    );
    expect(await page(["Bar", null], "en-GB")).toContain(
      "<h1>This box is waiting for Bar and the other box</h1>",
    );
  });
});

describe("readPeerNames", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  it("reads a box's name, and gives null where it has no row or no name", async () => {
    const venue = await setupVenue(suite.db);
    const own = venue.cfg.nodeId;
    await suite.db.update(nodes).set({ name: "Main" }).where(eq(nodes.id, own));
    expect(await readPeerNames(suite.db, [])).toEqual([]);
    expect(await readPeerNames(suite.db, [own, "unknown-box"])).toEqual(["Main", null]);
    await suite.db.update(nodes).set({ name: "" }).where(eq(nodes.id, own));
    expect(await readPeerNames(suite.db, [own])).toEqual([null]);
  });
});
