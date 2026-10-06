import { LiveData } from "@waitron/dashboard-kit";
import { LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { WtInput, WtButton, WtFormActions } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi, VenueDetailsModel, VenueDetailWrite } from "../api/client.js";
import "./venue-details-panel.js";

type Panel = LitElement & { api: DashboardApi; readOnly: boolean };
const q = <T extends HTMLElement = HTMLElement>(el: Panel, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const field = (el: Panel, name: string) => q<WtInput>(el, `[name="${name}"]`)!;
const actions = (el: Panel) => q<WtFormActions>(el, "wt-form-actions")!;
const save = (el: Panel) => q<WtButton>(el, "[data-test=save]")!;
const change = (el: Panel, name: string, value: string) =>
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
const flush = async (el: Panel) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};
const click = async (el: Panel, selector: string) => {
  q(el, selector)!.click();
  await flush(el);
};
function rig(model = venueDetailsFixture()) {
  let current = model;
  const liveData = new LiveData();
  const api = {
    liveData,
    getVenueDetails: vi.fn(async () => structuredClone(current)),
    getVenueClockPreview: vi.fn(async (clock: { timeZone: string; dayCutover: string }) => ({
      at: "2026-10-06T02:00:00.000Z",
      current: {
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
        civilDate: "2026-10-06",
        timeOfDay: "04:00",
        businessDay: "2026-10-05",
        transitions: [],
      },
      proposed: {
        ...clock,
        civilDate: "2026-10-06",
        timeOfDay: "02:00",
        businessDay: "2026-10-06",
        transitions: [
          {
            at: "2026-10-25T01:00:00.000Z",
            civilDate: "2026-10-25",
            boundaryAt: "2026-10-25T01:30:00.000Z",
            boundaryTime: "02:30",
          },
        ],
      },
      backupDeadlines: { archive: "2026-10-06T03:36:00.000Z", cloud: null },
    })),
    patchVenueDetails: vi.fn(async (body: VenueDetailWrite) => {
      current = { ...current, details: { ...current.details, ...body.changes } };
      return { changed: true, model: structuredClone(current) };
    }),
  } as unknown as DashboardApi;
  return {
    api,
    model,
    set(value: VenueDetailsModel) {
      current = value;
    },
    async notify(el: Panel, source = "locations") {
      liveData.invalidate([{ type: source }]);
      await vi.waitFor(() => expect(api.getVenueDetails).toHaveBeenCalledTimes(2));
      await flush(el);
    },
  };
}
async function mount(api: DashboardApi, readOnly = false) {
  const { el } = await mountWidget<Panel>("dashboard-venue-details-panel", { api, readOnly });
  await flush(el);
  return el;
}
async function editing(api: DashboardApi) {
  const el = await mount(api);
  await click(el, "[data-test=edit]");
  return el;
}
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("es-ES");
});

