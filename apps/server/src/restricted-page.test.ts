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

async function page(language: string): Promise<{ status: number; html: string }> {
  const app = new Hono();
  restrictedPageRoute({ venue: suite.db, node: suite.node, nodeId: NODE })(app);
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
      "<h1>This box has handed over</h1>",
      "It takes no sales and sends nothing to the tax agency. The venue now runs on Bar counter box.",
      "Handover begun",
      "Stopped taking sales",
      "It sends its invoice records to Bar counter box by itself, then becomes the spare.",
    ]);

    const spanish = await page("es-ES,es;q=0.9");
    expect(spanish.status).toBe(200);
    expect(spanish.html).toContain('<html lang="es-ES">');
    inOrder(spanish.html, [
      "<h1>Este equipo ha hecho el traspaso</h1>",
      "No hace ventas ni envía nada a Hacienda. El local funciona ahora con Bar counter box.",
      "Traspaso iniciado",
      "Ha dejado de vender",
      "Envía por sí solo sus registros de facturación a Bar counter box y después pasa a ser el equipo de reserva.",
    ]);
  });

  it("escapes the successor's name", async () => {
    await handOver(await seedSuccessor(`<script>alert("x")</script> & 'Co'`));
    const { html } = await page("en-GB");
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      "The venue now runs on &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Co&#39;.",
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
    expect(html).toContain(`The venue now runs on ${successor}.`);
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
    expect(html).toContain("The venue now runs on Bar counter box.");
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
