import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import type { FirstSetupState } from "./api/first-setup-types.js";
import { SetupApp } from "./setup-app.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, venue, wizardApi } from "../test/first-setup-browser.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  vi.restoreAllMocks();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
const q = <T extends Element>(app: SetupApp, name: string) =>
  app.shadowRoot!.querySelector<T>(`[data-test=${name}]`)!;
const button = (root: ParentNode, name: string) =>
  root.querySelector<WtButton>(`[data-test=${name}]`)!.shadowRoot!.querySelector("button")!;
async function mount(
  status: FirstSetupState["status"] = "committed",
  intercept?: NonNullable<Parameters<typeof wizardApi>[0]>["intercept"],
) {
  let state: FirstSetupState = {
    ...initial,
    environment: "production",
    status,
    consumptionIntent: true,
  };
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body, headers) {
      const answer = intercept?.(path, body, headers);
      if (answer !== undefined) return answer;
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: String(state.revision).repeat(64),
          pair: "valid",
          database: "occupied",
          password: "checkable",
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
          emptyDatabase: false,
          repairEligible: false,
          artifacts: [],
        });
      if (path.endsWith("/first-setup/status") && headers.has("X-Waitron-Setup-Owner"))
        return Response.json({ claimed: true, state });
      if (path.endsWith("/resolution/recover")) {
        state = {
          ...state,
          revision: state.revision + 1,
          ownerGeneration: state.ownerGeneration + 1,
        };
        return Response.json({
          state,
          capability: String.fromCharCode(64 + state.ownerGeneration).repeat(43),
          ownerGeneration: state.ownerGeneration,
        });
      }
      if (path.endsWith("/resolution/finish"))
        return Response.json({ provisioned: true, restarting: true });
    },
  });
  const { el: app } = await mountWidget<SetupApp>("setup-app", { api: fixture.api });
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  return { app, ...fixture };
}
async function recover(app: SetupApp) {
  const field = q<WtInput>(app, "resume-password");
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, venue.admin.password);
  await userEvent.click(button(app.shadowRoot!, "resume"));
  await expect.poll(() => q(app, "resume")).toBeNull();
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled ?? false).toBe(false);
}
async function publication(app: SetupApp) {
  expect(q<WtButton>(app, "finish-setup").variant).toBe("primary");
  await userEvent.click(button(app.shadowRoot!, "finish-setup"));
  await expect.poll(() => q(app, "screen-cert")).not.toBeNull();
  const cert = q<HTMLElement>(app, "screen-cert");
  const file = cert.shadowRoot!.querySelector<HTMLInputElement>("[data-test=pfx]")!;
  const files = new DataTransfer();
  files.items.add(new File(["synthetic certificate"], "test.pfx"));
  file.files = files.files;
  file.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => cert.shadowRoot!.querySelector("[data-test=file-status]")).not.toBeNull();
  await userEvent.fill(
    cert
      .shadowRoot!.querySelector<WtInput>("[data-test=passphrase]")!
      .shadowRoot!.querySelector("input")!,
    "certificate secret",
  );
  await userEvent.click(button(cert.shadowRoot!, "next"));
  await expect.poll(() => q(app, "screen-email")).not.toBeNull();
  const email = q<HTMLElement>(app, "screen-email");
  expect(email.shadowRoot!.querySelector("[data-test=test]")).toBeNull();
  for (const [name, value] of [
    ["server", "smtp.example.test"],
    ["port", "465"],
    ["from", "venue@example.test"],
  ])
    await userEvent.fill(
      email
        .shadowRoot!.querySelector<WtInput>(`[data-test=${name}]`)!
        .shadowRoot!.querySelector("input")!,
      value!,
    );
  await userEvent.click(button(email.shadowRoot!, "next"));
  await expect.poll(() => q(app, "screen-review")).not.toBeNull();
  const review = q<HTMLElement>(app, "screen-review");
  expect(review.shadowRoot!.querySelector("[data-test=provision]")!.textContent).toContain(
    "Finish setup",
  );
  expect(review.shadowRoot!.querySelector("[data-test=edit]")).toBeNull();
  return review;
}

