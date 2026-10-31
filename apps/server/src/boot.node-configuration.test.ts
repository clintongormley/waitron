import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import { sql } from "drizzle-orm";
import {
  invoiceSeries,
  locations,
  nodes,
  sales,
  stampDeployment,
  tenants,
  withTransaction,
} from "@waitron/db";
import { setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { stringToCents } from "@waitron/shared";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TradingContext } from "./trading-context.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
vi.mock("undici", async (original) => ({
  ...(await original<typeof import("undici")>()),
  fetch: vi.fn(() =>
    Promise.reject(new Error("external fetch disabled in node configuration test")),
  ),
}));

const observed = vi.hoisted(() => ({
  cfg: undefined as TradingContext | undefined,
  orders: undefined as Parameters<typeof import("./orders-api.js").mountOrdersApi>[1] | undefined,
  customers: undefined as
    | Parameters<typeof import("./invoice-customer-data-api.js").mountInvoiceCustomerDataApi>[1]
    | undefined,
}));
vi.mock("./orders-api.js", async (original) => {
  const actual = await original<typeof import("./orders-api.js")>();
  return {
    ...actual,
    mountOrdersApi: (...args: Parameters<typeof actual.mountOrdersApi>) => {
      observed.orders = args[1];
      return actual.mountOrdersApi(...args);
    },
  };
});
vi.mock("./invoice-customer-data-api.js", async (original) => {
  const actual = await original<typeof import("./invoice-customer-data-api.js")>();
  return {
    ...actual,
    mountInvoiceCustomerDataApi: (
      ...args: Parameters<typeof actual.mountInvoiceCustomerDataApi>
    ) => {
      observed.customers = args[1];
      return actual.mountInvoiceCustomerDataApi(...args);
    },
  };
});
vi.mock("./till-api.js", async (original) => {
  const actual = await original<typeof import("./till-api.js")>();
  return {
    ...actual,
    mountTillApi: (...args: Parameters<typeof actual.mountTillApi>) => {
      observed.cfg = args[1].cfg;
      return actual.mountTillApi(...args);
    },
  };
});

const NODE = "33333333-3333-4333-8333-333333333333";
const LOCATION = "55555555-5555-4555-8555-555555555555";
const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const { startServer, httpPort } = ephemeralServerFixture();
let root: string | undefined;
let migrations: string;
let next = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "waitron-node-config-boot-"));
  migrations = join(root, "migrations");
  const options = migrationOptionsFor(manifestSets(), null);
  for (const [i, set] of manifestSets().entries()) {
    await cp(options[i]!.migrationsFolder, join(migrations, set.name), { recursive: true });
  }
}, 60_000);
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

async function environment(ownNode: boolean, pending = false) {
  const state = join(root!, `state-${next++}`);
  const venue = join(state, "venue");
  await mkdir(venue, { recursive: true });
  await writeFile(
    join(state, "modules.json"),
    JSON.stringify({ modules: { "fiscal-verifactu": false } }),
  );
  const destination = join(venue, "venue.db");
  await source.db.execute(sql`vacuum into ${destination}`);
  await source.node.execute(sql`vacuum into ${join(venue, "node.db")}`);
  if (pending) {
    await writeFile(
      join(state, "pending-adoption.json"),
      JSON.stringify({
        locationId: LOCATION,
        standby: { nodeId: NODE, publicKey: "pub", privateKey: "priv" },
        nodeName: "standby",
        filingModule: "fiscal-none",
        taxModule: null,
        reserved: { modules: {}, series: [], endorsement: {} },
        originNodeId: "77777777-7777-4777-8777-777777777777",
      }),
      { mode: 0o600 },
    );
  }
  return {
    WAITRON_STATE_DIR: state,
    WAITRON_VENUE_DIR: venue,
    WAITRON_MIGRATIONS_DIR: migrations,
    WAITRON_HTTP_PORT: "8080",
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_ENV: "preproduction",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    ...(ownNode ? { WAITRON_NODE_ID: NODE } : {}),
    WAITRON_TILL_TIPS: "true",
  };
}

