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
import type { HandoverBinding } from "@waitron/handover";
import type { NodeStanding } from "@waitron/membership";
import {
  appendHandoverEventTx,
  NODE_MIGRATIONS,
  nodeHandoverEvents,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import { advanceHandover, beginHandover } from "./handover-store.js";
import type { ReturnState } from "./return-records.js";
import { restrictedPageRoute, type RestrictedPageDeps } from "./restricted-page.js";
import {
  RESTRICTED_PAGE_WORDS,
  RESTRICTED_RESET_WORDS,
  RESTRICTED_RETURN_WORDS,
} from "./i18n/restricted-page.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

async function handOver(successor: string): Promise<void> {
  const binding: HandoverBinding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: NODE,
    destinationNodeId: successor,
    membership: { term: 3, digest: "a".repeat(64) },
  };
  const deps = { node: suite.node, nodeId: NODE };
  await beginHandover(deps, binding, "source");
  await advanceHandover(deps, OP, "source_stepped_down", {});
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: NODE,
      operationId: OP,
      kind: "handed-over",
      successorNodeId: successor,
      membershipTerm: 3,
    }),
  );
}

async function holdChart(
  successor: string,
  contactUrl: string,
  standing: NodeStanding = "serving-primary",
): Promise<void> {
  await writeNodeMembership(suite.db, {
    body: {
      term: 3,
      nodes: [
        { nodeId: NODE, contactUrl: "https://old-box.example", standing: "sell-only" },
        { nodeId: successor, contactUrl, standing },
      ],
    },
    signerNodeId: NODE,
    signature: "not-verified-by-this-read",
    endorsements: [],
  });
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

describe("the restricted box's own page", () => {
  it("shows the successor and each recorded step, in English and in Spanish", async () => {
    const successor = await seedSuccessor("Bar counter box");
    await handOver(successor);
    await holdChart(successor, "https://bar-counter.example");

    const english = await page("en-GB,en;q=0.9");
    expect(english.status).toBe(200);
    expect(english.html).toContain('<html lang="en">');
    inOrder(english.html, [
      "<h1>This box no longer runs the venue</h1>",
      "It takes no sales and sends nothing to the tax agency. The box taking over the venue is <strong>bar-counter.example</strong> (main box).",
      "Handover begun",
      "Stopped taking sales",
    ]);
    expect(english.html).not.toContain("spare");

    const spanish = await page("es-ES,es;q=0.9");
    expect(spanish.status).toBe(200);
    expect(spanish.html).toContain('<html lang="es">');
    inOrder(spanish.html, [
      "<h1>El local ya no funciona con este servidor</h1>",
      "No hace ventas ni envía nada a Hacienda. El servidor que pasa a llevar el local es <strong>bar-counter.example</strong> (servidor principal).",
      "Traspaso iniciado",
      "Ha dejado de vender",
    ]);
  });

  it.each([
    ["https://new-box.example", true],
    ["javascript:alert(1);//", false],
  ] as const)("offers only a web handover link after restart: %s", async (contactUrl, linked) => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    await writeNodeMembership(suite.db, {
      body: {
        term: 3,
        nodes: [
          { nodeId: NODE, contactUrl: "https://old-box.example", standing: "serving-primary" },
          {
            nodeId: successor,
            contactUrl,
            standing: "serving-secondary",
          },
        ],
      },
      signerNodeId: NODE,
      signature: "not-verified-by-this-read",
      endorsements: [],
    });
    for (const language of ["en-GB", "es-ES"]) {
      const result = await page(language);
      expect(result.status).toBe(200);
      if (linked) expect(result.html).toContain(`href="${contactUrl}/handover/${OP}"`);
      else expect(result.html).not.toContain("<a ");
    }
  });

  it("escapes the successor's address", async () => {
    const successor = await seedSuccessor("Bar counter box");
    await handOver(successor);
    await holdChart(successor, "https://a&b'c.example:8443");
    const { html } = await page("en-GB");
    expect(html).toContain(
      "The box taking over the venue is <strong>a&amp;b&#39;c.example:8443</strong> (main box).",
    );
  });

  it("names the successor by its address and its role in this box's chart, never its venue name", async () => {
    const successor = await seedSuccessor("Bar Pepe (standby)");
    await handOver(successor);
    await holdChart(successor, "https://box-db91.waitron.local");
    const english = await page("en-GB");
    expect(english.html).toContain(
      "The box taking over the venue is <strong>box-db91.waitron.local</strong> (main box).",
    );
    expect(english.html).not.toContain("Bar Pepe");
    const spanish = await page("es-ES");
    expect(spanish.html).toContain(
      "El servidor que pasa a llevar el local es <strong>box-db91.waitron.local</strong> (servidor principal).",
    );
    expect(spanish.html).not.toContain("Bar Pepe");
  });

  it("gives a successor this box's chart still lists as standby no role", async () => {
    const successor = await seedSuccessor("Bar Pepe (standby)");
    await handOver(successor);
    await holdChart(successor, "https://box-db91.waitron.local", "serving-secondary");
    const english = (await page("en-GB")).html;
    expect(english).toContain(
      "The box taking over the venue is <strong>box-db91.waitron.local</strong>.",
    );
    expect(english).not.toContain("spare box");
    const spanish = (await page("es-ES")).html;
    expect(spanish).toContain(
      "El servidor que pasa a llevar el local es <strong>box-db91.waitron.local</strong>.",
    );
    expect(spanish).not.toContain("servidor de reserva");
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
      await withNodeTransaction(suite.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP,
          kind: "return_confirmed",
          detail: {
            destinationNodeId: toSuccessor ? successor : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            inventory: "a".repeat(64),
          },
          envelope: "{}",
        }),
      );
      const role = toSuccessor ? " (main box)" : "";
      expect((await page("en-GB")).html).toContain(
        `The box taking over the venue is <strong>box-db91.waitron.local</strong>${role}.`,
      );
      const spanish = toSuccessor ? " (servidor principal)" : "";
      expect((await page("es-ES")).html).toContain(
        `El servidor que pasa a llevar el local es <strong>box-db91.waitron.local</strong>${spanish}.`,
      );
    },
  );

  it.each(["sell-only", "evicted"] as const)(
    "gives a successor the chart lists as %s no role, even with a confirmed return to it",
    async (standing) => {
      const successor = await seedSuccessor("Bar Pepe (standby)");
      await handOver(successor);
      await holdChart(successor, "https://box-db91.waitron.local", standing);
      await withNodeTransaction(suite.node, (tx) =>
        appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP,
          kind: "return_confirmed",
          detail: { destinationNodeId: successor, inventory: "a".repeat(64) },
          envelope: "{}",
        }),
      );
      expect((await page("en-GB")).html).toContain(
        "The box taking over the venue is <strong>box-db91.waitron.local</strong>.",
      );
      expect((await page("es-ES")).html).toContain(
        "El servidor que pasa a llevar el local es <strong>box-db91.waitron.local</strong>.",
      );
    },
  );

  it.each(["", "javascript:alert(1);//", "not a url"])(
    "names the successor by its id when its chart address %j has no web host",
    async (contactUrl) => {
      const successor = await seedSuccessor("Bar Pepe (standby)");
      await handOver(successor);
      await holdChart(successor, contactUrl);
      const { html } = await page("en-GB");
      expect(html).toContain(`The box taking over the venue is <strong>${successor}</strong>.`);
    },
  );

  it("names the successor by its id when this box holds no chart, whatever its venue name", async () => {
    const successor = await seedSuccessor("Bar Pepe (standby)");
    await handOver(successor);
    const { html } = await page("en-GB");
    expect(html).toContain(`The box taking over the venue is <strong>${successor}</strong>.`);
  });

  it("carries no form", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    for (const language of ["en-GB", "es-ES"]) {
      const { html } = await page(language);
      expect(html).toContain("<h1>");
      expect(html).not.toMatch(/<form|<button|<input|<select|<textarea/);
    }
  });

  it("names the successor by its id when this box's copy holds no row for it", async () => {
    const successor = await seedSuccessor(null);
    await handOver(successor);
    const { html } = await page("en-GB");
    expect(html).toContain(`The box taking over the venue is <strong>${successor}</strong>.`);
  });

  it("names the successor by its id when its recorded name is empty", async () => {
    const successor = await seedSuccessor("");
    await handOver(successor);
    const { html } = await page("en-GB");
    expect(html).toContain(`The box taking over the venue is <strong>${successor}</strong>.`);
  });

  it("lists the steps in the order they were recorded, whatever their recorded times", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    await suite.node.insert(nodeHandoverEvents).values({
      nodeId: NODE,
      operationId: OP,
      kind: "filing_relinquished",
      detail: {},
      envelope: null,
      recordedAt: new Date("2020-01-01T00:00:00Z"),
    });
    const { html } = await page("en-GB");
    inOrder(html, [
      "Handover begun",
      "Stopped taking sales",
      "Stopped sending invoice records to the tax agency",
    ]);
  });

  it("dates each step in the venue's time zone", async () => {
    await seedVenue(suite.db, { timeZone: "Pacific/Auckland" });
    const successor = await seedNode(suite.db);
    await handOver(successor);
    await suite.node.insert(nodeHandoverEvents).values({
      nodeId: NODE,
      operationId: OP,
      kind: "filing_relinquished",
      detail: {},
      envelope: null,
      recordedAt: new Date("2020-01-01T00:00:00Z"),
    });
    const { html } = await page("en-GB");
    expect(html).toContain("1 Jan 2020, 13:00: Stopped sending invoice records to the tax agency");
  });

  it("dates each step in UTC when this box's copy holds no venue", async () => {
    await handOver("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await suite.node.insert(nodeHandoverEvents).values({
      nodeId: NODE,
      operationId: OP,
      kind: "filing_relinquished",
      detail: {},
      envelope: null,
      recordedAt: new Date("2020-01-01T00:00:00Z"),
    });
    const { status, html } = await page("en-GB");
    expect(status).toBe(200);
    expect(html).toContain("1 Jan 2020, 00:00: Stopped sending invoice records to the tax agency");
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

  it("answers a failure to read from the venue's copy with the same page", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
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
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("<h1>This page could not be shown.</h1>");
    expect(logged).toEqual([
      {
        level: "warn",
        event: "restricted_page.successor_link_failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
      {
        level: "error",
        event: "restricted_page.failed",
        fields: { errorCode: "unknown", requestId: "request-1" },
      },
    ]);
  });

  it("lists no step for a supersession learnt from a newer list of machines alone", async () => {
    const successor = await seedSuccessor("Bar counter box");
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
    expect(html).toContain(`The box taking over the venue is <strong>${successor}</strong>.`);
    expect(html).not.toContain("<li>");
  });

  it("words the final copy's step in English and in Spanish", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    await withNodeTransaction(suite.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: NODE,
        operationId: OP,
        kind: "final_state",
        detail: {},
        envelope: "{}",
      }),
    );
    const english = await page("en-GB");
    inOrder(english.html, ["Stopped taking sales", "Final copy of the venue taken"]);
    expect(english.html).not.toContain("final_state");
    const spanish = await page("es-ES");
    inOrder(spanish.html, ["Ha dejado de vender", "Copia final del local hecha"]);
    expect(spanish.html).not.toContain("final_state");
  });

  it("words the offer's step in English and in Spanish", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    await withNodeTransaction(suite.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: NODE,
        operationId: OP,
        kind: "offer",
        detail: {},
        envelope: "{}",
      }),
    );
    const english = await page("en-GB");
    expect(english.html).toContain("Handover offered");
    expect(english.html).not.toContain(": offer<");
    const spanish = await page("es-ES");
    expect(spanish.html).toContain("Traspaso ofrecido");
    expect(spanish.html).not.toContain(": offer<");
  });

  it("words the confirmed return's step in English and in Spanish", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    await withNodeTransaction(suite.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: NODE,
        operationId: OP,
        kind: "return_confirmed",
        detail: {},
        envelope: "{}",
      }),
    );
    const english = await page("en-GB");
    inOrder(english.html, ["Stopped taking sales", "Invoice records confirmed by the main box"]);
    expect(english.html).not.toContain("return_confirmed");
    const spanish = await page("es-ES");
    inOrder(spanish.html, [
      "Ha dejado de vender",
      "Registros de facturación confirmados por el servidor principal",
    ]);
    expect(spanish.html).not.toContain("return_confirmed");
  });

  it("shows a step this version has no words for by its recorded name", async () => {
    await handOver(await seedSuccessor("Bar counter box"));
    await withNodeTransaction(suite.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: NODE,
        operationId: OP,
        kind: "toString",
        detail: {},
        envelope: null,
      }),
    );
    const { status, html } = await page("en-GB");
    expect(status).toBe(200);
    inOrder(html, ["Stopped taking sales", ": toString</li>"]);
  });
});

