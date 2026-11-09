import { isDeepStrictEqual } from "node:util";
import {
  withOperationAuthority,
  type InitialSetupContext,
  type InitialSetupContribution,
  type InitialSetupCommandActions,
  type ModuleOperationHost,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { encodeMinuteIdentity, isMinuteIdentity } from "./hour-identity.js";
import { hostedHourPreparation, hourSetupInput } from "./hour-preparation.js";
import { WAIT_BOUND_MS } from "./hour-selection.js";
import "./errors.js";
import { assertHourSeriesConfiguration } from "./hour-series-configuration.js";
import {
  parseRecoveryDocumentPublic,
  recoveryDocumentPublic,
  type RecoveryDocument,
} from "./recovery-document.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import { startAgainHoldings, startAgainKept } from "./start-again-holdings.js";

function refuse(reason = "event_mismatch"): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function contextBinding(context: InitialSetupContext) {
  if (
    context.country !== "ES" ||
    !/^[A-Z0-9]{9}$/.test(context.taxId) ||
    !context.administratorId.trim() ||
    context.binding.module !== "fiscal-verifactu" ||
    context.binding.action !== "setup" ||
    context.binding.sourceId !== `first-setup:${context.attemptId}` ||
    context.recipientVenueId !== context.binding.sourceId
  )
    refuse();
  assertHourSeriesConfiguration(context.bases);
}
export function readHourSetupInput(context: InitialSetupContext, input: unknown) {
  contextBinding(context);
  const request = context.request;
  if (
    !record(request) ||
    !exact(request, ["kind", "status", "identity", "input"]) ||
    request.kind !== "waitron-hour-setup" ||
    request.status !== "selected" ||
    !isMinuteIdentity(request.identity) ||
    !record(request.input) ||
    !record(request.input.allocation) ||
    typeof request.input.allocation.issuedAt !== "string"
  )
    refuse();
  const issuedAt = request.input.allocation.issuedAt;
  const instant = Date.parse(issuedAt);
  if (!Number.isSafeInteger(instant) || new Date(instant).toISOString() !== issuedAt) refuse();
  let identity: string;
  try {
    identity = encodeMinuteIdentity(instant);
  } catch {
    return refuse();
  }
  if (identity !== request.identity) refuse();
  const expected = hourSetupInput(
    {
      binding: context.binding,
      scope: { taxpayerNif: context.taxId, environment: context.environment },
      bases: [...context.bases].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
      identity,
      issuedAt,
    },
    context.administratorId,
  );
  if (!isDeepStrictEqual(expected, request.input) || !isDeepStrictEqual(input, expected)) refuse();
  return structuredClone(expected);
}

function clockStale(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === "sif.allocation_invalid" &&
    (error.params as { reason?: unknown }).reason === "clock_stale"
  );
}

async function reviewCommandClock(
  actions: InitialSetupCommandActions,
): Promise<{ status: "ready"; comparisonId: string } | { status: "cancelled" }> {
  const comparison = (await actions.prepare({
    action: "compare-clocks",
    browser: null,
  })) as Awaited<ReturnType<ReturnType<typeof hostedHourPreparation>["compareClocks"]>>;
  for (const sample of comparison.clock.usable)
    actions.output(
      `${sample.source}: ${new Date(sample.lowerMs).toISOString()} – ${new Date(sample.upperMs).toISOString()}`,
    );
  for (const sample of comparison.clock.unavailable)
    actions.output(`${sample.source}: unavailable`);
  if (!comparison.clock.secondClock || comparison.clock.disagreement) {
    actions.output("No series is made without a confirmed time, so none is ever repeated.");
    if (!comparison.clock.secondClock)
      actions.output(
        "Connect the box to the internet, or set up from a phone or laptop on the venue's network.",
      );
    return { status: "cancelled" };
  }
  return { status: "ready", comparisonId: comparison.id };
}

