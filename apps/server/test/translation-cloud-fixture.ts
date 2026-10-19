import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { SavedCloudState } from "../src/cloud-client.js";
import { type TranslationAction, translationEnvelope } from "../src/cloud-translation.js";
import { installationFixture, type ServiceState } from "./cloud-installation-fixture.js";

export interface FakeItem {
  ref: string;
  kind: string;
  family: string;
  category: string | null;
  staffName: string;
  existing: Record<string, string>;
  missing: string[];
}
export interface FakeJobBody {
  version: 1;
  country: string;
  languages: { default: string; enabled: string[] };
  items: FakeItem[];
  houseStyle: { kind: string; staffName: string; names: Record<string, string> }[];
}
export interface FakeResult {
  ref: string;
  names: Record<string, string>;
  placeholder: boolean;
  corrections: { field: string; wrong: string; right: string }[];
}
export interface FakeJob {
  jobId: string;
  operationId: string;
  jobSha256: string;
  job: FakeJobBody | null;
  state: "queued" | "running" | "done" | "partly_done" | "failed" | "collected" | "expired";
  total: number;
  done: number;
  failed: string[];
  results: FakeResult[] | null;
  reason?: "limit_reached" | "provider_failed" | "provider_unavailable" | "consent_required";
}
export interface FakePage {
  version: 1;
  jobId: string;
  state: "done" | "partly_done";
  results: FakeResult[];
  failed: string[];
  nextCursor: number | null;
}
export const PAGE_BYTES = 16_777_216;
type Answer = (status: number, body: unknown, headers?: Record<string, string>) => void;
type Call = {
  action: string;
  operationId: string;
  at: number;
  cursor?: unknown;
  replyBytes?: number;
};

const ACTIONS: readonly string[] = [
  "translation-submit",
  "translation-status",
  "translation-collect",
  "translation-release",
];
const KINDS = new Set([
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "included_menu",
  "unit",
]);
const kind = (v: unknown) => typeof v === "string" && KINDS.has(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_BYTES = 1_048_576;
const JOB_ITEMS = 1000;
const HOUSE_STYLE = 300;
const PROOF_WINDOW_MS = 60_000;

const keysAre = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === [...keys].sort().join();
const text = (v: unknown, max = 500): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= max;
const namesIn = (v: unknown, enabled: Set<string>) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.entries(v).every(([language, name]) => enabled.has(language) && text(name));

/** The fake's fingerprint check (contract, "Submit", step 3). */
export function verifySubmitVector(c: { body: string; signedBody: string }): boolean {
  const signed = JSON.parse(c.signedBody) as { jobSha256: string; jobBytes: number };
  const bytes = Buffer.from(c.body, "utf8");
  return (
    signed.jobBytes === bytes.length &&
    signed.jobSha256 === createHash("sha256").update(bytes).digest("hex")
  );
}

function fingerprintOf(signedBody: string): { jobSha256: string; jobBytes: number } | null {
  let v: unknown;
  try {
    v = JSON.parse(signedBody);
  } catch {
    return null;
  }
  if (
    !keysAre(v, ["version", "jobSha256", "jobBytes"]) ||
    v.version !== 1 ||
    typeof v.jobSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.jobSha256) ||
    typeof v.jobBytes !== "number" ||
    !Number.isSafeInteger(v.jobBytes) ||
    v.jobBytes < 0
  )
    return null;
  return { jobSha256: v.jobSha256, jobBytes: v.jobBytes };
}

