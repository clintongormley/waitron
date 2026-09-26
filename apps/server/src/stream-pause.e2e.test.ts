// The stream's pause at the side-file limit, end to end, with the real pinned Litestream, a real
// S3-compatible server and sales posted to the running server's own sale route:
//   - the bucket is frozen, so every call to it goes unanswered;
//   - sales grow the side file past the limit, and the supervisor stops Litestream and folds the
//     file back in the server's own write queue while three sales at a time post on one till
//     session;
//   - every sale, before, across and after the fold-back, finishes within a bound that a call
//     waiting on the frozen bucket is shown to exceed;
//   - once the bucket answers again the pause ends, streaming resumes into the same generation,
//     and a sale made while the bucket was frozen is in it.
//
// Binaries as in `stream-loop.e2e.test.ts`: without them this case is reported SKIPPED; with
// CI=true or WAITRON_REQUIRE_STREAM_BINARIES=1 a missing binary FAILS it.
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { Agent } from "undici";
import { afterAll, describe, expect, it } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  deviceProfiles,
  devices,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { hashPassword, hashPin, hashSecret, persons } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { locationId as brandLocationId } from "@waitron/shared";
import {
  createS3ObjectStore,
  probeBucket,
  readPointer,
  restoreGeneration,
  TICK_MS,
  type BucketConfig,
  type StreamView,
} from "@waitron/stream";
import { startServer, type StartedServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { streamSettingsPayload } from "./stream-host.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  READY_TIMEOUT_MS as S3_READY_MS,
  VERSITYGW_VERSION,
  resolveLitestream,
  resolveVersitygw,
  startS3TestServer,
  type S3TestServer,
} from "./testing/s3-test-server.js";

const INSTALL = "node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs";
const REQUIRED = process.env.CI === "true" || process.env.WAITRON_REQUIRE_STREAM_BINARIES === "1";

const LOCALE = "es-ES";
const ADMIN_PIN = "1234";
const DEVICE_TOKEN = "stream-pause-e2e-device-token";

/**
 * Above the side file boot and the baseline sales leave with the bucket up: a 1 MiB limit paused
 * the stream while it was still opening (measured 2026-09-26). The default is 256 MiB.
 */
const WAL_LIMIT_BYTES = 16 * 1024 * 1024;

// `waitFor` checks each POINTER, RESUME and UPLOAD wait's deadline between probes, the helper
// enforces the S3 server's start, and `restoreGeneration` its RESTORE_MS ceiling; the fill and the
// wait for the fold-back each check a deadline between sales. BOOT_MS is a budget nothing here enforces, and UNTIMED_MS covers
// migrations, provisioning and the close. The case's timeout is the sum, because Vitest's timer
// fails a healthy run that outlasts it (CLAUDE.md §4). The fold-back is waited for until the
// supervisor's next side-file check after the fill, TICK_MS at most, plus FOLD_SLACK_MS for
// Litestream's stop, which escalates to SIGKILL after five seconds.
const POINTER_WAIT_MS = 30_000;
const BOOT_MS = 30_000;
/** A loaded CI runner took more than 30 s to reach the limit (testing-guide.md, the pause test). */
const FILL_WAIT_MS = 180_000;
const FOLD_SLACK_MS = 15_000;
const RESUME_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 30_000;
const RESTORE_MS = 30_000;
const UNTIMED_MS = 60_000;
const POLL_MS = 250;
/**
 * How long before the supervisor's side-file check the sellers start again, so they are selling
 * at it.
 */
const LEAD_MS = 3_000;
/**
 * Sales posted at once on one till session, so sales compete for the write queue the fold-back
 * runs in.
 */
const SELLERS = 3;
/**
 * At least this many sales timed with the bucket up, and again during the pause, across the sellers.
 */
