import { isDeepStrictEqual } from "node:util";
import {
  withOperationAuthority,
  type InitialSetupContext,
  type InitialSetupContribution,
  type InitialSetupCommandActions,
  type ModuleOperationHost,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { encodeHourIdentity, decodeHourIdentity, isHourIdentity } from "./hour-identity.js";
import { hostedHourPreparation, hourSetupInput } from "./hour-preparation.js";
import "./errors.js";
import {
  parseRecoveryDocumentPublic,
  recoveryDocumentPublic,
  type RecoveryDocument,
} from "./recovery-document.js";
import { WAITRON_ID_SISTEMA } from "./software.js";

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

async function reviewCommandClock(
  actions: InitialSetupCommandActions,
): Promise<{ status: "ready" } | { status: "waiting" } | { status: "cancelled" }> {
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
  if (comparison.clock.boundaryWait) {
    actions.output("Clocks span a UTC-hour boundary. Check again before choosing an hour.");
    return { status: "waiting" };
  }
  if (comparison.clock.requiresConfirmation) {
    actions.output("Accepting a wrong time can reuse invoice names or date invoices incorrectly.");
    const confirmed = (
      await actions.prompt("The box's displayed date and time are correct? [y/N]: ")
    )
      .trim()
      .toLowerCase();
    if (confirmed !== "y" && confirmed !== "yes") return { status: "cancelled" };
    await actions.prepare({ action: "confirm-clock", comparisonId: comparison.id });
  }
  return { status: "ready" as const };
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
      const selected = readHourSetupInput(context, imported.input);
      if (document.key.nodeId !== context.binding.targetNodeId) refuse();
      const recovery: RecoveryDocument = {
        kind: "waitron-recovery-document",
        installationCodes: [selected.allocation.installationIdentity],
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
      const { renderRecoveryPdf } = await import("./recovery-pdf-node.js");
      const bytes = await renderRecoveryPdf(recovery, document.locale);
      return { bytes, statement: recoveryDocumentPublic(recovery) };
    },
    async commandResume(context, actions) {
      readHourSetupInput(context, (context.request as { input: unknown })?.input);
      const reviewed = await reviewCommandClock(actions);
      if (reviewed.status !== "ready") return reviewed;
      return { status: "ready", input: (context.request as { input: unknown }).input };
    },
    async resume(context, input, documentBinding) {
      const checked = readHourSetupInput(context, input);
      await withOperationAuthority(context.binding, context.administratorId, (authority) =>
        hostedHourPreparation(host).resume(
          { binding: context.binding, authority, input: checked },
          documentBinding,
        ),
      );
    },
    async command(context, actions) {
      if (record(context.request) && context.request.status === "selected")
        return { status: "ready", input: readHourSetupInput(context, context.request.input) };
      const reviewed = await reviewCommandClock(actions);
      if (reviewed.status !== "ready") return reviewed;
      const waiting = (targetMs: unknown) => {
        actions.output(`Wait until ${new Date(targetMs as number).toISOString()}.`);
        actions.output(
          "This countdown does not reserve a separate hour. Coordinate setups one at a time.",
        );
        return { status: "waiting" as const };
      };
      const preview = await actions.prepare({ action: "selection" });
      if (!record(preview)) return refuse();
      if (preview.status === "waiting") return waiting(preview.targetMs);
      if (
        !["selected", "preview"].includes(preview.status as string) ||
        !["no", "yes", "unknown"].includes(preview.answer as string)
      )
        return refuse();
      actions.output(
        "Include every venue using this taxpayer's NIF, interrupted setups and recoveries. Arrange them one at a time.",
      );
      const answer =
        preview.status === "selected" || preview.answer !== "no"
          ? (preview.answer as string)
          : (
              await actions.prompt(
                "Has anyone set up a Waitron box for this business in the last hour? [no/yes/unknown]: ",
              )
            )
              .trim()
              .toLowerCase();
      if (!["no", "yes", "unknown"].includes(answer)) return { status: "cancelled" };
      const selected = await actions.select({ answer });
      if (record(selected) && selected.status === "waiting") return waiting(selected.targetMs);
      if (!record(selected) || selected.status !== "selected") return refuse();
      return { status: "ready", input: selected.input };
    },
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
    recoveryDocument(context, imported, document) {
      const selected = readHourSetupInput(context, imported.input);
      let statement: ReturnType<typeof parseRecoveryDocumentPublic>;
      try {
        statement = parseRecoveryDocumentPublic(document.statement);
      } catch {
        return refuse("outside_confirmation_missing");
      }
      if (
        statement.installationCodes.length !== 1 ||
        statement.installationCodes[0] !== selected.allocation.installationIdentity ||
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
