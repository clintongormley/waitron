import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nodes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { readPeerNames, waitingPageRoute } from "./waiting-page.js";

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
