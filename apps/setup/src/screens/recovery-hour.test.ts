import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { SetupApi, type RecoveryBackupPreview } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
const preview: RecoveryBackupPreview = {
  sourceId: "selected-copy",
  activationSourceId: "archive-digest",
  createdAt: "2026-10-17T12:30:00Z",
  environment: "production",
  nodeId: "node-1",
  nodeRecoveryKeyName: "Caja principal",
  taxpayer: { legalName: "Olivo SL", taxId: "B12345674" },
  locationName: "Centro",
  fiscalSelection: {
    module: "fiscal-verifactu",
    country: "ES",
    fiscalTerritory: "common",
    timeZone: "Europe/Madrid",
  },
};
const instant = Date.parse("2026-10-18T12:30:00Z");
const clock = {
  usable: ["box", "browser", "internet"].map((source) => ({
    source,
    lowerMs: instant,
    upperMs: instant,
  })),
  unavailable: [],
  disagreement: false,
  requiresConfirmation: false,
  boundaryWait: false,
  releaseBlocked: false,
  rangeBlocked: false,
};
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});
async function mounted(kind: "archive" | "bucket" | "cloud") {
  const requests: Array<{
    source: Record<string, unknown>;
    preparation: Record<string, unknown>;
    artifact?: Blob;
  }> = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/preview")) return Response.json(preview);
    if (String(url).endsWith("/recovery/preparation")) {
      const body =
        init!.body instanceof FormData
          ? JSON.parse(String(init!.body.get("request")))
          : JSON.parse(String(init!.body));
      if (init!.body instanceof FormData) body.artifact = init!.body.get("artifact");
      requests.push(body);
      const proposal = body.preparation.proposal;
      if (proposal.action === "clock-challenge")
        return Response.json({ id: "challenge", boxInstantMs: instant, expiresInMs: 5000 });
      if (proposal.action === "compare-clocks") return Response.json({ id: "comparison", clock });
      if (proposal.action === "select")
        return Response.json({
          status: "selected",
          binding: body.preparation.binding,
          identity: "06TH",
          input: { server: "selected-input" },
        });
    }
    throw new Error("unexpected URL " + url);
  });
  const artifact = new File(["encrypted selected copy"], "backup.waitron");
  const source =
    kind === "archive"
      ? { artifact, recoveryKey: "archive password", environment: "production" as const }
      : kind === "bucket"
        ? {
            bucketKit: "private selected kit",
            environment: "production" as const,
            oldBoxGone: true,
          }
        : { cloudPointId: "selected-cloud-point", selectionId: "approval-1" };
  const { el } = await mountWidget<SetupRecoveryCopy>("setup-recovery-copy", {
    api: new SetupApi("", transport),
    ...source,
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
  );
  const allocation = el.shadowRoot!.querySelector<LitElement>("setup-recovery-allocation")!;
  await allocation.updateComplete;
  const entry = allocation.shadowRoot!.querySelector<LitElement>("vf-recovery-hour");
  expect(entry, "the selected source offers the module's hour form").not.toBeNull();
  await entry!.updateComplete;
  return { el, entry: entry!, requests, artifact };
}
async function fill(entry: LitElement) {
  const key = entry.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await key.updateComplete;
  for (const [name, value] of [
    ["printed-recovery-key", "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c"],
  ]) {
    const field = key.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.value = value!;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  const codes = entry.shadowRoot!.querySelector<LitElement>(
    '[name="recovery-installation-codes"]',
  )!;
  await codes.updateComplete;
  const codeInput = codes.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  codeInput.value = "06RB";
  codeInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  for (const name of ["recovery-old-box-stopped", "recovery-sole-operation", "taxpayer-hour-no"]) {
    const field = entry.shadowRoot!.querySelector<HTMLInputElement>(
      name.startsWith("taxpayer-hour-")
        ? `[name="taxpayer-hour"][value="${name.slice(14)}"]`
        : `[name="${name}"]`,
    )!;
    field.checked = true;
    field.dispatchEvent(new Event("change"));
  }
  await vi.waitFor(() =>
    expect(
      (
        entry.shadowRoot!.querySelector("[data-test=compare]") as HTMLElement & {
          disabled: boolean;
        }
      ).disabled,
    ).toBe(false),
  );
  entry.shadowRoot!.querySelector<HTMLElement>("[data-test=compare]")!.click();
  await vi.waitFor(() =>
    expect(entry.shadowRoot!.querySelector("[data-test=clock-readings]")).not.toBeNull(),
  );
  entry.shadowRoot!.querySelector<HTMLElement>("[data-test=select]")!.click();
}
it.each(["archive", "bucket", "cloud"] as const)(
  "prepares %s recovery through the real client and forwards bound credentials",
  async (kind) => {
    const { el, entry, requests, artifact } = await mounted(kind);
    await fill(entry);
    await vi.waitFor(() =>
      expect(el.readCredentials()?.recoveryOperation.input).toEqual({ server: "selected-input" }),
    );
    const credentials = el.readCredentials()!;
    expect(credentials.recoveryContext).toEqual({
      selectedSourceId: "selected-copy",
      oldBoxGone: true,
      soleRecovery: true,
    });
    expect(credentials.nodeRecoverySecret).toBe("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(credentials.recoveryOperation.binding).toEqual({
      module: "fiscal-verifactu",
      action: "restore",
      eventId: expect.any(String),
      sourceId: "archive-digest",
      targetNodeId: "node-1",
    });
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.preparation).toMatchObject({
        binding: credentials.recoveryOperation.binding,
        context: credentials.recoveryContext,
        nodeRecoverySecret: credentials.nodeRecoverySecret,
      });
      expect(request.source).toEqual(
        kind === "archive"
          ? { kind, recoveryKey: "archive password", environment: "production" }
          : kind === "bucket"
            ? { kind, kit: "private selected kit", environment: "production" }
            : { kind, pointId: "selected-cloud-point" },
      );
      if (kind === "archive") expect(await request.artifact!.text()).toBe(await artifact.text());
    }
    if (kind === "bucket") el.bucketKit = "different kit";
    else if (kind === "cloud") el.selectionId = "approval-2";
    else el.recoveryKey = "different password";
    expect(el.readCredentials()).toBeNull();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("setup-recovery-allocation")).toBeNull();
  },
);