const TIMED_SALES = 10;
/** Each timed sale and the frozen-bucket control, budgeted at the bound's floor. */
const SALE_BUDGET_MS = 1_000;
const PAUSE_TIMEOUT_MS =
  S3_READY_MS +
  BOOT_MS +
  2 * POINTER_WAIT_MS +
  (2 * TIMED_SALES + 1) * SALE_BUDGET_MS +
  FILL_WAIT_MS +
  TICK_MS +
  FOLD_SLACK_MS +
  RESUME_WAIT_MS +
  UPLOAD_WAIT_MS +
  RESTORE_MS +
  UNTIMED_MS;

const litestream = await resolveLitestream(process.env);
const versitygw = await resolveVersitygw(process.env);
const missing = [litestream, versitygw].flatMap((lookup) => (lookup.ok ? [] : [lookup.reason]));
if (missing.length > 0 && !REQUIRED) {
  console.warn(`stream pause test SKIPPED: ${missing.join("; ")}. Install with: ${INSTALL}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitFor<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

/**
 * One sale through the route. `walBefore` is the side file measured just before it was posted and
 * `walAfter` just after its answer; each sale's `walBefore` is the previous one's `walAfter`, so
 * back-to-back sales leave no moment outside some sale's pair.
 */
interface TimedSale {
  invoiceNumber: string;
  ms: number;
  walBefore: number;
  walAfter: number;
}

/** The `stream.*` events the server logged, from every file the log has rotated into. */
async function streamEvents(
  logDir: string,
): Promise<{ event: string; [field: string]: unknown }[]> {
  const files = (await readdir(logDir))
    .filter((name) => name.startsWith("waitron.log"))
    .sort()
    .reverse();
  const lines = (await Promise.all(files.map((name) => readFile(join(logDir, name), "utf8"))))
    .join("")
    .split("\n");
  return lines
    .filter((line) => line.includes('"event":"stream.'))
    .map((line) => JSON.parse(line) as { event: string });
}

describe("the stream's pause at the side-file limit, with sales on the server's own route", () => {
  let scratch: string | undefined;
  let s3: S3TestServer | undefined;
  let server: StartedServer | undefined;
  let dispatcher: Agent | undefined;

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const cleanup of [
      async () => {
        s3?.resume();
      },
      async () => {
        if (server !== undefined) await server.close();
      },
      async () => {
        if (dispatcher !== undefined) await dispatcher.close();
      },
      async () => {
        if (s3 !== undefined) await s3.stop();
      },
      async () => {
        if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "stream pause teardown failed");
  });

  it(
    "folds the side file back behind live sales while the bucket is frozen, and resumes streaming once it answers",
    async (ctx) => {
      if (!litestream.ok || !versitygw.ok) {
        if (REQUIRED) {
          throw new Error(
            `stream pause test cannot run: ${missing.join("; ")}. CI installs both with: ${INSTALL}`,
          );
        }
        return ctx.skip(`${missing.join("; ")} — install with: ${INSTALL}`);
      }
      const litestreamBin = litestream.bin;

      scratch = await mkdtemp(join(tmpdir(), "waitron-stream-pause-"));
      const migrationsRoot = join(scratch, "migrations");
      const fromSource = migrationOptionsFor(manifestSets(), null);
      for (const [index, set] of manifestSets().entries()) {
        await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
          recursive: true,
        });
      }

      // 1. The bucket.
      s3 = await startS3TestServer({ bin: versitygw.bin, root: join(scratch, "s3") });
      const bucket: BucketConfig = {
        endpoint: s3.endpoint,
        region: s3.region,
        bucket: s3.bucket,
        prefix: "pause/",
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      };
      const store = createS3ObjectStore(bucket);
      expect(
        await probeBucket(store),
        `versitygw ${VERSITYGW_VERSION} failed the conditional-write probe. Server log: ${s3.log()}`,
      ).toEqual({ ok: true });

      // 2. A box provisioned as a setup boot leaves it, streaming switched on, plus what a till
      //    needs to ring a sale: an enrolled device and one product on offer.
      const stateDir = join(scratch, "state");
      const venueDir = join(stateDir, "venue");
      await mkdir(venueDir, { recursive: true });
      const port = await freePort();
      await ensureBoxSecrets({
        stateDir,
        hostnames: ["waitron.local", "localhost"],
        now: () => new Date(),
        listIpv4: () => [],
      });
      const ring = loadKeyRing(parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8")));
      await applyMigrations(venueDir, fromSource);
      const seeding = await openVenueDatabase(venueDir);
      let box: {
        nodeId: string;
        tillId: string;
        seriesId: string;
        locationId: string;
        venueId: string;
        adminId: string;
        deviceId: string;
        offer: string;
      };
      try {
        await stampDeployment(seeding.venue, "preproduction");
        const venue = await applyVenue(
          planVenue(
            {
              country: "ES",
              taxId: "74000002E",
              legalName: "Stream Pause SL",
              location: {
                name: "Sala principal",
                fiscalTerritory: "ES-common",
                invoiceLocales: [LOCALE],
                operationDescription: "Venta en establecimiento",
                addressLine1: "Calle Mayor 2",
                addressLine2: null,
                postalCode: "28013",
                city: "Madrid",
                province: "Madrid",
                timeZone: "Europe/Madrid",
                dayCutover: "05:00",
              },
              tillName: "Caja 1",
              seriesCode: "A",
              rectificativeSeriesCode: "R",
              admin: {
                displayName: "Administradora",
                firstNames: "Test",
                lastNames: "Operator",
                pinHash: hashPin(ADMIN_PIN),
                passwordHash: hashPassword("dashPass123"),
                email: "owner@example.test",
              },
            },
            ALL_MODULES,
          ),
          { db: seeding.venue, modules: ALL_MODULES },
        );
        await establishNodeIdentity({ ownerDb: seeding.venue, ring }, venue.nodeId);
        await seedTermZeroMembership(
          { db: seeding.venue, ring },
          venue.nodeId,
          `https://127.0.0.1:${port}`,
        );
        await withTransaction(seeding.venue, (tx) =>
          putCredential(tx, ring, {
            purpose: "backup.stream",
            value: streamSettingsPayload({ venueId: venue.locationId, bucket }),
          }),
        );
        const [admin] = await seeding.venue
          .select({ id: persons.id })
          .from(persons)
          .where(eq(persons.role, "admin"));
        const [profile] = await seeding.venue
          .select({ id: deviceProfiles.id })
          .from(deviceProfiles)
          .where(eq(deviceProfiles.formFactor, "till"));
        const [device] = await seeding.venue
          .insert(devices)
          .values({
            locationId: venue.locationId,
            deviceProfileId: profile!.id,
            tillId: venue.tillId,
            label: "Caja 1",
            tokenHash: hashSecret(DEVICE_TOKEN),
          })
          .returning({ id: devices.id });
        const offer = await withTransaction(seeding.venue, async (tx) => {
          const catalogue = await createCatalogue(tx, { name: "Carta" });
          const drinks = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
          const water = await createProduct(tx, {
            catalogueId: catalogue.id,
            categoryId: drinks.id,
            name: "Agua",
            pricingUnit: "each",
            unitPrice: "1.50",
            vatClass: "general",
          });
          await assignCatalogueToLocation(tx, brandLocationId(venue.locationId), catalogue.id);
          const offers = await offerProducts(tx, {
            locationId: brandLocationId(venue.locationId),
            orderFlow: "prepay",
          });
          return offers.offerFor(water.id);
        });
        box = {
          nodeId: venue.nodeId,
          tillId: venue.tillId,
          seriesId: venue.seriesIds[0]!,
          locationId: venue.locationId,
          venueId: venue.locationId,
          adminId: admin!.id,
          deviceId: device!.id,
          offer,
        };
      } finally {
        await seeding.close();
      }
      await writeFile(
        join(stateDir, "trading.env"),
        formatEnvFile({
          WAITRON_TILL_TILL_ID: box.tillId,
          WAITRON_TILL_NODE_ID: box.nodeId,
          WAITRON_TILL_SERIES_ID: box.seriesId,
          WAITRON_TILL_LOCATION_ID: box.locationId,
          WAITRON_ENV: "preproduction",
        }),
      );
      await writeFile(
        join(stateDir, "backup.env"),
        formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: "stream-pause-e2e-recovery-key" }),
      );
      await writeFile(
        join(stateDir, "modules.json"),
        JSON.stringify({ modules: { "fiscal-none": false } }),
      );

      // 3. The server boots with a small side-file limit and opens its generation.
      server = await startServer(
        await loadBoxEnv(
          {
            WAITRON_STATE_DIR: stateDir,
            WAITRON_VENUE_DIR: venueDir,
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_HTTP_PORT: String(port),
            WAITRON_HTTP_LANDING_PORT: "0",
            WAITRON_LITESTREAM_BIN: litestreamBin,
          },
          stateDir,
        ),
        {},
        { stream: { walLimitBytes: WAL_LIMIT_BYTES } },
      );
      const running = server;
      const stream = (): StreamView => running.health.readStream();
      const pointer = await waitFor(
        "the pointer to name the box's generation",
        POINTER_WAIT_MS,
        async () => {
          const read = await readPointer(store, box.venueId);
          return read !== null && read.pointer.body.nodeId === box.nodeId ? read : undefined;
        },
      );
      const generation = pointer.pointer.body.generation;
      await waitFor("the stream to read streaming", POINTER_WAIT_MS, async () =>
        stream().state === "streaming" ? true : undefined,
      );
      const streamingSince = Date.parse((stream() as { stateSince: string }).stateSince);

      // 4. A till signs in over the box's own TLS.
      dispatcher = new Agent({
        connect: {
          ca: await readFile(join(stateDir, "tls", "ca.crt"), "utf8"),
          servername: "localhost",
        },
      });
      const base = `https://127.0.0.1:${port}`;
      const deviceCookie = `${DEVICE_COOKIE}=${box.deviceId}.${DEVICE_TOKEN}`;
      const login = await fetch(`${base}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: deviceCookie },
        body: JSON.stringify({ personId: box.adminId, pin: ADMIN_PIN }),
        dispatcher,
      } as RequestInit);
      expect(login.status, await login.clone().text()).toBe(200);
      const cookies = `${login.headers.get("set-cookie")!.split(";")[0]!}; ${deviceCookie}`;

      const walPath = join(venueDir, "venue.db-wal");
      const sell = async (walBefore: number): Promise<TimedSale> => {
        const started = performance.now();
        const response = await fetch(`${base}/api/sales`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookies },
          body: JSON.stringify({
            lines: [{ menuItemId: box.offer, quantity: "1" }],
            tender: { method: "cash", amount: "2.00" },
          }),
          dispatcher,
        } as RequestInit);
        const ms = performance.now() - started;
        const ticket = (await response.json()) as { invoiceNumber?: string };
        expect(response.status, JSON.stringify(ticket)).toBe(200);
        return {
          invoiceNumber: ticket.invoiceNumber!,
          ms,
          walBefore,
          walAfter: await fileBytes(walPath),
        };
      };
      const slowest = (sales: TimedSale[]) => Math.max(...sales.map((sale) => sale.ms));
      /**
       * SELLERS sellers posting back to back on one till session, starting from a side file
       * measured at `walStart`, until `done` holds for one sale; each seller then finishes the sale
       * it has in flight. Answers each seller's sales in order.
       */
      const sellAtOnce = async (
        walStart: number,
        done: (sale: TimedSale, sold: number) => boolean,
        deadline?: { at: number; what: string },
        beforeEachSale?: () => Promise<void>,
      ): Promise<TimedSale[][]> => {
        const began = Date.now();
        let sold = 0;
        let stop = false;
        return Promise.all(
          Array.from({ length: SELLERS }, async () => {
            const mine: TimedSale[] = [];
            let walBefore = walStart;
            while (!stop) {
              await beforeEachSale?.();
              if (stop) break;
              if (deadline !== undefined && Date.now() > deadline.at) {
                stop = true;
                throw new Error(
                  `timed out waiting for ${deadline.what}: the stream reads ${JSON.stringify(stream())}, the side file ${walBefore} bytes, ` +
                    `${sold} sales in ${Date.now() - began} ms from ${walStart} bytes`,
                );
              }
              const sale = await sell(walBefore);
              mine.push(sale);
              sold += 1;
              walBefore = sale.walAfter;
              if (done(sale, sold)) stop = true;
            }
            return mine;
          }),
        );
      };
      const crosses = (sale: TimedSale) =>
        sale.walBefore >= WAL_LIMIT_BYTES && sale.walAfter < WAL_LIMIT_BYTES;
      /** The supervisor measures the side file every TICK_MS from the moment it began streaming. */
      const checkAfter = (at: number) =>
        streamingSince + TICK_MS * Math.max(1, Math.ceil((at - streamingSince) / TICK_MS));

      // 5. Sales with the bucket answering set the bound: a sale that waited on the frozen bucket
      //    would hang with it, so the bound sits far below that and far above a healthy sale.
      const baseline = (
        await sellAtOnce(await fileBytes(walPath), (_, sold) => sold >= TIMED_SALES)
      ).flat();
      const bound = Math.max(SALE_BUDGET_MS, 5 * slowest(baseline));
      expect(
        await fileBytes(walPath),
        "the side file reached the limit before the bucket was frozen",
      ).toBeLessThan(WAL_LIMIT_BYTES);

      // 6. The bucket freezes (SIGSTOP), so every call to it goes unanswered while it is frozen.
      //    The control: a call that does wait on the bucket is still unanswered at the bound.
      s3.pause();
      expect(
        await Promise.race([
          store.list("").then(
            () => "answered",
            () => "refused",
          ),
          delay(bound).then(() => "unanswered"),
        ]),
      ).toBe("unanswered");

      // 7. Sales grow the side file past the limit while Litestream still runs against the frozen
      //    bucket. A supervisor measurement landing after the fill passed the limit but before
      //    step 8 would pause the stream early, so near one the sellers post nothing from `bound`
      //    plus LEAD_MS before it until LEAD_MS after it. That holds while each sale beats the
      //    bound, as step 9 asserts, and the measurement is less than LEAD_MS late.
      const fillStarted = Date.now();
      const walAtFill = await fileBytes(walPath);
      const filling = (
        await sellAtOnce(
          walAtFill,
          (sale) => sale.walAfter >= WAL_LIMIT_BYTES,
          { at: fillStarted + FILL_WAIT_MS, what: "the side file to reach the limit" },
          async () => {
            const check = checkAfter(Date.now());
            if (check - Date.now() < bound + LEAD_MS) {
              await delay(Math.max(0, check + LEAD_MS - Date.now()));
            }
          },
        )
      ).flat();
      const fillMs = Date.now() - fillStarted;
      expect(stream().state).toBe("streaming");

      // 8. The sellers start again just before the supervisor's next measurement and sell until one
      //    of them sees the file folded back: the only thing in the server's own code that shrinks
      //    it is the stream's fold-back (`checkpointTruncate`, from `stream-host.ts`). Each seller's
      //    sales tile the time it sold, so each has exactly one sale whose two measurements straddle
      //    the fold-back.
      const nextCheck = checkAfter(Date.now());
      await delay(Math.max(0, nextCheck - LEAD_MS - Date.now()));
      const walAtLead = await fileBytes(walPath);
      expect(
        walAtLead,
        "the side file was folded back before the sellers resumed",
      ).toBeGreaterThanOrEqual(WAL_LIMIT_BYTES);
      const folding = await sellAtOnce(walAtLead, crosses, {
        at: nextCheck + FOLD_SLACK_MS,
        what: "the fold-back",
      });
      const foldSeenMs = Date.now() - nextCheck;
      const across = folding.map((seller) => seller.filter(crosses));
      expect(across.map((sales) => sales.length)).toEqual(Array<number>(SELLERS).fill(1));
      expect(stream()).toMatchObject({ state: "paused", reason: "side_file_limit", generation });

      // 9. Sales while paused: Litestream is stopped and the supervisor is waiting on its question
      //    to the frozen bucket, which holds the pause.
      const duringPause = (
        await sellAtOnce(await fileBytes(walPath), (_, sold) => sold >= TIMED_SALES)
      ).flat();
      expect(stream()).toMatchObject({ state: "paused", generation });

      const frozen = [...filling, ...folding.flat()];
      console.log(
        `stream pause timings (ms), ${SELLERS} sellers on one till session: slowest of ${baseline.length} with the bucket up ${slowest(baseline).toFixed(0)}; ` +
          `the fill ${filling.length} sales from ${walAtFill} to ${Math.max(...filling.map((sale) => sale.walAfter))} bytes in ${fillMs}; ` +
          `slowest of ${frozen.length} frozen before the pause ${slowest(frozen).toFixed(0)}; ` +
          `the sales across the fold-back ${across
            .flat()
            .map((sale) => `${sale.ms.toFixed(0)} (${sale.walBefore} -> ${sale.walAfter} bytes)`)
            .join(", ")}, the last answered ${foldSeenMs} after the expected measurement; ` +
          `slowest of ${duringPause.length} during the pause ${slowest(duringPause).toFixed(0)}; bound ${bound.toFixed(0)}`,
      );
      expect(slowest(frozen)).toBeLessThan(bound);
      expect(slowest(duringPause)).toBeLessThan(bound);
      const frozenSale = Math.max(
        ...duringPause.map((sale) => Number(sale.invoiceNumber.split("/")[1])),
      );

      // 10. The bucket answers again: the pause ends, Litestream restarts into the same generation,
      //     and a sale made while the bucket was frozen and Litestream stopped reaches it.
      s3.resume();
      const resumedAt = performance.now();
      await waitFor("the stream to resume", RESUME_WAIT_MS, async () =>
        stream().state === "streaming" ? true : undefined,
      );
      console.log(
        `stream pause: streaming again ${(performance.now() - resumedAt).toFixed(0)} ms after the bucket was let run`,
      );
      expect(stream()).toMatchObject({ state: "streaming", reason: null, generation });
      expect((await readPointer(store, box.venueId))?.pointer.body.generation).toBe(generation);
      await waitFor(
        "the sale made while frozen to reach the generation",
        UPLOAD_WAIT_MS,
        async () => {
          const out = join(await mkdtemp(join(scratch!, "probe-")), "venue.db");
          await restoreGeneration({
            litestreamBin,
            bucket,
            venueId: box.venueId,
            generation,
            outPath: out,
            ceilingMs: RESTORE_MS,
          });
          const db = new DatabaseSync(out);
          try {
            return db
              .prepare("select 1 as hit from sales where series_id = ? and invoice_number = ?")
              .get(box.seriesId, frozenSale) === undefined
              ? undefined
              : true;
          } finally {
            db.close();
          }
        },
      );

      // 11. One pause in the whole run, at this limit, and it ended.
      const events = await streamEvents(join(stateDir, "logs"));
      const paused = events.filter((line) => line.event === "stream.paused");
      expect(paused).toEqual([
        expect.objectContaining({ generation, limitBytes: WAL_LIMIT_BYTES }),
      ]);
      expect(events.map((line) => line.event).slice(events.indexOf(paused[0]!))).toContain(
        "stream.resumed",
      );
    },
    PAUSE_TIMEOUT_MS,
  );
});
