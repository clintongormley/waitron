import { escapeHtml } from "./html-page.js";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  nodes,
  withNodeTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import type { SignedMembershipDocument } from "@waitron/membership";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import type { HandoverBinding, HandoverScenario } from "@waitron/handover";
import type { NodeStanding } from "@waitron/membership";
import {
  appendHandoverEventTx,
  NODE_MIGRATIONS,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import { advanceHandover, beginHandover } from "./handover-store.js";
import type { ReturnState } from "./return-records.js";
import {
  readSuccessor,
  restrictedPageRoute,
  successorText,
  type RestrictedPageDeps,
} from "./restricted-page.js";
import {
  RESTRICTED_PAGE_WORDS,
  RESTRICTED_RESET_WORDS,
  RESTRICTED_RETURN_WORDS,
} from "./i18n/restricted-page.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECEIVER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });

async function seedSuccessor(name: string | null): Promise<string> {
  await seedVenue(suite.db);
  const id = await seedNode(suite.db);
  if (name === null) {
    await suite.db.delete(nodes).where(eq(nodes.id, id));
  } else {
    await suite.db.update(nodes).set({ name }).where(eq(nodes.id, id));
  }
  return id;
}

async function handOver(
  successor: string,
  scenario: HandoverScenario = "controlled",
): Promise<void> {
  const binding: HandoverBinding = {
    operationId: OP,
    scenario,
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: NODE,
    destinationNodeId: successor,
    membership: { term: 3, digest: "a".repeat(64) },
  };
  const deps = { node: suite.node, nodeId: NODE };
  await beginHandover(deps, binding, "source");
  if (scenario === "controlled") await advanceHandover(deps, OP, "source_stepped_down", {});
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: NODE,
      operationId: OP,
      kind: scenario === "controlled" ? "handed-over" : "superseded",
      successorNodeId: successor,
      membershipTerm: 3,
    }),
  );
}

async function holdNodes(
  chartNodes: SignedMembershipDocument["body"]["nodes"],
  term = 3,
): Promise<void> {
  await writeNodeMembership(suite.db, {
    body: { term, nodes: chartNodes },
    signerNodeId: NODE,
    signature: "not-verified-by-this-read",
    endorsements: [],
  });
}

async function holdChart(
  successor: string,
  contactUrl: string,
  standing: NodeStanding = "serving-primary",
): Promise<void> {
  await holdNodes([
    { nodeId: NODE, contactUrl: "https://old-box.example", standing: "sell-only" },
    { nodeId: successor, contactUrl, standing },
  ]);
}

const logged: { level: string; event: string; fields?: Record<string, unknown> }[] = [];

function request(
  language: string,
  venue: Database = suite.db,
  returnState?: ReturnState,
  path = "/",
  method = "GET",
  extra: Pick<RestrictedPageDeps, "resetOrdered" | "resetPhase"> = {},
): Promise<Response> {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("requestId", "request-1");
    await next();
  });
  restrictedPageRoute({
    venue,
    node: suite.node,
    nodeId: NODE,
    returnState: () => returnState ?? "waiting",
    log: (level, event, fields) => logged.push({ level, event, fields }),
    ...extra,
  })(app);
  return Promise.resolve(app.request(path, { method, headers: { "Accept-Language": language } }));
}

async function page(language: string): Promise<{ status: number; html: string }> {
  const response = await request(language);
  return { status: response.status, html: await response.text() };
}

