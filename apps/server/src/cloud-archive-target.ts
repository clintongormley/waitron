import { mkdirDurable, syncFolderHolding, writeFileDurable } from "@waitron/provisioning";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { CLOUD_SNAPSHOTS_DIR } from "@waitron/store";
import { randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_HEADER_BYTES } from "./artifact-cipher.js";
import { encryptArtifactFile } from "./artifact-cipher-file.js";
import type { ScheduleClock } from "./backup-schedule.js";
import type { CloudCaptureGrant, CloudCaptureMetadata } from "./cloud-backup.js";
import type { CloudConnection } from "./cloud-client.js";
import { digestFile } from "./handover-capture.js";
import "./errors.js";

const MAX_BYTES = 512 * 1024 * 1024;
interface Pending {
  id: string;
  createdAt: number;
  keyVersion?: number;
  uploaded?: boolean;
  month?: string;
  metadata?: CloudCaptureMetadata;
}
interface State {
  version: 1;
  installationId: string;
  venueId: string;
  lastMonth: string;
  pending?: Pending;
}
interface CloudArchiveInput {
  entries: () => AsyncIterable<Uint8Array>;
  plaintextBytes: number;
  modules: Record<string, number>;
  at: Date;
  clock: ScheduleClock;
  signal: AbortSignal;
}

type CloudArchiveOutcome = { stored: boolean; errorCode: string | null };

export interface CloudArchiveTarget {
  readonly id: "cloud";
  roomNeeded(plaintextBytes: number): Promise<number>;
  store(input: CloudArchiveInput): Promise<CloudArchiveOutcome>;
}

