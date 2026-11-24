import { escapeHtml } from "./html-page.js";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
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
  restrictedPageAnswer,
  restrictedPageRoute,
  successorText,
  type OldBoxDownloadState,
  type RestrictedPageDeps,
} from "./restricted-page.js";
import {
  RESTRICTED_DOWNLOAD_WORDS,
  RESTRICTED_PAGE_WORDS,
  RESTRICTED_RESET_WORDS,
  RESTRICTED_RETURN_WORDS,
} from "./i18n/restricted-page.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";
import { BOX_FORM_STYLE } from "./guide-pages.js";

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
    "hours-refused":
      "This box's invoice records have reached the main box, but the main box could not store some of its working hours. Carry on with the main box. Before this box is wiped, download its data below.",
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
    "hours-refused":
      "Los registros de facturación de este servidor han llegado al servidor principal, pero el servidor principal no ha podido guardar algunas de sus horas trabajadas. Sigue con el servidor principal. Antes de que se borre este servidor, descarga sus datos aquí abajo.",
  },
} as const;

const LANGUAGES = [
  ["en-GB", "en-GB,en;q=0.9", "en"],
  ["es-ES", "es-ES,es;q=0.9", "es"],
] as const;

/** The page above its download section. */
function statusPart(html: string): string {
  const section = html.indexOf("<section");
  return section === -1 ? html : html.slice(0, section);
}