it("shows the saved issuer and venue values as text without a second page h1", async () => {
  setLocale("en-GB");
  const el = await mount(rig().api);
  expect(q(el, "[data-test=issuer]")?.textContent).toContain("Issuer SL");
  expect(q(el, "[data-test=issuer]")?.textContent).toContain("B12345678");
  expect(q(el, "[data-test=issuer]")?.textContent).toContain("ES");
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Venue");
  expect(q(el, "h1")).toBeNull();
  expect(q(el, "[data-test=edit]")).not.toBeNull();
});
it("offers no edit or confirmation to a read-only supervisor", async () => {
  const el = await mount(rig().api, true);
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Venue");
  expect(q(el, "[data-test=edit]")).toBeNull();
  expect(q(el, "wt-input")).toBeNull();
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
});
it("draws semantic shared fields, explicit unset text and a locked province explanation", async () => {
  setLocale("en-GB");
  const el = await editing(rig(venueDetailsFixture({ province: null, addressLine2: null })).api);
  expect(
    [...el.shadowRoot!.querySelectorAll("wt-input")].map((input) => input.getAttribute("name")),
  ).toEqual(["venueName", "addressLine1", "addressLine2", "city", "timeZone", "dayCutover"]);
  expect(q(el, "[data-test=locked-province]")?.textContent).toContain("Not set");
  expect(q(el, "[data-test=locked-province]")?.textContent).toContain("setup");
  expect(q(el, "[data-test=locked-postalCode]")?.textContent).toContain("setup");
  expect(field(el, "venueName").required).toBe(true);
  expect(q(el, "wt-help-tooltip")).not.toBeNull();
});
it("requires acknowledgement of a changed normalized patch and resets it on a later edit", async () => {
  setLocale("en-GB");
  const { api, model } = rig();
  const el = await editing(api);
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  change(el, "venueName", "  Cafe\u0301  ");
  await flush(el);
  expect(q(el, "[data-test=warnings]")?.textContent?.toLowerCase()).toContain("departments");
  expect(q(el, "[data-test=warnings]")?.textContent).toContain("past receipts");
  expect(save(el).disabled).toBe(true);
  await click(el, "[data-test=acknowledge]");
  expect(save(el).disabled).toBe(false);
  change(el, "venueName", "Café");
  await flush(el);
  expect(save(el).disabled).toBe(false);
  change(el, "venueName", "Different");
  await flush(el);
  expect(save(el).disabled).toBe(true);
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(api.patchVenueDetails).toHaveBeenCalledExactlyOnceWith({
    changes: { name: "Different" },
    expected: model.details,
  });
  expect(q(el, "wt-input")).toBeNull();
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Different");
});
it("saves a name-only correction without adding or validating legacy-null address values", async () => {
  const { api, model } = rig(
    venueDetailsFixture({ addressLine1: null, postalCode: null, city: null, province: null }),
  );
  const el = await editing(api);
  change(el, "venueName", "Corrected");
  await flush(el);
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(api.patchVenueDetails).toHaveBeenCalledExactlyOnceWith({
    changes: { name: "Corrected" },
    expected: model.details,
  });
});
it("marks every bad changed field, focuses the first and disables only until fixed", async () => {
  setLocale("en-GB");
  const { api } = rig();
  const el = await editing(api);
  change(el, "addressLine1", " ");
  change(el, "city", " ");
  await flush(el);
  await click(el, "[data-test=save]");
  expect(field(el, "addressLine1").error).toBe("Enter a value.");
  expect(field(el, "city").error).toBe("Enter a value.");
  expect(el.shadowRoot!.activeElement).toBe(field(el, "addressLine1"));
  expect(field(el, "addressLine1").shadowRoot!.activeElement?.getAttribute("name")).toBe(
    "addressLine1",
  );
  expect(actions(el).error).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(true);
  expect(api.patchVenueDetails).not.toHaveBeenCalled();
  change(el, "addressLine1", "New street");
  change(el, "city", "Madrid");
  await flush(el);
  expect(save(el).disabled).toBe(false);
  await click(el, "[data-test=save]");
  expect(api.patchVenueDetails).toHaveBeenCalledOnce();
});
it("maps a server name refusal to venueName with a retryable Save", async () => {
  setLocale("en-GB");
  const { api } = rig();
  vi.mocked(api.patchVenueDetails).mockRejectedValue({
    code: "venue.detail_invalid",
    params: { field: "name", reason: "length" },
  });
  const el = await editing(api);
  change(el, "venueName", "New name");
  await flush(el);
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(field(el, "venueName").error).not.toBe("");
  expect(field(el, "city").error).toBe("");
  expect(el.shadowRoot!.activeElement).toBe(field(el, "venueName"));
  expect(actions(el).error).toBe("Correct the highlighted fields to continue.");
  expect(save(el).disabled).toBe(false);
});
it("keeps the draft and opening expected values across an external edit; Cancel adopts latest", async () => {
  const r = rig();
  const el = await editing(r.api);
  change(el, "addressLine1", "My street");
  await flush(el);
  field(el, "addressLine1").focus();
  r.set(venueDetailsFixture({ name: "Other editor", city: "Toledo" }));
  await r.notify(el);
  expect(field(el, "addressLine1").value).toBe("My street");
  expect(field(el, "venueName").value).toBe("Venue");
  expect(el.shadowRoot!.activeElement).toBe(field(el, "addressLine1"));
  await click(el, "[data-test=save]");
  expect(r.api.patchVenueDetails).toHaveBeenCalledExactlyOnceWith({
    changes: { addressLine1: "My street" },
    expected: r.model.details,
  });
  await click(el, "[data-test=edit]");
  change(el, "addressLine1", "Discard");
  await flush(el);
  await click(el, "[data-test=cancel]");
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Other editor");
  expect(q(el, "[data-test=saved-addressLine1]")?.textContent?.trim()).toBe("My street");
});
it("a first sale updates locks without discarding the proposed clock value", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await editing(r.api);
  change(el, "timeZone", "UTC");
  await flush(el);
  const locked = venueDetailsFixture();
  locked.hasSales = true;
  locked.policy.timeZone = { decision: "refuse", reasons: ["sales"] };
  locked.policy.dayCutover = { decision: "refuse", reasons: ["sales"] };
  r.set(locked);
  await r.notify(el, "sales");
  expect(field(el, "timeZone").value).toBe("UTC");
  expect(q(el, "[data-test=lock-timeZone]")?.textContent).toContain("sales");
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(r.api.patchVenueDetails).toHaveBeenCalledWith({
    changes: { timeZone: "UTC" },
    expected: r.model.details,
  });
});
it("a successful write closes the editor before a failed refresh and never resends", async () => {
  setLocale("en-GB");
  const { api } = rig();
  vi.mocked(api.getVenueDetails)
    .mockResolvedValueOnce(venueDetailsFixture())
    .mockRejectedValue({ code: "connection.failed" });
  const el = await editing(api);
  change(el, "addressLine1", "New street");
  await flush(el);
  await click(el, "[data-test=save]");
  expect(q(el, "wt-input")).toBeNull();
  expect(q(el, "[data-test=saved-addressLine1]")?.textContent?.trim()).toBe("New street");
  expect(q(el, "[data-test=read-error]")?.textContent).toContain("connect");
  expect(api.patchVenueDetails).toHaveBeenCalledOnce();
});
it("read failures and recovery cannot erase an action refusal", async () => {
  setLocale("en-GB");
  const r = rig();
  vi.mocked(r.api.patchVenueDetails).mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "addressLine1" },
  });
  const el = await editing(r.api);
  change(el, "addressLine1", "Mine");
  await flush(el);
  await click(el, "[data-test=save]");
  const refusal = field(el, "addressLine1").error;
  expect(refusal).toContain("changed");
  vi.mocked(r.api.getVenueDetails).mockRejectedValueOnce({ code: "connection.failed" });
  await r.notify(el);
  expect(field(el, "addressLine1").error).toBe(refusal);
  vi.mocked(r.api.getVenueDetails).mockResolvedValue(venueDetailsFixture({ name: "Newest" }));
  r.api.liveData!.invalidate([{ type: "locations" }]);
  await flush(el);
  await flush(el);
  expect(field(el, "addressLine1").error).toBe(refusal);
  expect(actions(el).error).toContain("highlighted");
});
it("does not PATCH or prompt when all values are unchanged", async () => {
  const { api } = rig();
  const el = await editing(api);
  await click(el, "[data-test=save]");
  expect(api.patchVenueDetails).not.toHaveBeenCalled();
  expect(q(el, "[data-test=acknowledge]")).toBeNull();
  expect(q(el, "wt-input")).toBeNull();
});

