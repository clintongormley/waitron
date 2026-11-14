// The stream loop's box B, which files with Veri*Factu and was rebuilt from the bucket, adds a spare
// C: refused while B streams to the loop's bucket, then joined once B stops, with nothing fiscal
// written on either box; C starts as a mirror holding B's sales, and B's next start counts C.
// `stream-loop-scenario.ts` runs these phases after its own; the two-box steps they repeat are
// `spare-join-scenario.ts`'s, on a main box that does not file.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { SPARE_FOLLOW_DIR } from "@waitron/store";
import { readPairLink } from "@waitron/node-db";
import { BOX_HOSTNAME, ownContactUrl } from "../box-name.js";
import type { StreamHostDeps } from "../stream-host.js";
import {
  POLL_INTERVAL_MS,
  POLL_TRIES,
  fetchHealthOk,
  httpsVia,
  withCapturedStdout,
  type LogLine,
} from "./boot-harness.js";
import { FISCAL_TABLES, preparationIn } from "./fiscal-rows.js";
import { freePorts } from "./free-ports.js";
import { waitUntil } from "./scenario-stages.js";
import {
  BOOT_MS,
  COPY_WAIT_MS,
  LINK_WAIT_MS,
  MIRROR_WAIT_MS,
  TestBox,
  WAIT_POLL_MS,
  adoptFrom,
  boundedStart,
  closeBoxes,
  firstRowIn,
  joinState,
  logLines,
  managementHeaders,
  nodeKeyIn,
  readOutside,
  waitForMirrorStart,
} from "./spare-join-scenario.js";
import { bootEnv, boxDirs, type BoxDirs } from "./stream-box.js";
import { synchronisedBoxHost } from "./synchronised-box-host.js";

export const STREAM_LOOP_SPARE_PHASES = [
  "spare-refused",
  "bucket-stopped",
  "spare-join",
  "spare-copy",
  "start-check",
] as const;
type StreamLoopSparePhase = (typeof STREAM_LOOP_SPARE_PHASES)[number];

const STREAM_WAIT_MS = 30_000;
const HEALTH_MS = POLL_TRIES * POLL_INTERVAL_MS;
// The two adopt requests, two sign-ins and closing three servers and C's store have no limits of
// their own.
const SPARE_UNTIMED_MS = 30_000;
// B and C start side by side under one BOOT_MS; B restarts for the start check and C after its
// followed copy is inspected with the follower stopped. C's
// restarts during the join happen inside the link, copy and mirror waits, which bound them.
export const STREAM_LOOP_SPARE_MS =
  3 * BOOT_MS +
  2 * STREAM_WAIT_MS +
  2 * HEALTH_MS +
  STREAM_WAIT_MS +
  LINK_WAIT_MS +
  COPY_WAIT_MS +
  MIRROR_WAIT_MS +
  SPARE_UNTIMED_MS;

