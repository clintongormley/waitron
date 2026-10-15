import type { ProvisionBody, SetupApi, EmailSettingsDraft } from "./api/client.js";
import type {
  FirstSetupOwner,
  FirstSetupOwnership,
  FirstSetupProvisionBody,
  FirstSetupState,
} from "./api/first-setup-types.js";

export const FIRST_SETUP_SESSION_KEY = "waitron:first-setup:v1";
type SessionStorage = Pick<Storage, "getItem" | "setItem">;
interface SavedOwner {
  version: 1;
  clientClaimNonce: string;
  claimPending: boolean;
  owner?: FirstSetupOwner;
}
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function publicState(value: unknown): value is FirstSetupState {
  return (
    object(value) &&
    uuid(value.attemptId) &&
    uuid(value.nodeId) &&
    uuid(value.administratorId) &&
    typeof value.consumptionIntent === "boolean" &&
    positive(value.revision) &&
    positive(value.ownerGeneration) &&
    [
      "claimed",
      "consumption-intent",
      "activation-started",
      "committed",
      "publication",
      "complete",
      "abandoned",
      "uncertain",
    ].includes(String(value.status)) &&
    ["production", "preproduction"].includes(String(value.environment)) &&
    object(value.venue) &&
    object(value.venue.admin) &&
    Array.isArray(value.modules) &&
    value.modules.every(
      (entry) =>
        object(entry) &&
        typeof entry.module === "string" &&
        entry.module.length > 0 &&
        typeof entry.version === "string" &&
        entry.version.length > 0,
    ) &&
    new Set(value.modules.map((entry: { module: string }) => entry.module)).size ===
      value.modules.length
  );
}
function failure(
  code:
    | "setup.owner_required"
    | "setup.attempt_conflict"
    | "setup.attempt_invalid"
    | "setup.attempt_uncertain",
): never {
  throw { code };
}
function readSaved(text: string): SavedOwner {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    failure("setup.attempt_invalid");
  }
  if (
    !object(value) ||
    value.version !== 1 ||
    !token(value.clientClaimNonce) ||
    typeof value.claimPending !== "boolean" ||
    Object.keys(value).some(
      (key) => !["version", "clientClaimNonce", "claimPending", "owner"].includes(key),
    )
  )
    failure("setup.attempt_invalid");
  const owner = value.owner;
  if (
    owner !== undefined &&
    (!object(owner) ||
      Object.keys(owner).length !== 4 ||
      typeof owner.attemptId !== "string" ||
      owner.attemptId.length === 0 ||
      !positive(owner.revision) ||
      !positive(owner.ownerGeneration) ||
      !token(owner.capability))
  )
    failure("setup.attempt_invalid");
  return value as unknown as SavedOwner;
}
function nonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export class FirstSetupSession {
  readonly #api: SetupApi;
  readonly #storage: SessionStorage;
  readonly #locks: LockManager;
  #saved?: SavedOwner;
  #state?: FirstSetupState;
  #opened = false;
  #disposed = false;
  #busy = false;
  #generation = 0;
  #proofRequired = false;
  #needsRefresh = false;
  #releases = new Set<() => void>();
  #lockTasks: Promise<void>[] = [];
  #attemptLock?: string;

  constructor(api: SetupApi, options: { storage?: SessionStorage; locks?: LockManager } = {}) {
    this.#api = api;
    this.#storage = options.storage ?? sessionStorage;
    this.#locks = options.locks ?? navigator.locks;
  }
  get state(): FirstSetupState | undefined {
    return this.#state === undefined ? undefined : structuredClone(this.#state);
  }
  get recoveryRequired(): boolean {
    return this.#proofRequired || this.#needsRefresh || this.#saved?.claimPending === true;
  }
  async open(): Promise<void> {
    if (this.#disposed || this.#opened || this.#busy) failure("setup.attempt_conflict");
    this.#busy = true;
    const generation = this.#generation;
    try {
      const text = this.#storage.getItem(FIRST_SETUP_SESSION_KEY);
      this.#saved =
        text === null
          ? { version: 1, clientClaimNonce: nonce(), claimPending: false }
          : readSaved(text);
      this.#storage.setItem(FIRST_SETUP_SESSION_KEY, JSON.stringify(this.#saved));
      this.#proofRequired = this.#saved.owner !== undefined || this.#saved.claimPending;
      if (!this.#locks) failure("setup.owner_required");
      await this.#takeLock(`waitron:first-setup:nonce:${this.#saved.clientClaimNonce}`, generation);
      if (this.#saved.owner) await this.#holdAttempt(this.#saved.owner.attemptId, generation);
      this.#opened = true;
    } catch (error) {
      await this.#releaseLocks();
      throw error;
    } finally {
      this.#busy = false;
    }
  }
  #takeLock(name: string, generation: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const task = this.#locks
        .request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!lock || this.#disposed || generation !== this.#generation) {
            reject({ code: "setup.attempt_conflict" });
            return;
          }
          await new Promise<void>((release) => {
            this.#releases.add(release);
            resolve();
          });
        })
        .catch(reject);
      this.#lockTasks.push(task);
    });
  }
  async #holdAttempt(attemptId: string, generation = this.#generation): Promise<void> {
    if (this.#attemptLock === attemptId) return;
    if (this.#attemptLock !== undefined) failure("setup.attempt_conflict");
    await this.#takeLock(`waitron:first-setup:attempt:${attemptId}`, generation);
    this.#attemptLock = attemptId;
  }
  async #releaseLocks(): Promise<void> {
    for (const release of this.#releases) release();
    this.#releases.clear();
    await Promise.all(this.#lockTasks.splice(0));
    this.#attemptLock = undefined;
  }
  dispose(): Promise<void> {
    this.#disposed = true;
    this.#opened = false;
    ++this.#generation;
    this.#state = undefined;
    return this.#releaseLocks();
  }
  async #run<T>(body: (current: () => void) => Promise<T>): Promise<T> {
    if (!this.#opened || this.#disposed || this.#busy) failure("setup.attempt_conflict");
    this.#busy = true;
    const generation = this.#generation;
    const current = () => {
      if (this.#disposed || generation !== this.#generation) failure("setup.attempt_conflict");
    };
    try {
      return await body(current);
    } finally {
      this.#busy = false;
    }
  }
  #save(): void {
    this.#storage.setItem(FIRST_SETUP_SESSION_KEY, JSON.stringify(this.#saved));
  }
  #owner(mutation = true, allowUncertain = false): FirstSetupOwner {
    const owner = this.#saved?.owner;
    if (!owner) failure("setup.owner_required");
    if (
      mutation &&
      (this.#state?.status === "complete" ||
        this.#state?.status === "abandoned" ||
        (this.#state?.status === "uncertain" && !allowUncertain))
    )
      failure("setup.attempt_conflict");
    if (mutation && this.recoveryRequired) failure("setup.owner_required");
    return { ...owner };
  }
  #module(module: string): void {
    if (!this.#state?.modules.some((entry) => entry.module === module))
      failure("setup.attempt_conflict");
  }
  #acceptState(state: FirstSetupState, generation = this.#saved?.owner?.ownerGeneration): void {
    const old = this.#state;
    if (
      !publicState(state) ||
      (generation !== undefined && state.ownerGeneration !== generation) ||
      (this.#saved?.owner && state.attemptId !== this.#saved.owner.attemptId) ||
      (old &&
        (state.revision < old.revision ||
          state.nodeId !== old.nodeId ||
          state.administratorId !== old.administratorId ||
          state.environment !== old.environment))
    )
      failure("setup.attempt_conflict");
    this.#state = structuredClone(state);
    if (this.#saved?.owner) {
      this.#saved.owner.revision = state.revision;
      this.#saved.owner.ownerGeneration = state.ownerGeneration;
      this.#save();
    }
  }
  #acceptOwnership(result: FirstSetupOwnership): void {
    if (!token(result.capability) || result.ownerGeneration !== result.state.ownerGeneration)
      failure("setup.attempt_conflict");
    const previous = this.#saved?.owner;
    if (
      previous &&
      (result.ownerGeneration <= previous.ownerGeneration ||
        result.state.revision <= previous.revision)
    )
      failure("setup.attempt_conflict");
    this.#acceptState(result.state, result.ownerGeneration);
    this.#saved = {
      ...this.#saved!,
      claimPending: false,
      owner: {
        attemptId: result.state.attemptId,
        revision: result.state.revision,
        ownerGeneration: result.ownerGeneration,
        capability: result.capability,
      },
    };
    this.#save();
    this.#proofRequired = false;
    this.#needsRefresh = false;
  }
  async #claim(
    venue: ProvisionBody["venue"],
    current: () => void,
    locale?: string,
    intent?: Pick<ProvisionBody, "configurationImport" | "newTaxpayer">,
  ): Promise<void> {
    this.#saved!.claimPending = true;
    this.#save();
    const result = await this.#api.claimFirstSetup(
      this.#saved!.clientClaimNonce,
      venue,
      locale,
      intent,
    );
    current();
    if (!publicState(result.state)) failure("setup.attempt_conflict");
    await this.#holdAttempt(result.state.attemptId);
    current();
    this.#acceptOwnership(result);
  }
  claim(
    venue: ProvisionBody["venue"],
    locale?: string,
    intent?: Pick<ProvisionBody, "configurationImport" | "newTaxpayer">,
  ): Promise<void> {
    return this.#run(async (current) => {
      if (this.#saved!.owner || this.recoveryRequired) failure("setup.owner_required");
      await this.#claim(venue, current, locale, intent);
    });
  }
  replaceAbandoned(
    venue: ProvisionBody["venue"],
    locale?: string,
    intent?: Pick<ProvisionBody, "configurationImport" | "newTaxpayer">,
  ): Promise<void> {
    return this.#run(async (current) => {
      if (this.#state?.consumptionIntent) failure("setup.attempt_uncertain");
      if (this.#state?.status !== "abandoned") failure("setup.attempt_conflict");
      this.#saved = {
        version: 1,
        clientClaimNonce: this.#saved!.clientClaimNonce,
        claimPending: false,
      };
      this.#state = undefined;
      this.#proofRequired = false;
      this.#needsRefresh = false;
      this.#save();
      this.#attemptLock = undefined;
      await this.#claim(venue, current, locale, intent);
    });
  }
  resume(password: string): Promise<void> {
    return this.#run(async (current) => {
      this.#proofRequired = true;
      const result = await this.#api.resumeFirstSetup(this.#saved!.clientClaimNonce, password);
      current();
      if (!publicState(result.state)) failure("setup.attempt_conflict");
      await this.#holdAttempt(result.state.attemptId);
      current();
      this.#acceptOwnership(result);
    });
  }
  refresh(): Promise<void> {
    return this.#run(async (current) => {
      if (this.#saved!.owner === undefined) {
        const result = await this.#api.firstSetupStatus();
        current();
        if (typeof result.claimed !== "boolean" || result.conflict || result.state !== undefined)
          failure("setup.attempt_conflict");
        this.#proofRequired = result.claimed;
        this.#saved!.claimPending = result.claimed;
        if (!result.claimed) {
          this.#needsRefresh = false;
        }
        this.#save();
        return;
      }
      const owner = this.#owner(false);
      const result = await this.#api.firstSetupStatus(owner);
      current();
      if (!result.claimed || !result.state) failure("setup.attempt_conflict");
      this.#acceptState(result.state);
      this.#needsRefresh = false;
    });
  }
  #change(
    module: string | undefined,
    body: (owner: FirstSetupOwner) => Promise<{ state: FirstSetupState }>,
    allowUncertain = false,
  ): Promise<void> {
    return this.#run(async (current) => {
      if (module !== undefined) this.#module(module);
      const owner = this.#owner(true, allowUncertain);
      try {
        const result = await body(owner);
        current();
        this.#acceptState(result.state);
      } catch (error) {
        this.#needsRefresh = true;
        throw error;
      }
    });
  }
  candidates(module: string, proposal: unknown, password: string): Promise<void> {
    return this.#change(module, async (owner) => {
      const { reconfirmation } = await this.#api.reconfirmFirstSetup(owner, password, "block-use");
      if (this.#disposed) failure("setup.attempt_conflict");
      return this.#api.firstSetupCandidates(owner, module, proposal, reconfirmation);
    });
  }
  importInput(module: string, input: unknown): Promise<void> {
    return this.#change(module, (owner) => this.#api.firstSetupImport(owner, module, input));
  }
  enrol(module: string, publicKey: unknown, comparison: unknown): Promise<void> {
    return this.#change(module, (owner) =>
      this.#api.firstSetupEnrol(owner, module, publicKey, comparison),
    );
  }
  confirm(module: string, statement: unknown, password: string): Promise<void> {
    return this.#change(module, async (owner) => {
      const { reconfirmation } = await this.#api.reconfirmFirstSetup(owner, password, "activation");
      if (this.#disposed) failure("setup.attempt_conflict");
      return this.#api.firstSetupConfirm(owner, module, statement, reconfirmation);
    });
  }
  abandon(): Promise<void> {
    return this.#change(undefined, (owner) => this.#api.abandonFirstSetup(owner), true);
  }
  request() {
    return this.#run(async (current) => {
      const owner = this.#owner(false);
      const result = await this.#api.firstSetupRequest(owner);
      current();
      if (result.attemptId !== owner.attemptId) failure("setup.attempt_conflict");
      return result;
    });
  }
  runEmailTest(email: EmailSettingsDraft) {
    return this.#run(async (current) => {
      const result = await this.#api.runFirstSetupEmailTest(this.#owner(), email);
      current();
      return result;
    });
  }
  runFiscalTest(settings: Omit<FirstSetupProvisionBody, "firstSetup">) {
    return this.#run(async (current) => {
      const owner = this.#owner();
      const result = await this.#api.runFirstSetupFiscalTest(
        owner,
        this.#publicationBody(owner, settings),
      );
      current();
      return result;
    });
  }
  provision(settings: Omit<FirstSetupProvisionBody, "firstSetup">, locale?: string) {
    return this.#run(async (current) => {
      const owner = this.#owner();
      try {
        const result = await this.#api.provisionFirstSetup(
          owner,
          this.#publicationBody(owner, settings),
          locale,
        );
        current();
        this.#needsRefresh = true;
        return result;
      } catch (error) {
        this.#needsRefresh = true;
        throw error;
      }
    });
  }
  #publicationBody(
    owner: FirstSetupOwner,
    settings: Omit<FirstSetupProvisionBody, "firstSetup">,
  ): FirstSetupProvisionBody {
    return {
      mode: "live",
      firstSetup: { attemptId: owner.attemptId, revision: owner.revision },
      ...(settings.aeatCert === undefined ? {} : { aeatCert: settings.aeatCert }),
      ...(settings.email === undefined ? {} : { email: settings.email }),
    };
  }
}
