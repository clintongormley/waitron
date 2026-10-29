import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { evidence, permission, savedCard } from "../../test/diagnosis-browser-fixtures.js";
import type { CertificateDiagnosisRequest } from "../certificate-diagnosis-contract.js";
import { AeatCertificateClient } from "./client.js";
import { DiagnosisState } from "./certificate-diagnosis-state.js";
import "./certificate-card.js";

let card: HTMLElementTagNameMap["dashboard-aeat-certificate-card"] | undefined;
const originalLocale = currentLocale();

it("a suspended account cannot start more work before a new authenticated account snapshot", async () => {
  const diagnose = vi.fn(async () => {
    throw { code: "person.suspended", params: {} };
  });
  const state = new DiagnosisState({
    client: { diagnose } as unknown as AeatCertificateClient,
    permissionContinuation: permission().hook,
    changed() {},
  });
  state.open({ source: "installed", savedCard, candidate: null });
  state.confirmSource();
  await state.run("inspect");
  expect(state.authorized).toBe(false);
  state.confirmSource();
  await state.run("inspect");
  expect(diagnose).toHaveBeenCalledTimes(1);
  state.stop();
});
afterEach(() => {
  card?.remove();
  card = undefined;
  setLocale(originalLocale);
});

it.each(["en", "es"])(
  "a changed certificate offers an explicit exit and card reload before a fresh inspection in %s",
  async (language) => {
    setLocale(language);
    let reads = 0;
    const diagnoses: CertificateDiagnosisRequest[] = [];
    const request = vi.fn(async (path: string, method: string, body: unknown) => {
      if (method === "GET") {
        reads++;
        return { ...savedCard, revision: reads === 1 ? "revision-1" : "revision-2" };
      }
      expect(path).toBe("/management-api/fiscal-certificate/diagnose");
      const diagnosis = body as CertificateDiagnosisRequest;
      diagnoses.push(diagnosis);
      if (diagnosis.expectedRevision === "revision-1")
        throw { code: "fiscal.certificate_changed", params: {} };
      return evidence(diagnosis);
    });
    card = document.createElement("dashboard-aeat-certificate-card");
    card.client = new AeatCertificateClient(request as DashboardRequest);
    card.permissionContinuation = permission().hook;
    document.body.append(card);
    const query = (root: ShadowRoot, test: string) =>
      root.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`)!;
    await vi.waitFor(() => expect(query(card!.shadowRoot!, "certificate-diagnose")).not.toBeNull());
    await userEvent.click(query(card.shadowRoot!, "certificate-diagnose"));
    await card.updateComplete;
    const panel = card.shadowRoot!.querySelector("dashboard-aeat-certificate-diagnosis")!;
    await panel.updateComplete;
    await userEvent.click(query(panel.shadowRoot!, "diagnosis-confirm"));
    await userEvent.click(query(panel.shadowRoot!, "diagnosis-inspect"));
    await vi.waitFor(() =>
      expect(panel.shadowRoot!.textContent).toContain(
        language === "en"
          ? "The installed certificate changed"
          : "El certificado instalado ha cambiado",
      ),
    );
    expect(query(panel.shadowRoot!, "diagnosis-inspect").disabled).toBe(true);
    expect(query(panel.shadowRoot!, "diagnosis-check").disabled).toBe(true);
    expect(query(panel.shadowRoot!, "diagnosis-copy")).toBeNull();
    expect(reads).toBe(1);
    expect(diagnoses).toHaveLength(1);
    panel.source = "candidate";
    await panel.updateComplete;
    panel.source = "installed";
    await panel.updateComplete;
    await userEvent.click(query(panel.shadowRoot!, "diagnosis-confirm"));
    expect(query(panel.shadowRoot!, "diagnosis-inspect").disabled).toBe(true);
    await userEvent.click(query(panel.shadowRoot!, "diagnosis-reload-card"));
    await vi.waitFor(() => expect(panel.isConnected).toBe(false));
    await vi.waitFor(() => expect(reads).toBe(2));
    expect(diagnoses).toHaveLength(1);
    await userEvent.click(query(card.shadowRoot!, "certificate-diagnose"));
    await card.updateComplete;
    const fresh = card.shadowRoot!.querySelector("dashboard-aeat-certificate-diagnosis")!;
    await fresh.updateComplete;
    expect(query(fresh.shadowRoot!, "diagnosis-inspect").disabled).toBe(true);
    await userEvent.click(query(fresh.shadowRoot!, "diagnosis-confirm"));
    await userEvent.click(query(fresh.shadowRoot!, "diagnosis-inspect"));
    await vi.waitFor(() =>
      expect(query(fresh.shadowRoot!, "diagnosis-check").disabled).toBe(false),
    );
    expect(diagnoses).toHaveLength(2);
    expect(diagnoses[1]).toMatchObject({ operation: "inspect", expectedRevision: "revision-2" });
    expect(diagnoses.some((body) => body.operation === "check")).toBe(false);
    expect(reads).toBe(2);
  },
);