export function createHourInitialSetup(
  host: ModuleOperationHost,
  base: InitialSetupContribution,
): InitialSetupContribution {
  const candidates = new WeakSet<object>();
  return {
    ...base,
    configure: undefined,
    resolutionEvidence: () => ({ files: [], directories: [] }),
    async commandRecoveryDocument(context, imported, document) {
      readHourSetupInput(context, imported.input);
      if (document.key.nodeId !== context.binding.targetNodeId) refuse();
      const recovery: RecoveryDocument = {
        kind: "waitron-recovery-document",
        version: 1,
        scope: {
          taxpayerNif: context.taxId,
          softwareId: WAITRON_ID_SISTEMA,
          environment: context.environment,
        },
        taxpayerName: document.identity.taxpayerName,
        venueName: document.identity.venueName,
        createdAt: new Date().toISOString(),
        nodeKey: document.key,
      };
      const { loadRecoveryFont } = await import("./recovery-pdf-node.js");
      const { renderSetupRecoveryPack } = await import("./setup-recovery-pack.js");
      const bytes = await renderSetupRecoveryPack(
        recovery,
        document.locale,
        document.identity.timeZone,
        loadRecoveryFont,
      );
      return { bytes, statement: recoveryDocumentPublic(recovery) };
    },
    async commandBeforeActivation(context, actions) {
      readHourSetupInput(context, (context.request as { input: unknown })?.input);
      const reviewed = await reviewCommandClock(actions);
      if (reviewed.status !== "ready") return reviewed;
      return { status: "ready", input: (context.request as { input: unknown }).input };
    },
    async command(context, actions) {
      if (record(context.request) && context.request.status === "selected")
        return { status: "ready", input: readHourSetupInput(context, context.request.input) };
      for (let waited = false; ; waited = true) {
        // After a wait the earlier clock comparison is too old to select with, so take a new one.
        const reviewed = await reviewCommandClock(actions);
        if (reviewed.status !== "ready") return reviewed;
        const target = (targetMs: unknown) => {
          if (
            !Number.isSafeInteger(targetMs) ||
            Number.isNaN(new Date(targetMs as number).getTime()) ||
            (targetMs as number) - Date.now() > WAIT_BOUND_MS
          )
            return refuse();
          if (waited) {
            actions.output(
              "The time could not be confirmed after the wait (it ran over, or the clock moved back), so no invoice series was made.",
            );
            return refuse("clock_unconfirmed");
          }
          actions.output("Waiting to confirm the time, so no invoice series is ever repeated.");
          actions.output(
            `Waiting until ${new Date(targetMs as number).toISOString()}; it carries on by itself, so keep the command running.`,
          );
          return targetMs as number;
        };
        const preview = await actions.prepare({ action: "selection" });
        if (!record(preview)) return refuse();
        let targetMs: number | undefined;
        if (preview.status === "waiting") targetMs = target(preview.targetMs);
        else {
          if (!["selected", "preview"].includes(preview.status as string)) return refuse();
          let selected: unknown;
          try {
            selected = await actions.select({ comparisonId: reviewed.comparisonId });
          } catch (error) {
            // Only the first selection asks for the password, so only its reading can go stale
            // while a person types: take one fresh reading and select once more with it.
            if (waited || !clockStale(error)) throw error;
            const fresh = await reviewCommandClock(actions);
            if (fresh.status !== "ready") return fresh;
            try {
              selected = await actions.select({ comparisonId: fresh.comparisonId });
            } catch (retryError) {
              if (clockStale(retryError)) {
                actions.output(
                  "The time reading went out of date before a series could be chosen, even after a fresh one was taken (a reading is used for 30 seconds), so no invoice series was made.",
                );
                actions.output(
                  "Choose Start again on the box's setup page, then run the command again.",
                );
              }
              throw retryError;
            }
          }
          if (record(selected) && selected.status === "waiting")
            targetMs = target(selected.targetMs);
          else if (!record(selected) || selected.status !== "selected") return refuse();
          else return { status: "ready", input: selected.input };
        }
        // The wait stays usable for a minute past its target, so a second's margin absorbs any
        // difference between the timer and the wall clock.
        await actions.sleep(Math.max(0, targetMs - Date.now()) + 1000);
      }
    },
    async preparation(context, proposal, client) {
      contextBinding(context);
      if (!record(proposal)) return refuse("malformed_allocation");
      const session = hostedHourPreparation(host);
      if (proposal.action === "selection" && exact(proposal, ["action"]))
        return withOperationAuthority(context.binding, context.administratorId, (authority) =>
          session.preview({ binding: context.binding, authority }),
        );
      if (proposal.action === "clock-challenge" && exact(proposal, ["action"]))
        return session.clockChallenge(context.binding);
      if (proposal.action === "compare-clocks" && exact(proposal, ["action", "browser"])) {
        if (
          proposal.browser !== null &&
          (!record(proposal.browser) ||
            !exact(proposal.browser, ["challengeId", "instantMs"]) ||
            typeof proposal.browser.challengeId !== "string" ||
            !Number.isSafeInteger(proposal.browser.instantMs))
        )
          return refuse("malformed_allocation");
        return session.compareClocks(
          context.binding,
          proposal.browser as { challengeId: string; instantMs: number } | null,
          client,
        );
      }
      return refuse("malformed_allocation");
    },
    async candidates(context, proposal) {
      contextBinding(context);
      if (
        !record(proposal) ||
        !exact(proposal, ["comparisonId"]) ||
        typeof proposal.comparisonId !== "string"
      )
        return refuse("malformed_allocation");
      const result = await withOperationAuthority(
        context.binding,
        context.administratorId,
        (authority) =>
          hostedHourPreparation(host).select({
            binding: context.binding,
            authority,
            comparisonId: proposal.comparisonId as string,
          }),
      );
      const value =
        result.status === "selected"
          ? {
              kind: "waitron-hour-setup",
              status: result.status,
              identity: result.identity,
              input: result.input,
            }
          : result;
      candidates.add(value);
      return value;
    },
    request(context, value) {
      contextBinding(context);
      if (!record(value) || !candidates.has(value)) return refuse();
      candidates.delete(value);
      return structuredClone(value);
    },
    pending: (value) => record(value) && value.status === "waiting",
    inspect(context, input) {
      const checked = readHourSetupInput(context, input);
      return {
        input: checked,
        summary: {
          allocationId: checked.allocation.allocationId,
          installationIdentity: checked.allocation.installationIdentity,
          series: checked.allocation.series,
        },
      };
    },
    enrol() {
      return refuse("outside_confirmation_missing");
    },
    confirmation() {
      return refuse("outside_confirmation_missing");
    },
    documentConfirmation: undefined,
    recoveryDocument(context, imported, document) {
      readHourSetupInput(context, imported.input);
      let statement: ReturnType<typeof parseRecoveryDocumentPublic>;
      try {
        statement = parseRecoveryDocumentPublic(document.statement);
      } catch {
        return refuse("outside_confirmation_missing");
      }
      if (
        statement.scope.taxpayerNif !== context.taxId ||
        statement.scope.softwareId !== WAITRON_ID_SISTEMA ||
        statement.scope.environment !== context.environment ||
        statement.nodeKey.nodeId !== context.binding.targetNodeId ||
        statement.nodeKey.nodeId !== document.stage.nodeId ||
        statement.nodeKey.name !== document.stage.name ||
        statement.taxpayerName !== document.identity.taxpayerName ||
        statement.venueName !== document.identity.venueName
      )
        refuse("outside_confirmation_missing");
      return statement;
    },
    assignmentKeys(context, input) {
      if (context.request == null && input === undefined) return [];
      const allocation = readHourSetupInput(
        context,
        input ?? (context.request as { input: unknown }).input,
      ).allocation;
      return [
        JSON.stringify([
          context.taxId,
          context.environment,
          "hour",
          allocation.installationIdentity,
        ]),
      ];
    },
    assignmentPositions: undefined,
    startAgainHoldings,
    startAgainKept,
  };
}
