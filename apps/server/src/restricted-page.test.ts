import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, nodes, withNodeTransaction } from "@waitron/db";
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

const logged: { level: string; event: string }[] = [];

async function page(language: string): Promise<{ status: number; html: string }> {
  const app = new Hono();
  restrictedPageRoute({
    venue: suite.db,
    node: suite.node,
    nodeId: NODE,
    log: (level, event) => logged.push({ level, event }),
  })(app);
  const response = await app.request("/", { headers: { "Accept-Language": language } });
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

  it("answers a failure to read through the error boundary, which logs it", async () => {
    logged.length = 0;
    const { status, html } = await page("en-GB");
    expect(status).toBe(500);
    expect(html).not.toContain("<h1>");
    expect(logged).toEqual([{ level: "error", event: "restricted_page.failed" }]);
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
