import { AsyncLocalStorage } from "node:async_hooks";
import { S3Client } from "@aws-sdk/client-s3";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";
import { planRefusal, type RequestPlan, type RequestSender } from "./aws-request-plan.js";

type Send = (this: object, command: unknown, optionsOrCb?: unknown, cb?: unknown) => unknown;

export interface RequestScopeOptions {
  plan: RequestPlan;
  mode: "enforce" | "record";
  /**
   * `{ s3Region }` refuses a request whose resolved host is not one of S3's own hosts for the plan's
   * bucket in that region; `"any"` is for a local endpoint.
   */
  hosts: "any" | { s3Region: string };
  onRefused?: (detail: string, api: string) => void;
}

export interface RequestScope {
  run<T>(body: () => T): T;
  /** Throws `AwsRehearsalRefused` when the request may not be sent; counts and reports the refusal first. */
  check(sender: RequestSender, api: string, input: Record<string, unknown>): void;
  /**
   * As `check`, for the input the SDK serialised the request from. A request let through at `send`
   * is not refused here for the run having ended since.
   */
  checkSerialised(sender: RequestSender, api: string, input: Record<string, unknown>): void;
  /** As `check`, for the hostname the SDK resolved; record mode lets every host through too. */
  checkHost(api: string, hostname: string): void;
  close(): void;
  refusals(): { count: number; first: string | undefined };
  seen(): { sender: RequestSender; api: string }[];
}

const SEND_PROTO = Object.getPrototypeOf(S3Client.prototype) as { send: Send };
const GATED = Symbol("waitron.sendGate");
const storage = new AsyncLocalStorage<RequestScope>();
const runnerClients = new WeakSet<object>();
const stackChecked = new WeakSet<object>();
let original: Send | undefined;
let strict = false;

export function markRunnerClient(client: object): void {
  runnerClients.add(client);
}

/** The scope the caller runs inside, if any. */
export function currentRequestScope(): RequestScope | undefined {
  return storage.getStore();
}

export function setSendGateStrict(on: boolean): void {
  strict = on;
}

