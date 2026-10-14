import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";
import type { RecoveryBackupPreview } from "../api/client.js";

const nodeId = "00000000-0000-4000-8000-000000000001";
const preview = {
  sourceId: "selected-copy-digest",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "preproduction",
  nodeId,
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
} satisfies RecoveryBackupPreview;
const operation = {
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "outside-event",
    sourceId: preview.sourceId,
    targetNodeId: nodeId,
  },
  input: {
    allocation: {
      installationIdentity: "P000042",
      series: [{ code: "A-P000042", purpose: "standard" }],
      issuedAt: "2026-10-14T08:00:00.000Z",
    },
    approval: { incidentEvidence: "outside/register/event" },
  },
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});
function change(el: SetupRecoveryAllocation, field: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
function tick(el: SetupRecoveryAllocation, field: string) {
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${field}]`)!;
  input.checked = true;
  input.dispatchEvent(new Event("change"));
}
async function filled(theme: "light" | "dark" = "light") {
  const mounted = await mountWidget<SetupRecoveryAllocation>(
    "setup-recovery-allocation",
    { preview },
    theme,
  );
  change(mounted.el, "record", JSON.stringify(operation));
  change(mounted.el, "node-key", "separate-node-secret");
  tick(mounted.el, "isolated");
  tick(mounted.el, "retained");
  await mounted.el.updateComplete;
  return mounted;
}
function link(el: SetupRecoveryAllocation) {
  const anchor = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=download-request]");
  expect(anchor, "the operator can retain the reviewed public request").not.toBeNull();
  return anchor!;
}

it("downloads the reviewed request and selected backup without the separately entered node key", async () => {
  const { el } = await filled();
  const anchor = link(el);
  expect(anchor.download).toBe("waitron-recovery-request.json");
  const response = await fetch(anchor.href);
  expect(await response.json()).toEqual({
    version: 1,
    kind: "recovery-request",
    selectedBackup: preview,
    recoveryOperation: operation,
  });
  const review = el.shadowRoot!.querySelector<HTMLElement>("[data-test=request-review]")!;
  expect(review.textContent).toContain("P000042");
  expect(review.textContent).toContain("A-P000042");
  expect(review.textContent).toContain("selected-copy-digest");
  expect(review.textContent).toContain("2026-10-01T08:00:00.000Z");
  expect(review.textContent).not.toContain("separate-node-secret");
  expect(review.textContent).toContain("This request does not confirm activation.");
});

it("requires fresh retention after the public request changes", async () => {
  const { el } = await filled();
  expect(el.readCredentials()).not.toBeNull();
  change(
    el,
    "record",
    JSON.stringify({ ...operation, input: { ...operation.input, revision: 2 } }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=retained]")!.checked).toBe(
    false,
  );
  expect(el.readCredentials()).toBeNull();
  tick(el, "retained");
  expect(el.readCredentials()?.recoveryOperation.input).toEqual({
    ...operation.input,
    revision: 2,
  });
});

it("asks an emergency operator to retain the request before an identity has been drawn", async () => {
  const { el } = await filled();
  change(
    el,
    "record",
    JSON.stringify({
      ...operation,
      input: { emergency: { version: 1 }, approval: operation.input.approval },
    }),
  );
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[data-test=retained]")!.parentElement!.textContent,
  ).toContain("I have kept this request with the outside recovery records.");
});

it("releases old downloads after edits, invalid input, clearing and disconnection", async () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const { el, host } = await filled();
  const first = link(el).href;
  change(el, "record", JSON.stringify({ ...operation, input: { emergency: { version: 1 } } }));
  await el.updateComplete;
  expect(revoke).toHaveBeenCalledWith(first);
  const emergency = link(el).href;
  expect((await (await fetch(emergency)).json()).recoveryOperation.input).toEqual({
    emergency: { version: 1 },
  });
  change(el, "record", "broken");
  await el.updateComplete;
  expect(revoke).toHaveBeenCalledWith(emergency);
  expect(el.shadowRoot!.querySelector("[data-test=request-review]")).toBeNull();
  change(el, "record", JSON.stringify(operation));
  await el.updateComplete;
  const next = link(el).href;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=clear]")!.click();
  await el.updateComplete;
  expect(revoke).toHaveBeenCalledWith(next);
  change(el, "record", JSON.stringify(operation));
  await el.updateComplete;
  const last = link(el).href;
  host.remove();
  expect(revoke).toHaveBeenCalledWith(last);
});

it("a different selected copy clears both the review and its retention confirmation", async () => {
  const { el } = await filled();
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const prior = link(el).href;
  el.preview = { ...preview, sourceId: "different-copy" };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=request-review]")).toBeNull();
  expect(el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=retained]")!.checked).toBe(
    false,
  );
  expect(revoke).toHaveBeenCalledWith(prior);
});

it.each(["light", "dark"] as const)(
  "the populated request review is accessible in %s",
  async (theme) => {
    const { el, host } = await filled(theme);
    link(el);
    await expectNoA11yViolations(host);
    setLocale("es-ES");
    await el.updateComplete;
    expect(link(el).textContent).toContain("Guardar solicitud");
    expect(el.shadowRoot!.textContent).toContain("Esta solicitud no confirma la activación.");
    await expectNoA11yViolations(host);
  },
);