/** Every row of `FISCAL_TABLES` in `venueDir`'s `venue.db`, by table, in `rowid` order. */
function fiscalRowsIn(venueDir: string): Record<string, unknown[]> {
  const db = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
  try {
    return Object.fromEntries(
      FISCAL_TABLES.map((table) => [
        table,
        db.prepare(`select * from "${table}" order by rowid`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}

export interface LoopSpareInput {
  scratch: string;
  migrationsRoot: string;
  litestreamBin: string;
  versitygwBin: string;
  /** Box B's folders and port; its server is closed when the phases begin. */
  dirsB: BoxDirs;
  portB: number;
  nodeIdB: string;
  /** Sales B's database holds, which C's copy must hold too. */
  saleIds: readonly string[];
  serverSeams?: Pick<StreamHostDeps, "spawn">;
  signal?: AbortSignal;
  begin(phase: StreamLoopSparePhase): void;
}

export function runLoopSpare(input: LoopSpareInput): Promise<void> {
  return withCapturedStdout((log) => runCaptured(input, log));
}

async function runCaptured(input: LoopSpareInput, log: readonly string[]): Promise<void> {
  const { dirsB, portB, nodeIdB, signal, begin } = input;
  const boxes: TestBox[] = [];
  const closers: Array<() => Promise<void>> = [];
  let abortClose: Promise<unknown[]> | undefined;
  const onAbort = (): void => {
    abortClose = closeBoxes(boxes);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const wait = <T>(what: string, ms: number, probe: () => Promise<T | undefined>) =>
    waitUntil(what, ms, probe, signal, WAIT_POLL_MS);
  const parsed: LogLine[] = [];
  let parsedUpTo = 0;
  const logSoFar = (): LogLine[] => {
    parsed.push(...logLines(log.slice(parsedUpTo)));
    parsedUpTo = log.length;
    return parsed;
  };
  const linesSince = (from: number): LogLine[] => logSoFar().slice(from);
  const failures: unknown[] = [];
  try {
    begin("spare-refused");
    const [portC, storeC, storeLoopbackC] = (await freePorts(3)) as [number, number, number];
    const boxEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      ...bootEnv(dirs, port, input.migrationsRoot, input.litestreamBin),
      WAITRON_MANAGEMENT_ORIGIN: `https://${BOX_HOSTNAME}:${port}`,
      WAITRON_MANAGEMENT_RP_ID: BOX_HOSTNAME,
    });
    const boxB = new TestBox(dirsB, portB, boxEnv(dirsB, portB), {
      boxHost: synchronisedBoxHost(),
      stream: { ...input.serverSeams },
    });
    boxes.push(boxB);
    const dirsC = await boxDirs(input.scratch, "box-c");
    const boxC = new TestBox(
      dirsC,
      portC,
      {
        ...boxEnv(dirsC, portC),
        WAITRON_VERSITYGW_BIN: input.versitygwBin,
        WAITRON_ENV: "preproduction",
        WAITRON_SPARE_STORE_PORT: String(storeC),
        WAITRON_SPARE_STORE_LOOPBACK_PORT: String(storeLoopbackC),
      },
      { stream: { ...input.serverSeams } },
    );
    boxes.push(boxC);
    const logAtStart = logSoFar().length;
    const started = await Promise.allSettled([
      boundedStart(boxB.start(), "B's start with a spare to add"),
      boundedStart(boxC.start(), "C's setup start"),
    ]);
    for (const result of started) if (result.status === "rejected") throw result.reason;

    const urlB = `https://127.0.0.1:${portB}`;
    const caB = await readFile(join(dirsB.state, "tls", "ca.crt"), "utf8");
    const clientB = httpsVia(caB);
    closers.push(clientB.close);
    const viaB = clientB.via;
    await fetchHealthOk(`${urlB}/health`, viaB);
    await wait("B to stream to the loop's bucket", STREAM_WAIT_MS, async () =>
      linesSince(logAtStart).find((line) => line.event === "stream.streaming"),
    );
    const urlC = `https://127.0.0.1:${portC}`;
    const clientC = httpsVia(await readFile(join(dirsC.state, "tls", "ca.crt"), "utf8"));
    closers.push(clientC.close);
    const primary = { primaryUrl: ownContactUrl(boxB.origin, nodeIdB), caPem: caB };
    const before = await joinState(dirsB.venue, nodeIdB);
    const fiscalBefore = fiscalRowsIn(dirsB.venue);
    const refused = await adoptFrom(urlC, clientC.via, primary);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toEqual({ error: { code: "mirror.bucket_stream_active", params: {} } });
    expect(await joinState(dirsB.venue, nodeIdB)).toEqual(before);
    expect(fiscalRowsIn(dirsB.venue)).toEqual(fiscalBefore);

    begin("bucket-stopped");
    const managing = await managementHeaders(urlB, boxB.origin, viaB);
    const stopped = await fetch(`${urlB}/api/backup/stream`, {
      ...viaB,
      method: "DELETE",
      headers: managing,
    });
    const stoppedView = (await stopped.json()) as { configured?: unknown };
    expect(stopped.status, JSON.stringify(stoppedView)).toBe(200);
    expect(stoppedView.configured).toBe(false);

    begin("spare-join");
    const fiscalAtJoin = fiscalRowsIn(dirsB.venue);
    expect(Object.values(fiscalAtJoin).flat()).not.toEqual([]);
    const preparationB = await preparationIn(dirsB.state);
    const logAtJoin = logSoFar().length;
    const joined = await adoptFrom(urlC, clientC.via, primary);
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ adopted: true, restarting: true });
    const link = await readOutside(dirsB.venue, (reader) =>
      wait("B's pair link to reach streaming", LINK_WAIT_MS, async () => {
        const current = await readPairLink(reader.node, nodeIdB);
        return current?.state === "streaming" ? current : undefined;
      }),
    );
    expect(link.role).toBe("streams");
    const nodeIdC = link.peerNodeId;
    expect(fiscalRowsIn(dirsB.venue)).toEqual(fiscalAtJoin);
    expect(await preparationIn(dirsB.state)).toBe(preparationB);
    expect(await preparationIn(dirsC.state)).toBeNull();

    begin("spare-copy");
    const ready = await wait("C's spare.first_copy_ready", COPY_WAIT_MS, async () =>
      linesSince(logAtJoin).find((line) => line.event === "spare.first_copy_ready"),
    );
    console.log(
      `stream loop spare: first copy ${String(ready.bytes)} bytes, ${String(ready.ms)} ms`,
    );
    await waitForMirrorStart(wait, dirsC.state, urlC, viaB);
    const node = await fetch(`${urlC}/api/node`, viaB);
    expect(await node.json()).toMatchObject({ acceptingSales: false });
    for (const saleId of input.saleIds)
      expect(firstRowIn(dirsC.venue, "select 1 as hit from sales where id = ?", saleId)).toEqual({
        hit: 1,
      });
    expect(nodeKeyIn(dirsC.venue, nodeIdC)).toBe(link.peerPublicKey);
    expect(nodeKeyIn(dirsB.venue, nodeIdC)).toBe(link.peerPublicKey);
    expect(fiscalRowsIn(dirsC.venue)).toEqual(fiscalAtJoin);
    expect(fiscalRowsIn(dirsB.venue)).toEqual(fiscalAtJoin);
    expect(await preparationIn(dirsB.state)).toBe(preparationB);
    expect(await preparationIn(dirsC.state)).toBeNull();

    let observedPosition = "";
    const readSpare = async () => {
      const response = await fetch(`${urlB}/api/box/health`, {
        ...viaB,
        headers: { ...managing, "x-waitron-live": "1" },
      });
      expect(response.status).toBe(200);
      const view = (await response.json()) as {
        stream: unknown;
        spare?: {
          state: string;
          appliedTXID: string | null;
          uploadedTXID: string | null;
          lagMs: number | null;
        };
      };
      const position = JSON.stringify([
        view.spare?.state,
        view.spare?.appliedTXID,
        view.spare?.uploadedTXID,
      ]);
      if (position !== observedPosition)
        console.log(
          `follower observation ${JSON.stringify({ stream: view.stream, spare: view.spare })}`,
        );
      observedPosition = position;
      return view.spare;
    };
    const initial = await wait("C's follower to catch up", STREAM_WAIT_MS, async () => {
      const copy = await readSpare();
      return copy?.state === "following" &&
        copy.appliedTXID !== null &&
        copy.appliedTXID === copy.uploadedTXID
        ? copy
        : undefined;
    });
    const detailsResponse = await fetch(`${urlB}/management-api/venue-details`, {
      ...viaB,
      headers: managing,
    });
    const details = (await detailsResponse.json()) as { details: Record<string, unknown> };
    const changedName = "Followed dining room";
    const changed = await fetch(`${urlB}/management-api/venue-details`, {
      ...viaB,
      method: "PATCH",
      headers: { ...managing, "content-type": "application/json" },
      body: JSON.stringify({ expected: details.details, changes: { name: changedName } }),
    });
    expect(changed.status, await changed.text()).toBe(200);
    await wait("C to apply the post-join update", STREAM_WAIT_MS, async () => {
      const copy = await readSpare();
      return copy?.state === "following" &&
        copy.appliedTXID! > initial.appliedTXID! &&
        copy.appliedTXID === copy.uploadedTXID
        ? copy
        : undefined;
    });
    await boxC.stopForRestart();
    const nameSql =
      "select json_extract(doc, '$.name') as name from settings where module = 'venue'";
    expect(firstRowIn(join(dirsC.state, SPARE_FOLLOW_DIR), nameSql)).toEqual({
      name: changedName,
    });
    expect(firstRowIn(dirsC.venue, nameSql)).toEqual({ name: details.details.name });
    expect(fiscalRowsIn(dirsC.venue)).toEqual(fiscalAtJoin);
    expect(fiscalRowsIn(dirsB.venue)).toEqual(fiscalAtJoin);
    await boundedStart(boxC.start(), "C's fresh follower start");
    await waitForMirrorStart(wait, dirsC.state, urlC, viaB);
    const mirrorHealth = await fetch(`${urlC}/health`, viaB);
    const mirrorHealthBody = await mirrorHealth.json();
    console.log(
      `restarted spare health ${JSON.stringify({ status: mirrorHealth.status, body: mirrorHealthBody })}`,
    );
    expect([200, 503]).toContain(mirrorHealth.status);

    begin("start-check");
    const logAtCheck = logSoFar().length;
    await boxB.restartNow();
    await fetchHealthOk(`${urlB}/health`, viaB);
    const checks = linesSince(logAtCheck).filter((line) => line.event === "handover.start_check");
    expect(checks.map(({ result, peers }) => ({ result, peers }))).toEqual([
      { result: "proceed", peers: [{ nodeId: nodeIdC, answer: "=", counted: true }] },
    ]);
  } catch (error) {
    failures.push(error);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (abortClose !== undefined) failures.push(...(await abortClose));
    failures.push(...(await closeBoxes(boxes)));
    for (const close of closers) await close().catch(() => {});
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "the stream loop's spare failed");
}
