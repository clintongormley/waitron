import {
  activateFirstFiscal,
  finishFirstFiscalSetup,
  checkedFirstFiscalCommit,
  firstFiscalPayload,
  firstFiscalProvisionRequest,
} from "./first-fiscal-activation.js";
import type { SetupDeps } from "./setup-api.js";
import { parseEmailSettings } from "./email-settings-api.js";
import { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { Context, Hono } from "hono";
import { isDeepStrictEqual } from "node:util";
import { TLSSocket } from "node:tls";
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
    "password.throttled": 429,
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
export async function readFirstFiscalBody(c: Context, limit = 131072): Promise<unknown> {
  const reader = c.req.raw.body?.getReader();
  if (reader === undefined) invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
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
  for (const path of ["/setup-api/provision", "/setup-api/fiscal-test", "/setup-api/email-test"])
    app.post(path, (c, next) => {
      if (c.req.header("X-Waitron-Setup-Owner") === undefined) return next();
      return boundary(c, log, async () => {
        assertFirstFiscalRequest(c);
        const body = object(await readFirstFiscalBody(c)),
          owner = firstFiscalOwner(c);
        return host.coordinator.run(async (hold) => {
          if (path.endsWith("email-test")) {
            const state = await host.owner.authorize(owner);
            host.assertSelection(state);
            if (Object.keys(body).length !== 1 || !("email" in body)) invalid();
            const settings = parseEmailSettings(object(body.email));
            const send = deps.sendEmailTest ?? sendSmtpTestMessage;
            return c.json(await send(settings, state.frozen.request.admin.email));
          }
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
  for (const action of ["node-key", "document", "document-kept"] as const)
    app.post(`${root}/${action}`, (c) =>
      boundary(c, log, () =>
        host.coordinator.run(async (hold) => {
          const owner = firstFiscalOwner(c);
          const state = await host.owner.authorize(owner);
          host.assertSelection(state);
          const body = object(
            await readFirstFiscalBody(c, action === "document" ? 8 * 1024 * 1024 : 131072),
          );
          if (action === "node-key") {
            exact(body, ["reconfirmation"]);
            const { stage, key } = await host.keys.stageInitialNodeKey(
              owner,
              text(body.reconfirmation),
              hold,
            );
            return c.json({
              stage: { stageId: stage.stageId, nodeId: stage.nodeId, name: stage.name },
              key,
            });
          }
          const fields = ["module", "stageId", "inputDigest", "historyDigest", "documentDigest"];
          if (action === "document") {
            exact(body, [...fields, "statement"]);
            await host.delivery.registerFirstFiscalDelivery(
              owner,
              body as unknown as import("./first-fiscal-delivery.js").FirstFiscalDeliveryInput,
              hold,
            );
          } else {
            exact(body, [...fields, "kept", "reconfirmation"]);
            const { reconfirmation, ...input } = body;
            await host.delivery.confirmFirstFiscalDocumentKept(
              owner,
              input as unknown as import("./first-fiscal-delivery.js").FirstFiscalKeptInput,
              text(reconfirmation),
              hold,
            );
          }
          return c.json({ accepted: true });
        }),
      ),
    );
  app.post(`${root}/offerings`, (c) =>
    boundary(c, log, async () => {
      const body = exact(await readFirstFiscalBody(c), ["fiscalTerritory"]);
      return c.json({ modules: host.offerings(text(body.fiscalTerritory)) });
    }),
  );
  app.post(`${root}/claim`, (c) =>
    boundary(c, log, async () => {
      const body = exact(
        await readFirstFiscalBody(c),
        ["clientClaimNonce", "venue"],
        ["configurationImport", "newTaxpayer"],
      );
      if (
        (body.configurationImport !== undefined && typeof body.configurationImport !== "boolean") ||
        (body.newTaxpayer !== undefined && typeof body.newTaxpayer !== "boolean") ||
        (body.newTaxpayer === true && body.configurationImport !== true)
      )
        invalid();
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
          {
            environment,
            request: { ...venue, admin: { ...normalized, password, pin } },
            configurationImport: body.configurationImport === true,
            newTaxpayer: body.newTaxpayer === true,
          },
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
  mountFirstSetupResolutionApi(app, host, log);
  app.post(`${root}/recover`, (c) =>
    boundary(c, log, async () => {
      const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
      if (!(socket instanceof TLSSocket) || !socket.encrypted)
        throw new AppError("setup.owner_required", {});
      const body = exact(await readFirstFiscalBody(c), ["clientClaimNonce", "password"]);
      const recovered = await host.owner.recoverFirstSetup(text(body.clientClaimNonce), {
        password: text(body.password),
      });
      host.evidence.invalidate(recovered.state.attemptId);
      return c.json(recovered);
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
            await host.assertFreshAssignment(
              {
                ...state,
                frozen: {
                  ...state.frozen,
                  modules: state.frozen.modules.map((entry) =>
                    entry.module === module ? { ...entry, request } : entry,
                  ),
                },
              },
              module,
            );
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
            await host.assertFreshAssignment(state, module, imported.input);
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

export function mountFirstSetupResolutionApi(
  app: Hono,
  host: FirstFiscalHost,
  log: Logger,
  options: {
    startAgain?: ReturnType<
      typeof import("./first-setup-resolution.js").createFirstSetupResolutionActions
    >["startAgainFirstSetup"];
    requestRestart?: () => void;
    withPublication?: <T>(body: (deps: SetupDeps) => Promise<T>) => Promise<T>;
    selection?: Pick<
      ReturnType<typeof import("./first-setup-resolution.js").createFirstSetupResolutionActions>,
      "inspectWorkspaceSelection" | "resumeWorkspaceSelection"
    >;
  } = {},
) {
  const root = "/setup-api/first-setup";
  for (const path of [`${root}/resolution`, `${root}/resolution/*`])
    app.use(path, (c, next) => {
      c.header("Cache-Control", "no-store");
      return next();
    });
  app.get(`${root}/resolution`, (c) =>
    boundary(c, log, async () => {
      assertFirstFiscalRequest(c);
      return c.json(await host.resolution.inspectFirstSetupResolution());
    }),
  );
  if (options.selection !== undefined) {
    const selection = options.selection;
    app.get(`${root}/resolution/selection`, (c) =>
      boundary(c, log, async () => {
        assertFirstFiscalRequest(c);
        return c.json(await selection.inspectWorkspaceSelection());
      }),
    );
    app.post(`${root}/resolution/resume-selection`, (c) =>
      boundary(c, log, async () => {
        assertFirstFiscalRequest(c);
        const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
        if (!(socket instanceof TLSSocket) || !socket.encrypted)
          throw new AppError("setup.owner_required", {});
        const body = exact(await readFirstFiscalBody(c), [
          "inspectionId",
          "revision",
          "ownerGeneration",
          "workspaceId",
          "selectionGeneration",
          "password",
        ]);
        if (
          ![body.revision, body.ownerGeneration, body.selectionGeneration].every(
            (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
          )
        )
          invalid();
        const selected = await selection.resumeWorkspaceSelection({
          inspectionId: text(body.inspectionId),
          revision: body.revision as number,
          ownerGeneration: body.ownerGeneration as number,
          workspaceId: text(body.workspaceId),
          selectionGeneration: body.selectionGeneration as number,
          password: text(body.password),
        });
        setTimeout(() => options.requestRestart?.(), 0);
        return c.json({
          workspaceId: selected.workspaceId,
          selectionGeneration: selected.selectionGeneration,
          restarting: true,
        });
      }),
    );
  }
  app.post(`${root}/resolution/recover`, (c) =>
    boundary(c, log, async () => {
      assertFirstFiscalRequest(c);
      const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
      if (!(socket instanceof TLSSocket) || !socket.encrypted)
        throw new AppError("setup.owner_required", {});
      const body = exact(await readFirstFiscalBody(c), [
        "inspectionId",
        "revision",
        "ownerGeneration",
        "clientClaimNonce",
        "password",
      ]);
      if (
        ![body.revision, body.ownerGeneration].every(
          (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
        )
      )
        invalid();
      return c.json(
        await host.owner.recoverFirstSetupOwner({
          inspectionId: text(body.inspectionId),
          revision: body.revision as number,
          ownerGeneration: body.ownerGeneration as number,
          clientClaimNonce: text(body.clientClaimNonce),
          password: text(body.password),
        }),
      );
    }),
  );

  if (options.withPublication !== undefined) {
    app.get(`${root}/resolution/publication`, (c) =>
      boundary(c, log, async () => {
        assertFirstFiscalRequest(c);
        const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
        if (!(socket instanceof TLSSocket) || !socket.encrypted)
          throw new AppError("setup.owner_required", {});
        const owner = firstFiscalOwner(c);
        return host.resolution.withVenueExclusion(() =>
          host.coordinator.run(async (hold) => {
            const state = await host.owner.authorize(owner);
            host.assertSelection(state);
            if (!["activation-started", "committed", "publication"].includes(state.status))
              throw new AppError("setup.attempt_uncertain", {});
            const stage = await host.keys.readStage(owner, hold);
            return c.json({
              state: publicFirstSetupState(state),
              stage: { stageId: stage.stageId, nodeId: stage.nodeId, name: stage.name },
              modules: state.frozen.modules
                .filter((m) => initialSetupFor(host.modules, m.module) !== undefined)
                .map((m) => ({
                  module: m.module,
                  request: m.request,
                  input: state.inputs[m.module],
                })),
            });
          }),
        );
      }),
    );
    for (const action of ["reconfirm", "document", "document-kept", "finish"] as const)
      app.post(`${root}/resolution/${action}`, (c) =>
        boundary(c, log, async () => {
          assertFirstFiscalRequest(c);
          const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming
            ?.socket;
          if (!(socket instanceof TLSSocket) || !socket.encrypted)
            throw new AppError("setup.owner_required", {});
          const owner = firstFiscalOwner(c);
          const body = object(
            await readFirstFiscalBody(c, action === "document" ? 8 * 1024 * 1024 : 131072),
          );
          // Password derivation must finish before taking either the venue or coordinator lock.
          if (action === "reconfirm") {
            exact(body, ["password", "purpose"]);
            if (body.purpose !== "activation") invalid();
            const state = await host.owner.authorize(owner);
            if (!["activation-started", "committed", "publication"].includes(state.status))
              throw new AppError("setup.attempt_uncertain", {});
            return c.json({
              reconfirmation: await host.owner.reconfirm(owner, text(body.password), "activation"),
            });
          }
          return host.resolution.withVenueExclusion(() =>
            host.coordinator.run(async (hold) => {
              const state = await host.owner.authorize(owner);
              host.assertSelection(state);
              if (!["activation-started", "committed", "publication"].includes(state.status))
                throw new AppError("setup.attempt_uncertain", {});
              if (action !== "finish") {
                const fields = [
                  "module",
                  "stageId",
                  "inputDigest",
                  "historyDigest",
                  "documentDigest",
                ];
                if (action === "document") {
                  exact(body, [...fields, "statement"]);
                  if (object(body.statement).priorActivation !== "committed")
                    throw new AppError("sif.allocation_invalid", {
                      reason: "outside_confirmation_missing",
                    });
                  await host.delivery.registerFirstFiscalDelivery(
                    owner,
                    body as unknown as import("./first-fiscal-delivery.js").FirstFiscalDeliveryInput,
                    hold,
                  );
                } else {
                  exact(body, [...fields, "kept", "reconfirmation"]);
                  const { reconfirmation, ...input } = body;
                  await host.delivery.confirmFirstFiscalDocumentKept(
                    owner,
                    input as unknown as import("./first-fiscal-delivery.js").FirstFiscalKeptInput,
                    text(reconfirmation),
                    hold,
                  );
                }
                return c.json({ accepted: true });
              }
              exact(body, ["inspectionId", "revision", "ownerGeneration", "publication"]);
              const inspected = await host.resolution.inspectFirstSetupResolution();
              if (
                body.inspectionId !== inspected.inspectionId ||
                body.revision !== state.revision ||
                body.ownerGeneration !== state.ownerGeneration
              )
                throw new AppError("setup.attempt_conflict", {});
              const publication = object(body.publication);
              await options.withPublication!((deps) =>
                finishFirstFiscalSetup(host, deps, owner, publication, hold),
              );
              setTimeout(() => options.requestRestart?.(), 0);
              return c.json({ provisioned: true, restarting: true });
            }),
          );
        }),
      );
  }

  if (options.startAgain !== undefined)
    app.post(`${root}/resolution/start-again`, (c) =>
      boundary(c, log, async () => {
        assertFirstFiscalRequest(c);
        const socket = (c.env as { incoming?: { socket?: unknown } } | undefined)?.incoming?.socket;
        if (!(socket instanceof TLSSocket) || !socket.encrypted)
          throw new AppError("setup.owner_required", {});
        const body = exact(await readFirstFiscalBody(c), [
          "inspectionId",
          "revision",
          "ownerGeneration",
          "register",
        ]);
        if (
          ![body.revision, body.ownerGeneration].every(
            (value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
          )
        )
          invalid();
        const raw = object(body.register);
        let register: import("@waitron/provisioning").RegisterAnswer;
        if (raw.kind === "no-current-master") {
          exact(raw, ["kind", "confirmed"]);
          if (raw.confirmed !== true) invalid();
          register = { kind: "no-current-master", confirmed: true };
        } else {
          exact(raw, ["kind", "status", "custodian", "reference", "consultedAt"]);
          if (
            raw.kind !== "current-master" ||
            typeof raw.status !== "string" ||
            !["Consumed", "Not consumed", "Unknown"].includes(raw.status)
          )
            invalid();
          register = {
            kind: "current-master",
            status: raw.status as "Consumed" | "Not consumed" | "Unknown",
            custodian: text(raw.custodian),
            reference: text(raw.reference),
            consultedAt: text(raw.consultedAt),
          };
        }
        const selected = await options.startAgain!({
          inspectionId: text(body.inspectionId),
          revision: body.revision as number,
          ownerGeneration: body.ownerGeneration as number,
          register,
          ...(c.req.header("X-Waitron-Setup-Owner") === undefined
            ? {}
            : { owner: firstFiscalOwner(c) }),
        });
        setTimeout(() => options.requestRestart?.(), 0);
        return c.json({
          workspaceId: selected.workspaceId,
          selectionGeneration: selected.selectionGeneration,
          restarting: true,
        });
      }),
    );
}
