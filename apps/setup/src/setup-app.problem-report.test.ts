import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { leaveCoordinatorFor, type WtButton, type WtReportDialog } from "@waitron/ui";
import type { SetupApi } from "./api/client.js";
import type { SetupApp } from "./setup-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import "./setup-app.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en-GB");
});

it.each(["pending", "refused", "offline"])(
  "offers reporting over plain HTTP while discovery is %s",
  async (state) => {
    vi.stubGlobal("isSecureContext", false);
    let finish!: (value: { caDownloadAvailable: boolean }) => void;
    const discovery = new Promise<{ caDownloadAvailable: boolean }>((resolve) => {
      finish = resolve;
    });
    const api = {
      getStatus: async () => ({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      }),
      getDiscovery: () =>
        state === "pending"
          ? discovery
          : state === "refused"
            ? Promise.reject({ status: 503, code: "setup.not_ready" })
            : Promise.resolve({ caDownloadAvailable: false }),
      firstSetupStatus: async () => ({ claimed: false }),
    } as unknown as SetupApi;
    const { el: app } = await mountWidget<SetupApp>("setup-app", {
      api,
      browserLanguages: ["en-GB"],
    });
    if (state === "refused")
      await expect
        .poll(
          () =>
            (
              app.shadowRoot!.querySelector("setup-connection-screen") as HTMLElement & {
                errorMessage: string;
              }
            ).errorMessage,
        )
        .toBe("This server reported a problem. Try again in a moment.");
    if (state === "offline")
      await expect.poll(() => app.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull();
    if (state === "offline") vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const report = app.shadowRoot!.querySelector<HTMLElementTagNameMap["setup-problem-report"]>(
      "header > setup-problem-report",
    );
    expect(report).not.toBeNull();
    await report!.updateComplete;
    const trigger = report!.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!;
    await trigger.updateComplete;
    await expect
      .element(trigger.shadowRoot!.querySelector("button")!)
      .toHaveAccessibleName("Report a problem");
    await userEvent.click(trigger);
    await report!.updateComplete;
    const dialog = report!.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
    await dialog.updateComplete;
    expect(dialog.open).toBe(true);
    expect(JSON.parse(dialog.preview.split("```json\n")[1]!.split("\n```")[0]!).client.online).toBe(
      state !== "offline",
    );
    finish({ caDownloadAvailable: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.restoreAllMocks();
  },
);

it("downloading from the real setup shell preserves its unfinished venue details", async () => {
  const { el: app } = await mountWidget<SetupApp>("setup-app", {
    browserLanguages: ["en-GB"],
    api: {
      getStatus: async () => ({
        provisioned: false,
        environment: "preproduction",
        needs: ["venue"],
      }),
      getDiscovery: async () => ({ caDownloadAvailable: false }),
      firstSetupStatus: async () => ({ claimed: false }),
    } as unknown as SetupApi,
  });
  await expect.poll(() => app.shadowRoot!.querySelector("setup-mode-screen")).not.toBeNull();
  app.shadowRoot!.querySelector("main")!.dispatchEvent(
    new CustomEvent("setup-patch", {
      detail: { patch: { venue: { legalName: "Unfinished restaurant" } } },
      bubbles: true,
      composed: true,
    }),
  );
  await app.updateComplete;
  const report = app.shadowRoot!.querySelector("setup-problem-report")!;
  const coordinator = leaveCoordinatorFor(report);
  expect(coordinator.isDirty()).toBe(true);
  await report.updateComplete;
  await userEvent.click(report.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!);
  await report.updateComplete;
  const dialog = report.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
  await dialog.updateComplete;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!);
  await expect.poll(() => dialog.open).toBe(false);
  expect(
    (app as unknown as { draft: { venue: { legalName: string } } }).draft.venue.legalName,
  ).toBe("Unfinished restaurant");
  expect(coordinator.isDirty()).toBe(true);
});
