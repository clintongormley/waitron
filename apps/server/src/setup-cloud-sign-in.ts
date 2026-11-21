import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { codeOf, createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { readSetupAddressLookup } from "./cloud-address-lookup.js";
import type { CloudConnection } from "./cloud-client.js";
import { mountCloudSignInCallback } from "./cloud-sign-in-callback.js";
import { cloudSignInId, readCloudSignInReturn, type PreparedSetupAdmin } from "./cloud-sign-in.js";
import { isSecure } from "./encrypted-connection.js";
import { sentFromThisOrigin } from "./own-page.js";
import { isRemoteStaffRequest } from "./request-from-box.js";
import type { Logger } from "./logger.js";
import type { TradingConfig } from "./trading-config.js";
import "./errors.js";

const COOKIE = "__Host-waitron-setup-cloud";
const ROOT = "/setup-api/cloud/sign-in";

export interface SetupCloudSignIn {
  origin: string;
  connection: Pick<
    CloudConnection,
    | "setupSignInAvailable"
    | "startSignIn"
    | "returnSignIn"
    | "readSetupAdmin"
    | "clearSetupAdmin"
    | "publishSetupSignIn"
    | "setupAddressLookup"
  >;
}

function onSetupOrigin(c: Context, { origin }: SetupCloudSignIn): boolean {
  return !isRemoteStaffRequest(c) && isSecure(c) && new URL(c.req.url).origin === origin;
}

function sessionFrom(c: Context): string | undefined {
  const cookie = getCookie(c, COOKIE);
  return cookie && /^[\w-]{42}[AEIMQUYcgkosw048]$/.test(cookie) ? cookie : undefined;
}

export async function setupCloudSignInAvailable(c: Context, deps: SetupCloudSignIn, log: Logger) {
  if (!onSetupOrigin(c, deps)) return false;
  try {
    return await deps.connection.setupSignInAvailable();
  } catch (error) {
    log("warn", "cloud.refresh_failed", { errorCode: codeOf(error) });
    return false;
  }
}

export function mountSetupCloudSignIn(
  app: Hono,
  deps: SetupCloudSignIn,
  authorize: () => Promise<void>,
  prepareAdmin: (input: unknown, saved?: PreparedSetupAdmin) => PreparedSetupAdmin,
  log: Logger,
): void {
  const run = createErrorBoundary(
    {
      "setup.owner_required": 403,
      "setup.request_invalid": 400,
      "person.email_invalid": 400,
      "cloud.request_invalid": 400,
      "cloud.not_configured": 409,
      "cloud.binding_conflict": 409,
      "cloud.request_unavailable": 409,
      "cloud.busy": 409,
      "cloud.state_invalid": 409,
      "cloud.unavailable": 503,
      "setup.attempt_conflict": 409,
      "setup.attempt_uncertain": 409,
      "setup.already_provisioning": 409,
    },
    "cloud.failed",
  );
  app.use(
    `${ROOT}/*`,
    bodyLimit({
      maxSize: 16_384,
      onError: (c) => c.json({ error: { code: "cloud.request_invalid", params: {} } }, 400),
    }),
  );
  mountCloudSignInCallback(app, (c) => onSetupOrigin(c, deps), true);
  for (const action of ["start", "return", "address-lookup"] as const) {
    app.post(`${ROOT}/${action}`, (c) =>
      run(c, log, async () => {
        c.header("Cache-Control", "no-store");
        if (
          !onSetupOrigin(c, deps) ||
          c.req.header("Origin") !== deps.origin ||
          !sentFromThisOrigin(c)
        )
          throw new AppError("setup.owner_required", {});
        if (
          c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
        )
          throw new AppError("cloud.request_invalid", {});
        await authorize();
        const input = await readRawJsonBody<Record<string, unknown>>(c);
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          !cloudSignInId(input.tab)
        )
          throw new AppError("cloud.request_invalid", {});
        const session = sessionFrom(c);
        if (action === "address-lookup") {
          if (!session) throw new AppError("setup.owner_required", {});
          return c.json(
            await deps.connection.setupAddressLookup(
              { kind: "setup", tab: input.tab, session },
              readSetupAddressLookup(input),
              authorize,
              c.req.raw.signal,
            ),
          );
        }
        if (action === "return") {
          if (!session) throw new AppError("setup.owner_required", {});
          await deps.connection.returnSignIn(
            { kind: "setup", tab: input.tab, session },
            readCloudSignInReturn(input),
            authorize,
          );
          return c.body(null, 204);
        }
        if (
          input.prepare !== true ||
          Object.keys(input).some((key) => !["tab", "prepare", "admin"].includes(key))
        )
          throw new AppError("cloud.request_invalid", {});
        const token = session ?? randomBytes(32).toString("base64url");
        setCookie(c, COOKIE, token, {
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
          maxAge: 43_800,
        });
        return c.json(
          await deps.connection.startSignIn(
            { kind: "setup", tab: input.tab, session: token },
            authorize,
            (saved) => {
              if (input.admin !== undefined) return prepareAdmin(input.admin, saved);
              if (!saved) throw new AppError("cloud.request_unavailable", {});
              return saved;
            },
          ),
        );
      }),
    );
  }
}

export function setupCloudBinding(c: Context, deps: SetupCloudSignIn | undefined) {
  if (
    !deps ||
    !onSetupOrigin(c, deps) ||
    c.req.header("Origin") !== deps.origin ||
    !sentFromThisOrigin(c)
  )
    return;
  const tab = c.req.header("X-Waitron-Setup-Cloud-Tab");
  const session = sessionFrom(c);
  if (session && cloudSignInId(tab)) return { kind: "setup" as const, tab, session };
}

export async function recordSetupCloudPublication(
  c: Context,
  deps: SetupCloudSignIn | undefined,
  cfg: TradingConfig,
  log: Logger,
  staffEmail?: true,
): Promise<boolean | undefined> {
  if (!deps || cfg.environment !== "preproduction" || cfg.onboardingIntent === "demo") return;
  const binding = setupCloudBinding(c, deps);
  if (!binding) return;
  try {
    return await deps.connection.publishSetupSignIn(
      binding,
      cfg.nodeId,
      ...(staffEmail ? ([staffEmail] as const) : []),
    );
  } catch (error) {
    log("warn", "cloud.refresh_failed", { errorCode: codeOf(error) });
  }
}