/** Collect alone may sign a `cursor`, of any JSON value: its value is checked after the job lookup. */
function jobIdIn(signedBody: string, action: string): { jobId: string; cursor: unknown } | null {
  let v: unknown;
  try {
    v = JSON.parse(signedBody);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { jobId, cursor } = v as { jobId?: unknown; cursor?: unknown };
  if (typeof jobId !== "string" || !UUID.test(jobId)) return null;
  if (signedBody === JSON.stringify({ version: 1, jobId })) return { jobId, cursor: 0 };
  return action === "translation-collect" &&
    keysAre(v, ["version", "jobId", "cursor"]) &&
    signedBody === JSON.stringify({ version: 1, jobId, cursor })
    ? { jobId, cursor }
    : null;
}

/** Null when the job breaks a field rule (contract, "Submit"); the caller checks the 1,000-item bound. */
function readJob(body: string): FakeJobBody | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (
    !keysAre(v, ["version", "country", "languages", "items", "houseStyle"]) ||
    v.version !== 1 ||
    typeof v.country !== "string" ||
    !/^[A-Z]{2}$/.test(v.country)
  )
    return null;
  const l = v.languages;
  if (
    !keysAre(l, ["default", "enabled"]) ||
    !Array.isArray(l.enabled) ||
    l.enabled.length < 1 ||
    l.enabled.length > 20 ||
    !l.enabled.every((t) => typeof t === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(t)) ||
    new Set(l.enabled).size !== l.enabled.length ||
    !l.enabled.includes(l.default)
  )
    return null;
  const enabled = new Set(l.enabled as string[]);
  if (!Array.isArray(v.items) || v.items.length === 0) return null;
  const position = new Map<string, number>();
  for (const [index, item] of (v.items as unknown[]).entries()) {
    if (
      !keysAre(item, ["ref", "kind", "family", "category", "staffName", "existing", "missing"]) ||
      !text(item.ref, 128) ||
      position.has(item.ref) ||
      !kind(item.kind) ||
      !text(item.family, 128) ||
      !(
        item.category === null ||
        ((item.kind === "product" || item.kind === "variant") && text(item.category))
      ) ||
      !text(item.staffName) ||
      !namesIn(item.existing, enabled) ||
      !Array.isArray(item.missing) ||
      new Set(item.missing).size !== item.missing.length ||
      !item.missing.every(
        (m) => typeof m === "string" && enabled.has(m) && !(m in (item.existing as object)),
      )
    )
      return null;
    position.set(item.ref, index);
  }
  const items = v.items as FakeItem[];
  for (const [index, item] of items.entries()) {
    const head = position.get(item.family);
    if (item.family !== item.ref && head !== undefined && head > index) return null;
    if (
      item.missing.length === 0 &&
      !items.some((m) => m.ref !== item.ref && m.family === item.ref && m.missing.length > 0)
    )
      return null;
  }
  if (
    !Array.isArray(v.houseStyle) ||
    v.houseStyle.length > HOUSE_STYLE ||
    !v.houseStyle.every(
      (h) =>
        keysAre(h, ["kind", "staffName", "names"]) &&
        kind(h.kind) &&
        text(h.staffName) &&
        namesIn(h.names, enabled),
    )
  )
    return null;
  return v as unknown as FakeJobBody;
}

function defaultTranslator(item: FakeItem): Omit<FakeResult, "ref"> {
  if (item.staffName.startsWith("?")) return { names: {}, placeholder: true, corrections: [] };
  return {
    names: Object.fromEntries(
      item.missing.map((language) => [
        language,
        `${language.toUpperCase()} ${item.staffName}`.slice(0, 500),
      ]),
    ),
    placeholder: false,
    corrections: item.staffName.includes("ZURRITO")
      ? [{ field: "internal", wrong: "ZURRITO", right: "ZURITO" }]
      : [],
  };
}

/**
 * Where the contract is silent, this fake chooses:
 * - for status, collect and release, `permission_denied` comes after the signed-body check and
 *   before the job lookup;
 * - `revoked` (403) comes after the envelope, proof and lease checks, for all four actions: before
 *   submit's fingerprint check and the other three's signed-body check;
 * - any unexpired lease this fake issued is accepted, not only the one the box saved last;
 * - a language tag matches `[a-z]{2,3}` with an optional `-` and two capitals;
 * - `expire()` expires a job in any state, a `collected` one included;
 * - `pageItems(n)` caps a collect page at `n` entries, which Cloud does not; the byte budget
 *   (`pageBytes`) is Cloud's rule;
 * - a signed body's keys must come in the order the box sends them, where Cloud sorts them.
 * A `translator` answer is returned as written, not limited to `missing`: the contract says `names`
 * holds only the item's `missing` languages, and the fake lets a test break that so the box's
 * dropping of extra names can be tested.
 */
