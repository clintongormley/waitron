import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  restoreGeneration,
  spawnLitestream,
  type BucketConfig,
  type SpawnFn,
} from "@waitron/stream";
import { expect } from "vitest";
import { hasShutdownMark } from "../admin-shutdown-hold.js";
import type { httpsVia } from "./boot-harness.js";
import { holdBucketUploads } from "./hold-bucket-uploads.js";
import { waitUntil } from "./scenario-stages.js";

const FINAL_NAME = "Final update before shutdown";
const NAME_SQL = "select json_extract(doc, '$.name') as name from settings where module = 'venue'";
const READY_MS = 85_000;
const PAUSE_MS = 45_000;
const RESTORE_MS = 20_000;
export const PAIRED_SHUTDOWN_MS = READY_MS + 2 * PAUSE_MS + 2 * 15_000 + RESTORE_MS;

interface PairStore {
  bucket: BucketConfig;
  generation: string;
  streamKey: string;
}

/** Controls the level-zero uploads from the main box to the spare's actual store. */
export async function pairedShutdownScenario(scratch: string, bin: string) {
  let store: PairStore | undefined;
  const uploads = await holdBucketUploads(() => store!.bucket.endpoint);

  const spawn: SpawnFn = (binary, args, env, options) => {
    if (args[0] !== "replicate") return spawnLitestream(binary, args, env, options);
    const configFile = args[args.indexOf("-config") + 1]!;
    const config = readFileSync(configFile, "utf8");
    const urlLine = /^ {6}url: (.+)$/m.exec(config)![1]!;
    const url = new URL(JSON.parse(urlLine));
    if (url.hostname !== "waitron") return spawnLitestream(binary, args, env, options);
    store = {
      bucket: {
        bucket: url.hostname,
        endpoint: url.searchParams.get("endpoint")!,
        region: url.searchParams.get("region")!,
        prefix: "",
        accessKeyId: env.WAITRON_STREAM_ACCESS_KEY_ID!,
        secretAccessKey: env.WAITRON_STREAM_SECRET_ACCESS_KEY!,
      },
      generation: url.pathname.split("/").at(-1)!,
      streamKey: env.WAITRON_STREAM_ENCRYPTION_KEY!,
    };
    url.searchParams.set("endpoint", uploads.endpoint);
    const gated = join(scratch, "paired-stream.yml");
    writeFileSync(gated, config.replace(urlLine, JSON.stringify(url.href)), { mode: 0o600 });
    return spawnLitestream(
      binary,
      args.map((arg) => (arg === configFile ? gated : arg)),
      env,
      options,
    );
  };

  return {
    spawn,
    close: uploads.close,
    async run(input: {
      url: string;
      headers: Record<string, string>;
      firstRowIn: (dir: string, sql: string) => { name?: unknown } | undefined;
      via: ReturnType<typeof httpsVia>["via"];
      stateDir: string;
      venueDir: string;
      signal?: AbortSignal;
    }) {
      const { url, headers, via, stateDir, venueDir, signal, firstRowIn } = input;
      async function health() {
        const response = await fetch(`${url}/api/box/health`, {
          ...via,
          headers: { ...headers, "x-waitron-live": "1" },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as {
          spare?: { state: string };
          shutdown?: {
            phase: string;
            available: boolean;
            paired?: boolean;
            name?: string;
            errorCode?: string;
            delivered?: boolean;
          };
        };
      }
      await waitUntil(
        "the main's joined spare",
        READY_MS,
        async () => {
          const view = await health();
          return view.spare?.state === "following" ? view : undefined;
        },
        signal,
        250,
      );
      const send = async (method: string, body?: object) => {
        const response = await fetch(`${url}/api/box/shutdown`, {
          ...via,
          headers: { ...headers, origin: url },
          method,
          body: body && JSON.stringify(body),
        });
        const answer = await response.json();
        expect(response.status, JSON.stringify(answer)).toBe(202);
        expect((await health()).shutdown).toMatchObject({ paired: true });
      };
      const detailsUrl = `${url}/management-api/venue-details`;
      const before = await fetch(detailsUrl, { ...via, headers });
      expect(before.status).toBe(200);
      const { details } = (await before.json()) as { details: unknown };
      uploads.hold((url) => /\/0000\/[^/?]+\.ltx(?:\?|$)/.test(url));
      const changed = await fetch(detailsUrl, {
        ...via,
        headers,
        method: "PATCH",
        body: JSON.stringify({ expected: details, changes: { name: FINAL_NAME } }),
      });
      expect(changed.status, await changed.text()).toBe(200);
      expect(firstRowIn(venueDir, NAME_SQL)?.name).toBe(FINAL_NAME);
      expect((await health()).shutdown).toMatchObject({
        phase: "idle",
        available: true,
        paired: true,
      });
      await send("POST");
      const phase = (expected: string, ms: number) =>
        waitUntil(
          expected,
          ms,
          async () => {
            const view = (await health()).shutdown;
            if (view?.phase === "ready" && expected === "paused")
              throw new Error("shutdown reported ready while the spare upload was held");
            if (view?.phase === "paused" && expected !== "paused")
              throw new Error(`shutdown paused: ${view.errorCode}`);
            return view?.phase === expected ? view : undefined;
          },
          signal,
          250,
        );
      const { name } = await phase("download", 15_000);
      const download = await fetch(
        `${url}/api/box/shutdown/download/${encodeURIComponent(name!)}`,
        { ...via, headers: { ...headers, origin: url } },
      );
      expect(download.status).toBe(200);
      expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
      await waitUntil(
        "the browser's delivered download",
        15_000,
        async () => ((await health()).shutdown?.delivered === true ? true : undefined),
        signal,
        250,
      );
      expect(await hasShutdownMark(stateDir)).toBe(false);
      await send("PATCH", { decision: "backup-saved", name });
      expect((await phase("paused", PAUSE_MS)).errorCode).toBe("box.shutdown_spare_unchecked");
      expect(uploads.sawUpload()).toBe(true);
      expect(await hasShutdownMark(stateDir)).toBe(false);
      uploads.release();
      await send("PATCH", { decision: "retry" });
      await phase("ready", PAUSE_MS);
      expect(await hasShutdownMark(stateDir)).toBe(true);

      const restored = join(scratch, "paired-shutdown-restored");
      await mkdir(restored);
      await restoreGeneration({
        ...store!,
        streamId: "paired-shutdown",
        litestreamBin: bin,
        outPath: join(restored, "venue.db"),
        ceilingMs: RESTORE_MS,
        pollMs: 500,
      });
      expect(firstRowIn(restored, NAME_SQL)?.name).toBe(FINAL_NAME);
    },
  };
}
