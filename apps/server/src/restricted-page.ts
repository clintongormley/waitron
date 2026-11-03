import { and, asc, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { nodes, type Database, type NodeDatabase } from "@waitron/db";
import { initialState } from "@waitron/handover";
import {
  nodeHandoverEvents,
  readHandoverOperation,
  readHandoverRestriction,
  type HandoverOperationState,
} from "@waitron/node-db";
import { FALLBACK_LOCALE, type SupportedLocale } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
import { escapeHtml } from "./recovery-surface.js";
import { readVenueTimeZone } from "./venue-time-zone.js";

export interface RestrictedPageDeps {
  venue: Database;
  node: NodeDatabase;
  nodeId: string;
}

interface Step {
  /** A handover state's name, as `node_handover_events.kind` recorded it. */
  kind: string;
  at: Date;
}

interface RestrictedView {
  successor: string;
  steps: Step[];
  timeZone: string;
}

const PAGE_TEXT: Readonly<
  Record<
    SupportedLocale,
    {
      title: string;
      body: (successor: string) => string;
      progress: string;
      after: (successor: string) => string;
    }
  >
> = {
  "en-GB": {
    title: "This box has handed over",
    body: (successor) =>
      `It takes no sales and sends nothing to the tax agency. The venue now runs on ${successor}.`,
    progress: "Progress",
    after: (successor) =>
      `It sends its invoice records to ${successor} by itself, then becomes the spare.`,
  },
  "es-ES": {
    title: "Este equipo ha hecho el traspaso",
    body: (successor) =>
      `No hace ventas ni envía nada a Hacienda. El local funciona ahora con ${successor}.`,
    progress: "Progreso",
    after: (successor) =>
      `Envía por sí solo sus registros de facturación a ${successor} y después pasa a ser el equipo de reserva.`,
  },
};

/** Keyed by every state, so a new state with no wording fails the typecheck. */
const STEP_TEXT: Readonly<
  Record<HandoverOperationState, Readonly<Record<SupportedLocale, string>>>
> = {
  prepared: { "en-GB": "Handover begun", "es-ES": "Traspaso iniciado" },
  source_stepped_down: { "en-GB": "Stopped taking sales", "es-ES": "Ha dejado de vender" },
  filing_relinquished: {
    "en-GB": "Stopped sending invoice records to the tax agency",
    "es-ES": "Ha dejado de enviar registros de facturación a Hacienda",
  },
  source_superseded: {
    "en-GB": "Another box took over the venue",
    "es-ES": "Otro equipo ha pasado a llevar el local",
  },
  copy_accepted: {
    "en-GB": "Copy of the venue accepted",
    "es-ES": "Copia del local aceptada",
  },
  filing_assumed: {
    "en-GB": "Took over sending invoice records to the tax agency",
    "es-ES": "Ha pasado a enviar los registros de facturación a Hacienda",
  },
  emergency_declared: {
    "en-GB": "Emergency handover declared",
    "es-ES": "Traspaso de emergencia declarado",
  },
  activated: { "en-GB": "Started running the venue", "es-ES": "Ha empezado a llevar el local" },
  return_pending: {
    "en-GB": "Sending its invoice records",
    "es-ES": "Enviando sus registros de facturación",
  },
  return_complete: {
    "en-GB": "Invoice records sent",
    "es-ES": "Registros de facturación enviados",
  },
  return_abandoned: {
    "en-GB": "Sending its invoice records was stopped",
    "es-ES": "Se ha detenido el envío de sus registros de facturación",
  },
  replaced: {
    "en-GB": "Replaced by another handover",
    "es-ES": "Sustituido por otro traspaso",
  },
  abandoned: { "en-GB": "Handover cancelled", "es-ES": "Traspaso cancelado" },
};

/** `Object.hasOwn`: the kind is read from a file, and `toString` must not find an inherited value. */
function stepText(kind: string, locale: SupportedLocale): string {
  if (!Object.hasOwn(STEP_TEXT, kind)) return kind;
  return STEP_TEXT[kind as HandoverOperationState][locale];
}

async function readView(deps: RestrictedPageDeps): Promise<RestrictedView> {
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  // A fault in Waitron: this page is mounted only on a start that found the restriction.
  if (restriction === null) throw new Error(`no handover restriction for node ${deps.nodeId}`);
  const [row] = await deps.venue
    .select({ name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, restriction.successorNodeId));
  const steps: Step[] = [];
  const operation =
    restriction.operationId === null
      ? null
      : await readHandoverOperation(deps.node, deps.nodeId, restriction.operationId);
  if (operation !== null) {
    // The first state is written with the operation's row; only later ones are events.
    steps.push({
      kind: initialState(operation.role, operation.scenario),
      at: operation.createdAt,
    });
    const events = await deps.node
      .select({ kind: nodeHandoverEvents.kind, at: nodeHandoverEvents.recordedAt })
      .from(nodeHandoverEvents)
      .where(
        and(
          eq(nodeHandoverEvents.nodeId, deps.nodeId),
          eq(nodeHandoverEvents.operationId, operation.operationId),
        ),
      )
      .orderBy(asc(nodeHandoverEvents.recordedAt), asc(sql`rowid`));
    steps.push(...events);
  }
  return {
    successor: row?.name ?? restriction.successorNodeId,
    steps,
    timeZone: await readVenueTimeZone(deps.venue),
  };
}

function renderPage(view: RestrictedView, locale: SupportedLocale): string {
  const text = PAGE_TEXT[locale];
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: view.timeZone,
  });
  const steps =
    view.steps.length === 0
      ? ""
      : `<h2>${escapeHtml(text.progress)}</h2>
<ul>
${view.steps
  .map(
    (step) => `<li>${escapeHtml(`${when.format(step.at)}: ${stepText(step.kind, locale)}`)}</li>`,
  )
  .join("\n")}
</ul>
`;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(text.title)}</title>
<style>:root { color-scheme: light dark; } p, li { overflow-wrap: anywhere; }</style>
</head>
<body>
<h1>${escapeHtml(text.title)}</h1>
<p>${escapeHtml(text.body(view.successor))}</p>
${steps}<p>${escapeHtml(text.after(view.successor))}</p>
</body>
</html>
`;
}

/** The page a person opening a stepped-down box sees. It offers nothing to do: none is needed. */
export function restrictedPageRoute(deps: RestrictedPageDeps): (app: Hono) => void {
  return (app) => {
    app.get("/", async (c) => {
      const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      return c.html(renderPage(await readView(deps), locale));
    });
  };
}
