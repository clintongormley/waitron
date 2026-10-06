import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, applyTokens } from "@waitron/ui";
import { codeMessage, setLocale } from "@waitron/dashboard-kit";
import { BookingApi, type Booking } from "./client.js";
import type { BookingForm } from "./booking-form.js";
import "./bookings-screen.js";

const booked: Booking = {
  id: "booking-one",
  bookingDate: "2026-08-20",
  bookingTime: "20:00:00",
  partySize: 4,
  contactName: "García",
  contactPhone: null,
  notes: null,
  tableId: null,
  tabId: null,
  status: "booked",
  createdBy: "person-one",
  createdAt: "2026-08-19T10:00:00.000Z",
};
class BookingLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: BookingApi;
  override render() {
    return html`<dashboard-bookings-screen .api=${this.api}></dashboard-bookings-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("booking-leave-test-app", BookingLeaveApp);
let app: BookingLeaveApp;
afterEach(() => app?.remove());

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(
  options: { write?: Promise<void>; refreshFails?: boolean; bookings?: Booking[] } = {},
) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  let reads = 0;
  const api = new BookingApi(
    async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
      if (method !== "GET") {
        writes.push({ path, method, body });
        await options.write;
        if (path.endsWith("/seat")) return { tabId: "tab-one" } as T;
        if (path === "/management-api/bookings") return { id: "created-one" } as T;
        return undefined as T;
      }
      if (path.includes("bookings")) {
        if (++reads > 1 && options.refreshFails) throw { code: "connection.failed" };
        return (options.bookings ?? [
          booked,
          { ...booked, id: "booking-two", contactName: "Second guest", notes: "Second note" },
        ]) as T;
      }
      return [
        {
          id: "table-one",
          label: "Window",
          zoneId: null,
          capacity: 4,
          active: true,
          createdAt: "2026-01-01",
        },
      ] as T;
    },
  );
  setLocale("en");
  app = document.createElement("booking-leave-test-app") as BookingLeaveApp;
  app.api = api;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector("dashboard-bookings-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("[data-test=row]")).not.toBeNull();
  return { screen, writes };
}
async function open(screen: HTMLElementTagNameMap["dashboard-bookings-screen"], edit = true) {
  screen
    .shadowRoot!.querySelector<HTMLElement>(
      `[data-test=${edit ? "edit-booking-one" : "add-booking"}]`,
    )!
    .click();
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-booking-form")!;
  await form.updateComplete;
  await dialog(form).updateComplete;
  return form;
}
function dialog(form: BookingForm) {
  return form.shadowRoot!.querySelector("wt-dialog")!;
}
function native(form: BookingForm) {
  return dialog(form).shadowRoot!.querySelector("dialog")!;
}
function input(form: BookingForm, field: string) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${field}]`)!;
}
async function field(form: BookingForm, name: string, value: string) {
  input(form, name).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await form.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
async function save(form: BookingForm) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await form.updateComplete;
}

for (const edit of [false, true]) {
  it(`keeps ${edit ? "Edit" : "Add"} contact input through native Escape, then discards once`, async () => {
    const { screen, writes } = await mount();
    const form = await open(screen, edit);
    let closed = 0;
    form.addEventListener("wt-close", () => closed++);
    await field(form, "contact-name", "Ortega");
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(native(form).open).toBe(true);
    await choose("keep");
    expect(input(form, "contact-name").value).toBe("Ortega");
    expect(closed).toBe(0);
    expect(writes).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await choose("discard");
    await expect.poll(() => form.open).toBe(false);
    expect(closed).toBe(1);
    expect(unload()).toBe(false);
  });
}

it.each([
  ["booking-date", "2026-08-21"],
  ["booking-time", "20:30"],
  ["party-size", "5"],
  ["party-size", ""],
  ["contact-name", " García "],
  ["contact-phone", "600123456"],
  ["notes", "Window"],
])("protects the submitted %s value %s", async (name, value) => {
  const { screen } = await mount();
  const form = await open(screen);
  await field(form, name, value);
  expect(unload()).toBe(true);
  const closing = dialog(form).requestClose("cancel");
  expect((await question()).open).toBe(true);
  await choose("keep");
  expect(await closing).toBe(false);
  expect(input(form, name).value).toBe(value);
});

