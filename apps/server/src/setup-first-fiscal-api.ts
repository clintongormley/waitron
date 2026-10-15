import {
  activateFirstFiscal,
  checkedFirstFiscalCommit,
  firstFiscalPayload,
  firstFiscalProvisionRequest,
} from "./first-fiscal-activation.js";
import type { SetupDeps } from "./setup-api.js";
import type { Context, Hono } from "hono";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { initialSetupFor } from "@waitron/module";
import type { VenueRequest } from "@waitron/provisioning";
import { createErrorBoundary } from "@waitron/server-kit";
import type { createFirstSetupModuleHost } from "./module-operation-host.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { publicFirstSetupState, type FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export type FirstFiscalHost = ReturnType<typeof createFirstSetupModuleHost>;
const boundary = createErrorBoundary(
  {
    "setup.not_ready": 503,
    "setup.owner_required": 403,
    "setup.attempt_conflict": 409,
    "setup.attempt_invalid": 409,
    "setup.attempt_uncertain": 409,
  },
  "setup.provision_failed",
);
function invalid(): never {
  throw new AppError("setup.request_invalid", { field: "body" });
}
function assertFirstFiscalRequest(c: Context): void {
  const origin = c.req.header("Origin"),
    site = c.req.header("Sec-Fetch-Site");
  if (
    (origin !== undefined && origin !== new URL(c.req.url).origin) ||
    (site !== undefined && !["same-origin", "none"].includes(site))
  )
    throw new AppError("setup.owner_required", {});
  if (
    c.req.method === "POST" &&
    c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    invalid();
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(
  value: unknown,
  fields: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const body = object(value);
  if (
    Object.keys(body).some((key) => ![...fields, ...optional].includes(key)) ||
    fields.some((key) => !Object.hasOwn(body, key))
  )
    invalid();
  return body;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > 65536) invalid();
  return value;
}
export function firstFiscalOwner(c: Context): FirstSetupOwnerAttempt {
  const integer = (name: string) => {
    const raw = c.req.header(name);
    if (raw === undefined || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new AppError("setup.owner_required", {});
    return Number(raw);
  };
  return {
    capability: c.req.header("X-Waitron-Setup-Owner") ?? "",
    attemptId: c.req.header("X-Waitron-Setup-Attempt") ?? "",
    revision: integer("X-Waitron-Setup-Revision"),
    ownerGeneration: integer("X-Waitron-Setup-Generation"),
  };
}
export async function readFirstFiscalBody(c: Context): Promise<unknown> {
  const reader = c.req.raw.body?.getReader();
  if (reader === undefined) invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 131072) {
        await reader.cancel();
        invalid();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    invalid();
  }
}
function boundedPublic(value: unknown, depth = 0): void {
  if (depth > 30) invalid();
  if (typeof value === "string") {
    if (
      Buffer.byteLength(value) > 65536 ||
      /-----BEGIN (?:.*PRIVATE KEY|ENCRYPTED)|SECRET \/ SECRETO/.test(value)
    )
      invalid();
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const item of value) boundedPublic(item, depth + 1);
    return;
  }
  const record = object(value);
  for (const [key, item] of Object.entries(record)) {
    if (
      /password|private|pkcs8|secret|credential|recoveryKey|recoveryPack|encrypted|path|validated|capability|passphrase/i.test(
        key,
      )
    )
      invalid();
    boundedPublic(item, depth + 1);
  }
}
export function mountSetupFirstFiscalApi(
  app: Hono,
  host: FirstFiscalHost,
  log: Logger,
  parseVenue: (value: unknown, language: string | undefined) => VenueRequest,
  environment: "production" | "preproduction",
  deps: SetupDeps,
) {
  const root = "/setup-api/first-setup";
  app.use(`${root}/*`, (c, next) =>
    boundary(c, log, async () => {
      assertFirstFiscalRequest(c);
      await next();
      return c.res;
    }),
  );
  for (const path of ["/setup-api/provision", "/setup-api/fiscal-test"])
    app.post(path, (c, next) => {
      if (c.req.header("X-Waitron-Setup-Owner") === undefined) return next();
      return boundary(c, log, async () => {
        assertFirstFiscalRequest(c);
        const body = object(await readFirstFiscalBody(c)),
          owner = firstFiscalOwner(c);
        return host.coordinator.run(async (hold) => {
          if (path.endsWith("fiscal-test")) {
            const state = await host.owner.authorize(owner);
            host.assertSelection(state);
            const payload = firstFiscalPayload(host, state, body);
            if (deps.runFiscalTest === undefined) throw new AppError("setup.not_ready", {});
            return c.json(
              await deps.runFiscalTest({
                request: firstFiscalProvisionRequest(state),
                contribution: payload.contribution,
                secret: body.aeatCert,
              }),
            );
          }
          const result = await activateFirstFiscal(host, deps, owner, body, hold);
          let openingHours: { departmentId: string } | undefined;
          try {
            openingHours = await deps.readOpeningHours?.(result);
          } catch {
            log("warn", "setup.opening_hours_read_failed", {});
          }
          setTimeout(() => deps.requestRestart?.(), 0);
          return c.json({
            provisioned: true,
            restarting: true,
            ...(openingHours === undefined ? {} : { openingHours }),
          });
        });
      });
    });
  app.post(`${root}/claim`, (c) =>
    boundary(c, log, async () => {
      const body = exact(await readFirstFiscalBody(c), ["clientClaimNonce", "venue"]);
      const raw = exact(body.venue, [
        "country",
        "taxId",
        "legalName",
        "taxpayerDomicile",
        "location",
        "seriesCode",
        "fullSeriesCode",
        "rectificativeSeriesCode",
        "admin",
      ]);
      exact(raw.location, [
        "name",
        "fiscalTerritory",
        "invoiceLocales",
        "operationDescription",
        "addressLine1",
        "addressLine2",
        "postalCode",
        "city",
        "province",
        "timeZone",
        "dayCutover",
      ]);
      const admin = exact(
        raw.admin,
        ["displayName", "email", "password", "pin"],
        ["firstNames", "lastNames"],
      );
      for (const [key, value] of [
        ...Object.entries(raw),
        ...Object.entries(object(raw.location)),
        ...Object.entries(admin),
      ]) {
        if (
          typeof value === "string" &&
          !["password", "pin"].includes(key) &&
          Buffer.byteLength(value) > 256
        )
          invalid();
      }
      const password = text(admin.password),
        pin = text(admin.pin);
      if (Buffer.byteLength(password) > 1024 || Buffer.byteLength(pin) > 1024) invalid();
      const venue = parseVenue(raw, c.req.header("Accept-Language"));
      if (!venue.taxpayerDomicile?.trim()) invalid();
      const { pinHash: _, passwordHash: __, ...normalized } = venue.admin;
      void _;
      void __;
      return c.json(
        await host.owner.claimFirstSetup(
          { environment, request: { ...venue, admin: { ...normalized, password, pin } } },
          text(body.clientClaimNonce),
        ),
      );
    }),
  );
  app.post(`${root}/resume`, (c) =>
    boundary(c, log, async () => {
      const body = exact(await readFirstFiscalBody(c), ["clientClaimNonce", "password"]);
      return c.json(
        await host.owner.resumeFirstSetup(text(body.clientClaimNonce), {
          password: text(body.password),
        }),
      );
    }),
  );
  app.get(`${root}/status`, (c) =>
    boundary(c, log, async () => {
      if (c.req.header("X-Waitron-Setup-Owner") === undefined) {
        try {
          return c.json({ claimed: (await host.store.readResumable()) !== null });
        } catch {
          return c.json({ claimed: true, conflict: true });
        }
      }
      const state = await host.owner.status(firstFiscalOwner(c));
      return c.json({ claimed: true, state: publicFirstSetupState(state) });
    }),
  );
  app.post(`${root}/reconfirm`, (c) =>
    boundary(c, log, async () => {
      const body = exact(await readFirstFiscalBody(c), ["password", "purpose"]);
      if (body.purpose !== "block-use" && body.purpose !== "activation") invalid();
      return c.json({
        reconfirmation: await host.owner.reconfirm(
          firstFiscalOwner(c),
          text(body.password),
          body.purpose,
        ),
      });
    }),
  );
  for (const action of ["candidates", "input", "enrol", "current-master", "abandon"] as const)
    app.post(`${root}/${action}`, (c) =>
      boundary(c, log, async () => {
        const body = object(await readFirstFiscalBody(c));
        const owner = firstFiscalOwner(c);
        return host.coordinator.run(async (hold) => {
          let state = await host.owner.authorize(owner);
          if (action !== "abandon") host.assertSelection(state);
          const selected = (name: unknown) => {
            const module = text(name);
            const entry = state.frozen.modules.find((m) => m.module === module);
            const installed = host.modules.find((m) => m.name === module);
            const seat = initialSetupFor(host.modules, module);
            if (!entry || entry.version !== installed?.version || seat === undefined) invalid();
            return { module, seat, context: firstSetupModuleContext(state, module) };
          };
          if (action === "candidates") {
            exact(body, ["module", "proposal", "reconfirmation"]);
            if (state.status !== "claimed") throw new AppError("setup.attempt_conflict", {});
            const { module, seat, context } = selected(body.module);
            boundedPublic(body.proposal);
            const request = seat.request(context, seat.candidates(context, body.proposal));
            await host.owner.consumeReconfirmation(
              owner,
              text(body.reconfirmation),
              "block-use",
              hold,
            );
            state = await host.store.update(
              owner.attemptId,
              state.revision,
              { kind: "candidates", module, request },
              hold,
            );
            if (
              state.frozen.modules.every(
                (m) => initialSetupFor(host.modules, m.module) === undefined || m.request !== null,
              )
            )
              state = await host.store.update(
                owner.attemptId,
                state.revision,
                { kind: "consumption-intent" },
                hold,
              );
          } else if (action === "input") {
            exact(body, ["module", "input"]);
            boundedPublic(body.input);
            const { module, seat, context } = selected(body.module);
            if (Buffer.byteLength(JSON.stringify(body.input)) > 65536) invalid();
            const imported = seat.inspect(context, body.input);
            if (Object.hasOwn(state.inputs, module)) {
              if (!isDeepStrictEqual(state.inputs[module], imported.input))
                throw new AppError("setup.attempt_conflict", {});
            } else
              state = await host.store.update(
                owner.attemptId,
                state.revision,
                { kind: "import", module, input: imported.input },
                hold,
              );
          } else if (action === "enrol") {
            exact(body, ["module", "publicKey", "comparison"]);
            boundedPublic(body.publicKey);
            boundedPublic(body.comparison);
            const { module } = selected(body.module);
            if (Buffer.byteLength(JSON.stringify(body.publicKey)) > 65536) invalid();
            await host.evidence.enrol(owner, module, body.publicKey, body.comparison, hold);
          } else if (action === "current-master") {
            exact(body, ["module", "statement", "reconfirmation"]);
            boundedPublic(body.statement);
            const { module } = selected(body.module);
            if (Buffer.byteLength(JSON.stringify(body.statement)) > 65536) invalid();
            const prior = object(body.statement).priorActivation;
            const replay = ["activation-started", "committed", "publication"].includes(
              state.status,
            );
            if (prior !== (replay ? "committed" : "none"))
              throw new AppError("sif.allocation_invalid", {
                reason: "outside_confirmation_missing",
              });
            if (replay) {
              try {
                if ((await checkedFirstFiscalCommit(host, deps, state)) === null)
                  throw new AppError("setup.attempt_uncertain", {});
              } catch {
                state = await host.store.update(
                  owner.attemptId,
                  state.revision,
                  { kind: "uncertain" },
                  hold,
                );
                host.owner.invalidate(owner.attemptId);
                host.evidence.invalidate(owner.attemptId);
                throw new AppError("setup.attempt_uncertain", {});
              }
            }
            await host.evidence.confirm(
              owner,
              module,
              body.statement,
              text(body.reconfirmation),
              hold,
            );
          } else {
            exact(body, []);
            state = await host.store.update(
              owner.attemptId,
              state.revision,
              { kind: "abandoned" },
              hold,
            );
          }
          host.owner.invalidate(owner.attemptId);
          if (action !== "current-master") host.evidence.invalidate(owner.attemptId);
          return c.json({ state: publicFirstSetupState(state) });
        });
      }),
    );
  app.get(`${root}/request`, (c) =>
    boundary(c, log, () =>
      host.coordinator.run(async () => {
        const state = await host.owner.authorize(firstFiscalOwner(c));
        host.assertSelection(state);
        const modules = state.frozen.modules.filter(
          (m) => initialSetupFor(host.modules, m.module) !== undefined,
        );
        if (!state.consumptionIntent || modules.some((m) => m.request === null))
          throw new AppError("setup.attempt_conflict", {});
        return c.json({
          attemptId: state.frozen.attemptId,
          modules: modules.map((m) => ({ module: m.module, request: m.request })),
        });
      }),
    ),
  );
}