it.each([undefined, ""])(
  "settings-only input serves setup without establishing node identity (%s)",
  async (node) => {
    const env = await environment(false);
    const server = await startServer({
      ...env,
      WAITRON_NODE_ID: node,
      WAITRON_TILL_LOCALE: "ca-ES",
    });
    let dispatcher: Agent | undefined;
    try {
      dispatcher = new Agent({
        connect: { ca: await readFile(join(env.WAITRON_STATE_DIR, "tls", "ca.crt")) },
      });
      const via = { dispatcher } as RequestInit;
      const setup = await fetch(`https://127.0.0.1:${httpPort()}/setup-api/status`, via);
      expect(setup.status).toBe(200);
      await setup.body?.cancel();
      const till = await fetch(`https://127.0.0.1:${httpPort()}/api/till`, via);
      expect(till.headers.get("content-type")).toContain("text/html");
      expect(await till.text()).toContain("setup");
    } finally {
      await dispatcher?.close();
      await server.close();
    }
  },
  60_000,
);

it("pending adoption without an own node serves status and help before location resolution", async () => {
  const env = await environment(true, true);
  const server = await startServer(env);
  try {
    const base = `http://127.0.0.1:${httpPort()}`;
    const status = await fetch(`${base}/api/box/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toStrictEqual({ adoption: "pending" });
    expect((await fetch(`${base}/help/en/products`)).status).toBe(200);
    expect((await fetch(`${base}/api/till`)).status).toBe(404);
  } finally {
    await server.close();
  }
  await rm(join(env.WAITRON_STATE_DIR, "pending-adoption.json"));
  await expect(startServer(env)).rejects.toMatchObject({
    code: "server.node_config_invalid",
    params: { key: "WAITRON_NODE_ID" },
  });
}, 60_000);

it("otherwise identical trading without a latch refuses a missing node location", async () => {
  await expect(startServer(await environment(true))).rejects.toMatchObject({
    code: "server.node_config_invalid",
    params: { key: "WAITRON_NODE_ID" },
  });
}, 60_000);

it.each([
  [undefined, "en-GB"],
  ["", "en-GB"],
  ["es-ES", "es-ES"],
  ["zz-ZZ", "en-GB"],
])(
  "GB boot uses raw override rather than defaulted locale (%s)",
  async (raw, expected) => {
    await source.db
      .insert(tenants)
      .values({ id: 1, country: "GB", taxId: "GB123456789", legalName: "British Test Ltd" });
    await source.db.insert(locations).values({
      id: LOCATION,
      name: "Counter",
      province: "London",
      timeZone: "Europe/London",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    await source.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Own box" });
    const server = await startServer({ ...(await environment(true)), WAITRON_TILL_LOCALE: raw });
    try {
      const reply = await fetch(`http://127.0.0.1:${httpPort()}/api/till`);
      expect(reply.status).toBe(200);
      expect(await reply.json()).toMatchObject({
        locale: expected,
        nodeId: NODE,
        tipsEnabled: true,
        simplifiedInvoiceLimit: null,
      });
      expect(observed.cfg).toMatchObject({
        nodeId: NODE,
        locationId: LOCATION,
        simplifiedInvoiceLimit: null,
        operationDescriptionRequired: false,
      });
      expect((await fetch(`http://127.0.0.1:${httpPort()}/setup-api/status`)).status).toBe(404);
    } finally {
      await server.close();
    }
  },
  60_000,
);

it.each([
  ["demo", true],
  ["prepare", true],
  ["live", false],
] as const)(
  "%s retains app preferences and practice mode",
  async (intent, practiceMode) => {
    await source.db
      .insert(tenants)
      .values({ id: 1, country: "GB", taxId: "GB123456789", legalName: "British Test Ltd" });
    await source.db.insert(locations).values({
      id: LOCATION,
      name: "Counter",
      province: "London",
      timeZone: "Europe/London",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    await source.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Own box" });
    const server = await startServer({
      ...(await environment(true)),
      WAITRON_ENV: "dev",
      WAITRON_ONBOARDING_INTENT: intent,
      WAITRON_TILL_LOCALE: "en-GB",
    });
    try {
      const reply = await fetch(`http://127.0.0.1:${httpPort()}/api/till`);
      expect(reply.status).toBe(200);
      expect(await reply.json()).toMatchObject({
        locale: "en-GB",
        tipsEnabled: true,
        simplifiedInvoiceLimit: null,
      });
      expect(observed.cfg).toMatchObject({
        nodeId: NODE,
        locationId: LOCATION,
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        tipsEnabled: true,
        practiceMode,
        operationDescriptionRequired: false,
      });
    } finally {
      await server.close();
    }
  },
  60_000,
);

it.each(["mirror", "primary"] as const)(
  "%s reads the correct node's rows while retaining its own box identity",
  async (mode) => {
    const originNode = "77777777-7777-4777-8777-777777777777";
    await source.db
      .insert(tenants)
      .values({ id: 1, country: "GB", taxId: "GB123456789", legalName: "British Test Ltd" });
    await source.db.insert(locations).values({
      id: LOCATION,
      name: "Counter",
      province: "London",
      timeZone: "Europe/London",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    await source.db.insert(nodes).values([
      { id: NODE, locationId: LOCATION, name: "Own box" },
      { id: originNode, locationId: LOCATION, name: "Origin box" },
    ]);
    for (const [nodeId, amount] of [
      [NODE, "90.00"],
      [originNode, "10.00"],
    ] as const) {
      const [series] = await source.db
        .insert(invoiceSeries)
        .values({ nodeId, code: "A" })
        .returning();
      await source.db.insert(sales).values({
        source: "demo_seed",
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: "2026-06-10T12:00:00.000Z",
        issuedOffsetMinutes: 60,
        total: stringToCents(amount),
        vatBreakdown: [{ rate: "0.00", base: amount, tax: "0.00" }],
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      });
    }
    const [person] = await source.db
      .insert(persons)
      .values({ displayName: "Administrator", role: "admin" })
      .returning();
    const session = await withTransaction(source.db, (tx) =>
      startManagementSession(tx, { personId: person!.id }),
    );
    await stampDeployment(source.db, "preproduction");
    if (mode === "mirror") {
      await setNodeMode({ venue: source.db, node: source.node }, NODE, "mirror");
      await writeMirrorLink(source.node, NODE, {
        relayUrl: "http://127.0.0.1:1/",
        boxHostname: "origin-box.local",
        boxCaPem: mintSelfSignedServerCert({
          hostnames: ["origin-box.local"],
          ipAddresses: [],
          now: new Date(),
        }).caCertPem,
        originNodeId: originNode,
      });
    }
    const server = await startServer(await environment(true));
    try {
      const base = `http://127.0.0.1:${httpPort()}`;
      const headers = { cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
      const response = await fetch(
        `${base}/management-api/reports/period?from=2026-06-10&to=2026-06-10`,
        { headers },
      );
      expect(response.status).toBe(200);
      const amount = mode === "mirror" ? "10.00" : "90.00";
      expect(await response.json()).toStrictEqual({
        from: "2026-06-10",
        to: "2026-06-10",
        vat: {
          byRate: [{ rate: "0.00", base: amount, tax: "0.00" }],
          baseTotal: amount,
          taxTotal: "0.00",
          grossTotal: amount,
        },
        topSellers: [],
      });
      const probe = await fetch(`${base}/api/node`);
      expect(probe.status).toBe(200);
      expect(await probe.json()).toMatchObject({
        nodeId: NODE,
        acceptingSales: mode === "primary",
      });
      expect(observed.cfg).toMatchObject({ nodeId: NODE, locationId: LOCATION });
      expect(observed.orders?.cfg).toStrictEqual({ nodeId: mode === "mirror" ? originNode : NODE });
      expect(observed.orders?.tradingContext).toBe(observed.cfg);
      expect(observed.customers?.nodeId).toBe(mode === "mirror" ? originNode : NODE);
      expect(observed.customers?.tradingContext).toBe(observed.cfg);
      if (mode === "mirror") {
        const write = await fetch(`${base}/management-api/catalogues`, {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(write.status).toBe(403);
        expect(await write.json()).toStrictEqual({ error: { code: "node.read_only", params: {} } });
      }
    } finally {
      await server.close();
    }
  },
  60_000,
);