export async function translationCloudFixture(options: { cloudBeforeVersion2?: boolean } = {}) {
  const jobs = new Map<string, FakeJob>();
  const byOperation = new Map<string, FakeJob>();
  const calls: Call[] = [];
  const submissions: { operationId: string; body: string }[] = [];
  const lost = new Set<string>();
  const stalls = new Map<string, { reach: () => void; released: Promise<void> }>();
  let serviceState: ServiceState = "ready";
  let consentGiven = true;
  let capFits: number | null = null;
  let holding = false;
  let failing = new Set<string>();
  let providerIsDown = false;
  let capStops = false;
  let consentGone = false;
  let isOffline = false;
  let proofRefused = false;
  let override: Record<string, unknown> = {};
  let translate: (item: FakeItem) => Omit<FakeResult, "ref"> = defaultTranslator;
  let budget = PAGE_BYTES;
  let itemsPerPage: number | null = null;
  let rewrite: ((page: FakePage, cursor: number) => FakePage | string) | null = null;
  let gzipping = false;

  function leaseIssued(lease: unknown): boolean {
    for (const reply of base.replies.values()) {
      const issued = (reply as { lease?: { payload: string } }).lease;
      if (issued && JSON.stringify(issued) === lease)
        return (
          (JSON.parse(Buffer.from(issued.payload, "base64url").toString()) as number[])[9]! >
          Date.now()
        );
    }
    return false;
  }

  async function handler(
    values: unknown[],
    saved: Record<string, unknown>,
    req: IncomingMessage,
    res: ServerResponse,
    sent: Record<string, unknown>,
  ): Promise<void> {
    const action = String(values[2]);
    const operationId = String(values[4]);
    const call: Call = { action, operationId, at: Date.now() };
    calls.push(call);
    const stalled = stalls.get(action);
    if (stalled) {
      stalls.delete(action);
      stalled.reach();
      await stalled.released;
    }
    if (isOffline) {
      req.socket.destroy();
      return;
    }
    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      if (lost.delete(action)) {
        req.socket.destroy();
        return;
      }
      call.replyBytes = Buffer.byteLength(body);
      if (gzipping && status === 200) {
        res.writeHead(status, { "content-type": "application/json", "content-encoding": "gzip" });
        res.end(gzipSync(body));
        return;
      }
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body);
    };
    const answer: Answer = (status, body, headers) => send(status, JSON.stringify(body), headers);
    const registration = (saved.view as { registration?: { installationId?: unknown } } | undefined)
      ?.registration;
    const issuedAt = values[5];
    const signedBody = values[7];
    const submitting = action === "translation-submit";
    if (
      !ACTIONS.includes(action) ||
      req.url !== `/api/installations/${action}` ||
      values[1] !== base.options.origin ||
      values[3] !== registration?.installationId ||
      !UUID.test(operationId) ||
      typeof issuedAt !== "number" ||
      Math.abs(Date.now() - issuedAt) > PROOF_WINDOW_MS ||
      !leaseIssued(values[6]) ||
      typeof signedBody !== "string" ||
      signedBody.length > 4096 ||
      !keysAre(sent, submitting ? ["payload", "signature", "body"] : ["payload", "signature"]) ||
      (submitting && typeof sent.body !== "string") ||
      proofRefused
    )
      return answer(401, { error: "invalid_proof" });
    if (base.isRevoked()) return answer(403, { error: "revoked" });
    if (submitting) return submit(String(sent.body), signedBody, operationId, answer);
    const reference = jobIdIn(signedBody, action);
    if (!reference) return answer(400, { error: "invalid_request" });
    if (serviceState !== "ready") return answer(403, { error: "permission_denied" });
    const job = jobs.get(reference.jobId);
    if (!job) return answer(404, { error: "translation_job_not_found" });
    if (action === "translation-status") return status(job, answer);
    if (action === "translation-collect") {
      call.cursor = reference.cursor;
      return collect(job, reference.cursor, answer, send);
    }
    return release(job, answer);
  }

  const submitReply = (j: FakeJob) => ({
    version: 1,
    jobId: j.jobId,
    state: j.state,
    total: j.total,
  });

  function submit(body: string, signedBody: string, operationId: string, answer: Answer) {
    const fingerprint = fingerprintOf(signedBody);
    if (!fingerprint) return answer(401, { error: "invalid_proof" });
    if (fingerprint.jobBytes > JOB_BYTES)
      return answer(413, { error: "translation_job_too_large" });
    if (!verifySubmitVector({ body, signedBody })) return answer(401, { error: "invalid_proof" });
    submissions.push({ operationId, body });
    const job = readJob(body);
    if (!job) return answer(400, { error: "invalid_request" });
    if (job.items.length > JOB_ITEMS) return answer(413, { error: "translation_job_too_large" });
    const earlier = byOperation.get(operationId);
    if (earlier)
      return earlier.jobSha256 === fingerprint.jobSha256
        ? answer(200, submitReply(earlier))
        : answer(409, { error: "conflict" });
    if (serviceState !== "ready") return answer(403, { error: "permission_denied" });
    if (!consentGiven) return answer(403, { error: "translation_consent_required" });
    if ([...jobs.values()].some((j) => j.state === "queued" || j.state === "running"))
      return answer(409, { error: "translation_job_running" });
    const total = job.items.filter((i) => i.missing.length > 0).length;
    if (capFits !== null && total > capFits)
      return answer(409, { error: "translation_limit_reached", fits: capFits });
    const created: FakeJob = {
      jobId: randomUUID(),
      operationId,
      jobSha256: fingerprint.jobSha256,
      job,
      state: "queued",
      total,
      done: 0,
      failed: [],
      results: null,
    };
    jobs.set(created.jobId, created);
    byOperation.set(operationId, created);
    return answer(200, submitReply(created));
  }

  function finish(j: FakeJob) {
    const writable = j.job!.items.filter((i) => i.missing.length > 0);
    const refs = writable.map((i) => i.ref);
    let failed = refs.filter((ref) => failing.has(ref));
    let reason: FakeJob["reason"] =
      failed.length === 0
        ? undefined
        : failed.length === refs.length
          ? "provider_unavailable"
          : "provider_failed";
    if (capStops) {
      failed = refs.length === 1 ? refs : refs.slice(Math.ceil(refs.length / 2));
      reason = "limit_reached";
    }
    if (providerIsDown) {
      failed = refs;
      reason = "provider_unavailable";
    }
    if (consentGone) {
      failed = refs;
      reason = "consent_required";
    }
    const failedRefs = new Set(failed);
    j.results = writable
      .filter((i) => !failedRefs.has(i.ref))
      .map((i) => ({ ref: i.ref, ...translate(i) }));
    j.failed = failed;
    j.done = j.results.length;
    j.state =
      failed.length === 0 ? "done" : failed.length === refs.length ? "failed" : "partly_done";
    if (reason) j.reason = reason;
    else delete j.reason;
  }

  function status(j: FakeJob, answer: Answer) {
    if (j.state === "queued") {
      j.state = "running";
      j.done = Math.floor(j.total / 2);
    } else if (j.state === "running" && !holding) finish(j);
    const ended = j.state === "partly_done" || j.state === "failed";
    answer(200, {
      version: 1,
      jobId: j.jobId,
      state: j.state,
      total: j.total,
      done: j.done,
      failed: j.failed.length,
      ...(ended && j.reason ? { reason: j.reason } : {}),
      ...override,
    });
  }

  function collect(
    j: FakeJob,
    cursor: unknown,
    answer: Answer,
    send: (status: number, body: string) => void,
  ) {
    if (
      typeof cursor !== "number" ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor >= j.total
    )
      return answer(400, { error: "invalid_request" });
    if (j.state === "collected" || j.state === "expired")
      return answer(410, { error: "translation_expired" });
    if (j.state !== "done" && j.state !== "partly_done")
      return answer(409, { error: "translation_not_ready" });
    const page = pageAt(j, j.state, cursor);
    // Cloud's plain `Error` when not one item fits becomes this (`publicError`).
    if (!page) return answer(503, { error: "temporarily_unavailable" }, { "retry-after": "1" });
    const reply = rewrite ? rewrite(page, cursor) : page;
    if (typeof reply === "string") return send(200, reply);
    answer(200, reply);
  }

  /** As Cloud's `collectPage`: the most items that fit, each measured with its own `nextCursor`. */
  function pageAt(j: FakeJob, state: FakePage["state"], cursor: number): FakePage | null {
    const refs = j.job!.items.filter((i) => i.missing.length > 0).map((i) => i.ref);
    const answered = new Map(j.results!.map((r) => [r.ref, r]));
    let itemBytes = 0;
    let results = 0;
    let failed = 0;
    let end = cursor;
    for (let i = cursor; i < refs.length; i++) {
      if (itemsPerPage !== null && i - cursor >= itemsPerPage) break;
      const result = answered.get(refs[i]!);
      itemBytes += result
        ? Buffer.byteLength(JSON.stringify(result)) + (results++ ? 1 : 0)
        : Buffer.byteLength(JSON.stringify(refs[i])) + (failed++ ? 1 : 0);
      if (itemBytes > budget) break;
      const envelope: FakePage = {
        version: 1,
        jobId: j.jobId,
        state,
        results: [],
        failed: [],
        nextCursor: i + 1 === refs.length ? null : i + 1,
      };
      if (Buffer.byteLength(JSON.stringify(envelope)) + itemBytes <= budget) end = i + 1;
    }
    if (end === cursor) return null;
    const page = refs.slice(cursor, end);
    return {
      version: 1,
      jobId: j.jobId,
      state,
      results: page.flatMap((ref) => answered.get(ref) ?? []),
      failed: page.filter((ref) => !answered.has(ref)),
      nextCursor: end === refs.length ? null : end,
    };
  }

  function release(j: FakeJob, answer: Answer) {
    if (j.state === "queued" || j.state === "running")
      return answer(409, { error: "translation_not_ready" });
    if (j.state === "expired") return answer(410, { error: "translation_expired" });
    j.state = "collected";
    j.job = null;
    j.results = null;
    answer(200, { version: 1, jobId: j.jobId, state: "collected" });
  }

  function stall(action: TranslationAction) {
    let reach = () => {};
    let free = () => {};
    const reached = new Promise<void>((resolve) => {
      reach = resolve;
    });
    const released = new Promise<void>((resolve) => {
      free = resolve;
    });
    stalls.set(action, { reach, released });
    return { reached, release: () => free() };
  }

  function expire(jobId: string) {
    const j = jobs.get(jobId);
    if (!j) throw new Error(`the fake Cloud holds no job ${jobId}`);
    j.state = "expired";
    j.job = null;
    j.results = null;
  }

  async function signedRequest(
    action: TranslationAction,
    input: {
      signedBody: string;
      onResponse?: (response: Response) => void;
      body?: string;
      operationId?: string;
      extra?: Record<string, unknown>;
      lease?: string;
      issuedAt?: number;
    },
  ): Promise<{ status: number; json: unknown }> {
    const saved = JSON.parse(
      await readFile(join(base.stateDir, "cloud-connection.json"), "utf8"),
    ) as SavedCloudState;
    const lease =
      input.lease ?? (saved.lifecycle?.lease ? JSON.stringify(saved.lifecycle.lease) : "");
    const envelope = translationEnvelope(
      saved,
      action,
      { operationId: input.operationId ?? randomUUID(), lease, signedBody: input.signedBody },
      input.issuedAt ?? Date.now(),
    );
    const response = await fetch(`${base.options.origin}/api/installations/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...envelope,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...input.extra,
      }),
    });
    input.onResponse?.(response);
    const raw = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
    return { status: response.status, json };
  }

  const base = await installationFixture(undefined, {
    cloudBeforeVersion2: options.cloudBeforeVersion2 ?? false,
    translation: handler,
    translationState: () => serviceState,
  });
  return {
    ...base,
    jobs,
    calls,
    submissions,
    signedRequest,
    consent: (given: boolean) => {
      consentGiven = given;
    },
    cap: (fits: number | null) => {
      capFits = fits;
    },
    hold: (on: boolean) => {
      holding = on;
    },
    failRefs: (refs: string[]) => {
      failing = new Set(refs);
    },
    providerDown: (on: boolean) => {
      providerIsDown = on;
    },
    capStop: (on: boolean) => {
      capStops = on;
    },
    consentWithdrawn: (on: boolean) => {
      consentGone = on;
    },
    service: (state: ServiceState) => {
      serviceState = state;
    },
    expire,
    offline: () => {
      isOffline = true;
      base.offline();
    },
    online: () => {
      isOffline = false;
      base.online();
    },
    refuseProof: (on: boolean) => {
      proofRefused = on;
    },
    loseNext: (action: TranslationAction) => {
      lost.add(action);
    },
    stall,
    statusOverride: (patch: Record<string, unknown> | null) => {
      override = patch ?? {};
    },
    translator: (fn: (item: FakeItem) => Omit<FakeResult, "ref">) => {
      translate = fn;
    },
    pageBytes: (n: number) => {
      budget = n;
    },
    pageItems: (n: number | null) => {
      itemsPerPage = n;
    },
    collectReply: (fn: ((page: FakePage, cursor: number) => FakePage | string) | null) => {
      rewrite = fn;
    },
    gzipReplies: (on: boolean) => {
      gzipping = on;
    },
  };
}
export type TranslationCloud = Awaited<ReturnType<typeof translationCloudFixture>>;
