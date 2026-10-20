import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Agent } from "undici";
import { afterEach, expect, it, vi, beforeEach } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { emptyDrainResult } from "@waitron/fiscal";
import {
  enabledModules,
  type ThrowawayAllocation,
  type ModuleOperationInput,
} from "@waitron/module";
import {
  venueFiscalSelection,
  type VenueRequest,
  type InitialVenueInput,
} from "@waitron/provisioning";
import { submitFiscalReadiness } from "./fiscal-readiness-runner.js";
import { startServer, type StartedServer } from "./boot.js";
import { initialSetupInput } from "./testing/allocated-provision.js";
import { freePorts } from "./testing/free-ports.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { ownedHourSetup } from "../test/owned-hour-setup.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00.000Z"));
});
afterEach(() => vi.useRealTimers());

const calls = vi.hoisted(() => ({ throwaway: vi.fn(), outside: vi.fn(), drain: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => {
    const mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 500,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  },
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/composition", async (original) => {
  const actual = await original<typeof import("@waitron/composition")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) => {
      if (module.name !== "fiscal-verifactu") return module;
      const operations = module.operations!;
      return {
        ...module,
        provisioning: {
          ...module.provisioning,
          throwawayAllocation: {
            prepare: (...args: Parameters<ThrowawayAllocation["prepare"]>) => {
              calls.throwaway(...args);
              return module.provisioning!.throwawayAllocation!.prepare(...args);
            },
          },
        },
        operations: {
          ...operations,
          configure: (host: Parameters<NonNullable<typeof operations.configure>>[0]) => {
            const configured = operations.configure!(host);
            return {
              prepare: <T>(
                operation: ModuleOperationInput,
                run: (prepared: ModuleOperationInput) => Promise<T>,
              ): Promise<T> => {
                calls.outside(operation);
                return configured.prepare(operation, run);
              },
            };
          },
        },
        fiscal: {
          ...module.fiscal!,
          provisioningSecret: { required: () => true, validate: () => {}, seal: async () => {} },
          drain: calls.drain,
        },
      };
    }),
  };
});

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  calls.throwaway.mockClear();
  calls.outside.mockClear();
  calls.drain.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function root() {
  const directory = await mkdtemp(join(tmpdir(), "readiness-first-setup-"));
  dirs.push(directory);
  return directory;
}

function facts(directory: string) {
  const db = new DatabaseSync(join(directory, "venue.db"), { readOnly: true });
  try {
    const all = (query: string) =>
      db
        .prepare(query)
        .all()
        .map((row) => ({ ...row }));
    return {
      deployment: all("select environment from deployment"),
      nodes: all("select id from nodes order by id"),
      administrators: all("select id from persons where role = 'admin' order by id"),
      allocations: all(
        "select event_key, allocation_key, node_id, environment from fiscal_allocations",
      ),
      identities: all("select id, node_id, numero_instalacion from registro_sif"),
      series: all("select id, code, purpose, next_number from invoice_series order by code"),
      records: all("select id, entorno, num_serie_factura, huella from registros_facturacion"),
      sales: all("select id from sales"),
    };
  } finally {
    db.close();
  }
}

