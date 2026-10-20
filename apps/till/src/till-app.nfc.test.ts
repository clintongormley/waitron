import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeNdefReader,
  installNfc,
  NFC_EQUIPMENT,
  PRINTER_ID,
  READER_ID,
} from "../test/equipment-nfc.js";
import { emit, mountEquipmentApp, openEquipment, signIn } from "../test/equipment-app.js";
import type { WtToast } from "@waitron/ui";
import type { TillApp } from "./till-app.js";
import type { TillEquipmentDialog } from "./widgets/equipment-dialog.js";
import { TillApi } from "./api/client.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";

beforeEach(() => {
  setLocale("en");
  installNfc();
});
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en");
});

async function reader() {
  await vi.waitFor(() => expect(FakeNdefReader.instances.at(-1)?.signal).toBeDefined());
  return FakeNdefReader.instances.at(-1)!;
}
const notice = (el: TillApp) => el.shadowRoot!.querySelector<WtToast>("[data-nfc-notice]");

async function signOut(el: TillApp) {
  emit(el.shadowRoot!.querySelector("till-shell")!, "logout");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
}

describe("NFC throughout the till", () => {
  it.each([
    ["receipt", "chosen", "Picked up Portable printer"],
    ["receipt", "resolved", "Picked up Portable printer"],
    ["payment_slip", "chosen", "slip only"],
    ["payment_slip", "resolved", "slip only"],
    ["receipt+payment_slip", "chosen", "Picked up Portable printer"],
  ])("an accepted printer scan confirms its %s %s assignment", async (target, source, message) => {
    const stored = {
      roles: NFC_EQUIPMENT.roles.map((role) =>
        target.split("+").includes(role.role)
          ? {
              ...role,
              ...(source === "chosen"
                ? { selection: "item", chosenId: PRINTER_ID, chosen: role.choices[0]! }
                : { resolved: { id: PRINTER_ID, name: "Portable printer", available: true } }),
            }
          : role,
      ),
    };
    const { el } = await mountEquipmentApp({
      setDeviceEquipment: vi.fn().mockResolvedValue(stored),
    });
    await signIn(el);
    (await reader()).read(`waitron-equipment:printer:${PRINTER_ID}`);
    const expected =
      message === "slip only"
        ? t("equipment.picked_up_slip_only").replace("{item}", "Portable printer")
        : message;
    await vi.waitFor(() => expect(notice(el)?.message).toBe(expected));
    expect(notice(el)?.tone).toBe("info");
  });
  it.each(["none", "drawer-only"])(
    "an accepted printer scan with %s assignment reports no selected printer role",
    async (assignment) => {
      const stored = {
        roles: NFC_EQUIPMENT.roles.map((role) =>
          assignment === "drawer-only" && role.role === "cash_drawer"
            ? {
                ...role,
                selection: "item",
                chosenId: PRINTER_ID,
                resolved: { id: PRINTER_ID, name: "Portable printer", available: true },
              }
            : role,
        ),
      };
      const setDeviceEquipment = vi.fn().mockResolvedValue(stored);
      const { el } = await mountEquipmentApp({ setDeviceEquipment });
      await signIn(el);
      (await reader()).read(`waitron-equipment:printer:${PRINTER_ID}`);
      await vi.waitFor(() =>
        expect(notice(el)?.message).toBe("No printer role selected. Choose a role in Equipment."),
      );
      expect(notice(el)?.tone).toBe("info");
      expect(setDeviceEquipment.mock.calls[0]![0]).toEqual({
        kind: "printer",
        selection: { id: PRINTER_ID },
        via: "scan",
      });
    },
  );
  it.each(["continue", "cancel"])(
    "holds a tap while a named operator's profile loads, and respects %s",
    async (action) => {
      const identity = {
        deviceId: "nfc-till",
        name: "Terrace handheld",
        formFactor: "handheld",
        profileId: "counter",
        approvedProfiles: [
          { id: "counter", name: "Counter", formFactor: "handheld" },
          { id: "terrace", name: "Terrace", formFactor: "handheld" },
        ],
      };
      const { el, api, requests } = await mountEquipmentApp({
        getDeviceIdentity: vi.fn(async () => identity),
        switchDeviceProfile: vi.fn(async () => {
          identity.profileId = "terrace";
          return { activeProfileId: "terrace" };
        }),
      });
      await signIn(el);
      const offers = await api.listDefaultZoneOffers();
      let release!: () => void;
      vi.mocked(api.listDefaultZoneOffers).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(offers);
          }),
      );
      emit(el.shadowRoot!.querySelector("till-shell")!, "open-profile");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("till-profile-dialog")).not.toBeNull(),
      );
      emit(el.shadowRoot!.querySelector("till-profile-dialog")!, "profile-switch", {
        profileId: "terrace",
      });
      await vi.waitFor(() => expect(release).toBeDefined());
      (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
      await el.updateComplete;
      expect(requests).toEqual([]);
      if (action === "cancel") await signOut(el);
      release();
      if (action === "continue") await vi.waitFor(() => expect(requests).toHaveLength(1));
      else {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await signIn(el);
        await el.updateComplete;
        expect(requests).toEqual([]);
        (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
        await vi.waitFor(() => expect(requests).toHaveLength(1));
      }
    },
  );
  it("a failed sign-in equipment read keeps the cached list but displays the server's binding refusal", async () => {
    const calls: unknown[] = [];
    const client = new TillApi("", async (_url, init) => {
      calls.push(JSON.parse(init!.body as string));
      return new Response(
        JSON.stringify({
          error: { code: "device.binding_invalid", params: { field: "cardReaderId" } },
        }),
        { status: 400 },
      );
    });
    const getDeviceEquipment = vi
      .fn()
      .mockResolvedValueOnce(NFC_EQUIPMENT)
      .mockRejectedValue(new TypeError("offline"));
    const { el } = await mountEquipmentApp({
      getDeviceEquipment,
      setDeviceEquipment: client.setDeviceEquipment.bind(client),
    });
    await signIn(el);
    await vi.waitFor(() => expect(getDeviceEquipment).toHaveBeenCalledTimes(1));
    await signOut(el);
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await signIn(el);
    await vi.waitFor(() => expect(notice(el)?.tone).toBe("error"));
    expect(notice(el)?.message).toBe(codeMessage("device.binding_invalid"));
    expect(calls).toEqual([{ kind: "reader", selection: { id: READER_ID }, via: "scan" }]);
  });
  it.each(["success", "lost answer"])(
    "a late pickup %s refreshes the new operator's displayed reader without an old notice",
    async (outcome) => {
      let stored = NFC_EQUIPMENT;
      let finish!: () => void;
      const getDeviceEquipment = vi.fn(async () => stored);
      const setDeviceEquipment = vi.fn(
        () =>
          new Promise((resolve, reject) => {
            finish = () => {
              stored = {
                roles: NFC_EQUIPMENT.roles.map((role) =>
                  role.role === "card_terminal"
                    ? {
                        ...role,
                        selection: "item",
                        chosenId: READER_ID,
                        chosen: role.choices[0]!,
                        resolved: {
                          id: READER_ID,
                          name: "Portable reader",
                          available: true,
                          provider: "stripe",
                        },
                      }
                    : role,
                ),
              };
              if (outcome === "success") resolve(stored);
              else reject(new TypeError("lost answer"));
            };
          }),
      );
      const { el } = await mountEquipmentApp({ getDeviceEquipment, setDeviceEquipment });
      await signIn(el);
      (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(1));
      (await reader()).read(`waitron-equipment:printer:${PRINTER_ID}`);
      await signOut(el);
      await signIn(el);
      const counter = () =>
        el.shadowRoot!.querySelector<
          HTMLElement & { activeReaders: { id: string; name: string; provider: string }[] }
        >("till-counter-screen")!;
      expect(counter().activeReaders).toEqual([]);
      finish();
      await vi.waitFor(() =>
        expect(counter().activeReaders).toEqual([
          { id: READER_ID, name: "Portable reader", provider: "stripe_terminal" },
        ]),
      );
      expect(notice(el)?.open).toBe(false);
      expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    },
  );
  it("does not send a prior operator's queued tap after another sign-in", async () => {
    let finish!: (value: typeof NFC_EQUIPMENT) => void;
    const setDeviceEquipment = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(NFC_EQUIPMENT);
    const { el } = await mountEquipmentApp({ setDeviceEquipment });
    await signIn(el);
    const nfc = await reader();
    nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(1));
    nfc.read(`waitron-equipment:printer:${PRINTER_ID}`);
    await signOut(el);
    await signIn(el);
    finish(NFC_EQUIPMENT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(notice(el)?.open).toBe(false);
    nfc.read(`waitron-equipment:printer:${PRINTER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
  });
  it("a refusal arriving after logout shows no old operator notice", async () => {
    let refuse!: (error: unknown) => void;
    const setDeviceEquipment = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const { el } = await mountEquipmentApp({ setDeviceEquipment });
    await signIn(el);
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(1));
    await signOut(el);
    refuse({ code: "reader.payment_in_progress", status: 409 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(notice(el)?.open).toBe(false);
    expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
  });
  it("granting NFC in the dialog ends with one live reader and one selection per tap", async () => {
    const permission = installNfc("prompt");
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    await openEquipment(el);
    const dialog = el.shadowRoot!.querySelector<TillEquipmentDialog>("till-equipment-dialog")!;
    await vi.waitFor(() =>
      expect(dialog.shadowRoot!.querySelector("[data-equipment-nfc-allow]")).not.toBeNull(),
    );
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-equipment-nfc-allow]")!.click();
    await reader();
    Object.assign(permission, { state: "granted" });
    permission.dispatchEvent(new Event("change"));
    await Promise.resolve();
    const live = FakeNdefReader.instances.filter((nfc) => !nfc.signal!.aborted);
    for (const nfc of live) nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect({ live: live.length, requests: requests.length }).toEqual({ live: 1, requests: 1 });
  });
  it("an identical pickup gives a fresh notice countdown", async () => {
    const setDeviceEquipment = vi.fn().mockResolvedValue(NFC_EQUIPMENT);
    const { el } = await mountEquipmentApp({ setDeviceEquipment });
    await signIn(el);
    const nfc = await reader();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      nfc.read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(notice(el)?.open).toBe(true));
      vi.advanceTimersByTime(4000);
      nfc.read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
      await el.updateComplete;
      await notice(el)!.updateComplete;
      vi.advanceTimersByTime(4000);
      await el.updateComplete;
      await notice(el)!.updateComplete;
      expect(notice(el)?.open).toBe(true);
      expect(notice(el)?.message).toBe("Picked up Portable reader");
    } finally {
      vi.useRealTimers();
    }
  });
  it("counts a valid equipment tap as activity, while passive permission updates do not", async () => {
    const permission = installNfc();
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const interaction = vi.spyOn(el.sessionActivity, "noteInteraction");
    permission.dispatchEvent(new Event("change"));
    expect(interaction).not.toHaveBeenCalled();
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(interaction).toHaveBeenCalledTimes(1);
  });
  it("a repeated permission grant leaves only one reader dispatching a tap", async () => {
    const permission = installNfc();
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const nfc = await reader();
    permission.dispatchEvent(new Event("change"));
    permission.dispatchEvent(new Event("change"));
    nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(FakeNdefReader.instances).toHaveLength(1);
  });

  it.each(["prompt", "denied"] as const)(
    "does not request NFC permission on load when %s; a later grant starts listening",
    async (state) => {
      const permission = installNfc(state);
      const { el, requests } = await mountEquipmentApp();
      await signIn(el);
      expect(FakeNdefReader.instances).toEqual([]);
      expect(notice(el)?.open).toBe(false);
      Object.assign(permission, { state: "granted" });
      permission.dispatchEvent(new Event("change"));
      (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(requests).toHaveLength(1));
    },
  );
  it("on a browser without Web NFC the equipment dialog keeps its dropdowns", async () => {
    vi.stubGlobal("NDEFReader", undefined);
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    await openEquipment(el);
    const dialog = el.shadowRoot!.querySelector<TillEquipmentDialog>("till-equipment-dialog")!;
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelectorAll("wt-combobox")).toHaveLength(3);
    expect(dialog.shadowRoot!.querySelector("[data-equipment-nfc]")).toBeNull();
    expect(requests).toEqual([]);
    expect(FakeNdefReader.instances).toEqual([]);
  });
  it("a permission query failure leaves QR and the dropdown available", async () => {
    vi.mocked(navigator.permissions.query).mockRejectedValue(new TypeError("unsupported"));
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    await openEquipment(el);
    const dialog = el.shadowRoot!.querySelector<TillEquipmentDialog>("till-equipment-dialog")!;
    expect(dialog.shadowRoot!.querySelectorAll("wt-combobox")).toHaveLength(3);
    expect(FakeNdefReader.instances).toEqual([]);
    expect(requests).toEqual([]);
  });
  it("revoking permission stops the reader and re-granting serves another tap", async () => {
    const permission = installNfc();
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const old = await reader();
    Object.assign(permission, { state: "denied" });
    permission.dispatchEvent(new Event("change"));
    expect(old.signal!.aborted).toBe(true);
    old.read(`waitron-equipment:reader:${READER_ID}`);
    expect(requests).toEqual([]);
    Object.assign(permission, { state: "granted" });
    permission.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it("a permission answer after removal cannot start a reader", async () => {
    let answer!: (status: PermissionStatus) => void;
    vi.mocked(navigator.permissions.query).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { el, requests } = await mountEquipmentApp();
    el.remove();
    answer(Object.assign(new EventTarget(), { state: "granted" }) as PermissionStatus);
    await el.updateComplete;
    await Promise.resolve();
    expect(FakeNdefReader.instances).toEqual([]);
    expect(requests).toEqual([]);
  });
  it("removing and reattaching the till aborts the old scan and starts a fresh one", async () => {
    const { el, host, requests } = await mountEquipmentApp();
    await signIn(el);
    const old = await reader();
    el.remove();
    expect(old.signal!.aborted).toBe(true);
    old.read(`waitron-equipment:reader:${READER_ID}`);
    expect(requests).toEqual([]);
    host.append(el);
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it("an old scan rejection cannot replace the next scan's success notice", async () => {
    let refuse!: (error: Error) => void;
    FakeNdefReader.scanResult = () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      });
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    await reader();
    const refuseGlobal = refuse;
    await openEquipment(el);
    FakeNdefReader.scanResult = () => Promise.resolve();
    emit(el.shadowRoot!.querySelector("till-equipment-dialog")!, "close");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-equipment-dialog")).toBeNull(),
    );
    const current = await reader();
    current.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.waitFor(() => expect(notice(el)?.message).toBe("Picked up Portable reader"));
    refuseGlobal(new DOMException("late", "NotReadableError"));
    await Promise.resolve();
    await el.updateComplete;
    expect(notice(el)?.message).toBe("Picked up Portable reader");
  });
  it("does not start scanning while the document is hidden", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    expect(FakeNdefReader.instances).toEqual([]);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it("canonicalises uppercase ids and uses UTF-8 when the tag has no encoding", async () => {
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    (await reader()).read(`waitron-equipment:reader:${READER_ID.toUpperCase()}`, "text", "");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual({
      kind: "reader",
      selection: { id: READER_ID },
      via: "scan",
    });
  });
  it("a sticker with two equipment text records changes no assignment", async () => {
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const nfc = await reader();
    nfc.dispatchEvent(
      Object.assign(new Event("reading"), {
        message: {
          records: [
            {
              recordType: "text",
              data: new DataView(
                new TextEncoder().encode(`waitron-equipment:reader:${READER_ID}`).buffer,
              ),
            },
            {
              recordType: "text",
              data: new DataView(
                new TextEncoder().encode(`waitron-equipment:printer:${PRINTER_ID}`).buffer,
              ),
            },
          ],
        },
      }),
    );
    await vi.waitFor(() => expect(notice(el)?.message).toContain("not a Waitron"));
    expect(requests).toEqual([]);
    nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it("a pending lock-screen tap is checked against the newly signed-in equipment list", async () => {
    const { el, requests } = await mountEquipmentApp({
      getDeviceEquipment: vi.fn().mockResolvedValue({
        roles: NFC_EQUIPMENT.roles.map((role) => ({ ...role, choices: [] })),
      }),
    });
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await signIn(el);
    await vi.waitFor(() => expect(notice(el)?.message).toContain("not available"));
    expect(requests).toEqual([]);
  });
  it.each(["rejection", "constructor", "synchronous scan"])(
    "contains a reader-start %s and resumes after returning to the foreground",
    async (failure) => {
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      const { el, requests } = await mountEquipmentApp();
      await signIn(el);
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      if (failure === "rejection")
        FakeNdefReader.scanResult = () =>
          Promise.reject(new DOMException("unavailable", "NotReadableError"));
      if (failure === "synchronous scan")
        FakeNdefReader.scanResult = () => {
          throw new DOMException("unavailable", "NotReadableError");
        };
      if (failure === "constructor")
        vi.stubGlobal(
          "NDEFReader",
          class {
            constructor() {
              throw new DOMException("unavailable", "NotReadableError");
            }
          },
        );
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(notice(el)?.message).toContain("NFC is not available"));
      expect(requests).toEqual([]);
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      FakeNdefReader.scanResult = () => Promise.resolve();
      vi.stubGlobal("NDEFReader", FakeNdefReader);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      const nfc = await reader();
      expect(nfc.signal!.aborted).toBe(false);
      nfc.read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(requests).toHaveLength(1));
    },
  );
  it("an old sign-in equipment read cannot discard a tap made after sign-out", async () => {
    let answer!: (value: typeof NFC_EQUIPMENT) => void;
    const getDeviceEquipment = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValue(NFC_EQUIPMENT);
    const { el, requests } = await mountEquipmentApp({ getDeviceEquipment });
    await signIn(el);
    await signOut(el);
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    answer(NFC_EQUIPMENT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([]);
    await signIn(el);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it.each([
    ["en-GB", "Picked up Portable reader"],
    ["es-ES", "Has recogido Portable reader"],
  ])(
    "announces a successful pickup in %s without leaving the current screen",
    async (locale, message) => {
      const { el } = await mountEquipmentApp();
      await signIn(el, locale);
      (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(notice(el)?.message).toBe(message));
      expect(notice(el)?.open).toBe(true);
      expect(notice(el)?.tone).toBe("info");
      expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
    },
  );
  it.each([
    ["not-equipment", "text", "utf-8", "not a Waitron"],
    [`waitron-equipment:drawer:${PRINTER_ID}`, "text", "utf-8", "not a Waitron"],
    [`waitron-equipment:reader:${READER_ID}`, "url", "utf-8", "not a Waitron"],
    [`waitron-equipment:reader:${READER_ID}`, "text", "invalid-encoding", "not a Waitron"],
    [
      "waitron-equipment:reader:c45f83b1-3333-4333-8333-333333333333",
      "text",
      "utf-8",
      "not available",
    ],
  ])(
    "refuses %s/%s without a request and accepts a later valid label",
    async (text, type, encoding, message) => {
      const { el, requests } = await mountEquipmentApp();
      await signIn(el);
      const nfc = await reader();
      nfc.read(text, type, encoding);
      await vi.waitFor(() => expect(notice(el)?.message).toContain(message));
      expect(requests).toEqual([]);
      nfc.read(`waitron-equipment:reader:${READER_ID}`);
      await vi.waitFor(() => expect(requests).toHaveLength(1));
    },
  );
  it("a reading error changes no assignment and keeps listening", async () => {
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const nfc = await reader();
    nfc.dispatchEvent(new Event("readingerror"));
    await vi.waitFor(() => expect(notice(el)?.message).toContain("could not be read"));
    expect(requests).toEqual([]);
    nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it.each([
    "reader.payment_in_progress",
    "device.binding_invalid",
    "reader.not_found",
    "session.required",
  ])("shows the real client's HTTP refusal %s and allows the next tap", async (code) => {
    let accept = false;
    const client = new TillApi("", async () =>
      accept
        ? new Response(JSON.stringify(NFC_EQUIPMENT))
        : new Response(JSON.stringify({ error: { code, params: {} } }), { status: 409 }),
    );
    const { el } = await mountEquipmentApp({
      setDeviceEquipment: client.setDeviceEquipment.bind(client),
    });
    await signIn(el);
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(notice(el)?.tone).toBe("error"));
    expect(notice(el)?.message).toBe(codeMessage(code));
    expect(el.shadowRoot!.querySelector("till-equipment-dialog")).toBeNull();
    accept = true;
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(notice(el)?.message).toBe("Picked up Portable reader"));
  });
  it("the dialog owns NFC while open and QR pauses both readers", async () => {
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const global = await reader();
    await openEquipment(el);
    const dialog = el.shadowRoot!.querySelector<TillEquipmentDialog>("till-equipment-dialog")!;
    await vi.waitFor(() => expect(global.signal!.aborted).toBe(true));
    const own = await reader();
    expect(own).not.toBe(global);
    global.read(`waitron-equipment:reader:${READER_ID}`);
    expect(requests).toEqual([]);
    dialog
      .shadowRoot!.querySelector<HTMLElement>(
        '[data-equipment-row="receipt"] [data-equipment-scan]',
      )!
      .click();
    await dialog.updateComplete;
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("refused", "NotAllowedError"),
    );
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-equipment-qr]")!.click();
    await dialog.updateComplete;
    expect(own.signal!.aborted).toBe(true);
    own.read(`waitron-equipment:printer:${PRINTER_ID}`);
    expect(requests).toEqual([]);
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-equipment-close]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-equipment-dialog")).toBeNull(),
    );
    const resumed = await reader();
    expect(resumed).not.toBe(own);
    resumed.read(`waitron-equipment:printer:${PRINTER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it("backgrounding aborts NFC and returning starts it again", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    const old = await reader();
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(old.signal!.aborted).toBe(true);
    old.read(`waitron-equipment:reader:${READER_ID}`);
    expect(requests).toEqual([]);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });
  it("a queued tap is discarded when its operator signs out", async () => {
    let finish!: (value: typeof NFC_EQUIPMENT) => void;
    const setDeviceEquipment = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(NFC_EQUIPMENT);
    const { el } = await mountEquipmentApp({ setDeviceEquipment });
    await signIn(el);
    const nfc = await reader();
    nfc.read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(1));
    nfc.read(`waitron-equipment:printer:${PRINTER_ID}`);
    await signOut(el);
    finish(NFC_EQUIPMENT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    expect(notice(el)?.open).toBe(false);
    await signIn(el);
    expect(setDeviceEquipment).toHaveBeenCalledTimes(1);
    nfc.read(`waitron-equipment:printer:${PRINTER_ID}`);
    await vi.waitFor(() => expect(setDeviceEquipment).toHaveBeenCalledTimes(2));
  });
  it.each([
    ["reader", READER_ID],
    ["printer", PRINTER_ID],
  ])(
    "picks up a registered %s outside the equipment dialog through the authenticated scan PUT",
    async (kind, id) => {
      const { el, requests } = await mountEquipmentApp();
      await signIn(el);
      (await reader()).read(`waitron-equipment:${kind}:${id}`);
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]!.url).toBe("/api/device/equipment");
      expect(requests[0]!.init.method).toBe("PUT");
      expect(requests[0]!.init.credentials).toBe("include");
      expect(JSON.parse(requests[0]!.init.body as string)).toEqual({
        kind,
        selection: { id },
        via: "scan",
      });
      expect(el.shadowRoot!.querySelector("till-equipment-dialog")).toBeNull();
    },
  );
  it("continues listening on the schedule screen", async () => {
    const { el, requests } = await mountEquipmentApp();
    await signIn(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "show-schedule");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-schedule-screen")).not.toBeNull(),
    );
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual({
      kind: "reader",
      selection: { id: READER_ID },
      via: "scan",
    });
  });
  it("waits for the normal sign-in before applying a sticker tapped on the lock screen", async () => {
    const { el, requests } = await mountEquipmentApp();
    (await reader()).read(`waitron-equipment:reader:${READER_ID}`);
    await el.updateComplete;
    expect(requests).toEqual([]);
    expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull();
    await signIn(el);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual({
      kind: "reader",
      selection: { id: READER_ID },
      via: "scan",
    });
  });
});