function inOrder(html: string, lines: readonly string[]): void {
  const positions = lines.map((line) => html.indexOf(line));
  for (const [index, position] of positions.entries()) {
    expect({ line: lines[index], found: position >= 0 }).toEqual({
      line: lines[index],
      found: true,
    });
  }
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

const WORDS = {
  "en-GB": {
    dashboard: "Open the dashboard on the new main box.",
    waiting:
      "This box is still sending its invoice records to the main box. Keep it switched on and connected; it keeps trying by itself.",
    "needs-attention":
      "The main box did not accept this box's invoice records. Keep this box switched on; it tries again by itself.",
    clock:
      "The main box's clock is behind this box's invoice records. Check the time on both boxes; the return tries again by itself.",
    clash:
      "The return stopped: some payments on this box differ from the main box's. Keep both boxes switched on with their data. Once the main box accepts the difference, switch this box off and on.",
    "record-clash":
      "The return stopped: an invoice record on this box clashes with one on the main box. Carry on selling on the main box, and keep this box's data.",
  },
  "es-ES": {
    dashboard: "Abrir el panel en el nuevo servidor principal.",
    waiting:
      "Este servidor aún está enviando sus registros de facturación al servidor principal. Mantenlo encendido y conectado; lo sigue intentando por sí mismo.",
    "needs-attention":
      "El servidor principal no ha aceptado los registros de facturación de este servidor. Mantenlo encendido; lo vuelve a intentar por sí mismo.",
    clock:
      "El reloj del servidor principal va por detrás de los registros de facturación de este servidor. Comprueba la hora de ambos servidores; la devolución se vuelve a intentar por sí misma.",
    clash:
      "La devolución se ha detenido: algunos pagos de este servidor no coinciden con los del servidor principal. Mantén ambos servidores encendidos con sus datos. Cuando el servidor principal acepte la diferencia, apaga y enciende este servidor.",
    "record-clash":
      "La devolución se ha detenido: un registro de facturación de este servidor choca con uno del servidor principal. Sigue vendiendo con el servidor principal y conserva los datos de este servidor.",
  },
} as const;

const LANGUAGES = [
  ["en-GB", "en-GB,en;q=0.9", "en"],
  ["es-ES", "es-ES,es;q=0.9", "es"],
] as const;

/** Every `<p>` on the page, as written. */
function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p>[\s\S]*?<\/p>/g)].map((match) => match[0]);
}

async function recordConfirmedReturn(destinationNodeId: string): Promise<void> {
  await withNodeTransaction(suite.node, (tx) =>
    appendHandoverEventTx(tx, {
      nodeId: NODE,
      operationId: OP,
      kind: "return_confirmed",
      detail: { destinationNodeId, inventory: "a".repeat(64) },
      envelope: "{}",
    }),
  );
}

