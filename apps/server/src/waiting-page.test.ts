import vm from "node:vm";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mountBuiltApps } from "./spa-api.js";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nodes, writeNodeMembership } from "@waitron/db";
import type { SignedMembershipDocument } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupVenue } from "./testing/venue-fixtures.js";
import { renderWaitingPage, waitingPageRoute } from "./waiting-page.js";
import { readBoxAddresses } from "./restricted-page.js";

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

/** Runs the page's script against a stand-in clock, `fetch` and `location`. */
function openPage(
  answer: (url: string, init: RequestInit) => Promise<Response>,
  destination = "/",
) {
  const script = [
    ...renderWaitingPage("Spare", "en-GB", "", destination).matchAll(
      /<script>([\s\S]*?)<\/script>/g,
    ),
  ].at(-1)?.[1];
  if (script === undefined) throw new Error("the waiting page has no script");
  let now = 0;
  let nextId = 1;
  let timers: { id: number; at: number; run: () => void }[] = [];
  const add = (run: () => void, ms: number): number => {
    timers.push({ id: nextId, at: now + ms, run });
    return nextId++;
  };
  const deadlines: number[] = [];
  const fetch = vi.fn(answer);
  const replace = vi.fn();
  vm.runInNewContext(script, {
    fetch,
    location: { replace },
    setTimeout: add,
    AbortSignal: {
      timeout: (ms: number) => {
        deadlines.push(ms);
        const controller = new AbortController();
        add(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
        return controller.signal;
      },
    },
  });
  /** Runs every timer due in the next `ms`, in order, letting each one's promises settle. */
  const advance = async (ms: number): Promise<void> => {
    const until = now + ms;
    for (;;) {
      const due = timers
        .filter((timer) => timer.at <= until)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      now = due.at;
      timers = timers.filter((timer) => timer !== due);
      due.run();
      await new Promise((settled) => setImmediate(settled));
    }
    now = until;
  };
  return { fetch, replace, deadlines, advance };
}

describe("the waiting page", () => {
  it("speaks Spanish to a Spanish browser", async () => {
    const html = await page(["Spare"], "es-ES");
    expect(html).toContain("<h1>Este servidor está esperando a Spare</h1>");
    expect(html).toContain(
      "No hará ventas ni enviará nada a Hacienda hasta saber si <strong>Spare</strong> ha pasado a llevar el local. Vuelve a comprobarlo cada 15 segundos.",
    );
  });

  it("names every box it waits for, escaped", async () => {
    const html = await page(["Bar <b>", "Terrace"], "en-GB");
    expect(html).toContain("<h1>This box is waiting for Bar &lt;b&gt; and Terrace</h1>");
  });

  it("puts a section it is given in a section element before the page's script, and draws none without one", () => {
    expect(renderWaitingPage("Spare", "en-GB", "<p>Carry on</p>\n")).toContain(
      "<section>\n<p>Carry on</p>\n</section>\n<script>",
    );
    expect(renderWaitingPage("Spare", "en-GB")).not.toContain("<section>");
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
        "No se ha podido mostrar el formulario para seguir como servidor principal. Vuelve a cargar esta página para intentarlo.",
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
          : "<h1>Este servidor está esperando a Spare</h1>",
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

  it("asks 5 seconds after opening whether it is still the waiting page, and leaves for the box's page once a successful answer is not", async () => {
    const page = openPage(() => Promise.resolve(new Response(null, { status: 200 })));
    await page.advance(4_999);
    expect(page.fetch).not.toHaveBeenCalled();
    await page.advance(1);
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.fetch).toHaveBeenCalledWith("/", expect.objectContaining({ cache: "no-store" }));
    expect(page.replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("serves a saved till page while waiting and returns there after the peer answers", async () => {
    const app = new Hono();
    waitingPageRoute(
      () => Promise.resolve(["Spare"]),
      () => {},
    )(app);
    const response = await app.request("/till/tabs/counter?view=all", {
      headers: { accept: "text/html" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-waitron-waiting")).toBe("1");
    const root = await mkdtemp(join(tmpdir(), "waitron-peer-wait-page-"));
    try {
      await writeFile(join(root, "index.html"), "<html>till ready</html>");
      const ready = new Hono();
      mountBuiltApps(ready, { tillAppDir: root }, () => {});
      const page = openPage(
        async (url, init) => ready.request(url, init),
        "/till/tabs/counter?view=all",
      );
      await page.advance(5_000);
      expect((await page.fetch.mock.results[0]!.value).status).toBe(200);
      await vi.waitFor(() =>
        expect(page.replace).toHaveBeenCalledExactlyOnceWith("/till/tabs/counter?view=all"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    expect((await app.request("/api/working-orders")).status).toBe(404);
  });

  it("leaves asset requests outside the peer-wait page", async () => {
    const app = new Hono();
    waitingPageRoute(
      () => Promise.resolve(["Spare"]),
      () => {},
    )(app);
    const response = await app.request("/till/assets/app.js", { headers: { accept: "*/*" } });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toContain("text/html");
  });

  it("stays on the waiting page's own answer, a refusal or a failed fetch, and leaves at the next turn that answers otherwise", async () => {
    const answers: (() => Promise<Response>)[] = [
      () =>
        Promise.resolve(new Response(null, { status: 200, headers: { "X-Waitron-Waiting": "1" } })),
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve(new Response(null, { status: 200 })),
    ];
    const page = openPage(() => answers[page.fetch.mock.calls.length - 1]!());
    for (let turn = 1; turn <= 3; turn++) {
      await page.advance(5_000);
      expect(page.fetch).toHaveBeenCalledTimes(turn);
      expect(page.replace).not.toHaveBeenCalled();
    }
    await page.advance(5_000);
    expect(page.replace).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("asks no more while an answer is still on its way, gives it up after 5 seconds, and asks again 5 seconds later", async () => {
    const page = openPage((_url, init) =>
      page.fetch.mock.calls.length === 1
        ? new Promise((_answered, failed) =>
            init.signal?.addEventListener("abort", () => failed(init.signal?.reason)),
          )
        : Promise.resolve(new Response(null, { status: 200 })),
    );
    await page.advance(5_000);
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.deadlines).toEqual([5_000]);
    await page.advance(5_000);
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.replace).not.toHaveBeenCalled();
    await page.advance(5_000);
    expect(page.fetch).toHaveBeenCalledTimes(2);
    expect(page.replace).toHaveBeenCalledExactlyOnceWith("/");
    await page.advance(5_000);
    expect(page.fetch).toHaveBeenCalledTimes(2);
  });

  it("with no box to name, waits for the other box", async () => {
    expect(await page([], "en-GB")).toContain("<h1>This box is waiting for the other box</h1>");
  });

  it("a box with no name is the other box, never its id", async () => {
    expect(await page([null, null], "es-ES")).toContain(
      "<h1>Este servidor está esperando a otro servidor</h1>",
    );
    expect(await page(["Bar", null], "en-GB")).toContain(
      "<h1>This box is waiting for Bar and the other box</h1>",
    );
  });
});

describe("readBoxAddresses", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  it("names each box by its address in the held chart, or by nothing, never by its venue name", async () => {
    const venue = await setupVenue(suite.db);
    const own = venue.cfg.nodeId;
    await suite.db.update(nodes).set({ name: "Main" }).where(eq(nodes.id, own));
    expect(await readBoxAddresses(suite.db, [own])).toEqual([null]);
    await writeNodeMembership(suite.db, {
      body: {
        term: 1,
        nodes: [
          { nodeId: own, contactUrl: "https://main.example:8443/", standing: "serving-primary" },
          { nodeId: "no-address", contactUrl: "not an address", standing: "serving-secondary" },
        ],
      },
      signerNodeId: own,
      signature: "",
      endorsements: [],
    } as unknown as SignedMembershipDocument);
    expect(await readBoxAddresses(suite.db, [])).toEqual([]);
    expect(await readBoxAddresses(suite.db, [own, "no-address", "unknown-box"])).toEqual([
      "main.example:8443",
      null,
      null,
    ]);
  });
});
