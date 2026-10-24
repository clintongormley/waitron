import type { NonDbSource } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { projectHourHistory, type HourHistorySource } from "./hour-history.js";
import { readHourSetupInput } from "./initial-hour-setup.js";
import { parseRecoveryDocumentPublic } from "./recovery-document.js";
import "./errors.js";

type Recovery = Parameters<
  Extract<NonDbSource, { kind: "preparation-history" }>["project"]
>[0]["recovery"];
function invalid(): never {
  throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const FIELDS = [
  "reference",
  "kind",
  "taxpayerNif",
  "environment",
  "softwareId",
  "nodeId",
  "identity",
  "recordedAtMs",
];
export function projectRepairHourHistory(recovery: Recovery): readonly HourHistorySource[] {
  if (recovery === undefined) return [];
  const sources: unknown[] = [...recovery.history];
  for (const evidence of recovery.publicEvidence) {
    if (record(evidence) && evidence.kind === "waitron-recovery-document") {
      try {
        const document = parseRecoveryDocumentPublic(evidence);
        sources.push({
          reference: `recovery-document/${document.nodeKey.name}`,
          complete: true,
          records: [],
          timeFloorMs: Date.parse(document.createdAt),
        });
      } catch {
        invalid();
      }
      continue;
    }
    if (
      !record(evidence) ||
      evidence.format !== "waitron-hour-history" ||
      !Array.isArray(evidence.sources)
    )
      invalid();
    const checked = projectHourHistory(evidence);
    if (checked.contradictions.length > 0) invalid();
    sources.push(...evidence.sources);
  }
  for (const { context, input } of recovery.setups) {
    if (
      input === undefined &&
      (context.request == null || (record(context.request) && context.request.status === "waiting"))
    )
      continue;
    let allocation;
    try {
      allocation = readHourSetupInput(
        context,
        input === undefined ? (context.request as { input?: unknown }).input : input,
      ).allocation;
    } catch {
      invalid();
    }
    sources.push({
      reference: `setup/${context.binding.eventId}`,
      complete: true,
      records: [
        {
          reference: `setup/${context.binding.eventId}`,
          kind: "workspace",
          taxpayerNif: allocation.taxpayerNif,
          environment: allocation.environment,
          softwareId: allocation.softwareId,
          nodeId: context.binding.targetNodeId,
          identity: allocation.installationIdentity,
          recordedAtMs: Date.parse(allocation.issuedAt),
        },
      ],
    });
  }
  return sources.map((source) => {
    const checked = projectHourHistory({
      scope: { taxpayerNif: "validation", environment: "preproduction" },
      sources: [source],
    });
    if (checked.contradictions.length > 0) invalid();
    const current = source as HourHistorySource;
    return {
      reference: current.reference,
      complete: true,
      records: current.records.map((row) =>
        Object.fromEntries(FIELDS.map((name) => [name, (row as Record<string, unknown>)[name]])),
      ),
      ...(current.timeFloorMs === undefined ? {} : { timeFloorMs: current.timeFloorMs }),
    };
  });
}