it.each(["activation-started", "committed", "publication"] as const)(
  "finishes recovered %s through publication only",
  async (status) => {
    const { app, requests } = await mount(status);
    expect(q(app, "finish-setup")).toBeNull();
    await recover(app);
    const review = await publication(app);
    await userEvent.click(button(review.shadowRoot!, "provision"));
    await expect.poll(() => q(app, "screen-done")).not.toBeNull();
    const finish = requests.filter((r) => r.path.endsWith("/resolution/finish"));
    expect(finish).toHaveLength(1);
    expect(finish[0]!.body).toEqual({
      inspectionId: "2".repeat(64),
      revision: 2,
      ownerGeneration: 2,
      publication: {
        mode: "live",
        aeatCert: {
          pfxBase64: btoa("synthetic certificate"),
          passphrase: "certificate secret",
          certKind: "sello",
        },
        email: {
          server: "smtp.example.test",
          port: 465,
          encryption: "starttls",
          from: "venue@example.test",
          user: "",
          password: "",
        },
      },
    });
    expect(finish[0]!.headers.get("X-Waitron-Setup-Owner")).toBe("B".repeat(43));
    expect(
      requests.some((r) =>
        /\/(provision|preparation|candidates|document|document-kept|fiscal-test|email-test|claim)$/.test(
          r.path,
        ),
      ),
    ).toBe(false);
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain("certificate secret");
  },
);

it.each(["claimed", "consumption-intent", "uncertain", "abandoned", "complete"] as const)(
  "does not offer Finish for recovered %s",
  async (status) => {
    const { app, requests } = await mount(status);
    await recover(app);
    expect(q(app, "finish-setup")).toBeNull();
    expect(requests.some((r) => r.path.endsWith("/finish"))).toBe(false);
  },
);

it("requires fresh password recovery after a refused Finish and never falls back to activation", async () => {
  let attempts = 0;
  const { app, requests } = await mount("committed", (path) => {
    if (path.endsWith("/resolution/finish") && attempts++ === 0)
      return Response.json(
        { error: { code: "setup.attempt_uncertain", params: {} } },
        { status: 409 },
      );
  });
  await recover(app);
  const review = await publication(app);
  await userEvent.click(button(review.shadowRoot!, "provision"));
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(q(app, "finish-setup")).toBeNull();
  await recover(app);
  expect(requests.filter((r) => r.path.endsWith("/resolution/recover"))).toHaveLength(2);
  expect(requests.some((r) => r.path.endsWith("/resume"))).toBe(false);
  expect(q(app, "finish-setup")).not.toBeNull();
});

it("ignores a Finish answer after the setup app is removed", async () => {
  let answer!: (response: Response) => void;
  const { app, requests } = await mount("committed", (path) => {
    if (path.endsWith("/resolution/finish"))
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
  });
  await recover(app);
  const review = await publication(app);
  const pending = vi.spyOn(FirstSetupSession.prototype, "finish");
  await userEvent.click(button(review.shadowRoot!, "provision"));
  await expect.poll(() => requests.filter((r) => r.path.endsWith("/finish"))).toHaveLength(1);
  app.remove();
  answer(Response.json({ provisioned: true, restarting: true }));
  await expect(pending.mock.results[0]!.value).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await app.updateComplete;
  expect(q(app, "screen-done")).toBeNull();
});

it("does not replace a navigated-away repair page with a late Finish answer", async () => {
  let answer!: (response: Response) => void;
  const { app, requests } = await mount("committed", (path) => {
    if (path.endsWith("/resolution/finish"))
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
  });
  await recover(app);
  const review = await publication(app);
  const pending = vi.spyOn(FirstSetupSession.prototype, "finish");
  await userEvent.click(button(review.shadowRoot!, "provision"));
  await expect.poll(() => requests.some((r) => r.path.endsWith("/finish"))).toBe(true);
  app.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("setup-goto", {
      detail: { screen: "first-owner" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => q(app, "screen-first-owner")).not.toBeNull();
  answer(Response.json({ provisioned: true, restarting: true }));
  await pending.mock.results[0]!.value;
  await app.updateComplete;
  expect(q(app, "screen-first-owner")).not.toBeNull();
  expect(q(app, "screen-done")).toBeNull();
});
