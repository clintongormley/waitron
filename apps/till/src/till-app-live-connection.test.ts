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
import { ServerRouter } from "./api/server-router.js";

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

it("the till quiets one-box probes on ready and resumes them when its device connection stops", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const stream = liveReadFixture();
  const fetchImpl = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ acceptingSales: true, term: 1, nodeId: "box" })),
    );
  const router = new ServerRouter({
    origin: location.origin,
    fetchImpl: async (...args) => (await fetchImpl(...args)).clone(),
    storage: { getItem: () => null, setItem: () => {} },
  });
  const probes = vi.spyOn(router, "probeNow");
  const { el } = await mountApp({ readLiveEvents: stream.read });
  try {
    el.router = router;
    await flush(el);
    router.start();
    await router.probeNow();
    stream.event("ready");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await probes.mock.results.at(-1)!.value;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await probes.mock.results.at(-1)!.value;
    window.dispatchEvent(new Event("pageshow"));
    stream.event("ready");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    el.remove();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  } finally {
    router.stop();
  }
});

it("a stream ending resumes one-box probes immediately", async () => {
  const stream = liveReadFixture();
  const router = new ServerRouter({
    origin: location.origin,
    fetchImpl: async () => new Response(JSON.stringify({ acceptingSales: true, term: 1 })),
    storage: { getItem: () => null, setItem: () => {} },
  });
  const probes = vi.spyOn(router, "probeNow");
  const { el } = await mountApp({ readLiveEvents: stream.read });
  try {
    el.router = router;
    await flush(el);
    router.start();
    await router.probeNow();
    stream.event("ready");
    probes.mockClear();
    stream.reads.at(-1)!.end();
    await vi.waitFor(() => expect(probes).toHaveBeenCalled());
    expect(router.waiting).toBe(false);
  } finally {
    router.stop();
  }
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

it("a workforce-disabled till opens its shared connection without clocking interests", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({
    readLiveEvents: stream.read,
    getTill: vi.fn().mockResolvedValue({ ...till("till"), clockingAvailable: false }),
  });
  await signIn(el);
  expect(stream.reads.at(-1)!.types).not.toContain("time_entries");
  stream.event("ready");
  await flush(el);
  expect(stream.reads.at(-1)!.signal?.aborted).toBe(false);
});

it("live bill changes immediately reread the open draft and bills", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  const drafts = api.listDrafts!.mock.calls.length;
  const bills = api.getPartyBills!.mock.calls.length;
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el);
  expect(api.listDrafts).toHaveBeenCalledTimes(drafts + 1);
  expect(api.getPartyBills).toHaveBeenCalledTimes(bills + 1);
});

it("the bill-draft timer quiets while connected and resumes after a connection ends", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await openTable(el);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  el.api = { ...api } as unknown as import("./api/client.js").TillApi;
  await vi.advanceTimersByTimeAsync(0);
  await el.updateComplete;
  stream.event("ready");
  await vi.advanceTimersByTimeAsync(0);
  const drafts = api.listDrafts!.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15_000);
  await el.updateComplete;
  expect(api.listDrafts).toHaveBeenCalledTimes(drafts);
  stream.reads.at(-1)!.end();
  await vi.advanceTimersByTimeAsync(0);
  const resumed = api.listDrafts!.mock.calls.length;
  expect(resumed).toBe(drafts + 1);
  await vi.advanceTimersByTimeAsync(15_000);
  await el.updateComplete;
  expect(api.listDrafts).toHaveBeenCalledTimes(resumed + 1);
});

it("a bill change during a draft read queues a fresh read", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  const answer = await api.listDrafts!.mock.results.at(-1)!.value;
  let release!: (value: typeof answer) => void;
  api.listDrafts!.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const before = api.listDrafts!.mock.calls.length;
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el);
  stream.event("change", '[{"type":"bill_edit_states"}]');
  await flush(el);
  expect(api.listDrafts).toHaveBeenCalledTimes(before + 1);
  release(answer);
  await flush(el);
  expect(api.listDrafts).toHaveBeenCalledTimes(before + 2);
});

it("a change during a focus-started draft read queues a fresh read while connected", async () => {
  const stream = liveReadFixture();
  const { el } = await mountApp({ readLiveEvents: stream.read });
  await openTable(el);
  stream.event("ready");
  await flush(el);
  const answer = await api.listDrafts!.mock.results.at(-1)!.value;
  let release!: (value: typeof answer) => void;
  api.listDrafts!.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const before = api.listDrafts!.mock.calls.length;
  window.dispatchEvent(new Event("focus"));
  await flush(el);
  expect(api.listDrafts).toHaveBeenCalledTimes(before + 1);
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el);
  expect(api.listDrafts).toHaveBeenCalledTimes(before + 1);
  release(answer);
  await flush(el);
  expect(api.listDrafts).toHaveBeenCalledTimes(before + 2);
});
