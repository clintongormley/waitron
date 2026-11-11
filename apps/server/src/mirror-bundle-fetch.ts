// `credential` is the primary's by-id login object (`AdoptCredential`), not the dashboard's
// by-email body: the primary's mirror-bundle route authenticates it with `loginManagerById`.
import { X509Certificate } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { AppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import { lookupBoxName, RememberedAnswers, type BoxAddresses } from "./box-lookup.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { assertSafePrimaryUrl } from "./primary-url.js";
import { reachDisk } from "./sync-path.js";
import "./errors.js";
// The registry of the code this file relays from the primary.
import "@waitron/identity";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isKeyEntry(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.key === "string" && typeof value.version === "number";
}

function isEncodedKeyRing(value: unknown): boolean {
  return isKeyEntry(value) && (value.previous === undefined || isKeyEntry(value.previous));
}

function isMirrorBundle(value: unknown): value is MirrorBundle {
  if (!isRecord(value)) return false;
  const { designated, tenant, primaryNode, reservedIdentity, moduleOverrides, wireguardPublicKey } =
    value;
  if (
    !hasStrings(value, [
      "boxHostname",
      "boxCaPem",
      "primaryUrl",
      "accountKey",
      "primaryPublicKey",
      "boxCaKeyPem",
    ]) ||
    (value.relayUrl !== undefined && typeof value.relayUrl !== "string") ||
    !isRecord(value.store) ||
    !hasStrings(value.store, ["accessKeyId", "secretAccessKey", "venueId"]) ||
    !isEncodedKeyRing(value.credentialsRing) ||
    (value.environment !== "production" && value.environment !== "preproduction") ||
    (wireguardPublicKey !== undefined && typeof wireguardPublicKey !== "string") ||
    !isRecord(designated) ||
    !hasStrings(designated, ["nodeId"]) ||
    !isRecord(tenant) ||
    !hasStrings(tenant, ["country", "taxId"]) ||
    !isRecord(primaryNode) ||
    !hasStrings(primaryNode, ["name"]) ||
    !isNullableString(primaryNode.filingModule) ||
    !isNullableString(primaryNode.taxModule) ||
    !isRecord(reservedIdentity) ||
    !isRecord(reservedIdentity.modules) ||
    !Array.isArray(reservedIdentity.series) ||
    !reservedIdentity.series.every(
      (entry: unknown) => isRecord(entry) && hasStrings(entry, ["code", "purpose"]),
    ) ||
    !isRecord(reservedIdentity.endorsement) ||
    !hasStrings(reservedIdentity.endorsement, ["nodeId", "publicKey", "endorsedBy", "signature"]) ||
    !isRecord(moduleOverrides) ||
    !Object.values(moduleOverrides).every((override) => typeof override === "boolean")
  ) {
    return false;
  }
  // Module-owned reservation values remain opaque to the bundle carrier.
  return true;
}

/**
 * The primary's refused login is relayed as `password.invalid`, rebuilt here so nothing the primary
 * wrote travels on; every other refusal is `mirror.bundle_fetch_failed`.
 */
async function refusalFrom(response: Response): Promise<AppError> {
  let code: unknown;
  try {
    const body: unknown = await response.json();
    code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  } catch {
    code = undefined;
  }
  if (code === "password.invalid") return new AppError("password.invalid", {});
  return new AppError("mirror.bundle_fetch_failed", {});
}

// A box's authority certificate is about 1–2 KiB; anything far larger is not one.
const MAX_CERTIFICATE_BYTES = 64 * 1024;

// One small file from a box on the venue's network: a box that has not sent it by then is not
// answering, and the person should be told so rather than watch a frozen screen.
const CERTIFICATE_READ_LIMIT_MS = 10_000;
// Far above the time a bundle mint takes, and well under the five minutes Node's fetch waits for an
// answer's headers by default.
const BUNDLE_REQUEST_LIMIT_MS = 60_000;

/** A request still unanswered after `timeoutMs` is destroyed and refused. */
export interface RequestLimit {
  timeoutMs?: number;
}

async function withinLimit<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

type BoxTrust = Pick<RequestOptions, "ca" | "rejectUnauthorized">;

/**
 * The addresses a host name answers to; the default asks the venue's network for a `.local` one.
 * `fresh` passes over any answer kept from an earlier ask.
 */
export type BoxLookup = (hostname: string, ask: { fresh: boolean }) => Promise<BoxAddresses>;

const remembered = new RememberedAnswers();
const askVenueNetwork: BoxLookup = (hostname, { fresh }) =>
  lookupBoxName(hostname, { remembered, fresh });

/**
 * The address at which a connection to a box's name last finished its handshake under the
 * authority pinned for it. Process memory only: after a restart nothing counts as reached until a
 * call reaches the box again.
 */
export class CheckedAddresses {
  private readonly reached = new Map<string, string>();

  recall(key: string): string | undefined {
    return this.reached.get(key);
  }

  keep(key: string, address: string): void {
    this.reached.set(key, address);
  }
}

const checkedByDefault = new CheckedAddresses();

/**
 * A failed call that tried the address `CheckedAddresses` remembered for the name first and
 * reached no address's TCP connection at all, that one included.
 */
export class CheckedAddressUnreached extends Error {
  constructor(cause: unknown) {
    super("the address last checked was not reached", { cause });
  }
}

/** Remembering applies only to an https host, a name or a literal address, under a pinned authority. */
function checkedKey(url: URL, host: string, trust: BoxTrust): string | undefined {
  if (url.protocol !== "https:") return undefined;
  if (trust.ca === undefined || trust.rejectUnauthorized !== true) return undefined;
  return JSON.stringify([host.toLowerCase(), url.port, [trust.ca].flat().map(String)]);
}

// An address still short of its handshake after this is passed over when another try follows it;
// the last try has whatever remains of the call's own limit.
const HANDSHAKE_LIMIT_MS = 2_000;

interface BoxRequest {
  method: "GET" | "POST";
  trust: BoxTrust;
  signal: AbortSignal;
  body?: string;
  /** Milliseconds a connection may carry no byte before it is a failure. */
  silenceLimitMs?: number;
  lookup?: BoxLookup;
  /** This process's own with the default lookup; with a lookup the caller names, kept for this call only. */
  checked?: CheckedAddresses;
  /** TCP connection, before any TLS handshake or response. */
  onConnected?: () => void;
  /** A handshake finished at `address`, under the pinned authority when there is one. */
  onHandshake?: (address: string) => void;
}

/** Thrown when a connection failed before its handshake finished, so another address may be tried. */
class NotConnected extends Error {
  constructor(readonly failure: unknown) {
    super("not connected");
  }
}

function openAt(
  url: URL,
  host: string,
  address: string,
  options: BoxRequest,
  handshakeLimitMs: number | undefined,
): Promise<IncomingMessage> {
  const https = url.protocol === "https:";
  return new Promise((resolve, reject) => {
    let connected = false;
    const req = (https ? request : httpRequest)(
      url,
      {
        method: options.method,
        agent: false,
        signal: options.signal,
        hostname: address,
        // The certificate is checked against the name asked for, not the address it answered at.
        ...(https && isIP(host) === 0 ? { servername: host } : {}),
        ...(options.silenceLimitMs === undefined ? {} : { timeout: options.silenceLimitMs }),
        ...options.trust,
        headers: {
          host: url.host,
          ...(options.body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(options.body),
              }),
        },
      },
      resolve,
    );
    const onConnected = options.onConnected;
    const handshakeTimer =
      handshakeLimitMs === undefined
        ? undefined
        : setTimeout(() => req.destroy(new Error("no handshake in time")), handshakeLimitMs);
    req.once("close", () => clearTimeout(handshakeTimer));
    req.on("socket", (socket) => {
      if (onConnected !== undefined) {
        if (socket.connecting) socket.once("connect", onConnected);
        else onConnected();
      }
      // Under `rejectUnauthorized`, Node emits `secureConnect` only for a certificate it accepted.
      socket.once(https ? "secureConnect" : "connect", () => {
        connected = true;
        clearTimeout(handshakeTimer);
        options.onHandshake?.(address);
      });
    });
    req.on("timeout", () => req.destroy(new Error("no bytes in time")));
    req.on("error", (error) =>
      reject(connected || options.signal.aborted ? error : new NotConnected(error)),
    );
    req.end(options.body);
  });
}

