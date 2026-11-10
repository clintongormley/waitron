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
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import type { HandoverBinding } from "@waitron/handover";
import {
  appendHandoverEventTx,
  NODE_MIGRATIONS,
  nodeHandoverEvents,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import { advanceHandover, beginHandover } from "./handover-store.js";
import type { ReturnState } from "./return-records.js";
import { restrictedPageRoute } from "./restricted-page.js";

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

const logged: { level: string; event: string; fields?: Record<string, unknown> }[] = [];

function request(
  language: string,
  venue: Database = suite.db,
  returnState?: ReturnState,
): Promise<Response> {
  const app = new Hono();
  restrictedPageRoute({
    venue,
    node: suite.node,
    nodeId: NODE,
    returnState: () => returnState ?? "waiting",
    log: (level, event, fields) => logged.push({ level, event, fields }),
  })(app);
  return Promise.resolve(app.request("/", { headers: { "Accept-Language": language } }));
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
    await handOver(await seedSuccessor("Bar counter box"));

    const english = await page("en-GB,en;q=0.9");
    expect(english.status).toBe(200);
    expect(english.html).toContain('<html lang="en-GB">');
    inOrder(english.html, [
      "<h1>This box no longer runs the venue</h1>",
      "It takes no sales and sends nothing to the tax agency. The box taking over the venue is <strong>Bar counter box</strong>.",
      "Handover begun",
      "Stopped taking sales",
    ]);
    expect(english.html).not.toContain("spare");

    const spanish = await page("es-ES,es;q=0.9");
    expect(spanish.status).toBe(200);
    expect(spanish.html).toContain('<html lang="es-ES">');
    inOrder(spanish.html, [
      "<h1>El local ya no funciona con este equipo</h1>",
      "No hace ventas ni envía nada a Hacienda. El equipo que pasa a llevar el local es <strong>Bar counter box</strong>.",
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

  it("escapes the successor's name", async () => {
    await handOver(await seedSuccessor(`<script>alert("x")</script> & 'Co'`));
    const { html } = await page("en-GB");
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      "The box taking over the venue is <strong>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Co&#39;</strong>.",
    );
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
    ["en-GB", "en-GB", "This page could not be shown."],
    ["es-ES", "es-ES", "No se ha podido mostrar esta página."],
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
        { level: "error", event: "restricted_page.failed", fields: { errorCode: "unknown" } },
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
      { level: "error", event: "restricted_page.failed", fields: { errorCode: "unknown" } },
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
    expect(html).toContain("The box taking over the venue is <strong>Bar counter box</strong>.");
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

it.each(["waiting", "sending", "needs-attention", "confirmed"] as const)(
  "permits reset only after signed whole-inventory confirmation: %s",
  async (state) => {
    await handOver(await seedSuccessor("Main box"));
    const response = await request("en-GB", suite.db, state);
    const html = await response.text();
    if (state === "confirmed") expect(html).toContain("You can reset this box.");
    else {
      expect(html).toContain("Do not reset this box.");
      expect(html).not.toContain("You can reset this box.");
    }
  },
);