it.each([true, false])(
  "real boot readiness isolates Live inputs (production allocation supplied: %s), retains its chain across restart and a changed binding gets another database",
  async (supplied) => {
    const directory = await root();
    const stateDir = join(directory, "state");
    await mkdir(stateDir);
    let production: InitialVenueInput = await initialSetupInput(stateDir, request, "production");
    const [port] = await freePorts(1);
    const migrationsRoot = join(directory, "migrations");
    await copyMigrationsRoot(migrationsRoot);
    const env = {
      ...process.env,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: join(directory, "live"),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "production",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
    };
    const killed = vi.spyOn(process, "kill").mockReturnValue(true);
    calls.drain.mockResolvedValue(emptyDrainResult());
    let server: StartedServer | undefined;
    let agent: Agent | undefined;
    try {
      server = await startServer(env);
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      const post = async (legalName = request.legalName) => {
        const response = await fetch(`https://127.0.0.1:${port}/setup-api/fiscal-test`, {
          dispatcher: agent,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "live",
            aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "synthetic", certKind: "sello" },
            venue: { ...request, legalName },
            ...(supplied ? { initialOperations: production } : {}),
          }),
        } as RequestInit);
        return { status: response.status, body: await response.json() };
      };
      expect(await post()).toEqual({ status: 200, body: { status: "uncertain" } });
      expect(calls.outside).not.toHaveBeenCalled();
      expect(calls.throwaway).toHaveBeenCalledTimes(1);
      expect(calls.throwaway.mock.calls[0]![0]).toMatchObject({ environments: ["preproduction"] });
      const databases = async () =>
        (await readdir(stateDir)).filter((name) => name.startsWith("fiscal-readiness-db-"));
      const [name] = await databases();
      const first = facts(join(stateDir, name!));
      expect(first.deployment).toEqual([{ environment: "preproduction" }]);
      expect(first.allocations).toEqual([
        {
          event_key: expect.any(String),
          allocation_key: expect.stringMatching(/^throwaway-/),
          node_id: expect.any(String),
          environment: "preproduction",
        },
      ]);
      expect(first.nodes).not.toContainEqual({ id: production.nodeId });
      expect(first.administrators).not.toContainEqual({ id: production.administratorId });
      expect(first.sales).toHaveLength(1);
      expect(first.records).toEqual([
        {
          id: expect.any(String),
          entorno: "preproduction",
          num_serie_factura: "A-06RB/1",
          huella: expect.any(String),
        },
      ]);
      expect(first.series.map(({ code, next_number }) => ({ code, next_number }))).toEqual([
        { code: "A-06RB", next_number: 2 },
        { code: "FF-06RB", next_number: 1 },
        { code: "R-06RB", next_number: 1 },
      ]);
      await server.close();
      server = undefined;
      await agent.close();
      agent = undefined;
      server = await startServer(env);
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      calls.drain.mockResolvedValue({ ...emptyDrainResult(), recordsAccepted: 1 });
      expect(await post()).toMatchObject({ status: 200, body: { status: "accepted" } });
      expect(await databases()).toEqual([name]);
      expect(facts(join(stateDir, name!))).toEqual(first);
      expect(calls.throwaway).toHaveBeenCalledTimes(1);
      expect(calls.outside).not.toHaveBeenCalled();
      expect(await post("Another legal name SL")).toMatchObject({
        status: 200,
        body: { status: "accepted" },
      });
      expect(await databases()).toHaveLength(2);
      expect(calls.throwaway).toHaveBeenCalledTimes(2);
      expect(facts(join(stateDir, name!))).toEqual(first);
      if (supplied) {
        expect(await post()).toMatchObject({ status: 200, body: { status: "accepted" } });
        const owned = await ownedHourSetup(
          (input, init) => fetch(input, { ...init, dispatcher: agent } as RequestInit),
          `https://127.0.0.1:${port}`,
          request,
          PASSWORD,
        );
        production = owned.initialOperations;
        const response = await fetch(`https://127.0.0.1:${port}/setup-api/provision`, {
          dispatcher: agent,
          method: "POST",
          headers: owned.headers,
          body: JSON.stringify({
            mode: "live",
            aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "synthetic", certKind: "sello" },
            email: {
              server: "smtp.example.test",
              port: 587,
              encryption: "starttls",
              from: "owner@example.test",
            },
          }),
        } as RequestInit);
        expect({ status: response.status, body: await response.json() }).toMatchObject({
          status: 200,
          body: { provisioned: true, restarting: true },
        });
        await vi.waitFor(() => expect(killed).toHaveBeenCalledWith(process.pid, "SIGTERM"));
        await server.close();
        server = undefined;
        const live = facts(env.WAITRON_VENUE_DIR);
        expect(live.deployment).toEqual([{ environment: "production" }]);
        expect(first.nodes).not.toContainEqual({ id: production.nodeId });
        expect(first.administrators).not.toContainEqual({ id: production.administratorId });
        expect(live.nodes).toEqual([{ id: production.nodeId }]);
        expect(live.administrators).toEqual([{ id: production.administratorId }]);
        expect(live.allocations).toEqual([
          {
            event_key: expect.any(String),
            allocation_key: `hour/${production.inputs[0]!.eventId}`,
            node_id: production.nodeId,
            environment: "production",
          },
        ]);
        expect(live.sales).toEqual([]);
        expect(live.records).toEqual([]);
        expect(live.series.map(({ next_number }) => next_number)).toEqual([1, 1, 1]);
        for (const identity of live.identities)
          expect(first.identities).not.toContainEqual(identity);
        expect(calls.outside).toHaveBeenCalledTimes(1);
        expect(calls.throwaway).toHaveBeenCalledTimes(2);
        expect(facts(join(stateDir, name!))).toEqual(first);
      }
    } finally {
      await agent?.close();
      await server?.close();
    }
  },
);

it("direct readiness refuses an uploaded production allocation without an owned hour session", async () => {
  const stateDir = await root();
  const initialOperations = await initialSetupInput(stateDir, request, "production");
  const selected = venueFiscalSelection(ALL_MODULES, "ES-common");
  await expect(
    submitFiscalReadiness({
      stateDir,
      modules: enabledModules(ALL_MODULES, selected.config),
      venue: {
        ...request,
        admin: {
          displayName: request.admin.displayName,
          email: request.admin.email,
          pinHash: "synthetic-hash",
          passwordHash: "synthetic-hash",
        },
      } satisfies VenueRequest,
      initialOperations,
      contribution: selected.contribution!,
      secret: undefined,
      ring: {} as never,
      readinessInput: {
        requirement: "accepted-test-submission",
        fiscalModule: "verifactu",
        country: "ES",
        taxId: request.taxId,
        legalName: request.legalName,
        fiscalTerritory: "ES-common",
        submissionTarget: null,
        certificateFingerprint: null,
        certificateKind: null,
        moduleVersions: { core: 1 },
        applicationVersion: "test",
      },
    }),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  expect(calls.throwaway).not.toHaveBeenCalled();
  const [scratch] = (await readdir(stateDir)).filter((name) =>
    name.startsWith("fiscal-readiness-db-"),
  );
  expect(scratch).toBeDefined();
  const empty = facts(join(stateDir, scratch!));
  expect(empty.nodes).toEqual([]);
  expect(empty.administrators).toEqual([]);
  expect(empty.allocations).toEqual([]);
  expect(empty.identities).toEqual([]);
  expect(empty.series).toEqual([]);
  expect(empty.records).toEqual([]);
  expect(empty.sales).toEqual([]);
});
