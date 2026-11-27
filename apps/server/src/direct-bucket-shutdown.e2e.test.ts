import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { createS3ObjectStore, readPointer, restoreGeneration } from "@waitron/stream";
import { expect, it, onTestFinished } from "vitest";
import { hasShutdownMark } from "./admin-shutdown-hold.js";
import { startServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { ALL_MODULES } from "./modules.js";
import { deriveStreamKey } from "./stream-key.js";
import { httpsVia } from "./testing/boot-harness.js";
import { holdBucketUploads } from "./testing/hold-bucket-uploads.js";
import { holdRecoveryKey, USABLE_RECOVERY_KEY } from "./testing/recovery-key.js";
import {
  retainHttpListener,
  startWithRetainedListeners,
} from "./testing/retained-http-listener.js";
import {
  resolveLitestream,
  resolveVersitygw,
  startS3TestServer,
} from "./testing/s3-test-server.js";
import { waitUntil } from "./testing/scenario-stages.js";
import {
  firstRowIn,
  managementHeaders,
  MODULES_M,
  VENUE_M,
} from "./testing/spare-join-scenario.js";
import { bootEnv, boxDirs, copyMigrations, provisionStreamBox } from "./testing/stream-box.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";

const NAME_SQL = "select json_extract(doc, '$.name') as name from settings where module = 'venue'";
const FINAL_NAME = "Final update before shutdown";
const BOOT_MS = 60_000;
const BACKUP_MS = 15_000;
const DOWNLOAD_MS = 10_000;
const SYNC_MS = 35_000;
const RESTORE_MS = 20_000;
const OTHER_MS = 15_000;

it(
  "waits for the final direct bucket upload before marking a checked shutdown",
  async () => {
    const [litestream, versitygw] = await Promise.all([
      resolveLitestream(process.env),
      resolveVersitygw(process.env),
    ]);
    if (!litestream.ok || !versitygw.ok) {
      const missing = [litestream, versitygw].flatMap((tool) => (tool.ok ? [] : [tool.reason]));
      throw new Error(`Install the pinned Litestream and versitygw. ${missing.join("; ")}`);
    }
    const scratch = await mkdtemp(join(tmpdir(), "waitron-bucket-shutdown-"));
    const cleanup: (() => Promise<void>)[] = [() => rm(scratch, { recursive: true, force: true })];
    onTestFinished(async () => {
      const errors: unknown[] = [];
      for (const dispose of cleanup.reverse())
        await dispose().catch((error: unknown) => errors.push(error));
      if (errors.length) throw new AggregateError(errors, "Direct bucket shutdown teardown failed");
    });
    const s3 = await startS3TestServer({ bin: versitygw.bin, root: join(scratch, "s3") });
    cleanup.push(() => s3.stop());
    const uploads = await holdBucketUploads(() => s3.endpoint);
    cleanup.push(uploads.close);
    const bucket = {
      endpoint: s3.endpoint,
      bucket: s3.bucket,
      region: s3.region,
      prefix: "direct-shutdown/",
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
    };
    const dirs = await boxDirs(scratch, "box");
    const migrations = await copyMigrations(scratch);
    const listener = await retainHttpListener();
    cleanup.push(listener.close);
    const origin = `https://127.0.0.1:${listener.port}`;
    const { streamId, nodeId } = await provisionStreamBox({
      dirs,
      advertisedOrigin: origin,
      modulesJson: MODULES_M,
      venue: {
        request: VENUE_M,
        modules: enabledModules(ALL_MODULES, parseModuleConfig(MODULES_M, ALL_MODULES)),
      },
      streaming: { ...bucket, endpoint: uploads.endpoint },
    });
    await holdRecoveryKey(dirs.state);
    const env = await loadBoxEnv(
      {
        ...bootEnv(dirs, listener.port, migrations, litestream.bin),
        WAITRON_MANAGEMENT_ORIGIN: origin,
      },
      dirs.state,
    );
    const server = await startWithRetainedListeners([listener], () =>
      startServer(env, {}, { boxHost: synchronisedBoxHost() }),
    );
    cleanup.push(async () => {
      uploads.release();
      await server.close();
    });
    const { via, close } = httpsVia(await readFile(join(dirs.state, "tls", "ca.crt")));
    cleanup.push(close);
    const headers = await managementHeaders(origin, origin, via);
    const send = (url: string, method = "GET", body?: object) =>
      fetch(`${origin}${url}`, {
        ...via,
        headers: { ...headers, "x-waitron-live": "1" },
        method,
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    const shutdown = async () => {
      const response = await send("/api/box/health");
      expect(response.status).toBe(200);
      return (await response.json()).shutdown as {
        phase: string;
        directBucket?: boolean;
        name?: string;
        delivered?: boolean;
        errorCode?: string;
      };
    };
    const action = async (method: string, body?: object) => {
      const response = await send("/api/box/shutdown", method, body);
      expect(response.status, await response.text()).toBe(202);
    };
    const wait = <T>(what: string, ms: number, fn: () => Promise<T | undefined>) =>
      waitUntil(what, ms, fn, undefined, 250);

    const store = createS3ObjectStore(bucket);
    const generation = await wait("the direct bucket generation", BOOT_MS, async () => {
      const entry = await readPointer(store, streamId);
      if (entry?.pointer.body.nodeId === nodeId) return entry.pointer.body.generation;
    });
    const restoreName = async (label: string) => {
      const out = await mkdtemp(join(scratch, label));
      await restoreGeneration({
        bucket,
        generation,
        streamId,
        streamKey: deriveStreamKey(USABLE_RECOVERY_KEY, streamId),
        litestreamBin: litestream.bin,
        outPath: join(out, "venue.db"),
        ceilingMs: RESTORE_MS,
        pollMs: 500,
      });
      return firstRowIn(out, NAME_SQL)?.name;
    };

    const path = "/management-api/venue-details";
    const before = await send(path);
    expect(before.status).toBe(200);
    const { details } = await before.json();
    uploads.hold((url) => url.includes(`/${generation}/`) && /\.ltx(?:\?|$)/.test(url));
    const changed = await send(path, "PATCH", {
      expected: details,
      changes: { name: FINAL_NAME },
    });
    expect(changed.status, await changed.text()).toBe(200);

    await action("POST");
    const { name } = await wait("a checked backup to download", BACKUP_MS, async () => {
      const status = await shutdown();
      if (status.phase === "paused") throw new Error(`shutdown paused: ${status.errorCode}`);
      return status.phase === "download" ? status : undefined;
    });
    expect(name).toBeTruthy();
    const download = await send(`/api/box/shutdown/download/${encodeURIComponent(name!)}`);
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
    await wait("the download and the held upload", DOWNLOAD_MS, async () =>
      (await shutdown()).delivered && uploads.sawUpload() ? true : undefined,
    );
    await action("PATCH", { decision: "backup-saved", name });
    const paused = await wait("the bucket check to finish", SYNC_MS, async () => {
      const status = await shutdown();
      return status.phase === "paused" || status.phase === "ready" ? status : undefined;
    });
    expect(await hasShutdownMark(dirs.state)).toBe(false);
    expect(paused).toMatchObject({
      phase: "paused",
      directBucket: true,
      errorCode: "box.shutdown_bucket_unchecked",
    });
    expect(await restoreName("held-")).toBe(VENUE_M.name);

    uploads.release();
    await action("PATCH", { decision: "retry" });
    await wait("Safe to switch off", SYNC_MS, async () => {
      const status = await shutdown();
      if (status.phase === "paused") throw new Error(`shutdown paused: ${status.errorCode}`);
      return status.phase === "ready" ? status : undefined;
    });
    expect(await hasShutdownMark(dirs.state)).toBe(true);
    expect(await restoreName("confirmed-")).toBe(FINAL_NAME);
  },
  BOOT_MS + BACKUP_MS + DOWNLOAD_MS + 2 * SYNC_MS + 2 * RESTORE_MS + OTHER_MS,
);