it("compares table selection and restores no table after discard", async () => {
  const { screen } = await mount();
  const form = await open(screen);
  const table = form.shadowRoot!.querySelector("wt-combobox")!;
  table.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "table-one" } }));
  await form.updateComplete;
  expect(unload()).toBe(true);
  const closing = dialog(form).requestClose("cancel");
  await choose("discard");
  expect(await closing).toBe(true);
  await expect.poll(() => form.open).toBe(false);
  await open(screen);
  expect(form.shadowRoot!.querySelector("wt-combobox")!.value).toBe("");
});

it("closes clean or normalized reverted edits without asking", async () => {
  const { screen } = await mount();
  const form = await open(screen);
  await field(form, "contact-name", "Other");
  await field(form, "contact-name", "García");
  await field(form, "party-size", "04");
  await field(form, "contact-phone", "  ");
  await field(form, "notes", "  ");
  expect(unload()).toBe(false);
  expect(await dialog(form).requestClose("cancel")).toBe(true);
  await expect.poll(() => form.open).toBe(false);
  expect((await question()).open).toBe(false);
});

it("keeps a same-id refreshed booking from replacing the opening values and dirty baseline", async () => {
  const { screen } = await mount();
  const form = await open(screen);
  await field(form, "notes", "Locally entered");
  form.booking = { ...booked, notes: "Background response" };
  await form.updateComplete;
  expect(input(form, "notes").value).toBe("Locally entered");
  await field(form, "notes", "");
  expect(unload()).toBe(false);
});

it.each([false, true])("commits accepted %s writes before a refused list refresh", async (edit) => {
  const { screen, writes } = await mount({ refreshFails: true });
  const form = await open(screen, edit);
  await field(form, "booking-date", "2026-08-20");
  await field(form, "booking-time", "20:00");
  await field(form, "party-size", "4");
  await field(form, "contact-name", "Ortega");
  expect(unload()).toBe(true);
  await save(form);
  await expect.poll(() => form.open).toBe(false);
  expect(unload()).toBe(false);
  expect(writes).toEqual([
    {
      path: edit ? "/management-api/bookings/booking-one" : "/management-api/bookings",
      method: edit ? "PATCH" : "POST",
      body: {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Ortega",
        contactPhone: null,
        notes: null,
        tableId: null,
      },
    },
  ]);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[role=alert]")?.textContent)
    .toContain(codeMessage("connection.failed", "en"));
});

it("blocks dismissal during a pending write and retains a refused draft", async () => {
  const pending = deferred();
  const { screen, writes } = await mount({ write: pending.promise });
  const form = await open(screen);
  await field(form, "notes", "High chair");
  await save(form);
  await expect.poll(() => form.busy).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect(native(form).open).toBe(true);
  expect((await question()).open).toBe(false);
  pending.reject({ code: "connection.failed" });
  await expect.poll(() => form.busy).toBe(false);
  expect(writes).toHaveLength(1);
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await choose("keep");
  expect(input(form, "notes").value).toBe("High chair");
});

it("commits only the submitted snapshot when newer input arrives during a write", async () => {
  const pending = deferred();
  const { screen, writes } = await mount({ write: pending.promise });
  const form = await open(screen);
  await field(form, "notes", "Submitted note");
  await save(form);
  await expect.poll(() => form.busy).toBe(true);
  await field(form, "notes", "Newer note");
  pending.resolve();
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(input(form, "notes").value).toBe("Newer note");
  expect(writes[0]!.body).toEqual({
    bookingDate: "2026-08-20",
    bookingTime: "20:00",
    partySize: 4,
    contactName: "García",
    contactPhone: null,
    notes: "Submitted note",
    tableId: null,
  });
  expect(unload()).toBe(true);
  await field(form, "notes", "Submitted note");
  expect(unload()).toBe(false);
});