it("editing away from an acknowledged patch and back requires a fresh acknowledgement", async () => {
  const { api } = rig();
  const el = await editing(api);
  change(el, "venueName", "First change");
  await flush(el);
  await click(el, "[data-test=acknowledge]");
  change(el, "venueName", "Other change");
  await flush(el);
  change(el, "venueName", "First change");
  await flush(el);
  expect(save(el).disabled).toBe(true);
  expect(q(el, "[data-test=acknowledge]")).not.toBeNull();
});
it("an unrelated edit keeps the server's field refusal until that field is edited", async () => {
  setLocale("en-GB");
  const { api } = rig();
  vi.mocked(api.patchVenueDetails).mockRejectedValue({
    code: "venue.detail_changed",
    params: { field: "addressLine1" },
  });
  const el = await editing(api);
  change(el, "addressLine1", "Mine");
  await flush(el);
  await click(el, "[data-test=save]");
  const refusal = field(el, "addressLine1").error;
  expect(refusal).toContain("changed");
  change(el, "addressLine2", "Upstairs");
  await flush(el);
  expect(field(el, "addressLine1").error).toBe(refusal);
  change(el, "addressLine1", "Corrected");
  await flush(el);
  expect(field(el, "addressLine1").error).toBe("");
});
it("blocks implicit Enter while the changed-field review is unresolved", async () => {
  const { api } = rig();
  const el = await editing(api);
  change(el, "venueName", "Changed");
  await flush(el);
  field(el, "venueName").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }),
  );
  q(el, "form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush(el);
  expect(api.patchVenueDetails).not.toHaveBeenCalled();
});
it("keeps the opening read generation separate from a reopened panel", async () => {
  const { api } = rig();
  let complete!: (value: VenueDetailsModel) => void;
  vi.mocked(api.getVenueDetails)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(venueDetailsFixture({ name: "Reopened" }));
  const el = await mount(api);
  expect(q(el, "[role=status]")).not.toBeNull();
  const host = el.parentElement!;
  el.remove();
  host.append(el);
  await flush(el);
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Reopened");
  complete(venueDetailsFixture({ name: "Old generation" }));
  await flush(el);
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Reopened");
  expect(api.liveData!.interests).toHaveLength(5);
  el.remove();
  expect(api.liveData!.interests).toEqual([]);
});
it("a detached save cannot replace a reopened panel's new saved values", async () => {
  const r = rig();
  let complete!: (value: { changed: boolean; model: VenueDetailsModel }) => void;
  vi.mocked(r.api.patchVenueDetails).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const el = await editing(r.api);
  change(el, "addressLine1", "Old request");
  await flush(el);
  q(el, "[data-test=save]")!.click();
  await flush(el);
  const host = el.parentElement!;
  el.remove();
  r.set(venueDetailsFixture({ name: "Reopened" }));
  host.append(el);
  await flush(el);
  complete({ changed: true, model: venueDetailsFixture({ name: "Old reply" }) });
  await flush(el);
  await click(el, "[data-test=cancel]");
  expect(q(el, "[data-test=saved-name]")?.textContent?.trim()).toBe("Reopened");
});
it("shows a refusal without a visible field at the bottom without disabling retry", async () => {
  setLocale("en-GB");
  const { api } = rig();
  vi.mocked(api.patchVenueDetails).mockRejectedValue({
    code: "authorization.not_permitted",
    params: { field: "body" },
  });
  const el = await editing(api);
  change(el, "addressLine1", "New street");
  await flush(el);
  await click(el, "[data-test=save]");
  expect(actions(el).error).toBe("You don't have permission to do that");
  expect(save(el).disabled).toBe(false);
  expect(
    [...el.shadowRoot!.querySelectorAll<WtInput>("wt-input")].every((field) => field.error === ""),
  ).toBe(true);
});