/** `work`'s answer, unless `signal` stops first; nothing is started on a signal already stopped. */
async function untilStopped<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  // An abort event never fires on a signal already aborted, so nothing below would end the wait.
  if (signal.aborted) throw new Error("no answer in time");
  let stop = () => {};
  const stopped = new Promise<never>((_, reject) => {
    stop = () => reject(new Error("no answer in time"));
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([work(), stopped]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Tries each address in turn; `NotConnected` carries the last failure when none connected, or
 * `earlier` when there was no address to try.
 */
async function firstToConnect(
  url: URL,
  host: string,
  addresses: readonly string[],
  options: BoxRequest,
  anotherTryFollows: boolean,
  earlier: unknown = new Error("no address"),
): Promise<IncomingMessage> {
  let failure = earlier;
  for (const [index, address] of addresses.entries()) {
    const followed = anotherTryFollows || index < addresses.length - 1;
    try {
      return await openAt(url, host, address, options, followed ? HANDSHAKE_LIMIT_MS : undefined);
    } catch (error) {
      if (!(error instanceof NotConnected)) throw error;
      failure = error.failure;
    }
  }
  throw new NotConnected(failure);
}

/**
 * Sends the request on the first connection to finish its handshake. Under a pinned authority only
 * a server holding a certificate that authority issued for the name finishes one, and the address
 * last checked that way is tried before any the network answers with; a call that checks no
 * certificate goes to whichever server finishes first.
 */
async function openBoxRequest(url: URL, options: BoxRequest): Promise<IncomingMessage> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const checked =
    options.checked ?? (options.lookup === undefined ? checkedByDefault : new CheckedAddresses());
  const key = checkedKey(url, host, options.trust);
  const known = key === undefined ? undefined : checked.recall(key);
  let reachedTcp = false;
  const tracked: BoxRequest = {
    ...options,
    onConnected: () => {
      reachedTcp = true;
      options.onConnected?.();
    },
    ...(key === undefined ? {} : { onHandshake: (address) => checked.keep(key, address) }),
  };
  let knownTried = false;
  try {
    let failure: unknown = new Error("no address");
    if (known !== undefined) {
      knownTried = true;
      try {
        return await firstToConnect(url, host, [known], tracked, isIP(host) === 0);
      } catch (error) {
        if (!(error instanceof NotConnected)) throw error;
        failure = error.failure;
      }
    }
    return await openHeard(url, host, tracked, known, failure);
  } catch (error) {
    if (knownTried && !reachedTcp) throw new CheckedAddressUnreached(error);
    throw error;
  }
}

/** The addresses the lookup answers with for `host`, other than `known`, tried after it. */
async function openHeard(
  url: URL,
  host: string,
  options: BoxRequest,
  known: string | undefined,
  earlier: unknown,
): Promise<IncomingMessage> {
  const { signal } = options;
  const lookup = options.lookup ?? askVenueNetwork;
  let failure = earlier;
  const unknown = (addresses: readonly string[]) => addresses.filter((a) => a !== known);
  const first = await untilStopped(() => lookup(host, { fresh: false }), signal);
  try {
    return await firstToConnect(
      url,
      host,
      unknown(first.addresses),
      options,
      first.remembered,
      failure,
    );
  } catch (error) {
    if (!(error instanceof NotConnected)) throw error;
    if (!first.remembered) throw error.failure;
    failure = error.failure;
  }
  const again = await untilStopped(() => lookup(host, { fresh: true }), signal);
  try {
    return await firstToConnect(url, host, unknown(again.addresses), options, false, failure);
  } catch (error) {
    throw error instanceof NotConnected ? error.failure : error;
  }
}

/**
 * One request to a box; `trust` applies to an https address, and plain http ignores it. A
 * `.local` host that no other box answers for is `mirror.peer_unresolved`, which names no host:
 * the caller names the box it was asking.
 */
export async function boxExchange(
  url: URL,
  options: {
    method: "GET" | "POST";
    trust: BoxTrust;
    signal: AbortSignal;
    body?: string;
    lookup?: BoxLookup;
    checked?: CheckedAddresses;
    /** TCP connection, before any TLS handshake or response. */
    onConnected?: () => void;
  },
  maxBytes?: number,
): Promise<{ status: number; text: string }> {
  const res = await openBoxRequest(url, options);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (maxBytes !== undefined && size > maxBytes) {
      res.destroy();
      throw new Error("answer too large");
    }
    chunks.push(chunk);
  }
  return { status: Number(res.statusCode), text: Buffer.concat(chunks).toString("utf8") };
}

// A refusal is one short JSON error; anything far larger is not one.
const MAX_REFUSAL_BYTES = 64 * 1024;

// Long, because the sender digests the whole file before it sends the first byte, and silent only:
// a copy of any size may take as long as it needs while its bytes keep coming.
const DOWNLOAD_SILENCE_LIMIT_MS = 5 * 60_000;

async function refusalText(res: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_REFUSAL_BYTES) throw new Error("answer too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One POST to a box whose 200 answer is a file: written to `<destinationPath>.partial` as it
 * arrives, and moved to `destinationPath` only once all of it came. Any other status touches no
 * file and comes back with its text; a text over 64 KiB or cut short throws. The destination's folder
 * must exist. A connection that carries no byte for `silenceLimitMs` is a failure.
 *
 * The file is flushed to disk before the move and the folder after it. A failed folder flush is
 * thrown with the file already at its final name.
 *
 * A declared length is required because Node reports a body with no length and no chunking as
 * ended whenever the connection closes; with a length it fails a shorter body, so a read that
 * finishes has the whole file (the "connection lost" and "no length" cases in
 * `mirror-bundle-fetch.test.ts`).
 */
export async function boxDownload(
  url: URL,
  options: {
    trust: BoxTrust;
    signal: AbortSignal;
    body: string;
    silenceLimitMs?: number;
    lookup?: BoxLookup;
  },
  destinationPath: string,
): Promise<{ status: number; text: string }> {
  const res = await openBoxRequest(url, {
    method: "POST",
    trust: options.trust,
    signal: options.signal,
    body: options.body,
    silenceLimitMs: options.silenceLimitMs ?? DOWNLOAD_SILENCE_LIMIT_MS,
    lookup: options.lookup,
  });
  const status = Number(res.statusCode);
  if (status !== 200) return { status, text: await refusalText(res) };
  if (res.headers["content-length"] === undefined) {
    res.destroy();
    throw new Error("answer names no length");
  }
  const partialPath = `${destinationPath}.partial`;
  try {
    // A leftover's permissions would survive: `open` applies the mode only when it creates the file.
    await rm(partialPath, { force: true });
    // 0600 because this is the whole venue database.
    const partial = await open(partialPath, "w", 0o600);
    try {
      await partial.writeFile(res);
      await partial.sync();
    } finally {
      await partial.close();
    }
    await rename(partialPath, destinationPath);
  } catch (error) {
    // Until the signal fires, nothing else closes an answer whose file could not be started.
    res.destroy();
    // The write's own failure is the one to report, not a failed tidy-up after it.
    await rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
  await reachDisk(dirname(destinationPath));
  return { status, text: "" };
}

/**
 * The main box's authority certificate, read before anything secret is sent so the person can
 * compare its fingerprint with the one the main box shows. `null` for a plain-http address, which
 * only a loopback host may use and which carries no certificate to compare.
 */
export async function fetchPrimaryCertificate(
  primaryUrl: string,
  { timeoutMs = CERTIFICATE_READ_LIMIT_MS, lookup }: RequestLimit & { lookup?: BoxLookup } = {},
): Promise<{ pem: string; fingerprint256: string } | null> {
  const base = assertSafePrimaryUrl(primaryUrl);
  if (base.protocol === "http:") return null;
  // A main box's address is its origin: a typed path, query or fragment is not sent to it.
  const url = new URL("/ca.crt", base.origin);

  let answer: { status: number; text: string };
  try {
    // It skips the certificate check: it carries no credential, body or cookie, and what it returns
    // is public, and is trusted only once the person confirms it.
    answer = await withinLimit(timeoutMs, (signal) =>
      boxExchange(
        url,
        { method: "GET", trust: { rejectUnauthorized: false }, signal, lookup },
        MAX_CERTIFICATE_BYTES,
      ),
    );
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  if (answer.status !== 200) throw new AppError("mirror.bundle_fetch_failed", {});
  const certificate = authorityCertificate(answer.text);
  if (certificate === null) throw new AppError("mirror.bundle_fetch_failed", {});
  return { pem: certificate.toString(), fingerprint256: certificate.fingerprint256 };
}

/** One PEM certificate that is an authority, or `null`. */
function authorityCertificate(pem: string): X509Certificate | null {
  if (pem.match(/-----BEGIN CERTIFICATE-----/g)?.length !== 1) return null;
  try {
    const certificate = new X509Certificate(pem);
    return certificate.ca ? certificate : null;
  } catch {
    return null;
  }
}

function sameAuthority(bundleCaPem: string, confirmedCaPem: string): boolean {
  try {
    return (
      new X509Certificate(bundleCaPem).fingerprint256 ===
      new X509Certificate(confirmedCaPem).fingerprint256
    );
  } catch {
    return false;
  }
}

/**
 * Only the PUBLIC half of the standby's key travels; the private key never leaves the mirror.
 * `standby.storeUrl` is where the spare's store listens; the main box refuses one whose host is not
 * `standby.contactUrl`'s.
 *
 * A network error, a non-2xx response `refusalFrom` does not relay, unparseable JSON, or a
 * malformed bundle is `mirror.bundle_fetch_failed`; no refusal carries upstream detail that could
 * include a URL or connection information.
 */
export async function fetchMirrorBundle(
  primaryUrl: string,
  credential: AdoptCredential,
  standby: { nodeId: string; publicKey: string; contactUrl: string; storeUrl: string; at: number },
  confirmedCaPem?: string,
  { timeoutMs = BUNDLE_REQUEST_LIMIT_MS }: RequestLimit = {},
): Promise<MirrorBundle> {
  // Re-checked here so no caller can make this fetch an unvalidated URL; the request is built from
  // the parsed `URL`, not the raw string.
  const base = assertSafePrimaryUrl(primaryUrl);
  const url = new URL("/management-api/mirror-bundle", base.origin).href;
  // Plain http is allowed only to a loopback host, which only this machine can answer, so it needs
  // no confirmation. Every https request, `localhost` included, is sent only to the one authority
  // certificate the person confirmed, and is refused before any connection when there is none.
  const https = base.protocol === "https:";
  if (https && (confirmedCaPem === undefined || authorityCertificate(confirmedCaPem) === null)) {
    throw new AppError("mirror.primary_unconfirmed", {});
  }
  const body = JSON.stringify({
    ...credential,
    standbyNodeId: standby.nodeId,
    standbyPublicKey: standby.publicKey,
    standbyContactUrl: standby.contactUrl,
    standbyStoreUrl: standby.storeUrl,
    standbyAt: standby.at,
  });

  let response: Response;
  try {
    const answer = await withinLimit(timeoutMs, async (signal) => {
      if (https) {
        // `ca` is the confirmed AUTHORITY: trusting the box's own leaf instead would refuse it.
        // `rejectUnauthorized` is explicit so NODE_TLS_REJECT_UNAUTHORIZED=0 cannot switch it off.
        return boxExchange(new URL(url), {
          method: "POST",
          trust: { ca: confirmedCaPem, rejectUnauthorized: true },
          signal,
          body,
        });
      }
      const plain = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal,
        // A redirect would resend the password to an address `assertSafePrimaryUrl` never saw.
        redirect: "error",
      });
      return { status: plain.status, text: await plain.text() };
    });
    response = new Response(answer.text, { status: answer.status });
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }

  if (!response.ok) throw await refusalFrom(response);

  let bundle: unknown;
  try {
    bundle = await response.json();
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  if (!isMirrorBundle(bundle)) throw new AppError("mirror.bundle_fetch_failed", {});
  // The box that answered is under the confirmed authority; the bundle it sent must name that
  // authority too, or the spare would go on to trust a different one.
  if (confirmedCaPem !== undefined && !sameAuthority(bundle.boxCaPem, confirmedCaPem)) {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  return bundle;
}
