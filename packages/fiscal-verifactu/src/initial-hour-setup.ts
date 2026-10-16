import { isDeepStrictEqual } from "node:util";
import {
  withOperationAuthority,
  type InitialSetupContext,
  type InitialSetupContribution,
  type ModuleOperationHost,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { encodeHourIdentity, decodeHourIdentity, isHourIdentity } from "./hour-identity.js";
import { hostedHourPreparation, hourSetupInput } from "./hour-preparation.js";
import "./errors.js";

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
}
export function readHourSetupInput(context: InitialSetupContext, input: unknown) {
  contextBinding(context);
  const request = context.request;
  if (
    !record(request) ||
    !exact(request, ["kind", "status", "identity", "input"]) ||
    request.kind !== "waitron-hour-setup" ||
    request.status !== "selected" ||
    !isHourIdentity(request.identity) ||
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
    identity = encodeHourIdentity(instant);
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

export function createHourInitialSetup(
  host: ModuleOperationHost,
  base: InitialSetupContribution,
): InitialSetupContribution {
  const candidates = new WeakSet<object>();
  return {
    ...base,
    configure: undefined,
    resolutionEvidence: () => ({ files: [], directories: [] }),
    async preparation(context, proposal) {
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
        );
      }
      if (
        proposal.action === "confirm-clock" &&
        exact(proposal, ["action", "comparisonId"]) &&
        typeof proposal.comparisonId === "string"
      )
        return session.confirmClock(context.binding, proposal.comparisonId);
      return refuse("malformed_allocation");
    },
    async candidates(context, proposal) {
      contextBinding(context);
      if (
        !record(proposal) ||
        !exact(proposal, ["answer"]) ||
        !["no", "yes", "unknown"].includes(proposal.answer as string)
      )
        return refuse("malformed_allocation");
      const result = await withOperationAuthority(
        context.binding,
        context.administratorId,
        (authority) =>
          hostedHourPreparation(host).select({
            binding: context.binding,
            authority,
            answer: proposal.answer as "no" | "yes" | "unknown",
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
    assignmentPositions(context, input) {
      if (context.request == null && input === undefined) return [];
      const allocation = readHourSetupInput(
        context,
        input ?? (context.request as { input: unknown }).input,
      ).allocation;
      return [
        {
          namespace: JSON.stringify([context.taxId, context.environment, "hour"]),
          position: decodeHourIdentity(allocation.installationIdentity),
        },
      ];
    },
  };
}