describe("the restricted box's own page", () => {
  it.each(LANGUAGES)(
    "shows only the heading and the dashboard link when all is well, in %s",
    async (locale, header, lang) => {
      const successor = await seedSuccessor("Bar counter box");
      // Recorded steps, a chart naming the successor main and a planned handover: everything that
      // could draw a step list, a successor sentence or a Progress link.
      await handOver(successor);
      await withNodeTransaction(suite.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP,
          kind: "final_state",
          detail: {},
          envelope: "{}",
        }),
      );
      await holdChart(successor, "https://bar-counter.example");
      const response = await request(header, suite.db, "confirmed");
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain(`<html lang="${lang}">`);
      inOrder(html, [
        `<h1>${escapeHtml(RESTRICTED_PAGE_WORDS[locale].title)}</h1>`,
        `<p><a href="https://bar-counter.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
      ]);
      expect(paragraphs(html)).toEqual([
        `<p><a href="https://bar-counter.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
      ]);
      expect(html).not.toContain("bar-counter.example</strong>");
      expect(html).not.toMatch(/<h2|<ul|<li/);
      expect(html).not.toContain(`>${RESTRICTED_PAGE_WORDS[locale].progress}<`);
      expect(html).not.toContain("/handover/");
      expect(html).not.toMatch(/Handover begun|Traspaso iniciado|tax agency|Hacienda/);
    },
  );

  it.each(
    LANGUAGES.flatMap(([locale, header]) =>
      (["waiting", "sending", "needs-attention", "clock", "clash", "record-clash"] as const).map(
        (state) => [locale, header, state] as const,
      ),
    ),
  )(
    "shows one line for the return while it needs the person, in %s (%s), while %s",
    async (locale, header, state) => {
      const successor = await seedSuccessor("Bar counter box");
      await handOver(successor);
      await holdChart(successor, "https://bar-counter.example");
      await recordConfirmedReturn(successor);
      const html = await (await request(header, suite.db, state)).text();
      const line = WORDS[locale][state === "sending" ? "waiting" : state];
      expect(RESTRICTED_RETURN_WORDS[locale][state]).toBe(line);
      expect(paragraphs(html)).toEqual([
        `<p><a href="https://bar-counter.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
        `<p>${escapeHtml(line)}</p>`,
      ]);
    },
  );

  it.each([
    ["https://new-box.example", true],
    ["javascript:alert(1);//", false],
  ] as const)(
    "links Progress during an unfinished planned handover only at a web address: %s",
    async (contactUrl, linked) => {
      const successor = await seedSuccessor("Counter box");
      await handOver(successor);
      await writeNodeMembership(suite.db, {
        body: {
          term: 3,
          nodes: [
            { nodeId: NODE, contactUrl: "https://old-box.example", standing: "serving-primary" },
            { nodeId: successor, contactUrl, standing: "serving-secondary" },
          ],
        },
        signerNodeId: NODE,
        signature: "not-verified-by-this-read",
        endorsements: [],
      });
      for (const [locale, header] of LANGUAGES) {
        const result = await request(header, suite.db, "waiting");
        expect(result.status).toBe(200);
        const html = await result.text();
        if (linked)
          expect(paragraphs(html)).toEqual([
            `<p><a href="${contactUrl}">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
            `<p>${escapeHtml(WORDS[locale].waiting)}</p>`,
            `<p><a href="${contactUrl}/handover/${OP}">${RESTRICTED_PAGE_WORDS[locale].progress}</a></p>`,
          ]);
        else expect(html).not.toContain("<a ");
      }
    },
  );

  it.each(["waiting", "sending", "needs-attention", "clock", "record-clash"] as const)(
    "keeps Progress while %s says nothing of the new main box having started",
    async (state) => {
      const successor = await seedSuccessor("Counter box");
      await handOver(successor);
      await holdChart(successor, "https://new-box.example", "serving-secondary");
      const html = await (await request("en-GB", suite.db, state)).text();
      expect(html).toContain(`<a href="https://new-box.example/handover/${OP}">Progress</a>`);
    },
  );

  it.each([
    ["the return is confirmed", "confirmed", false],
    ["the main box answered with a payment clash", "clash", false],
    ["this box holds the main box's confirmation from an earlier start", "waiting", true],
  ] as const)(
    "hides Progress once the new main box has started: %s",
    async (_, state, recorded) => {
      const successor = await seedSuccessor("Counter box");
      await handOver(successor);
      await holdChart(successor, "https://new-box.example", "serving-secondary");
      const before = await (await request("en-GB", suite.db, "waiting")).text();
      expect(before).toContain(`/handover/${OP}">Progress</a>`);
      if (recorded) await recordConfirmedReturn(successor);
      for (const [locale, header] of LANGUAGES) {
        const html = await (await request(header, suite.db, state)).text();
        expect(html).toContain(`<a href="https://new-box.example">`);
        expect(html).not.toContain("/handover/");
        expect(html).not.toContain(`>${RESTRICTED_PAGE_WORDS[locale].progress}<`);
      }
    },
  );

  it("links the dashboard to the box a newer chart names main, and drops Progress", async () => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    await holdChart(successor, "https://planned.example", "serving-secondary");
    const before = await (await request("en-GB", suite.db, "waiting")).text();
    expect(before).toContain(`<a href="https://planned.example/handover/${OP}">Progress</a>`);
    await holdNodes(
      [
        { nodeId: NODE, contactUrl: "https://old-box.example", standing: "sell-only" },
        { nodeId: successor, contactUrl: "https://planned.example", standing: "sell-only" },
        { nodeId: RECEIVER, contactUrl: "https://receiver.example", standing: "serving-primary" },
      ],
      5,
    );
    for (const [locale, header] of LANGUAGES) {
      const html = await (await request(header, suite.db, "waiting")).text();
      expect(paragraphs(html)).toEqual([
        `<p><a href="https://receiver.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
        `<p>${escapeHtml(WORDS[locale].waiting)}</p>`,
      ]);
    }
  });

  it("drops Progress once the chart names the box taking over main, before any receipt", async () => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    await holdNodes([
      { nodeId: NODE, contactUrl: "https://old-box.example", standing: "serving-primary" },
      { nodeId: successor, contactUrl: "https://new-box.example", standing: "serving-secondary" },
    ]);
    const before = await (await request("en-GB", suite.db, "waiting")).text();
    expect(before).toContain(`<a href="https://new-box.example/handover/${OP}">Progress</a>`);
    await holdNodes(
      [
        { nodeId: NODE, contactUrl: "https://old-box.example", standing: "sell-only" },
        { nodeId: successor, contactUrl: "https://new-box.example", standing: "serving-primary" },
      ],
      4,
    );
    for (const [locale, header] of LANGUAGES) {
      const html = await (await request(header, suite.db, "waiting")).text();
      expect(paragraphs(html)).toEqual([
        `<p><a href="https://new-box.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
        `<p>${escapeHtml(WORDS[locale].waiting)}</p>`,
      ]);
    }
  });

  it("follows the handover, not the chart's other boxes, while the chart still names this box main", async () => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    await holdNodes([
      { nodeId: NODE, contactUrl: "https://old-box.example", standing: "serving-primary" },
      { nodeId: RECEIVER, contactUrl: "https://other.example", standing: "serving-secondary" },
      { nodeId: successor, contactUrl: "https://new-box.example", standing: "serving-secondary" },
    ]);
    for (const [locale, header] of LANGUAGES) {
      const html = await (await request(header, suite.db, "waiting")).text();
      expect(paragraphs(html)).toEqual([
        `<p><a href="https://new-box.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
        `<p>${escapeHtml(WORDS[locale].waiting)}</p>`,
        `<p><a href="https://new-box.example/handover/${OP}">${RESTRICTED_PAGE_WORDS[locale].progress}</a></p>`,
      ]);
    }
  });

  it("never links Progress after an emergency switch", async () => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor, "emergency");
    await holdChart(successor, "https://new-box.example", "serving-secondary");
    for (const [locale, header] of LANGUAGES) {
      const html = await (await request(header, suite.db, "waiting")).text();
      expect(paragraphs(html)).toEqual([
        `<p><a href="https://new-box.example">${escapeHtml(WORDS[locale].dashboard)}</a></p>`,
        `<p>${escapeHtml(WORDS[locale].waiting)}</p>`,
      ]);
    }
  });

  it("does not link Progress for a planned handover that was replaced", async () => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    await advanceHandover({ node: suite.node, nodeId: NODE }, OP, "replaced", {});
    await holdChart(successor, "https://new-box.example", "serving-secondary");
    const html = await (await request("en-GB", suite.db, "waiting")).text();
    expect(html).toContain(`<a href="https://new-box.example">`);
    expect(html).not.toContain("/handover/");
  });

  it("carries no form", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    for (const language of ["en-GB", "es-ES"]) {
      const { html } = await page(language);
      expect(html).toContain("<h1>");
      expect(html).not.toMatch(/<form|<button|<input|<select|<textarea/);
    }
  });

  it.each([
    ["en-GB", "en", "This page could not be shown."],
    ["es-ES", "es", "No se ha podido mostrar esta página."],
  ])(
    "answers a failure to read with a page in the reader's language (%s), and logs it",
    async (language, lang, heading) => {
      // No restriction row: the read fails the way a fault in Waitron would.
      logged.length = 0;
      const response = await request(language);
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toMatch(/^text\/html/);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain(`<html lang="${lang}">`);
      expect(html).toContain(`<h1>${heading}</h1>`);
      expect(html).not.toContain("server.internal");
      expect(logged).toEqual([
        {
          level: "error",
          event: "restricted_page.failed",
          fields: { errorCode: "unknown", requestId: "request-1" },
        },
      ]);
    },
  );

  it("shows the page without its links, and logs both, when the venue's copy cannot be read", async () => {
    const successor = await seedSuccessor("Bar counter box");
    await handOver(successor);
    await holdChart(successor, "https://bar-counter.example", "serving-secondary");
    expect(await (await request("en-GB")).text()).toContain(`/handover/${OP}">Progress</a>`);
    logged.length = 0;
    const venue = new Proxy(suite.db, {
      get: (target, key) => {
        if (key === "select") {
          return () => {
            throw new Error("disk I/O error");
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const response = await request("en-GB", venue);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(paragraphs(html)).toEqual([`<p>${escapeHtml(WORDS["en-GB"].waiting)}</p>`]);
    expect(logged).toEqual([
      {
        level: "warn",
        event: "restricted_page.successor_link_failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
      {
        level: "warn",
        event: "restricted_page.progress_link_failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
    ]);
  });

  it("links no Progress for a supersession learnt from a newer list of machines alone", async () => {
    const successor = await seedSuccessor("Bar counter box");
    await holdChart(successor, "https://bar-counter.example");
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: NODE,
        operationId: null,
        kind: "superseded",
        successorNodeId: successor,
        membershipTerm: 4,
      }),
    );
    const { html } = await page("en-GB");
    expect(paragraphs(html)).toEqual([
      `<p><a href="https://bar-counter.example">${escapeHtml(WORDS["en-GB"].dashboard)}</a></p>`,
      `<p>${escapeHtml(WORDS["en-GB"].waiting)}</p>`,
    ]);
  });

  it.each(["en-GB", "es-ES"] as const)(
    "escapes the dashboard link's address in %s",
    async (language) => {
      const successor = await seedSuccessor("Main <box>");
      await handOver(successor);
      await holdChart(successor, "https://a&b.example");
      const html = await (await request(language, suite.db, "record-clash")).text();
      expect(html).toContain(`<a href="https://a&amp;b.example">`);
      expect(html).not.toContain("a&b.example");
      expect(html).not.toContain("Main <box>");
    },
  );
});

/** How the waiting page's "Carry on" (`carry-on.ts`) names the box this one handed over to. */
describe("the successor's name", () => {
  async function named(successor: string, locale: "en-GB" | "es-ES" = "en-GB"): Promise<string> {
    return successorText(
      await readSuccessor({ venue: suite.db, node: suite.node, nodeId: NODE }, successor),
      locale,
    );
  }

  it("escapes the successor's address", async () => {
    const successor = await seedSuccessor("Bar counter box");
    await handOver(successor);
    await holdChart(successor, "https://a&b'c.example:8443");
    expect(await named(successor)).toBe("<strong>a&amp;b&#39;c.example:8443</strong> (main box)");
  });

  it("names the successor by its address and its role in this box's chart, never its venue name", async () => {
    const successor = await seedSuccessor("Bar Pepe (standby)");
    await handOver(successor);
    await holdChart(successor, "https://box-db91.waitron.local");
    expect(await named(successor)).toBe("<strong>box-db91.waitron.local</strong> (main box)");
    expect(await named(successor, "es-ES")).toBe(
      "<strong>box-db91.waitron.local</strong> (servidor principal)",
    );
  });

  it("gives a successor this box's chart still lists as standby no role", async () => {
    const successor = await seedSuccessor("Bar Pepe (standby)");
    await handOver(successor);
    await holdChart(successor, "https://box-db91.waitron.local", "serving-secondary");
    expect(await named(successor)).toBe("<strong>box-db91.waitron.local</strong>");
    expect(await named(successor, "es-ES")).toBe("<strong>box-db91.waitron.local</strong>");
  });

  it.each([
    ["the successor", true],
    ["another box", false],
  ] as const)(
    "names a successor its stale chart lists as standby the main box once it holds a confirmed return to %s",
    async (_to, toSuccessor) => {
      const successor = await seedSuccessor("Bar Pepe (standby)");
      await handOver(successor);
      await holdChart(successor, "https://box-db91.waitron.local", "serving-secondary");
      await recordConfirmedReturn(toSuccessor ? successor : "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
      const role = toSuccessor ? " (main box)" : "";
      expect(await named(successor)).toBe(`<strong>box-db91.waitron.local</strong>${role}`);
      const spanish = toSuccessor ? " (servidor principal)" : "";
      expect(await named(successor, "es-ES")).toBe(
        `<strong>box-db91.waitron.local</strong>${spanish}`,
      );
    },
  );

  it.each(["sell-only", "evicted"] as const)(
    "gives a successor the chart lists as %s no role, even with a confirmed return to it",
    async (standing) => {
      const successor = await seedSuccessor("Bar Pepe (standby)");
      await handOver(successor);
      await holdChart(successor, "https://box-db91.waitron.local", standing);
      await recordConfirmedReturn(successor);
      expect(await named(successor)).toBe("<strong>box-db91.waitron.local</strong>");
      expect(await named(successor, "es-ES")).toBe("<strong>box-db91.waitron.local</strong>");
    },
  );

  it.each(["", "javascript:alert(1);//", "not a url"])(
    "names the successor by its id when its chart address %j has no web host",
    async (contactUrl) => {
      const successor = await seedSuccessor("Bar Pepe (standby)");
      await handOver(successor);
      await holdChart(successor, contactUrl);
      expect(await named(successor)).toBe(`<strong>${successor}</strong>`);
    },
  );

  it("names the successor by its id when this box holds no chart, whatever its venue name", async () => {
    const successor = await seedSuccessor("Bar Pepe (standby)");
    await handOver(successor);
    expect(await named(successor)).toBe(`<strong>${successor}</strong>`);
  });

  it("names the successor by its id when this box's copy holds no row for it", async () => {
    const successor = await seedSuccessor(null);
    await handOver(successor);
    expect(await named(successor)).toBe(`<strong>${successor}</strong>`);
  });

  it("names the successor by its id when its recorded name is empty", async () => {
    const successor = await seedSuccessor("");
    await handOver(successor);
    expect(await named(successor)).toBe(`<strong>${successor}</strong>`);
  });
});

async function chartNaming(successor: string, contactUrl: string): Promise<void> {
  await writeNodeMembership(suite.db, {
    body: {
      term: 3,
      nodes: [
        // This box's own stale chart can still call it the main box; the link never follows that.
        { nodeId: NODE, contactUrl: "https://old-box.example", standing: "serving-primary" },
        { nodeId: successor, contactUrl, standing: "serving-secondary" },
      ],
    },
    signerNodeId: NODE,
    signature: "not-verified-by-this-read",
    endorsements: [],
  });
}

describe("the restricted page at the till's and the dashboard's addresses", () => {
  it.each(["/till", "/till/", "/till/tabs/counter", "/servers", "/staff/people"])(
    "serves the page at %s, linking to the successor's https address",
    async (path) => {
      const successor = await seedSuccessor("Counter box");
      await handOver(successor);
      await chartNaming(successor, "https://new-box.example");
      for (const language of ["en-GB", "es-ES"] as const) {
        const response = await request(language, suite.db, undefined, path);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const html = await response.text();
        expect(html).toContain(`<h1>${escapeHtml(RESTRICTED_PAGE_WORDS[language].title)}</h1>`);
        expect(html).toContain(
          `<a href="https://new-box.example">${escapeHtml(WORDS[language].dashboard)}</a>`,
        );
        expect(html).not.toContain('href="https://old-box.example"');
      }
      expect((await request("en-GB", suite.db, undefined, path, "HEAD")).status).toBe(200);
    },
  );

  it.each(["/api/something-unknown", "/management-api/alerts", "/favicon.ico", "/help/x"])(
    "leaves %s a 404",
    async (path) => {
      await handOver(await seedSuccessor("Counter box"));
      expect((await request("en-GB", suite.db, undefined, path)).status).toBe(404);
    },
  );

  it.each([
    ["the chart does not list the successor", null],
    ["the successor's address is plain http", "http://new-box.example"],
    ["the successor's address is empty", ""],
  ] as const)("offers no dashboard link when %s", async (_, contactUrl) => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    if (contactUrl !== null) await chartNaming(successor, contactUrl);
    else await chartNaming("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "https://elsewhere.example");
    const html = await (await request("en-GB", suite.db, undefined, "/till")).text();
    expect(html).toContain(`<h1>${RESTRICTED_PAGE_WORDS["en-GB"].title}</h1>`);
    expect(html).not.toContain("Counter box");
    expect(html).not.toContain(WORDS["en-GB"].dashboard);
    expect(html).not.toContain('<a href="http://new-box.example"');
    expect(html).not.toContain("elsewhere.example");
  });

  it.each([
    ["lacks its list of boxes", { body: { term: 3 }, signerNodeId: NODE }],
    ["has no body", { signerNodeId: NODE }],
  ])("shows the page without the successor link when the chart %s", async (_, chart) => {
    const successor = await seedSuccessor("Counter box");
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: NODE,
        operationId: null,
        kind: "superseded",
        successorNodeId: successor,
        membershipTerm: 4,
      }),
    );
    await writeNodeMembership(suite.db, chart as unknown as SignedMembershipDocument);
    logged.length = 0;
    const response = await request("en-GB", suite.db, undefined, "/till");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<h1>${RESTRICTED_PAGE_WORDS["en-GB"].title}</h1>`);
    expect(paragraphs(html)).toEqual([`<p>${escapeHtml(WORDS["en-GB"].waiting)}</p>`]);
    expect(logged).toEqual([
      {
        level: "warn",
        event: "restricted_page.successor_link_failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
    ]);
  });

  it("keeps a recorded handover's page, without its links, when the chart lacks its list of boxes", async () => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    await writeNodeMembership(suite.db, {
      body: { term: 3 },
      signerNodeId: NODE,
    } as unknown as SignedMembershipDocument);
    logged.length = 0;
    const response = await request("en-GB", suite.db, undefined, "/till");
    expect(response.status).toBe(200);
    const html = await response.text();
    inOrder(html, [
      `<h1>${RESTRICTED_PAGE_WORDS["en-GB"].title}</h1>`,
      `<p>${escapeHtml(WORDS["en-GB"].waiting)}</p>`,
    ]);
    expect(html).not.toContain("Handover begun");
    expect(html).not.toContain("<a ");
    expect(logged).toEqual([
      {
        level: "warn",
        event: "restricted_page.successor_link_failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
      {
        level: "warn",
        event: "restricted_page.progress_link_failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
    ]);
  });

  it.each(["en-GB", "es-ES"] as const)(
    "has the guides' look and the Waitron logo: %s",
    async (language) => {
      await handOver(await seedSuccessor("Counter box"));
      const response = await request(language);
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      const html = await response.text();
      expect(html).toContain("font-family: var(--wt-font-family)");
      expect(html).toContain(`<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>`);
      expect(html).toContain(".logo svg { display: block; }");
      expect(html).toContain("p, li { overflow-wrap: anywhere; }");
    },
  );

  it("draws the failure page with the logo too", async () => {
    const response = await request("en-GB", suite.db, undefined, "/till");
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain(`<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>`);
    expect(html).toContain("font-family: var(--wt-font-family)");
  });
});

describe("the restricted page after the main box asks this box to reset", () => {
  const ORDERED = {
    "en-GB": "The main box asked this box to wipe itself. It restarts shortly as a new box.",
    "es-ES":
      "El servidor principal ha pedido a este servidor que se borre. En breve se reinicia como un servidor nuevo.",
  } as const;
  const REFUSED = {
    "en-GB":
      "This box was asked to wipe itself but could not set its records aside, so nothing on it was changed. The venue runs on the new main box; you can switch this one off.",
    "es-ES":
      "Se pidió a este servidor que se borrara, pero no ha podido apartar sus registros, así que no se ha cambiado nada en él. El local funciona con el nuevo servidor principal; puedes apagar este.",
  } as const;
  const languages = [
    ["en-GB", "en-GB,en;q=0.9"],
    ["es-ES", "es-ES,es;q=0.9"],
  ] as const;

  function html(
    header: string,
    extra: Pick<RestrictedPageDeps, "resetOrdered" | "resetPhase">,
    returnState: ReturnState = "waiting",
  ) {
    return request(header, suite.db, returnState, "/", "GET", extra).then((r) => r.text());
  }
  const resetBesideReturn = languages.flatMap(([locale, header]) =>
    (
      [
        "waiting",
        "sending",
        "needs-attention",
        "clock",
        "clash",
        "record-clash",
        "confirmed",
      ] as const
    ).map((state) => [locale, header, state] as const),
  );

  it("words both lines in English and in Spanish, naming nobody to contact", () => {
    for (const [locale] of languages) {
      expect(RESTRICTED_RESET_WORDS[locale].ordered).toBe(ORDERED[locale]);
      expect(RESTRICTED_RESET_WORDS[locale].setAsideRefused).toBe(REFUSED[locale]);
    }
    for (const text of [...Object.values(ORDERED), ...Object.values(REFUSED)])
      expect(text).not.toMatch(/support|contact|soporte|contacta|administrador|administrator/i);
  });

  it.each(languages)(
    "shows the order's line while the box has one, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Main box"));
      const page = await html(header, { resetOrdered: () => true, resetPhase: async () => null });
      expect(page).toContain(`<p>${escapeHtml(ORDERED[locale])}</p>`);
      expect(page).not.toContain(escapeHtml(REFUSED[locale]));
      const other = locale === "en-GB" ? "es-ES" : "en-GB";
      expect(page).not.toContain(escapeHtml(ORDERED[other]));
    },
  );

  it.each(resetBesideReturn)(
    "shows the order's line in place of the return's, in %s (asked as %s) while %s",
    async (locale, header, state) => {
      await handOver(await seedSuccessor("Main box"));
      const page = await html(
        header,
        { resetOrdered: () => true, resetPhase: async () => null },
        state,
      );
      expect(page).toContain(`<p>${escapeHtml(ORDERED[locale])}</p>`);
      expect(paragraphs(page)).toEqual([`<p>${escapeHtml(ORDERED[locale])}</p>`]);
    },
  );

  it.each(resetBesideReturn)(
    "shows the refused set-aside in place of the return's line, in %s (asked as %s) while %s",
    async (locale, header, state) => {
      await handOver(await seedSuccessor("Main box"));
      const page = await html(
        header,
        { resetOrdered: () => false, resetPhase: async () => "set_aside_refused" },
        state,
      );
      expect(page).toContain(`<p>${escapeHtml(REFUSED[locale])}</p>`);
      expect(paragraphs(page)).toEqual([`<p>${escapeHtml(REFUSED[locale])}</p>`]);
    },
  );

  it.each(languages)(
    "shows the refused set-aside in place of the order's line, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Main box"));
      const page = await html(header, {
        resetOrdered: () => true,
        resetPhase: async () => "set_aside_refused",
      });
      expect(page).toContain(`<p>${escapeHtml(REFUSED[locale])}</p>`);
      expect(page).not.toContain(escapeHtml(ORDERED[locale]));
    },
  );

  it.each(languages)(
    "shows neither line on a plain restricted box, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Main box"));
      for (const extra of [
        {},
        { resetOrdered: () => false, resetPhase: async () => null },
        { resetOrdered: () => false, resetPhase: async () => "wiping" as const },
      ]) {
        const page = await html(header, extra);
        expect(page).not.toContain(escapeHtml(ORDERED[locale]));
        expect(page).not.toContain(escapeHtml(REFUSED[locale]));
        expect(page).toContain(`<p>${escapeHtml(WORDS[locale].waiting)}</p>`);
      }
    },
  );

  it("still shows the page, without the refused line, when the marker cannot be read", async () => {
    await handOver(await seedSuccessor("Main box"));
    logged.length = 0;
    const response = await request("en-GB", suite.db, "waiting", "/", "GET", {
      resetPhase: () => Promise.reject(new Error("unreadable")),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(escapeHtml(REFUSED["en-GB"]));
    expect(logged).toContainEqual(
      expect.objectContaining({ level: "warn", event: "restricted_page.reset_marker_unreadable" }),
    );
  });
});
