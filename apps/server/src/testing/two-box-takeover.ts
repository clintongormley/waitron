// The steps a joined spare takes to become the main box, on databases opened in the test's own
// process: the accepted copy placed as a start places it, then the real preparation and activation
// routes, with the real promotion standing behind the activation. The restart the promotion asks
// for is not run: the case carries on against the same open databases.
import { Socket } from "node:net";
import { eq, sql } from "drizzle-orm";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { expect } from "vitest";
import type { KeyRing } from "@waitron/credentials";
import {
  invoiceSeries,
  openVenueDatabase,
  readStandardSeriesId,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { FISCAL_CLASSIFICATION } from "@waitron/fiscal-verifactu";
import { registrosFacturacion as registros } from "@waitron/fiscal-verifactu/src/schema/registros.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import type { WaitronModule } from "@waitron/module";
import { createFirstSetupCoordinator, createPasswordThrottle } from "@waitron/provisioning";
import { nodeId as asNodeId } from "@waitron/shared";
import { recordFixtureSale } from "../../scripts/testing/sale.js";
import { createDeploymentHolders } from "../deployment-holders.js";
import { mountHandoverActivationApi } from "../handover-activation.js";
import type { EmergencyHandover } from "../handover-emergency-api.js";
import { placeAcceptedCopyAtStart, recordCopyPlaced } from "../handover-place-copy.js";
import { mountHandoverPreparationApi } from "../handover-preparation.js";
import { createNodeOperationPreparation } from "../node-operation-preparation.js";
import { promoteMirrorToPrimary } from "../promote.js";
import { TOTP_KEY_RING } from "./authenticator.js";

export interface Store {
  venue: Database;
  node: NodeDatabase;
}
export interface SignIn {
  email: string;
  password: string;
}

const FISCAL_TABLES = [...FISCAL_CLASSIFICATION.map(({ table }) => table), "invoice_series"];

/** Every row of the fiscal module's tables and the invoice series in `db`. */
export async function fiscalRows(db: Database): Promise<Record<string, unknown[]>> {
  const rows: Record<string, unknown[]> = {};
  for (const table of FISCAL_TABLES)
    rows[table] = (await db.execute(sql.raw(`select * from "${table}" order by rowid`))).rows;
  return rows;
}

/** A request through `app` over a stand-in TLS socket, as the box's HTTPS listener hands it on. */
export async function boxRequest(
  app: Hono,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      `https://box.test${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { incoming: { socket } },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    socket.destroy();
  }
}

/** The spare's own files, as a stopped box leaves them, then the start's real placing of the copy. */
export async function placeCopy(args: {
  spare: Store;
  venueDir: string;
  stateDir: string;
  nodeId: string;
  operationId: string;
}): Promise<Store & { close(): Promise<void> }> {
  const { spare, venueDir, stateDir, nodeId, operationId } = args;
  spare.venue.run(sql`vacuum into ${`${venueDir}/venue.db`}`);
  spare.node.run(sql`vacuum into ${`${venueDir}/node.db`}`);
  const log = () => {};
  expect(await placeAcceptedCopyAtStart({ venueDir, stateDir, nodeId, log })).toMatchObject({
    kind: "copy_placed_owed",
    swapped: true,
  });
  const placed = await openVenueDatabase(venueDir);
  await recordCopyPlaced({ node: placed.node, nodeId, stateDir, operationId, log });
  return placed;
}

/**
 * The real preparation and activation routes on `store`, the activation running the real
 * promotion; `takeOver` selects the new installation's name and activates under it.
 */
export function takeoverRoutes(args: {
  store: Store;
  nodeId: string;
  sourceId: string;
  operationId: string;
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
  ring: KeyRing;
  signIn: SignIn;
  emergency?: EmergencyHandover;
  /** Moves the test's clock on to a minute the selection asked to wait for. */
  waitUntil: (targetMs: number) => void;
}) {
  const { store, nodeId, operationId, signIn } = args;
  const binding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: operationId,
    sourceId: args.sourceId,
    targetNodeId: nodeId,
  };
  const common = {
    node: store.node,
    nodeId,
    appDb: store.venue,
    nodePreparation: createNodeOperationPreparation({
      stateDir: args.stateDir,
      venueDir: args.venueDir,
      db: store.venue,
      nodeDb: store.node,
      node: { nodeId: asNodeId(nodeId) },
      modules: args.modules,
      credentialKeyRing: TOTP_KEY_RING,
      coordinator: createFirstSetupCoordinator(),
      environment: {},
    }),
    passwordThrottle: createPasswordThrottle(),
  };
  const app = new Hono();
  mountHandoverPreparationApi(app, { ...common, requestFromBox: () => false });
  mountHandoverActivationApi(app, {
    ...common,
    run: async (attestation, runner, beforeRestart) => {
      const result = await promoteMirrorToPrimary(
        {
          db: store.venue,
          node: store.node,
          nodeId,
          ring: args.ring,
          modules: args.modules,
          holders: createDeploymentHolders("mirror", "secondary"),
          log: () => {},
          persistTradingEnv: async () => {},
          withModuleOperations: runner,
        },
        attestation,
      );
      if (!result.alreadyPrimary) await beforeRestart?.();
      return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
    },
    ...(args.emergency === undefined ? {} : { emergency: args.emergency }),
  });

  const path = (step: string) => `/api/node/handover/${operationId}/${step}`;
  const prepare = async (proposal: unknown) => {
    const answer = await boxRequest(app, path("preparation"), {
      moduleOperation: { binding, input: null },
      signIn,
      proposal,
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body as { id: string; status: string; targetMs?: number; identity: string };
  };

  /** The browser's clock check and minute choice, then the activation; answers the new name. */
  async function takeOver(): Promise<{ identity: string; answer: unknown }> {
    let selected: Awaited<ReturnType<typeof prepare>> & { input?: unknown };
    for (;;) {
      const challenge = await prepare({ action: "clock-challenge" });
      const compared = await prepare({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      selected = await prepare({ action: "select", comparisonId: compared.id });
      if (selected.status !== "waiting") break;
      args.waitUntil(selected.targetMs!);
    }
    expect(selected.status, JSON.stringify(selected)).toBe("selected");
    const activated = await boxRequest(app, path("activate"), {
      moduleOperation: { binding, input: selected.input },
      signIn,
    });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body).toEqual({ activated: true, restarting: true });
    return { identity: selected.identity, answer: activated.body };
  }
  return { app, takeOver };
}

/** A cash sale on `nodeId`'s standard series, and the fiscal record it wrote. */
export async function saleOn(db: Database, nodeId: string) {
  const seriesId = await readStandardSeriesId(db, nodeId);
  const { saleId } = await recordFixtureSale(db, {
    nodeId,
    seriesId,
    description: "Coffee",
    baseAmount: "2.00",
    vatRate: "10.00",
  });
  const [record] = await db.select().from(registros).where(eq(registros.saleId, saleId));
  return { seriesId, record: record! };
}

/** `nodeId`'s installations and series codes in `db`. */
export async function filingOf(db: Database, nodeId: string) {
  return {
    installations: (await db.select().from(registroSif).where(eq(registroSif.nodeId, nodeId))).map(
      (row) => ({ id: row.id, name: row.numeroInstalacion }),
    ),
    series: (await db.select().from(invoiceSeries).where(eq(invoiceSeries.nodeId, nodeId))).map(
      (row) => ({ id: row.id, code: row.code }),
    ),
  };
}
