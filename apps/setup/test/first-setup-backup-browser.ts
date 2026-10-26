import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { SetupApi } from "../src/api/client.js";
import type { BackupRepairSession } from "../src/api/first-setup-types.js";
export const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "00000000-0000-4000-8000-000000000003",
  sourceId: "archive-digest",
  targetNodeId: "00000000-0000-4000-8000-000000000004",
};
export const saved: BackupRepairSession = {
  sessionId: "b".repeat(64),
  recoveryId: "00000000-0000-4000-8000-000000000002",
  binding,
  preview: {
    activationSourceId: "archive-digest",
    sourceId: "copy",
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
};
export const inspection = {
  version: 2 as const,
  inspectionId: "a".repeat(64),
  pair: "invalid" as const,
  database: "unknown" as const,
  password: "uncheckable" as const,
  revision: null,
  ownerGeneration: null,
  repairEligible: false,
  emptyDatabase: false,
  artifacts: [],
};
export const printedKey = "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c";
export function repairApi(
  intercept?: (action: string, body: unknown) => Response | Promise<Response> | undefined,
) {
  const calls: { action: string; path: string; body: unknown }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const path = String(url),
      action = path.split("/").at(-1)!;
    const body: unknown =
      init?.body instanceof FormData
        ? JSON.parse(String(init.body.get("request")))
        : JSON.parse(String(init?.body ?? "{}"));
    calls.push({ action, path, body });
    const response = intercept?.(action, body);
    if (response) return response;
    if (action === "resolution") return Response.json(inspection);
    if (action === "status") return Response.json({ phase: "unstarted", proofRequired: true });
    if (action === "open") return Response.json(saved);
    if (action === "close") return Response.json({ closed: true });
    if (action === "activity") return Response.json({ activity: null });
    if (action === "commit") return Response.json({ restarting: true });
    throw new Error("Unexpected repair request " + path);
  });
  return { api, calls };
}
export const q = <T extends Element = HTMLElement>(element: LitElement, name: string) =>
  element.shadowRoot!.querySelector<T>(`[data-test="${name}"]`)!;
export async function fill(element: LitElement, name: string, value: string) {
  const field = q<LitElement>(element, name);
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector<HTMLInputElement>("input,textarea")!, value);
  await element.updateComplete;
}
export async function click(element: LitElement, name: string) {
  const button = q<LitElement>(element, name);
  await button.updateComplete;
  await userEvent.click(button.shadowRoot!.querySelector("button")!);
  await element.updateComplete;
}
export async function key(element: LitElement) {
  const entry = q<LitElement>(element, "proof-key");
  await entry.updateComplete;
  const field = entry.shadowRoot!.querySelector<LitElement>("[name=printed-recovery-key]")!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector<HTMLInputElement>("input")!, printedKey);
  await expect
    .poll(() => field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value)
    .not.toBe("");
}
export async function bucketProof(element: LitElement) {
  q(element, "source").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bucket" } }));
  await element.updateComplete;
  await fill(element, "kit", "private-kit");
  await key(element);
  for (const name of ["offline", "sole"]) await userEvent.click(q<HTMLInputElement>(element, name));
  await element.updateComplete;
}
export function moduleAnswer(body: unknown, waiting = false): Response {
  const proposal = (body as { proposal: { action: string } }).proposal;
  const instant = Date.parse("2026-10-24T10:00:00Z");
  if (proposal.action === "clock-challenge")
    return Response.json({ id: "challenge", boxInstantMs: instant, expiresInMs: 5000 });
  if (proposal.action === "compare-clocks")
    return Response.json({
      id: "comparison",
      clock: {
        usable: ["box", "browser", "internet"].map((source) => ({
          source,
          lowerMs: instant,
          upperMs: instant,
        })),
        unavailable: [],
        secondClock: true,
        disagreement: false,
        releaseBlocked: false,
        rangeBlocked: false,
      },
    });
  if (proposal.action === "preview")
    return Response.json(
      waiting
        ? { status: "waiting", targetMs: Date.now() + 120_000, remainingMs: 120_000 }
        : { status: "preview" },
    );
  if (proposal.action === "select")
    return Response.json({
      status: "selected",
      binding,
      identity: "0CRHE",
      input: { selected: "module" },
    });
  throw new Error("Unexpected module proposal " + proposal.action);
}
export async function recoveryEntry(element: LitElement) {
  const allocation = q<LitElement>(element, "allocation");
  await allocation.updateComplete;
  const entry = allocation.shadowRoot!.querySelector<LitElement>("vf-recovery-hour")!;
  await entry.updateComplete;
  const picker = entry.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await picker.updateComplete;
  const input = picker.shadowRoot!.querySelector<LitElement>("[name=printed-recovery-key]")!;
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector<HTMLInputElement>("input")!, printedKey);
  for (const name of ["recovery-old-box-stopped", "recovery-sole-operation"])
    await userEvent.click(entry.shadowRoot!.querySelector<HTMLInputElement>(`[name=${name}]`)!);
  await expect
    .poll(() => q<HTMLElement & { disabled: boolean }>(entry, "compare").disabled)
    .toBe(false);
  return entry;
}
