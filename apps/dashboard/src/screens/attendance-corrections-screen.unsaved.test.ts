import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { createRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./attendance-corrections-screen.js";

class AttendanceManagerLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly request = createRequest({
    fetchImpl: async (path) => {
      if (path.endsWith("/lookups"))
        return Response.json({
          viewer: { personId: "manager", canSelfApprove: false },
          locations: [{ id: "shop", name: "Deli", timeZone: "Europe/Madrid" }],
          people: [{ personId: "worker", displayName: "Ana Worker" }],
        });
      if (path.includes("/queue?")) return Response.json({ locationId: "shop", items: [] });
      return Response.json({
        personId: "worker",
        locationId: "shop",
        date: "2026-10-14",
        timeZone: "Europe/Madrid",
        revision: "revision",
        items: [],
        record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
      });
    },
  });
  override render() {
    return html`<dashboard-attendance-corrections-screen
        .request=${this.request}
      ></dashboard-attendance-corrections-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("attendance-manager-leave-test-app", AttendanceManagerLeaveApp);
afterEach(cleanupWidgets);
it("navigation and Cancel use the app's leave choice for the manager's edited proposal", async () => {
  const { el: app } = await mountWidget<AttendanceManagerLeaveApp>(
    "attendance-manager-leave-test-app",
    {},
  );
  const screen = app.shadowRoot!.querySelector("dashboard-attendance-corrections-screen")!;
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElement & { options: unknown[] }>(
          "[name=attendancePerson]",
        )!.options.length,
    )
    .toBe(1);
  screen
    .shadowRoot!.querySelector("[name=attendanceDay]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2026-10-14" } }));
  await screen.updateComplete;
  await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("[data-open-day]")!);
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-add-shift]")).not.toBeNull();
  await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("[data-add-shift]")!);
  const form = screen.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!;
  await form.updateComplete;
  const reason = form.shadowRoot!.querySelector("wt-textarea")!;
  await reason.updateComplete;
  await userEvent.fill(
    page.elementLocator(reason.shadowRoot!.querySelector("textarea")!),
    "Forgot the whole shift",
  );
  await form.updateComplete;
  let proceeded = false;
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed: () => {
      proceeded = true;
    },
  });
  await app.updateComplete;
  const choice = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await choice.updateComplete;
  expect(choice.open).toBe(true);
  await userEvent.click(choice.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  expect(await leaving).toBe("kept");
  expect(proceeded).toBe(false);
  expect(reason.value).toBe("Forgot the whole shift");
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!);
  await app.updateComplete;
  await choice.updateComplete;
  expect(choice.open).toBe(true);
  const closed = new Promise((resolve) =>
    form.addEventListener("proposal-cancel", resolve, { once: true }),
  );
  await userEvent.click(choice.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await closed;
  expect(form.open).toBe(false);
  await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("[data-add-shift]")!);
  await form.updateComplete;
  expect(form.open).toBe(true);
  expect(form.shadowRoot!.querySelector("wt-textarea")!.value).toBe("");
});