interface CloudArchiveDeps {
  stateDir: string;
  connection: Pick<CloudConnection, "status" | "reserveCapture" | "publishCapture"> | undefined;
  sourceNodeId: string;
  isPrimary(): boolean;
  now?: () => Date;
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
  const s = JSON.parse(bytes.toString()) as State & { nextAt?: number };
  if (
    !s ||
    s.version !== 1 ||
    !uuid(s.installationId) ||
    !uuid(s.venueId) ||
    (s.nextAt !== undefined && !Number.isFinite(s.nextAt)) ||
    typeof s.lastMonth !== "string"
  )
    unavailable();
  const p = s.pending;
  if (p) {
    if (!uuid(p.id) || !Number.isFinite(p.createdAt)) unavailable();
    if (p.uploaded !== undefined && (typeof p.uploaded !== "boolean" || !p.metadata)) unavailable();
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
  delete s.nextAt;
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
/** An unpublished capture is abandoned a day after it was made, or once it was made more than a day
 * ahead of now, as before a backward step. */
const pendingExpired = (p: { createdAt: number }, t: number) => {
  const age = t - p.createdAt;
  return age >= 86400000 || age < -86400000;
};
export function createCloudArchiveTarget(deps: CloudArchiveDeps): CloudArchiveTarget {
  const dir = join(deps.stateDir, CLOUD_SNAPSHOTS_DIR);
  const file = join(dir, "archive.enc");
  const statePath = join(dir, "state.json");
  const now = deps.now ?? (() => new Date());
  let running = false;

  return {
    id: "cloud",
    async roomNeeded(plaintextBytes) {
      let waiting = 0;
      try {
        const info = await lstat(file);
        if (info.isFile()) waiting = info.size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return plaintextBytes + ARTIFACT_HEADER_BYTES + waiting;
    },
    async store(input) {
      const { connection } = deps;
      if (running || !connection) return { stored: false, errorCode: "cloud.unavailable" };
      const { signal } = input;
      const allowed = () => {
        if (signal.aborted || !deps.isPrimary()) unavailable();
      };
      running = true;
      try {
        allowed();
        const status = await connection.status();
        allowed();
        await mkdirDurable(dir, 0o700);
        if (!(await lstat(dir)).isDirectory()) unavailable();
        await chmod(dir, 0o700);
        await rm(join(dir, "staging"), { recursive: true, force: true });
        await rm(join(dir, "archive.enc.tmp"), { force: true });
        await rm(join(dir, "state.json.tmp"), { force: true });
        let saved = await readState(dir);
        const registration = status.registration;
        if (
          status.installation?.state === "revoked" ||
          !registration ||
          (saved &&
            (saved.installationId !== registration.installationId ||
              saved.venueId !== registration.venueId))
        ) {
          await rm(file, { force: true });
          await rm(statePath, { force: true });
          saved = undefined;
        }
        if (
          status.state !== "complete" ||
          status.environment !== "test" ||
          !registration ||
          status.installation?.state !== "active" ||
          !status.installation.services.some(
            (service) =>
              service.service === "retained_snapshots" && service.state !== "unconfigured",
          )
        )
          unavailable();
        const state: State = saved ?? {
          version: 1,
          installationId: registration.installationId,
          venueId: registration.venueId,
          lastMonth: "",
        };
        const save = () => writeFileDurable(statePath, JSON.stringify(state), 0o600);
        const clearPending = async () => {
          delete state.pending;
          await save();
          await rm(file, { force: true });
        };
        const complete = async (pending: Pending, metadata: CloudCaptureMetadata) => {
          if (metadata.retention === "monthly") state.lastMonth = pending.month!;
          await clearPending();
        };
        const deliver = async (pending: Pending) => {
          allowed();
          const grant = await connection.reserveCapture(pending.id, signal);
          allowed();
          if (
            grant.id !== pending.id ||
            grant.installationId !== state.installationId ||
            grant.venueId !== state.venueId ||
            (pending.keyVersion !== undefined && grant.keyVersion !== pending.keyVersion)
          )
            unavailable();

          let metadata = pending.metadata;
          if (!metadata) {
            // Only the saved metadata makes this ciphertext eligible for retry. A crash before
            // that save can leave a partial file, which the next attempt replaces.
            await rm(file, { force: true });
            await encryptArtifactFile(input.entries(), file, grant.recoveryKey, signal);
            allowed();
            const { sha256, bytes } = await digestFile(file, signal);
            if (bytes <= ARTIFACT_HEADER_BYTES || bytes > MAX_BYTES) unavailable();
            const handle = await open(file, "r+");
            try {
              await handle.sync();
            } finally {
              await handle.close();
            }
            await syncFolderHolding(file);
            const month = monthAt(input.at, input.clock);
            pending.month = month;
            pending.keyVersion = grant.keyVersion;
            metadata = {
              digest: sha256,
              size: bytes,
              capturedAt: input.at.toISOString(),
              retention: state.lastMonth === month ? "daily" : "monthly",
              sourceNodeId: deps.sourceNodeId,
              modules: input.modules,
            };
            pending.metadata = metadata;
            await save();
          }
          allowed();
          await deps.upload(grant, file, metadata, signal);
          allowed();
          pending.uploaded = true;
          await save();
          await connection.publishCapture(pending.id, metadata, signal);
          await complete(pending, metadata);
        };

        const previous = state.pending;
        if (previous?.metadata) {
          const metadata = previous.metadata;
          allowed();
          let published = false;
          try {
            await connection.publishCapture(previous.id, metadata, signal);
            published = true;
          } catch (error) {
            allowed();
            if (pendingExpired(previous, now().getTime())) await clearPending();
            else if (previous.uploaded) throw error;
            else await deliver(previous);
          }
          if (published) await complete(previous, metadata);
        } else if (previous && pendingExpired(previous, now().getTime())) {
          await clearPending();
        }
        if (input.plaintextBytes + ARTIFACT_HEADER_BYTES > MAX_BYTES) unavailable();
        let pending = state.pending;
        if (!pending) {
          pending = { id: randomUUID(), createdAt: now().getTime() };
          state.pending = pending;
          await save();
        }
        await deliver(pending);
        return { stored: true, errorCode: null };
      } catch (error) {
        return { stored: false, errorCode: codeOf(error) };
      } finally {
        running = false;
      }
    },
  };
}