it("explains current-address printing for a street correction without changing saved issuer text", async () => {
  setLocale("en-GB");
  const { api } = rig();
  const el = await editing(api);
  change(el, "addressLine1", "Corrected address");
  await flush(el);
  expect(q(el, "[data-test=address-notice]")?.textContent).toContain("copies of earlier sales");
  expect(q(el, "[data-test=issuer]")?.textContent).toContain("Issuer SL");
});

it("explains the consequences beside the filled name and clock fields", async () => {
  setLocale("en-GB");
  const el = await editing(rig().api);
  const nameHelp = field(el, "venueName").parentElement!.querySelector("wt-help-tooltip")!;
  const clockHelp = field(el, "timeZone").parentElement!.querySelector("wt-help-tooltip")!;
  expect(nameHelp.textContent?.toLowerCase()).toContain("departments");
  expect(clockHelp.textContent).toContain("Manual day overrides");
  expect(nameHelp.getAttribute("aria-label")).toContain("Venue name");
});

it("shows captured old/new civil and business dates, transition boundaries and retained deadlines before clock acknowledgement", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await editing(r.api);
  change(el, "timeZone", "UTC");
  await flush(el);
  expect(r.api.getVenueClockPreview).toHaveBeenCalledWith({ timeZone: "UTC", dayCutover: "06:00" });
  const preview = q(el, "[data-test=clock-preview]")!;
  expect(preview.textContent).toContain("2026-10-06T02:00:00.000Z");
  expect(preview.textContent).toContain("2026-10-05");
  expect(preview.textContent).toContain("04:00");
  expect(preview.textContent).toContain("02:00");
  expect(preview.textContent).toContain("2026-10-25T01:30:00.000Z");
  expect(preview.textContent).toContain("02:30");
  expect(preview.textContent).toContain("2026-10-06T03:36:00.000Z");
  expect(preview.textContent).toContain("No deadline is scheduled");
  expect(save(el).disabled).toBe(true);
  await click(el, "[data-test=acknowledge]");
  expect(save(el).disabled).toBe(false);
});
it("blocks acknowledgement and Enter while the matching clock preview is pending, and ignores an obsolete reply", async () => {
  const r = rig();
  let oldReply!: (value: Awaited<ReturnType<DashboardApi["getVenueClockPreview"]>>) => void;
  const answer = await r.api.getVenueClockPreview({ timeZone: "UTC", dayCutover: "06:00" });
  vi.mocked(r.api.getVenueClockPreview)
    .mockClear()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldReply = resolve;
        }),
    );
  const el = await editing(r.api);
  change(el, "timeZone", "UTC");
  await flush(el);
  expect(q<WtButton>(el, "[data-test=acknowledge]")!.disabled).toBe(true);
  await click(el, "[data-test=acknowledge]");
  el.shadowRoot!.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  expect(r.api.patchVenueDetails).not.toHaveBeenCalled();
  change(el, "timeZone", "Europe/London");
  await flush(el);
  expect(q(el, "[data-test=clock-proposed]")!.textContent).toContain("Europe/London");
  oldReply(answer);
  await flush(el);
  expect(q(el, "[data-test=clock-proposed]")!.textContent).toContain("Europe/London");
});
it("allows a failed clock preview to retry without losing the draft", async () => {
  setLocale("en-GB");
  const r = rig();
  vi.mocked(r.api.getVenueClockPreview).mockRejectedValueOnce({ code: "connection.failed" });
  const el = await editing(r.api);
  change(el, "timeZone", "UTC");
  await flush(el);
  expect(field(el, "timeZone").value).toBe("UTC");
  expect(q(el, "[data-test=clock-error]")).not.toBeNull();
  expect(save(el).disabled).toBe(true);
  await click(el, "[data-test=preview-retry]");
  expect(q(el, "[data-test=clock-error]")).toBeNull();
  expect(q(el, "[data-test=clock-preview]")).not.toBeNull();
  await click(el, "[data-test=acknowledge]");
  expect(save(el).disabled).toBe(false);
});

it("previews the latest saved zone when only the cutover is changed, preserving the opening draft", async () => {
  const r = rig();
  const el = await editing(r.api);
  change(el, "dayCutover", "02:30");
  await flush(el);
  r.set(venueDetailsFixture({ timeZone: "Europe/London" }));
  await r.notify(el);
  expect(field(el, "timeZone").value).toBe("Europe/Madrid");
  expect(r.api.getVenueClockPreview).toHaveBeenLastCalledWith({
    timeZone: "Europe/London",
    dayCutover: "02:30",
  });
  expect(save(el).disabled).toBe(true);
});

it("explains an unavailable country beside the changed city and leaves retry available", async () => {
  setLocale("en-GB");
  const { api } = rig();
  vi.mocked(api.patchVenueDetails).mockRejectedValue({
    code: "venue.detail_invalid",
    params: { field: "city", reason: "country_unavailable" },
  });
  const el = await editing(api);
  change(el, "city", "New town");
  await flush(el);
  await click(el, "[data-test=acknowledge]");
  await click(el, "[data-test=save]");
  expect(field(el, "city").error).toBe(
    "This geography cannot be changed here. A different fiscal or language context requires separate setup or a venue reset.",
  );
  expect(save(el).disabled).toBe(false);
});
