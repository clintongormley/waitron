import type { SetupApi } from "./api/client.js";
import type {
  BackupRepairOpenRequest,
  BackupRepairResumeRequest,
  BackupRepairSession,
} from "./api/first-setup-types.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4096;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}
function fail(
  code: "setup.owner_required" | "setup.attempt_conflict" | "setup.attempt_invalid",
): never {
  throw { code };
}
function valid(value: unknown): value is BackupRepairSession {
  if (!object(value) || !text(value.sessionId) || !uuid(value.recoveryId)) return false;
  const preview = value.preview;
  const binding = value.binding;
  if (
    !object(preview) ||
    !object(binding) ||
    !object(preview.taxpayer) ||
    !object(preview.fiscalSelection)
  )
    return false;
  return (
    text(preview.sourceId) &&
    text(preview.createdAt) &&
    Number.isFinite(Date.parse(preview.createdAt)) &&
    (preview.environment === "production" || preview.environment === "preproduction") &&
    uuid(preview.nodeId) &&
    text(preview.nodeRecoveryKeyName) &&
    text(preview.taxpayer.taxId) &&
    text(preview.taxpayer.legalName) &&
    text(preview.locationName) &&
    text(preview.fiscalSelection.module) &&
    text(preview.fiscalSelection.country) &&
    text(preview.fiscalSelection.fiscalTerritory) &&
    text(preview.fiscalSelection.timeZone) &&
    (preview.activationSourceId === undefined || text(preview.activationSourceId)) &&
    text(binding.module) &&
    binding.module === preview.fiscalSelection.module &&
    binding.action === "restore" &&
    uuid(binding.eventId) &&
    binding.sourceId === (preview.activationSourceId ?? preview.sourceId) &&
    binding.targetNodeId === preview.nodeId
  );
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]))
  );
}

export class FirstSetupBackupSession {
  readonly #api: SetupApi;
  #current?: BackupRepairSession;
  #grant?: string;
  #disposed = false;
  #pending?: Promise<unknown>;
  #disposal?: Promise<void>;
  #selected?: unknown;

  constructor(api: SetupApi) {
    this.#api = api;
  }

  get current(): BackupRepairSession | undefined {
    return this.#current === undefined ? undefined : structuredClone(this.#current);
  }

  #run<T>(body: () => Promise<T>): Promise<T> {
    if (this.#disposed) return Promise.reject({ code: "setup.owner_required" });
    if (this.#pending) return Promise.reject({ code: "setup.attempt_conflict" });
    const task = body();
    this.#pending = task;
    void task
      .finally(() => {
        if (this.#pending === task) this.#pending = undefined;
      })
      .catch(() => {});
    return task;
  }

  async #accept(raw: unknown, resume?: string): Promise<BackupRepairSession> {
    if (object(raw) && text(raw.sessionId)) this.#grant = raw.sessionId;
    if (this.#disposed) fail("setup.owner_required");
    if (
      !valid(raw) ||
      (resume !== undefined &&
        (raw.recoveryId !== resume || raw.input === undefined || raw.input === null))
    ) {
      const grant = this.#grant;
      this.#grant = undefined;
      if (grant !== undefined) await this.#api.closeFirstSetupBackup(grant).catch(() => {});
      fail("setup.attempt_invalid");
    }
    this.#current = structuredClone(raw);
    this.#selected = raw.input === null ? undefined : structuredClone(raw.input);
    return structuredClone(raw);
  }

  open(request: BackupRepairOpenRequest): Promise<BackupRepairSession> {
    return this.#run(async () => {
      if (this.#current) fail("setup.attempt_conflict");
      return this.#accept(await this.#api.openFirstSetupBackup(request));
    });
  }

  resume(request: BackupRepairResumeRequest): Promise<BackupRepairSession> {
    return this.#run(async () => {
      if (this.#current) fail("setup.attempt_conflict");
      return this.#accept(await this.#api.resumeFirstSetupBackup(request), request.recoveryId);
    });
  }

  prepare(proposal: unknown): Promise<unknown> {
    return this.#run(async () => {
      if (!this.#current || !this.#grant) fail("setup.owner_required");
      const result = await this.#api.prepareFirstSetupBackup(this.#grant, proposal);
      if (this.#disposed) fail("setup.owner_required");
      if (object(result) && result.status === "selected") {
        this.#selected = undefined;
        if (
          !same(result.binding, this.#current.binding) ||
          result.input === undefined ||
          result.input === null
        )
          fail("setup.attempt_invalid");
        this.#selected = structuredClone(result.input);
      }
      return result;
    });
  }

  commit(input: unknown): Promise<void> {
    return this.#run(async () => {
      if (!this.#current || !this.#grant) fail("setup.owner_required");
      if (this.#selected === undefined || !same(input, this.#selected))
        fail("setup.attempt_conflict");
      const result = await this.#api.commitFirstSetupBackup(this.#grant, input);
      if (this.#disposed) fail("setup.owner_required");
      if (!object(result) || result.restarting !== true) fail("setup.attempt_invalid");
      this.#current = undefined;
      this.#selected = undefined;
      this.#grant = undefined;
    });
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal;
    this.#disposed = true;
    this.#current = undefined;
    this.#selected = undefined;
    this.#disposal = (async () => {
      await this.#pending?.catch(() => {});
      const grant = this.#grant;
      this.#grant = undefined;
      if (grant !== undefined) await this.#api.closeFirstSetupBackup(grant);
    })();
    return this.#disposal;
  }
}
