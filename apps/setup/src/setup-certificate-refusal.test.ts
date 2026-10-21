import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { venue, initial, wizardApi } from "../test/first-setup-browser.js";
import { setLocale, t } from "./i18n/t.js";
import type { StringKey } from "./i18n/strings.js";
import type { SetupCertScreen } from "./screens/cert-screen.js";
import { mountWidget, cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";

const mounted: HTMLElement[] = [];
it.each(["en-GB", "es-ES"])(
  "links the certificate form to its translated refusal guide (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {});
    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=certificate-guide]");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      `/help/${locale === "es-ES" ? "es" : "en"}/aeat-certificate#refusals`,
    );
    expect(link!.target).toBe("_blank");
    expect(link!.rel).toBe("noopener");
  },
);
afterEach(async () => {
  mounted.splice(0).forEach((host) => host.remove());
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  setLocale("en-GB");
  await new Promise((resolve) => setTimeout(resolve, 0));
});

for (const locale of ["en-GB", "es-ES"]) {
  it.each([
    "unreadable",
    "old_encryption",
    "no_private_key",
    "expired",
    "not_yet_valid",
    "passphrase_wrong",
  ])(`shows the local %s refusal beside its field (${locale})`, async (reason) => {
    setLocale(locale);
    const field = reason === "passphrase_wrong" ? "passphrase" : "pfxBase64";
    const { el } = await mountWidget<SetupCertScreen>("setup-cert-screen", {
      draft: {
        aeatCert: {
          pfxBase64: "c3ludGhldGlj",
          passphrase: "SYNTHETIC-passphrase",
          certKind: "sello",
        },
      },
      refusal: { field, reason },
    });
    const root = el.shadowRoot!;
    const passphrase = root.querySelector<HTMLElement & { error: string }>(
      "[data-test=passphrase]",
    )!;
    const pfxError = root.querySelector("[data-test=pfx-field-error]");
    const sentence = t(`cert.refusal.${reason}` as StringKey);
    expect(field === "passphrase" ? passphrase.error : pfxError?.textContent?.trim()).toBe(
      sentence,
    );
    expect(
      root.querySelector<HTMLInputElement>("[data-test=pfx]")!.getAttribute("aria-invalid"),
    ).toBe(field === "pfxBase64" ? "true" : "false");
    const actions = root.querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
    expect(actions.error).toBe(t("cert.fix_fields"));
    expect(
      root.querySelector<HTMLElement & { disabled: boolean }>("[data-test=next]")!.disabled,
    ).toBe(false);
    await userEvent.click(root.querySelector<HTMLElement>("[data-test=next]")!);
    await el.updateComplete;
    expect(passphrase.error).toBe("");
    expect(root.querySelector("[data-test=pfx-field-error]")).toBeNull();
  });
}

for (const theme of ["light", "dark"] as const) {
  it.each(["pfxBase64", "passphrase"] as const)(
    `keeps the refused %s field accessible (${theme})`,
    async (field) => {
      const { host } = await mountWidget<SetupCertScreen>(
        "setup-cert-screen",
        {
          draft: {
            aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "SYNTHETIC", certKind: "sello" },
          },
          refusal: {
            field,
            reason: field === "passphrase" ? "passphrase_wrong" : "no_private_key",
          },
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
}

it("requires fresh owner recovery after a Finish refusal, while keeping the corrected certificate draft", async () => {
  const state = {
    ...initial,
    status: "committed",
    consumptionIntent: true,
    revision: 2,
    ownerGeneration: 2,
  };
  let finished = 0;
  const fixture = wizardApi({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/first-setup/status")) return Response.json({ claimed: true, state });
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: "b".repeat(64),
          pair: "valid",
          database: "occupied",
          password: "checkable",
          revision: 2,
          ownerGeneration: 2,
          emptyDatabase: false,
          repairEligible: false,
          artifacts: [],
        });
      if (path.endsWith("/resolution/recover"))
        return Response.json({ state, capability: "B".repeat(43), ownerGeneration: 2 });
      if (path.endsWith("/finish")) {
        finished++;
        return Response.json(
          {
            error: {
              code: "setup.certificate_refused",
              params: { field: "passphrase", reason: "passphrase_wrong" },
            },
          },
          { status: 422 },
        );
      }
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  mounted.push(host);
  const app = new SetupApp();
  app.api = fixture.api;
  host.append(app);
  const owner = await screen(app, "first-owner");
  owner
    .querySelector("[data-test=resume-password]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "SYNTHETIC-owner" } }));
  await userEvent.click(owner.querySelector<HTMLElement>("[data-test=resume]")!);
  await expect.poll(() => owner.querySelector("[data-test=finish-setup]")).not.toBeNull();
  await userEvent.click(owner.querySelector<HTMLElement>("[data-test=finish-setup]")!);
  await screen(app, "cert");
  emit(app, "setup-patch", {
    patch: {
      aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "SYNTHETIC-wrong", certKind: "sello" },
    },
  });
  emit(app, "setup-goto", { screen: "email" });
  await screen(app, "email");
  emit(app, "setup-goto", { screen: "review" });
  await screen(app, "review");
  emit(app, "provision-requested");
  const refused = await screen(app, "cert");
  expect(finished).toBe(1);
  const passphrase = refused.shadowRoot!.querySelector<HTMLElement & { error: string }>(
    "[data-test=passphrase]",
  )!;
  expect(passphrase.error).toBe("The certificate passphrase is incorrect.");
  passphrase.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "SYNTHETIC-correct" },
      bubbles: true,
      composed: true,
    }),
  );
  await userEvent.click(refused.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!);
  await screen(app, "first-owner");
  expect(finished).toBe(1);
  expect(
    (app as unknown as { draft: { aeatCert: { passphrase: string } } }).draft.aeatCert.passphrase,
  ).toBe("SYNTHETIC-correct");
});

