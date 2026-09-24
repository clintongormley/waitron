import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { CloudConnection } from "./cloud-client.js";
import type { CloudCaptureGrant, CloudCaptureMetadata } from "./cloud-backup.js";
import { nextFireMs, type ScheduleClock } from "./backup-schedule.js";
import "./errors.js";
const MAX_BYTES = 512 * 1024 * 1024;
interface Pending {
  id: string;
  createdAt: number;
  keyVersion?: number;
  month?: string;
  metadata?: CloudCaptureMetadata;
}
interface State {
  version: 1;
  installationId: string;
  venueId: string;
  nextAt: number;
  lastMonth: string;
  pending?: Pending;
}
export interface CloudSnapshotDeps {
  stateDir: string;
  connection: Pick<CloudConnection, "status" | "reserveCapture" | "publishCapture">;
  sourceNodeId: string;
  isPrimary(): boolean;
  readClock(): Promise<ScheduleClock>;
  now?: () => Date;
  createArchive(
    grant: CloudCaptureGrant,
    at: Date,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; modules: Record<string, number> }>;
  upload(
    grant: CloudCaptureGrant,
    file: string,
    metadata: CloudCaptureMetadata,
    signal: AbortSignal,
  ): Promise<void>;
}
function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}
async function durableWrite(dir: string, name: string, bytes: Uint8Array | string) {
  const temp = join(dir, name + ".tmp");
  const handle = await open(
    temp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, join(dir, name));
  const parent = await open(dir, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
async function readState(dir: string): Promise<State | undefined> {
  let bytes: Buffer;
  try {
    const stat = await lstat(join(dir, "state.json"));
    if (!stat.isFile() || stat.size > 65536) unavailable();
    bytes = await readFile(join(dir, "state.json"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const s = JSON.parse(bytes.toString()) as State;
  if (
    !s ||
    s.version !== 1 ||
    !uuid(s.installationId) ||
    !uuid(s.venueId) ||
    !Number.isFinite(s.nextAt) ||
    typeof s.lastMonth !== "string"
  )
    unavailable();
  const p = s.pending;
  if (p) {
    if (!uuid(p.id) || !Number.isFinite(p.createdAt)) unavailable();
    const m = p.metadata;
    if (
      m &&
      (!Number.isSafeInteger(p.keyVersion) ||
        p.keyVersion! < 1 ||
        typeof p.month !== "string" ||
        !Number.isSafeInteger(m.size) ||
        m.size < 1 ||
        m.size > MAX_BYTES ||
        !/^([0-9a-f]{64})$/.test(m.digest) ||
        !Number.isFinite(Date.parse(m.capturedAt)) ||
        !["daily", "monthly"].includes(m.retention) ||
        !uuid(m.sourceNodeId) ||
        !m.modules ||
        typeof m.modules !== "object" ||
        Object.values(m.modules).some((v) => !Number.isSafeInteger(v) || v < 0))
    )
      unavailable();
  }
  return s;
}
function monthAt(at: Date, clock: ScheduleClock) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return (
    parts.find((p) => p.type === "year")!.value + "-" + parts.find((p) => p.type === "month")!.value
  );
}
export function createCloudSnapshotWorker(deps: CloudSnapshotDeps) {
  const dir = join(deps.stateDir, "cloud-snapshots"),
    file = join(dir, "archive.enc");
  const now = deps.now ?? (() => new Date());
  let running = false;
  async function tick(signal: AbortSignal) {
    if (running || signal.aborted || !deps.isPrimary()) return;
    running = true;
    try {
      const status = await deps.connection.status();
      if (signal.aborted || !deps.isPrimary()) return;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if (!(await lstat(dir)).isDirectory()) unavailable();
      await chmod(dir, 0o700);
      await rm(join(dir, "staging"), { recursive: true, force: true });
      await rm(join(dir, "archive.enc.tmp"), { force: true });
      let state = await readState(dir);
      const registration = status.registration;
      if (
        status.installation?.state === "revoked" ||
        !registration ||
        (state &&
          (state.installationId !== registration.installationId ||
            state.venueId !== registration.venueId))
      ) {
        await rm(file, { force: true });
        await rm(join(dir, "state.json"), { force: true });
        state = undefined;
      }
      if (
        status.state !== "complete" ||
        status.environment !== "test" ||
        !registration ||
        status.installation?.state !== "active" ||
        !status.installation.services.some(
          (s) => s.service === "retained_snapshots" && s.state !== "unconfigured",
        )
      )
        return;
      const clock = await deps.readClock();
      state ??= {
        version: 1,
        installationId: registration.installationId,
        venueId: registration.venueId,
        nextAt: 0,
        lastMonth: "",
      };
      const save = () => durableWrite(dir, "state.json", JSON.stringify(state));
      const allowed = () => {
        signal.throwIfAborted();
        if (!deps.isPrimary()) unavailable();
      };
      const complete = async () => {
        const p = state!.pending!;
        if (p.metadata!.retention === "monthly") state!.lastMonth = p.month!;
        state!.nextAt = nextFireMs(
          { kind: "wall-clock", days: "daily", at: "auto" },
          clock,
          now(),
          deps.sourceNodeId,
        );
        delete state!.pending;
        await save();
        await rm(file, { force: true });
      };
      let p = state.pending;
      if (p?.metadata) {
        allowed();
        let published = false;
        try {
          await deps.connection.publishCapture(p.id, p.metadata, signal);
          published = true;
        } catch {
          allowed();
        }
        if (published) {
          await complete();
          return;
        }
      }
      if (p && now().getTime() - p.createdAt >= 86400000) {
        delete state.pending;
        state.nextAt = 0;
        await save();
        await rm(file, { force: true });
        p = undefined;
      }
      if (!p) {
        if (now().getTime() < state.nextAt) {
          await rm(file, { force: true });
          return;
        }
        p = { id: randomUUID(), createdAt: now().getTime() };
        state.pending = p;
        await save();
      }
      allowed();
      const grant = await deps.connection.reserveCapture(p.id, signal);
      allowed();
      if (
        grant.id !== p.id ||
        grant.installationId !== state.installationId ||
        grant.venueId !== state.venueId ||
        (p.keyVersion !== undefined && grant.keyVersion !== p.keyVersion)
      )
        unavailable();
      if (!p.metadata) {
        const at = now(),
          archive = await deps.createArchive(grant, at, signal);
        allowed();
        if (archive.bytes.length === 0 || archive.bytes.length > MAX_BYTES) unavailable();
        p.month = monthAt(at, clock);
        p.keyVersion = grant.keyVersion;
        p.metadata = {
          digest: createHash("sha256").update(archive.bytes).digest("hex"),
          size: archive.bytes.length,
          capturedAt: at.toISOString(),
          retention: state.lastMonth === p.month ? "daily" : "monthly",
          sourceNodeId: deps.sourceNodeId,
          modules: archive.modules,
        };
        await durableWrite(dir, "archive.enc", archive.bytes);
        await save();
      }
      allowed();
      await deps.upload(grant, file, p.metadata, signal);
      allowed();
      await deps.connection.publishCapture(p.id, p.metadata, signal);
      await complete();
    } finally {
      running = false;
    }
  }
  return { tick };
}