it("invalidates a pending answer and detached controls when the booking identity changes", async () => {
  const { screen, writes } = await mount();
  const form = await open(screen);
  await field(form, "notes", "First draft");
  const oldField = input(form, "notes");
  const oldSave = form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!;
  const oldDialog = dialog(form);
  const closing = oldDialog.requestClose("cancel");
  const oldQuestion = await question();
  form.booking = {
    ...booked,
    id: "booking-two",
    contactName: "Second guest",
    notes: "Second note",
  };
  await form.updateComplete;
  oldQuestion.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await closing).toBe(false);
  oldField.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed input" } }));
  oldSave.click();
  oldDialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await form.updateComplete;
  expect(form.open).toBe(true);
  expect(input(form, "notes").value).toBe("Second note");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("disconnect disposes a dirty scope and cancels its question", async () => {
  const { screen } = await mount();
  const form = await open(screen);
  await field(form, "notes", "Unsubmitted");
  const closing = dialog(form).requestClose("cancel");
  expect((await question()).open).toBe(true);
  screen.remove();
  expect(await closing).toBe(false);
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
});

it("an earlier successful write cannot close a replacement booking editor", async () => {
  const pending = deferred();
  const { screen, writes } = await mount({ write: pending.promise });
  const form = await open(screen);
  await field(form, "notes", "First booking submitted");
  await save(form);
  await expect.poll(() => form.busy).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-booking-two]")!.click();
  await screen.updateComplete;
  await form.updateComplete;
  await field(form, "notes", "Second booking draft");
  pending.resolve();
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(form.booking!.id).toBe("booking-two");
  expect(input(form, "notes").value).toBe("Second booking draft");
  expect(writes).toEqual([
    {
      path: "/management-api/bookings/booking-one",
      method: "PATCH",
      body: {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        contactPhone: null,
        notes: "First booking submitted",
        tableId: null,
      },
    },
  ]);
  expect(unload()).toBe(true);
});

it("a successful write makes a prior discard answer inert", async () => {
  const { screen } = await mount();
  const form = await open(screen);
  await field(form, "notes", "Accepted note");
  const closing = dialog(form).requestClose("cancel");
  const oldQuestion = await question();
  expect(oldQuestion.open).toBe(true);
  await save(form);
  await expect.poll(() => form.open).toBe(false);
  expect(await closing).toBe(false);
  await open(screen);
  await field(form, "notes", "Replacement draft");
  oldQuestion.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  expect(form.open).toBe(true);
  expect(input(form, "notes").value).toBe("Replacement draft");
  expect(unload()).toBe(true);
});

it("clean Add and Edit close directly through native Escape", async () => {
  const { screen, writes } = await mount();
  for (const edit of [false, true]) {
    const form = await open(screen, edit);
    expect(unload()).toBe(false);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => form.open).toBe(false);
    expect((await question()).open).toBe(false);
  }
  expect(writes).toEqual([]);
});

it("an earlier refused write cannot put its error on a replacement booking editor", async () => {
  const pending = deferred();
  const { screen } = await mount({ write: pending.promise });
  const form = await open(screen);
  await field(form, "notes", "First booking submitted");
  await save(form);
  await expect.poll(() => form.busy).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-booking-two]")!.click();
  await screen.updateComplete;
  await form.updateComplete;
  await field(form, "notes", "Second booking draft");
  pending.reject({ code: "connection.failed" });
  await expect.poll(() => form.busy).toBe(false);
  expect(screen.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(form.open).toBe(true);
  expect(input(form, "notes").value).toBe("Second booking draft");
  expect(unload()).toBe(true);
});

it("calendar filtering stays exempt from the leave question", async () => {
  const { screen, writes } = await mount();
  screen
    .shadowRoot!.querySelector("[data-test=booking-date-picker]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2026-08-21" } }));
  await screen.updateComplete;
  expect(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[data-test=booking-date-picker]",
    )!.value,
  ).toBe("2026-08-21");
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});

it.each([
  ["seat", "booked", {}],
  ["no-show", "booked", undefined],
  ["cancel", "booked", undefined],
  ["complete", "seated", undefined],
] as const)(
  "immediate %s remains exempt and sends its existing command",
  async (action, status, body) => {
    const { screen, writes } = await mount({
      bookings: [
        { ...booked, status, tableId: "table-one", tabId: status === "seated" ? "tab-one" : null },
      ],
    });
    screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}-booking-one]`)!.click();
    await expect.poll(() => writes.length).toBe(1);
    await screen.updateComplete;
    expect(writes).toEqual([
      { path: `/management-api/bookings/booking-one/${action}`, method: "POST", body },
    ]);
    expect(unload()).toBe(false);
    expect((await question()).open).toBe(false);
    expect(screen.shadowRoot!.querySelector("dashboard-booking-form")!.open).toBe(false);
  },
);