it("retires an earlier accepted readiness answer when provisioning refuses the certificate", async () => {
  const fixture = wizardApi({
    offering: false,
    intercept(path) {
      if (path.endsWith("/provision"))
        return Response.json(
          {
            error: {
              code: "setup.certificate_refused",
              params: { field: "pfxBase64", reason: "expired" },
            },
          },
          { status: 422 },
        );
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  mounted.push(host);
  const app = new SetupApp();
  app.api = fixture.api;
  host.append(app);
  await screen(app, "mode");
  emit(app, "setup-patch", {
    patch: {
      mode: "live",
      venue,
      aeatCert: { pfxBase64: "c3ludGhldGlj", passphrase: "SYNTHETIC", certKind: "sello" },
    },
  });
  emit(app, "setup-goto", { screen: "fiscal-test" });
  const readiness = await screen(app, "fiscal-test");
  await userEvent.click(readiness.shadowRoot!.querySelector<HTMLElement>("[data-test=run]")!);
  await expect
    .poll(() => readiness.shadowRoot!.querySelector("[data-test=continue]"))
    .not.toBeNull();
  emit(app, "setup-goto", { screen: "review" });
  await screen(app, "review");
  emit(app, "provision-requested");
  const refused = await screen(app, "cert");
  expect(refused.shadowRoot!.querySelector("[data-test=pfx-field-error]")!.textContent).toContain(
    t("cert.refusal.expired"),
  );
  await userEvent.click(refused.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!);
  const retry = await screen(app, "fiscal-test");
  expect(retry.shadowRoot!.querySelector("[data-test=continue]")).toBeNull();
  expect(retry.shadowRoot!.querySelector("[data-test=run]")).not.toBeNull();
});
function emit(app: SetupApp, name: string, detail?: unknown) {
  app
    .shadowRoot!.querySelector("main")!
    .dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function screen(app: SetupApp, name: string) {
  await expect
    .poll(() => app.shadowRoot!.querySelector(`[data-test=screen-${name}]`))
    .not.toBeNull();
  const el = app.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    `[data-test=screen-${name}]`,
  )!;
  await el.updateComplete;
  return el;
}

it.each([false, true])(
  "returns a local certificate refusal to the passphrase and allows correction/retry (owned=%s)",
  async (offering) => {
    let attempts = 0;
    const fixture = wizardApi({
      offering,
      intercept(path) {
        if (path.endsWith("/fiscal-test") && ++attempts === 1)
          return Response.json(
            {
              error: {
                code: "setup.certificate_refused",
                params: { field: "passphrase", reason: "passphrase_wrong" },
              },
            },
            { status: 422 },
          );
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    applyTokens(host);
    mounted.push(host);
    const app = new SetupApp();
    app.api = fixture.api;
    host.append(app);
    await screen(app, "mode");
    emit(app, "setup-patch", { patch: { mode: "live", venue } });
    emit(app, "setup-goto", { screen: "venue" });
    await screen(app, "venue");
    emit(app, "setup-advance");
    const cert = await screen(app, "cert");
    const files = new DataTransfer();
    files.items.add(new File(["SYNTHETIC-certificate"], "company.p12"));
    const input = cert.shadowRoot!.querySelector<HTMLInputElement>("[data-test=pfx]")!;
    input.files = files.files;
    input.dispatchEvent(new Event("change"));
    await expect
      .poll(() => cert.shadowRoot!.querySelector("[data-test=file-status]"))
      .not.toBeNull();
    cert.shadowRoot!.querySelector("[data-test=passphrase]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "SYNTHETIC-wrong" },
        bubbles: true,
        composed: true,
      }),
    );
    await userEvent.click(cert.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!);
    const test = await screen(app, "fiscal-test");
    await userEvent.click(test.shadowRoot!.querySelector<HTMLElement>("[data-test=run]")!);
    const refused = (await screen(app, "cert")) as SetupCertScreen;
    const passphrase = refused.shadowRoot!.querySelector<
      HTMLElement & { error: string; value: string }
    >("[data-test=passphrase]")!;
    expect(passphrase.error).toBe("The certificate passphrase is incorrect.");
    expect(passphrase.value).toBe("SYNTHETIC-wrong");
    expect(refused.shadowRoot!.querySelector("[data-test=pfx-field-error]")).toBeNull();
    const next = refused.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=next]",
    )!;
    expect(next.disabled).toBe(false);
    passphrase.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "SYNTHETIC-correct" },
        bubbles: true,
        composed: true,
      }),
    );
    await refused.updateComplete;
    expect(passphrase.error).toBe("");
    await userEvent.click(next);
    const retry = await screen(app, "fiscal-test");
    await userEvent.click(retry.shadowRoot!.querySelector<HTMLElement>("[data-test=run]")!);
    await expect.poll(() => retry.shadowRoot!.querySelector("[data-test=continue]")).not.toBeNull();
    expect(attempts).toBe(2);
    const request = fixture.requests.filter((r) => r.path.endsWith("/fiscal-test")).at(-1)!;
    expect((request.body as { aeatCert: { passphrase: string } }).aeatCert.passphrase).toBe(
      "SYNTHETIC-correct",
    );
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY) ?? "").not.toContain(
      "SYNTHETIC-correct",
    );
  },
);
