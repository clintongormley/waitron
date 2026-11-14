import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./guest-menu-preview.js";
class PaperLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = new DashboardApi(
    "",
    async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes("guest-preview")
            ? {
                html: "<h1>Lunch</h1>",
                versionId: "v1",
                members: ["Lunch"],
                language: "en",
                languages: ["en"],
              }
            : { enabled: false, revision: 0, available: false },
        ),
      ),
  );
  override render() {
    return html`<dashboard-guest-menu-preview
        .api=${this.api}
        menuId="menu"
      ></dashboard-guest-menu-preview
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard edits?", keepLabel: "Keep editing", discardLabel: "Discard" })}`;
  }
}
customElements.define("paper-leave-test-app", PaperLeaveApp);
afterEach(cleanupWidgets);
it("protects paper appearance on preview close, keeps the edit and discards only when chosen", async () => {
  const { el: app } = await mountWidget<PaperLeaveApp>("paper-leave-test-app", {});
  const preview = app.shadowRoot!.querySelector("dashboard-guest-menu-preview")!;
  await page.elementLocator(preview.shadowRoot!.querySelector("wt-button")!).click();
  await expect
    .poll(
      () =>
        preview
          .shadowRoot!.querySelector("dashboard-guest-menu-paper")
          ?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-button"]>("#preview-paper")
          ?.disabled,
    )
    .toBe(false);
  const paper = preview.shadowRoot!.querySelector("dashboard-guest-menu-paper")!;
  paper
    .shadowRoot!.querySelector('[name="paper-font"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "sans" } }));
  const modal = preview.shadowRoot!.querySelector("wt-modal")!;
  void modal.requestClose("escape");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  let question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await page.elementLocator(question.shadowRoot!.querySelector('[data-choice="keep"]')!).click();
  await expect.poll(() => question.open).toBe(false);
  expect(modal.open).toBe(true);
  expect(
    paper.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="paper-font"]')!
      .value,
  ).toBe("sans");
  void modal.requestClose("escape");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await page.elementLocator(question.shadowRoot!.querySelector('[data-choice="discard"]')!).click();
  await expect
    .poll(() => preview.shadowRoot!.querySelector("dashboard-guest-menu-paper"))
    .toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
