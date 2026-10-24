import { afterEach, expect, it } from "vitest";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";

afterEach(cleanupWidgets);
it("passes the authenticated repair event to the module instead of making another event", async () => {
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "00000000-0000-4000-8000-000000000003",
    sourceId: "archive-digest",
    targetNodeId: "00000000-0000-4000-8000-000000000004",
  };
  const { el } = await mountWidget<SetupRecoveryAllocation>("setup-recovery-allocation", {
    binding,
    preview: {
      sourceId: "copy",
      activationSourceId: "archive-digest",
      createdAt: "2026-10-24T10:00:00Z",
      environment: "production",
      nodeId: binding.targetNodeId,
      nodeRecoveryKeyName: "Amber Hill",
      taxpayer: { taxId: "B12345674", legalName: "Saved venue" },
      locationName: "Saved location",
      fiscalSelection: {
        module: "fiscal-verifactu",
        country: "ES",
        fiscalTerritory: "common",
        timeZone: "Europe/Madrid",
      },
    },
    prepare: async (request) => request,
  });
  const entry = el.shadowRoot!.querySelector<LitElement & { context: { binding: unknown } }>(
    "vf-recovery-hour",
  )!;
  expect(entry.context.binding).toEqual(binding);
});