it.each(["waiting", "sending", "needs-attention", "clock", "clash", "confirmed"] as const)(
  "keeps data before confirmation and explains reset data loss after it: %s",
  async (state) => {
    await handOver(await seedSuccessor("Main box"));
    const response = await request("en-GB", suite.db, state);
    const html = await response.text();
    if (state === "confirmed" || state === "clash") {
      expect(html).toContain(
        "Resetting this box deletes its venue data, including sale lines and local backups",
      );
      expect(html).not.toContain("You can reset this box.");
      if (state === "clash") expect(html).not.toContain("Do not reset this box.");
    } else {
      expect(html).toContain("Do not reset this box.");
      expect(html).not.toContain("You can reset this box.");
      if (state === "clock") expect(html).toContain(RESTRICTED_RETURN_WORDS["en-GB"].clock);
    }
  },
);

it("shows the Spanish clock refusal while withholding reset permission", async () => {
  await handOver(await seedSuccessor("Main box"));
  const response = await request("es-ES", suite.db, "clock");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(RESTRICTED_RETURN_WORDS["es-ES"].clock);
  expect(html).not.toContain(RESTRICTED_RETURN_WORDS["es-ES"].confirmed);
});

it("explains reset data loss in Spanish after confirmation", async () => {
  await handOver(await seedSuccessor("Bar counter box"));
  const html = await (await request("es-ES", suite.db, "confirmed")).text();
  expect(html).toContain(
    "Restablecer este servidor borra sus datos del local, incluidas las líneas de venta y las copias de seguridad locales",
  );
  expect(html).not.toContain("Puedes restablecer este servidor");
});