/** Every `<p>` on the page above its download section, as written. */
function paragraphs(html: string): string[] {
  return [...statusPart(html).matchAll(/<p>[\s\S]*?<\/p>/g)].map((match) => match[0]);
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
      expect(statusPart(html)).not.toMatch(/<h2|<ul|<li/);
      expect(html).not.toContain(`>${RESTRICTED_PAGE_WORDS[locale].progress}<`);
      expect(html).not.toContain("/handover/");
      expect(html).not.toMatch(/Handover begun|Traspaso iniciado|tax agency|Hacienda/);
    },
  );

  it.each(
    LANGUAGES.flatMap(([locale, header]) =>
      (
        [
          "waiting",
          "sending",
          "needs-attention",
          "clock",
          "clash",
          "record-clash",
          "hours-refused",
        ] as const
      ).map((state) => [locale, header, state] as const),
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
    ["the main box refused the returned working hours", "hours-refused", false],
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

  it("reads the chart again for Progress when the first read failed", async () => {
    const successor = await seedSuccessor("Bar counter box");
    await handOver(successor);
    await holdChart(successor, "https://bar-counter.example", "serving-primary");
    logged.length = 0;
    let failed = false;
    const venue = new Proxy(suite.db, {
      get: (target, key) => {
        if (key === "select" && !failed) {
          failed = true;
          return () => {
            throw new Error("disk I/O error");
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const html = await (await request("en-GB", venue)).text();
    expect(paragraphs(html)).toEqual([`<p>${escapeHtml(WORDS["en-GB"].waiting)}</p>`]);
    expect(logged).toEqual([
      {
        level: "warn",
        event: "restricted_page.successor_link_failed",
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
    "leaves %s a 404 from the page route mounted alone",
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
        "hours-refused",
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

describe("the restricted page's download section", () => {
  const DOWNLOAD = {
    "en-GB": {
      heading: "Download this box's data",
      emergency:
        "This box may hold data that the new main box does not have. To keep it, download it here before this box is wiped.",
      planned: "Download the invoice records this box holds that the new main box does not.",
      email: "Email",
      password: "Password",
      totp: "Authenticator code",
      action: "Download",
      insecure: "To download this box's data, open this page at its https:// address.",
      signInRefused:
        "That email and password do not match an account on this box. This box knows the accounts as they were when it stopped running the venue. Nothing was changed.",
      notPermitted:
        "This account cannot download this box's data. Sign in here with an administrator's account, or one with Manage boxes. Nothing was changed.",
      busy: "This box is already making the file. Try again in a minute.",
      otherPage: "The download must be asked for on this page. Nothing was changed.",
      totpRequired: "Enter your password again and the code from your authenticator app.",
      throttled: "Too many incorrect attempts. Wait 2 minutes and try again. Nothing was changed.",
      emailMissing: "Enter your email.",
      passwordMissing: "Enter your password.",
      fixFields: "Correct the highlighted fields to continue.",
      wipeUnderWay: "This box is being wiped, so its data can no longer be downloaded.",
      failed:
        "Nothing was changed: this is a fault in Waitron or this box. Try again. If it fails again, switch this box off and on, then try once more.",
    },
    "es-ES": {
      heading: "Descargar los datos de este servidor",
      emergency:
        "Este servidor puede tener datos que el nuevo servidor principal no tiene. Para conservarlos, descárgalos aquí antes de borrarlo.",
      planned:
        "Descarga los registros de facturación que tiene este servidor y que el nuevo servidor principal no tiene.",
      email: "Correo electrónico",
      password: "Contraseña",
      totp: "Código del autenticador",
      action: "Descargar",
      insecure:
        "Para descargar los datos de este servidor, abre esta página en su dirección https://.",
      signInRefused:
        "Ese correo electrónico y esa contraseña no coinciden con ninguna cuenta de este servidor. Este servidor conoce las cuentas tal como estaban cuando dejó de llevar el local. No se ha cambiado nada.",
      notPermitted:
        "Esta cuenta no puede descargar los datos de este servidor. Inicia sesión aquí con la cuenta de un administrador o con una que tenga Gestionar servidores. No se ha cambiado nada.",
      busy: "Este servidor ya está creando el archivo. Vuelve a intentarlo en un minuto.",
      otherPage: "La descarga debe pedirse en esta página. No se ha cambiado nada.",
      totpRequired:
        "Vuelve a introducir tu contraseña y el código de tu aplicación de autenticación.",
      throttled:
        "Demasiados intentos incorrectos. Espera 2 minutos y vuelve a intentarlo. No se ha cambiado nada.",
      emailMissing: "Introduce tu correo electrónico.",
      passwordMissing: "Introduce tu contraseña.",
      fixFields: "Corrige los campos marcados para continuar.",
      wipeUnderWay: "Este servidor se está borrando, así que ya no se pueden descargar sus datos.",
      failed:
        "No se ha cambiado nada: es un fallo de Waitron o de este servidor. Vuelve a intentarlo. Si vuelve a fallar, apaga y enciende este servidor y después inténtalo otra vez.",
    },
  } as const;

  async function answer(
    language: string,
    options: {
      secure?: boolean;
      download?: OldBoxDownloadState;
      resetOrdered?: boolean;
    } = {},
  ): Promise<{ response: Response; html: string }> {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("requestId", "request-1");
      await next();
    });
    const deps: RestrictedPageDeps = {
      venue: suite.db,
      node: suite.node,
      nodeId: NODE,
      returnState: () => "waiting",
      log: (level, event, fields) => logged.push({ level, event, fields }),
      ...(options.resetOrdered === undefined ? {} : { resetOrdered: () => options.resetOrdered! }),
    };
    app.get("/", (c) =>
      restrictedPageAnswer(deps, c, options.download === undefined ? 200 : 401, options.download),
    );
    const socket = new TLSSocket(new Socket());
    try {
      const response = await app.request(
        "https://old-box.test/",
        { headers: { "Accept-Language": language } },
        options.secure === false ? {} : { incoming: { socket } },
      );
      return { response, html: await response.text() };
    } finally {
      socket.destroy();
    }
  }

  async function noOperation(): Promise<void> {
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: NODE,
        operationId: null,
        kind: "superseded",
        successorNodeId: RECEIVER,
        membershipTerm: 3,
      }),
    );
  }

  /** The download section's opening tag to its end. */
  function section(html: string): string {
    const start = html.indexOf("<section");
    expect(start).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</section>", start) + "</section>".length);
  }

  it("words every line in English and in Spanish", () => {
    for (const [locale] of LANGUAGES) {
      const words = RESTRICTED_DOWNLOAD_WORDS[locale];
      const expected = DOWNLOAD[locale];
      expect({
        heading: words.heading,
        emergency: words.emergency,
        planned: words.planned,
        email: words.email,
        password: words.password,
        totp: words.totp,
        action: words.action,
        insecure: words.insecure,
        signInRefused: words.signInRefused,
        notPermitted: words.notPermitted,
        busy: words.busy,
        otherPage: words.otherPage,
        totpRequired: words.totpRequired,
        throttled: words.throttled(2),
        emailMissing: words.emailMissing,
        passwordMissing: words.passwordMissing,
        fixFields: words.fixFields,
        wipeUnderWay: words.wipeUnderWay,
        failed: words.failed,
      }).toEqual(expected);
    }
  });

  it.each(LANGUAGES)(
    "asks for the data after an emergency switch, below the status line, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const { html } = await answer(header);
      inOrder(html, [
        `<p>${escapeHtml(WORDS[locale].waiting)}</p>`,
        `<h2>${escapeHtml(DOWNLOAD[locale].heading)}</h2>`,
        `<p>${escapeHtml(DOWNLOAD[locale].emergency)}</p>`,
        "<form",
      ]);
      expect(html).not.toContain(escapeHtml(DOWNLOAD[locale].planned));
    },
  );

  it("uses the emergency sentence when the restriction names no operation", async () => {
    await seedSuccessor("Counter box");
    await noOperation();
    for (const [locale, header] of LANGUAGES) {
      const { html } = await answer(header);
      expect(section(html)).toContain(`<p>${escapeHtml(DOWNLOAD[locale].emergency)}</p>`);
    }
  });

  it.each(LANGUAGES)(
    "names the invoice records after a planned handover, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Counter box"));
      const { html } = await answer(header);
      const drawn = section(html);
      expect(drawn).toContain(`<h2>${escapeHtml(DOWNLOAD[locale].heading)}</h2>`);
      expect(drawn).toContain(`<p>${escapeHtml(DOWNLOAD[locale].planned)}</p>`);
      expect(drawn).not.toContain(escapeHtml(DOWNLOAD[locale].emergency));
    },
  );

  it.each(LANGUAGES)(
    "draws a form posted to this box, its email and password marked required, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const { response, html } = await answer(header);
      const drawn = section(html);
      expect(drawn).toMatch(/<form method="post" action="\/old-box-data"[^>]*>/);
      expect(drawn).not.toContain("enctype");
      expect(drawn).toContain(
        `<label for="old-box-data-email">${escapeHtml(DOWNLOAD[locale].email)} <span class="required">*</span></label>`,
      );
      expect(drawn).toContain(
        `<label for="old-box-data-password">${escapeHtml(DOWNLOAD[locale].password)} <span class="required">*</span></label>`,
      );
      expect(drawn).toMatch(
        /<input type="email" id="old-box-data-email" name="email"[^>]* required/,
      );
      expect(drawn).toMatch(
        /<input type="password" id="old-box-data-password" name="password"[^>]* required/,
      );
      expect(drawn).not.toContain('name="totp"');
      expect(drawn).toContain(
        `<button type="submit">${escapeHtml(DOWNLOAD[locale].action)}</button>`,
      );
      expect(drawn).not.toContain('role="alert"');
      expect(drawn).toContain('<form method="post" action="/old-box-data" class="box-form">');
      expect(html).toContain(BOX_FORM_STYLE);
      const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
      const hash = createHash("sha256").update(script).digest("base64");
      expect(response.headers.get("content-security-policy")).toBe(
        `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`,
      );
    },
  );

  it.each(LANGUAGES)(
    "draws no form over plain HTTP, only the HTTPS sentence, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const { html } = await answer(header, { secure: false });
      const drawn = section(html);
      expect(drawn).toContain(`<p>${escapeHtml(DOWNLOAD[locale].insecure)}</p>`);
      expect(html).not.toMatch(/<form|<input|<button/);
    },
  );

  it.each(LANGUAGES)("draws no form while a wipe is under way, in %s", async (locale, header) => {
    await handOver(await seedSuccessor("Counter box"), "emergency");
    for (const download of [
      undefined,
      { refusal: "wipeUnderWay", email: "owner@example.test" } as const,
    ]) {
      const { html } = await answer(header, {
        resetOrdered: true,
        ...(download === undefined ? {} : { download }),
      });
      const drawn = section(html);
      // An alert only when it answers a refused download.
      const alert = download === undefined ? "" : ' role="alert"';
      expect(drawn).toContain(`<p${alert}>${escapeHtml(DOWNLOAD[locale].wipeUnderWay)}</p>`);
      expect(drawn).not.toContain(escapeHtml(DOWNLOAD[locale].emergency));
      expect(html).not.toMatch(/<form|<input|<button/);
    }
  });

  const BOTTOM = LANGUAGES.flatMap(([locale, header]) =>
    (
      [
        ["signInRefused", undefined, DOWNLOAD[locale].signInRefused],
        ["notPermitted", undefined, DOWNLOAD[locale].notPermitted],
        ["busy", undefined, DOWNLOAD[locale].busy],
        ["otherPage", undefined, DOWNLOAD[locale].otherPage],
        ["throttled", 90, DOWNLOAD[locale].throttled],
        ["failed", undefined, DOWNLOAD[locale].failed],
      ] as const
    ).map(([refusal, retry, message]) => [locale, header, refusal, retry, message] as const),
  );

  it.each(BOTTOM)(
    "draws the %s refusal (%s) on the bottom line, the email kept and no field marked: %s",
    async (_locale, header, refusal, retryAfterSeconds, message) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const email = `o"wner<b>@example.test`;
      const { response, html } = await answer(header, {
        download: {
          refusal,
          email,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      });
      expect(response.status).toBe(401);
      const drawn = section(html);
      expect(drawn).toContain(`value="${escapeHtml(email)}"`);
      expect(drawn).not.toContain(email);
      expect(drawn).not.toContain("aria-invalid");
      inOrder(drawn, [
        'name="password"',
        `<p id="old-box-data-message" role="alert">${escapeHtml(message)}</p>`,
        "<button",
      ]);
    },
  );

  it.each(LANGUAGES)(
    "asks for the authenticator code after totp.required, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const { html } = await answer(header, {
        download: { refusal: "totpRequired", email: "owner@example.test" },
      });
      const drawn = section(html);
      inOrder(drawn, [
        'name="password"',
        `<label for="old-box-data-totp">${escapeHtml(DOWNLOAD[locale].totp)} <span class="required">*</span></label>`,
        `<p id="old-box-data-totp-error">${escapeHtml(DOWNLOAD[locale].totpRequired)}</p>`,
        `<p id="old-box-data-message" role="alert">${escapeHtml(DOWNLOAD[locale].fixFields)}</p>`,
        "<button",
      ]);
      expect(drawn).toMatch(
        /<input type="text" id="old-box-data-totp" name="totp"[^>]* required aria-invalid="true" aria-describedby="old-box-data-totp-error">/,
      );
      expect(drawn).toContain('value="owner@example.test"');
    },
  );

  const KEPT_CODE = LANGUAGES.flatMap(([locale, header]) =>
    (
      [
        ["signInRefused", undefined, DOWNLOAD[locale].signInRefused],
        ["busy", undefined, DOWNLOAD[locale].busy],
        ["throttled", 90, DOWNLOAD[locale].throttled],
        ["failed", undefined, DOWNLOAD[locale].failed],
      ] as const
    ).map(([refusal, retry, message]) => [locale, header, refusal, retry, message] as const),
  );

  it.each(KEPT_CODE)(
    "keeps the code field after a %s refusal (%s) to a form that had one: %s",
    async (locale, header, refusal, retryAfterSeconds, message) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const { html } = await answer(header, {
        download: {
          refusal,
          email: "owner@example.test",
          askCode: true,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      });
      const drawn = section(html);
      inOrder(drawn, [
        'name="password"',
        `<label for="old-box-data-totp">${escapeHtml(DOWNLOAD[locale].totp)} <span class="required">*</span></label>`,
        `<p id="old-box-data-message" role="alert">${escapeHtml(message)}</p>`,
        "<button",
      ]);
      expect(drawn).toMatch(/<input type="text" id="old-box-data-totp" name="totp"[^>]* required>/);
      expect(drawn).not.toContain("aria-invalid");
    },
  );

  it.each(LANGUAGES)(
    "marks the missing field beside it and says so above the button, in %s",
    async (locale, header) => {
      await handOver(await seedSuccessor("Counter box"), "emergency");
      const words = DOWNLOAD[locale];
      const emailGone = section(
        (await answer(header, { download: { refusal: "fieldsMissing", email: "" } })).html,
      );
      expect(emailGone).toMatch(
        /id="old-box-data-email"[^>]* aria-invalid="true" aria-describedby="old-box-data-email-error"/,
      );
      expect(emailGone).toContain(
        `<p id="old-box-data-email-error">${escapeHtml(words.emailMissing)}</p>`,
      );
      expect(emailGone).not.toContain("old-box-data-password-error");
      expect(emailGone).toContain(
        `<p id="old-box-data-message" role="alert">${escapeHtml(words.fixFields)}</p>`,
      );
      const passwordGone = section(
        (
          await answer(header, {
            download: { refusal: "fieldsMissing", email: "owner@example.test" },
          })
        ).html,
      );
      expect(passwordGone).toMatch(
        /id="old-box-data-password"[^>]* aria-invalid="true" aria-describedby="old-box-data-password-error"/,
      );
      expect(passwordGone).toContain(
        `<p id="old-box-data-password-error">${escapeHtml(words.passwordMissing)}</p>`,
      );
      expect(passwordGone).not.toContain("old-box-data-email-error");
      expect(passwordGone).toContain('value="owner@example.test"');
    },
  );
});