/** The failure text for a run whose scope refused `count` requests, naming the first refusal. */
export function refusalsSummary(refusals: { count: number; first: string | undefined }): string {
  return `${refusals.count} unplanned request(s) refused before sending; the first: ${refusals.first}`;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The hosts the SDK builds for `bucket` in `region`: virtual-hosted or path-style, each with or
 * without FIPS and dual-stack. Measured 2026-10-14 on @aws-sdk/client-s3 3.1140.0, one client per
 * switch combination (the probe is described in the commit message).
 */
function s3HostPattern(bucket: string, region: string): RegExp {
  return new RegExp(
    `^(?:${escaped(bucket)}\\.)?s3(?:-fips)?(?:\\.dualstack)?\\.${escaped(region)}\\.amazonaws\\.com$`,
  );
}

export function openRequestScope(options: RequestScopeOptions): RequestScope {
  let closed = false;
  const s3Host =
    options.hosts === "any" || options.mode === "record"
      ? null
      : s3HostPattern(options.plan.bucket, options.hosts.s3Region);
  let count = 0;
  let first: string | undefined;
  const seen: { sender: RequestSender; api: string }[] = [];

  const refuse = (detail: string, api: string): never => {
    count += 1;
    first ??= detail;
    try {
      options.onRefused?.(detail, api);
    } catch {
      // The refusal, not the hook's error, is what the sender sees.
    }
    throw new AwsRehearsalRefused("request-unplanned", detail);
  };

  const scope: RequestScope = {
    run: (body) => storage.run(scope, body),
    check(sender, api, input) {
      if (closed) refuse(`${api} was sent after the run has ended`, api);
      if (!seen.some((pair) => pair.sender === sender && pair.api === api)) {
        seen.push({ sender, api });
      }
      scope.checkSerialised(sender, api, input);
    },
    checkSerialised(sender, api, input) {
      if (options.mode === "record") return;
      const detail = planRefusal(options.plan, sender, api, input);
      if (detail !== null) refuse(detail, api);
    },
    checkHost(api, hostname) {
      if (s3Host !== null && !s3Host.test(hostname)) {
        refuse(`${api} was sent to a host that is not this run's Amazon S3 host`, api);
      }
    },
    close: () => {
      closed = true;
    },
    refusals: () => ({ count, first }),
    seen: () => seen.map((pair) => ({ ...pair })),
  };
  return scope;
}

/** The S3 API a command, or a command's name, stands for. */
export function apiOf(command: unknown): string {
  const name =
    typeof command === "string"
      ? command
      : (command as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof name === "string" ? name.replace(/Command$/, "") : "an unnamed command";
}

type Handler = (args: {
  input?: Record<string, unknown>;
  request?: { hostname?: unknown };
}) => Promise<unknown>;
type Middleware = (next: Handler, context: { commandName?: unknown }) => Handler;

interface MiddlewareStack {
  add(
    middleware: Middleware,
    options: { step: "finalizeRequest"; priority: "low"; name: string },
  ): void;
  addRelativeTo(
    middleware: Middleware,
    options: { relation: "after"; toMiddleware: "serializerMiddleware"; name: string },
  ): void;
}

/**
 * `send` checks `command.input` before the SDK serialises it, asynchronously, so a change made
 * after `send`, by the caller or by a middleware, could go out unchecked. The plan is checked again
 * on the input the serialiser was handed, just after it built the request.
 *
 * `send` runs before the SDK resolves the endpoint, so the host is checked from the client's stack.
 * Measured 2026-10-14 on @aws-sdk/client-s3 3.1140.0 (the probe is described in the commit message):
 * at `initialize` there is no request yet; at `finalizeRequest`, priority low, the hostname equals
 * the one the request handler receives, for plain, FIPS, dual-stack and custom endpoints.
 */
function addStackChecks(client: object): void {
  const stack = (client as { middlewareStack?: MiddlewareStack }).middlewareStack;
  if (stack === undefined || stackChecked.has(client)) return;
  stackChecked.add(client);
  stack.addRelativeTo(
    (next, context) => async (args) => {
      storage
        .getStore()
        ?.checkSerialised(
          runnerClients.has(client) ? "runner" : "scenario",
          apiOf(context.commandName),
          args.input ?? {},
        );
      return next(args);
    },
    { relation: "after", toMiddleware: "serializerMiddleware", name: "waitronRehearsalPlanCheck" },
  );
  stack.add(
    (next, context) => async (args) => {
      const hostname = args.request?.hostname;
      storage
        .getStore()
        ?.checkHost(apiOf(context.commandName), typeof hostname === "string" ? hostname : "");
      return next(args);
    },
    { step: "finalizeRequest", priority: "low", name: "waitronRehearsalHostCheck" },
  );
  // With `cacheMiddleware: true`, @smithy/core 3.35.0's `Client.send` keeps each command's built
  // stack in `handlers`; one built before these checks were added would skip them.
  delete (client as { handlers?: unknown }).handlers;
}

function gatedSend(this: object, command: unknown, optionsOrCb?: unknown, cb?: unknown): unknown {
  const callback = typeof optionsOrCb === "function" ? optionsOrCb : cb;
  const api = apiOf(command);
  try {
    const scope = storage.getStore();
    if (scope !== undefined) {
      const input = (command as { input?: Record<string, unknown> }).input ?? {};
      scope.check(runnerClients.has(this) ? "runner" : "scenario", api, input);
      addStackChecks(this);
    } else if (strict) {
      throw new AwsRehearsalRefused("request-unplanned", `${api} was sent outside a rehearsal run`);
    }
  } catch (error) {
    if (typeof callback === "function") {
      (callback as (err: unknown) => void)(error);
      return undefined;
    }
    return Promise.reject(error);
  }
  return original!.call(this, command, optionsOrCb, cb);
}
Object.defineProperty(gatedSend, GATED, { value: true });

/** Wraps the SDK's shared `send` once per process; a second call does nothing. */
export function installSendGate(): void {
  if ((SEND_PROTO.send as unknown as Record<symbol, unknown>)[GATED] === true) return;
  original = SEND_PROTO.send;
  SEND_PROTO.send = gatedSend;
}

/** Test-only: puts the SDK's own `send` back, so the gate does not reach other suites in the process. */
export function uninstallSendGate(): void {
  if (original === undefined) return;
  SEND_PROTO.send = original;
  original = undefined;
  strict = false;
}