it("distinguishes accepted payment differences from imported facts in both languages", async () => {
  await handOver(await seedSuccessor("Main box"));
  for (const language of ["en-GB", "es-ES"] as const) {
    const clash = await (await request(language, suite.db, "clash")).text();
    const confirmed = await (await request(language, suite.db, "confirmed")).text();
    expect(clash).toContain(escapeHtml(RESTRICTED_RETURN_WORDS[language].clash));
    expect(confirmed).toContain(escapeHtml(RESTRICTED_RETURN_WORDS[language].confirmed));
    expect(RESTRICTED_RETURN_WORDS[language].clash).toContain(
      language === "en-GB" ? "specifically accepted" : "aceptadas expresamente",
    );
    expect(RESTRICTED_RETURN_WORDS[language].confirmed).toContain(
      language === "en-GB" ? "kept its own payment facts" : "conservado sus propios datos de pago",
    );
  }
});

it.each(["en-GB", "es-ES"] as const)(
  "renders the record-clash stop separately from payment acceptance in %s",
  async (language) => {
    const successor = await seedSuccessor("Main <box>");
    await handOver(successor);
    await holdChart(successor, "https://a&b.example");
    const html = await (await request(language, suite.db, "record-clash")).text();
    expect(html).toContain(escapeHtml(RESTRICTED_RETURN_WORDS[language]["record-clash"]));
    expect(html).not.toContain(escapeHtml(RESTRICTED_RETURN_WORDS[language].clash));
    expect(html).toContain("<strong>a&amp;b.example</strong>");
    expect(html).not.toContain("a&b.example");
  },
);

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
          `<a href="https://new-box.example">${escapeHtml(RESTRICTED_PAGE_WORDS[language].openSuccessor)}</a>`,
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
    ["the chart does not list the successor", null, null],
    ["the successor's address is plain http", "http://new-box.example", "new-box.example"],
    ["the successor's address is empty", "", null],
  ] as const)("offers no successor link when %s", async (_, contactUrl, shown) => {
    const successor = await seedSuccessor("Counter box");
    await handOver(successor);
    if (contactUrl !== null) await chartNaming(successor, contactUrl);
    else await chartNaming("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "https://elsewhere.example");
    const html = await (await request("en-GB", suite.db, undefined, "/till")).text();
    expect(html).toContain(`<strong>${shown ?? successor}</strong>`);
    expect(html).not.toContain("Counter box");
    expect(html).not.toContain(RESTRICTED_PAGE_WORDS["en-GB"].openSuccessor);
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
    expect(html).toContain(`<strong>${successor}</strong>`);
    expect(html).toContain(escapeHtml(RESTRICTED_RETURN_WORDS["en-GB"].waiting));
    expect(html).not.toContain(RESTRICTED_PAGE_WORDS["en-GB"].openSuccessor);
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
      `<strong>${successor}</strong>`,
      "Handover begun",
      "Stopped taking sales",
      escapeHtml(RESTRICTED_RETURN_WORDS["en-GB"].waiting),
    ]);
    expect(html).not.toContain(RESTRICTED_PAGE_WORDS["en-GB"].openSuccessor);
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
    "en-GB": "The main box asked this box to reset. It restarts shortly as a new box.",
    "es-ES":
      "El servidor principal ha pedido restablecer este servidor. En breve se reinicia como un servidor nuevo.",
  } as const;
  const REFUSED = {
    "en-GB":
      "This box was asked to reset, but it could not set its records aside, so it did not reset. Nothing on it was changed or deleted. The venue runs on the main box and no longer needs this one, so you can switch it off.",
    "es-ES":
      "Se pidió a este servidor que se restableciera, pero no ha podido apartar sus registros, así que no se ha restablecido. No se ha cambiado ni borrado nada en él. El local funciona con el servidor principal y ya no necesita este, así que puedes apagarlo.",
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
    (["waiting", "sending"] as const).map((state) => [locale, header, state] as const),
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
      expect(page).not.toContain(escapeHtml(RESTRICTED_RETURN_WORDS[locale][state]));
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
      expect(page).not.toContain(escapeHtml(RESTRICTED_RETURN_WORDS[locale][state]));
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
        expect(page).toContain(`<p>${escapeHtml(RESTRICTED_RETURN_WORDS[locale].waiting)}</p>`);
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
