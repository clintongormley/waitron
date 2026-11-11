import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import {
  api,
  floor,
  emit,
  flush,
  lock,
  mountApp,
  openTable,
  resetAllergyFixture,
  shell,
  signIn,
  till,
} from "../test/allergy-app-fixture.js";
import { liveReadFixture } from "../test/live-connection.js";

const locale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetAllergyFixture();
});
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale(locale);
});

it("a normal table visit adds no streams or unrelated menu reads", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await flush(el);
  await signIn(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  stream.event("ready");
  await flush(el);
  const streams = stream.reads.length,
    menus = api.menuState!.mock.calls.length;
  emit(floor(el)!, "open-table", { tableId: "t4", seated: true });
  await flush(el);
  emit(shell(el), "screen-select", { screen: "floor" });
  await flush(el);
  expect(stream.reads).toHaveLength(streams);
  expect(api.menuState).toHaveBeenCalledTimes(menus);
  window.dispatchEvent(new Event("pagehide"));
  await flush(el);
  expect(api.menuState).toHaveBeenCalledTimes(menus);
  expect(stream.reads.at(-1)!.signal?.aborted).toBe(true);
});

it("an ended person session locks the till while its device connection stays up", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const stream = liveReadFixture();
  const { el } = await mountApp({
    readLiveEvents: stream.read,
    listIncomingDepartmentTransfers: vi.fn().mockResolvedValue({ receiving: false, requests: [] }),
    listDepartmentSentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
  });
  await flush(el);
  emit(lock(el), "logged-in", {
    personId: "p1",
    displayName: "Waiter",
    permissions: ["payment.take"],
  });
  await flush(el);
  stream.event("ready");
  await flush(el);
  api.menuState!.mockRejectedValue({ code: "session.required", status: 401 });
  api.listIncomingDepartmentTransfers!.mockRejectedValue({ code: "session.required", status: 401 });
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(() => expect(lock(el)).not.toBeNull());
  expect(stream.reads.at(-1)!.signal?.aborted).toBe(false);
});

it("starts with the till identity before sign-in, adds transfers with the person and keeps the device connection after sign-out", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({
    readLiveEvents: stream.read,
    getTill: vi.fn().mockResolvedValue({ ...till("till"), capabilities: ["take-orders"] }),
    listIncomingDepartmentTransfers: vi.fn().mockResolvedValue({ receiving: false, requests: [] }),
    listDepartmentSentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
  });
  await vi.waitFor(() => expect(stream.reads.length).toBeGreaterThan(0));
  expect(lock(el)).not.toBeNull();
  expect(stream.reads.at(-1)!.types).not.toContain("department_transfer_requests");
  emit(lock(el), "logged-in", {
    personId: "p1",
    displayName: "Waiter",
    permissions: ["payment.take"],
  });
  await flush(el);
  expect(stream.reads.at(-1)!.types).toContain("department_transfer_requests");
  emit(shell(el), "logout");
  await vi.waitFor(() => expect(lock(el)).not.toBeNull());
  expect(stream.reads.at(-1)!.types).not.toContain("department_transfer_requests");
  expect(stream.reads.at(-1)!.signal?.aborted).toBe(false);
  stream.event("ready");
  el.remove();
  expect(stream.reads.at(-1)!.signal?.aborted).toBe(true);
});

it.each(["phone-portrait", "kds"])(
  "keeps timed reads without opening a stream on %s under measure six's fallback",
  async (formFactor) => {
    const readLiveEvents = vi.fn();
    const { el } = await mountApp({
      readLiveEvents,
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "device-1",
        name: "Display",
        formFactor,
        kitchenScreens: [],
      }),
    });
    await flush(el);
    expect(api.getDeviceIdentity).toHaveBeenCalled();
    expect(readLiveEvents).not.toHaveBeenCalled();
  },
);

it("a revoked live device goes back to the join screen", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await vi.waitFor(() => expect(stream.reads.length).toBeGreaterThan(0));
  api.getDeviceIdentity!.mockRejectedValue({ code: "device.unauthorized" });
  stream.event("session-invalid", '{"code":"device.unauthorized"}');
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-enrol-screen")).not.toBeNull());
  expect(stream.reads.at(-1)!.signal?.aborted).toBe(true);
});

it("re-reads table allergies on change and quiets their timer while connected", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await openTable(el);
  const read = api.readPartyAllergy!;
  expect(stream.reads.length).toBeGreaterThan(0);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  stream.event("ready");
  await vi.advanceTimersByTimeAsync(0);
  const before = read.mock.calls.length;
  stream.event("change", '[{"type":"party_allergy"}]');
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(before + 1));
  stream.event("change", '[{"type":"device_profile_admission_roles"}]');
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(before + 2));
  stream.event("change", '[{"type":"devices"}]');
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(before + 3));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(read).toHaveBeenCalledTimes(before + 3);
});
