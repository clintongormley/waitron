import { describe, expect, it } from "vitest";
import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../api/client.js";
import {
  autoPickReader,
  heldForEquipment,
  payPrinterOf,
  payRowWantsOpen,
  payReaderOf,
  printerChoices,
  printerWantsRowOpen,
  readerChoices,
  readyPayReader,
  rowStartsOpen,
  type PayPrinter,
  type PayReader,
} from "./pay-equipment.js";

function item(id: string, overrides: Partial<EquipmentItem> = {}): EquipmentItem {
  return {
    id,
    name: `Name ${id}`,
    portable: false,
    available: true,
    busy: false,
    heldBy: null,
    ...overrides,
  };
}

function role(name: RoleEquipment["role"], overrides: Partial<RoleEquipment> = {}): RoleEquipment {
  return {
    role: name,
    selection: "default",
    chosenId: null,
    resolved: null,
    chosen: null,
    default: null,
    choices: [],
    ...overrides,
  };
}

/** The five roles, with the receipt and card roles as given; the others empty. */
function equipment(
  receipt: Partial<RoleEquipment> = {},
  reader: Partial<RoleEquipment> = {},
): DeviceEquipment {
  return {
    roles: [
      role("receipt", receipt),
      role("payment_slip"),
      role("cash_drawer"),
      role("invoice"),
      role("card_terminal", reader),
    ],
  };
}

const lector = item("r1", { name: "Lector barra", portable: true, provider: "sumup" });

describe("payReaderOf", () => {
  it("a chosen, switched-on reader on a till provider is ready, not from the default", () => {
    const read = equipment(
      {},
      {
        selection: "item",
        chosenId: "r1",
        resolved: { id: "r1", name: "Lector barra", available: true, provider: "sumup" },
        chosen: lector,
        choices: [lector],
      },
    );

    expect(payReaderOf(read)).toEqual({
      kind: "ready",
      id: "r1",
      name: "Lector barra",
      provider: "sumup_cloud",
      fromDefault: false,
    });
  });

  it("the profile's default reader, switched on, is ready from the default", () => {
    const read = equipment(
      {},
      {
        resolved: { id: "r1", name: "Lector barra", available: true, provider: "stripe" },
        default: { ...lector, provider: "stripe" },
      },
    );

    expect(payReaderOf(read)).toEqual({
      kind: "ready",
      id: "r1",
      name: "Lector barra",
      provider: "stripe_terminal",
      fromDefault: true,
    });
  });

  it("a switched-on reader whose provider the till cannot pay through is none", () => {
    const read = equipment(
      {},
      {
        selection: "item",
        chosenId: "r1",
        resolved: { id: "r1", name: "Lector barra", available: true, provider: "adyen" },
        chosen: { ...lector, provider: "adyen" },
      },
    );

    expect(payReaderOf(read)).toEqual({ kind: "none" });
  });

  // The server reads a switched-off and an unpaired chosen reader alike
  // (`apps/server/src/device-equipment.test.ts`, "reads a chosen reader that was switched off as
  // the chosen, unavailable reader" and "… that was unpaired as …").
  it("a chosen reader that was switched off or unpaired is switched_off", () => {
    const read = equipment(
      {},
      {
        selection: "item",
        chosenId: "r1",
        resolved: { id: "r1", name: "Lector barra", available: false, provider: "sumup" },
        chosen: { ...lector, available: false },
        choices: [],
      },
    );

    expect(payReaderOf(read)).toEqual({ kind: "switched_off", id: "r1", name: "Lector barra" });
  });

  it("a chosen reader that resolves to nothing and is not available is switched_off", () => {
    const read = equipment(
      {},
      { selection: "item", chosenId: "r1", chosen: { ...lector, available: false } },
    );

    expect(payReaderOf(read)).toEqual({ kind: "switched_off", id: "r1", name: "Lector barra" });
  });

  it("no reader chosen and no default is none", () => {
    expect(payReaderOf(equipment())).toEqual({ kind: "none" });
  });

  it("an available chosen reader that resolves to nothing is none", () => {
    const read = equipment({}, { selection: "item", chosenId: "r1", chosen: lector });

    expect(payReaderOf(read)).toEqual({ kind: "none" });
  });

  it("no equipment read, or one without a card role, is none", () => {
    expect(payReaderOf(null)).toEqual({ kind: "none" });
    expect(payReaderOf({ roles: [role("receipt")] })).toEqual({ kind: "none" });
  });
});

const barra = item("p1", { name: "Barra", kind: "receipt" });
const terraza = item("p2", { name: "Terraza", kind: "receipt" });

describe("payPrinterOf", () => {
  it("a chosen, switched-on printer is ready, not from the default", () => {
    const read = equipment({
      selection: "item",
      chosenId: "p1",
      resolved: { id: "p1", name: "Barra", available: true },
      chosen: barra,
      choices: [barra, terraza],
    });

    expect(payPrinterOf(read)).toEqual({
      kind: "ready",
      id: "p1",
      name: "Barra",
      fromDefault: false,
    });
  });

  it("the profile's default printer, switched on, is ready from the default", () => {
    const read = equipment({
      resolved: { id: "p1", name: "Barra", available: true },
      default: barra,
      choices: [barra],
    });

    expect(payPrinterOf(read)).toEqual({
      kind: "ready",
      id: "p1",
      name: "Barra",
      fromDefault: true,
    });
  });

  // `apps/server/src/device-equipment-api.test.ts`, "a switched-off chosen printer is reported
  // available:false and stays chosen".
  it("a chosen printer that was switched off is switched_off, not the default", () => {
    const read = equipment({
      selection: "item",
      chosenId: "p1",
      resolved: { id: "p1", name: "Barra", available: false },
      chosen: { ...barra, available: false },
      default: terraza,
      choices: [terraza],
    });

    expect(payPrinterOf(read)).toEqual({ kind: "switched_off", id: "p1", name: "Barra" });
  });

  // `apps/server/src/device-equipment.test.ts`, "reads a profile-default printer that was switched
  // off as the default, unavailable printer".
  it("the profile's default printer, switched off, is switched_off", () => {
    const read = equipment({
      resolved: { id: "p1", name: "Barra", available: false },
      default: { ...barra, available: false },
      choices: [],
    });

    expect(payPrinterOf(read)).toEqual({ kind: "switched_off", id: "p1", name: "Barra" });
  });

  it("receipt choices with none chosen and no default is unset", () => {
    expect(payPrinterOf(equipment({ choices: [barra, terraza] }))).toEqual({ kind: "unset" });
  });

  it("no receipt choices, no chosen and no default printer is none_listed", () => {
    expect(payPrinterOf(equipment())).toEqual({ kind: "none_listed" });
    expect(payPrinterOf(null)).toEqual({ kind: "none_listed" });
  });

  // `apps/server/src/device-equipment.test.ts`, "reads a portable default printer another device
  // holds as resolving to nothing".
  it("a portable default printer this phone does not hold is unset, with or without choices", () => {
    const held = item("p3", {
      name: "Portátil",
      kind: "receipt",
      portable: true,
      heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: null },
    });
    const notHeld = { resolved: null, default: held };

    expect(payPrinterOf(equipment({ ...notHeld, choices: [held] }))).toEqual({ kind: "unset" });
    expect(payPrinterOf(equipment({ ...notHeld, choices: [] }))).toEqual({ kind: "unset" });
  });

  // `apps/server/src/device-equipment.test.ts`, "reads a portable default printer another device
  // holds, then switched off, as resolving to nothing with no choices".
  it("a portable default printer another device holds, switched off, is unset and opens the row", () => {
    const read = equipment({
      selection: "default",
      chosenId: null,
      resolved: null,
      chosen: null,
      default: item("p3", {
        name: "Portátil",
        kind: "receipt",
        portable: true,
        available: false,
        heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: null },
      }),
      choices: [],
    });
    const printer = payPrinterOf(read);

    expect(printer).toEqual({ kind: "unset" });
    expect(
      rowStartsOpen(
        { kind: "ready", id: "r1", name: "L", provider: "sumup_cloud", fromDefault: true },
        printer,
      ),
    ).toBe(true);
  });

  it("a chosen printer that resolves to nothing, with no choices, is unset", () => {
    const read = equipment({ selection: "item", chosenId: "p3", chosen: item("p3"), choices: [] });

    expect(payPrinterOf(read)).toEqual({ kind: "unset" });
  });
});

describe("rowStartsOpen", () => {
  const ready: PayReader = {
    kind: "ready",
    id: "r1",
    name: "L",
    provider: "sumup_cloud",
    fromDefault: false,
  };
  const printed: PayPrinter = { kind: "ready", id: "p1", name: "B", fromDefault: true };

  it.each<[string, PayReader, PayPrinter, boolean]>([
    ["reader ready, printer ready", ready, printed, false],
    ["reader ready, no printer listed", ready, { kind: "none_listed" }, false],
    [
      "reader ready, printer switched off",
      ready,
      { kind: "switched_off", id: "p1", name: "B" },
      true,
    ],
    ["reader ready, printer unset", ready, { kind: "unset" }, true],
    [
      "reader switched off, printer ready",
      { kind: "switched_off", id: "r1", name: "L" },
      printed,
      true,
    ],
    ["no reader, printer ready", { kind: "none" }, printed, true],
    ["no reader, no printer listed", { kind: "none" }, { kind: "none_listed" }, true],
  ])("%s: %s", (_label, reader, printer, open) => {
    expect(rowStartsOpen(reader, printer)).toBe(open);
  });
});

describe("printerWantsRowOpen", () => {
  it.each<[PayPrinter, boolean]>([
    [{ kind: "ready", id: "p1", name: "B", fromDefault: false }, false],
    [{ kind: "none_listed" }, false],
    [{ kind: "switched_off", id: "p1", name: "B" }, true],
    [{ kind: "unset" }, true],
  ])("%j: %s", (printer, open) => {
    expect(printerWantsRowOpen(printer)).toBe(open);
  });
});

describe("the choices the drop-downs offer", () => {
  it("readerChoices keeps a reader another device is paying on, marked busy, in list order", () => {
    const busy = item("r2", {
      name: "Lector terraza",
      portable: true,
      provider: "sumup",
      busy: true,
    });
    const read = equipment({ choices: [barra] }, { choices: [lector, busy] });

    expect(readerChoices(read)).toEqual([lector, busy]);
    expect(readerChoices(read)[1]!.busy).toBe(true);
  });

  it("printerChoices are the receipt role's choices", () => {
    const read = equipment({ choices: [barra, terraza] }, { choices: [lector] });

    expect(printerChoices(read)).toEqual([barra, terraza]);
  });

  it("no equipment read offers nothing", () => {
    expect(readerChoices(null)).toEqual([]);
    expect(printerChoices(null)).toEqual([]);
  });
});

describe("the payment's hold for its equipment", () => {
  const ready = equipment(
    { selection: "item", chosenId: "p1", resolved: { id: "p1", name: "Barra", available: true } },
    {
      selection: "item",
      chosenId: "r1",
      resolved: { id: "r1", name: "Lector barra", available: true, provider: "sumup" },
      chosen: lector,
      choices: [lector],
    },
  );
  const noReader = equipment({
    selection: "item",
    chosenId: "p1",
    resolved: { id: "p1", name: "Barra", available: true },
  });
  const demo = { id: "sim-1", name: "Demo reader" };

  it("charges the equipment's ready reader, the demo reader before it, and none before a read", () => {
    expect(readyPayReader(ready, null)).toMatchObject({ id: "r1", name: "Lector barra" });
    expect(readyPayReader(ready, demo)).toEqual(demo);
    expect(readyPayReader(null, demo)).toEqual(demo);
    expect(readyPayReader(null, null)).toBeNull();
    expect(readyPayReader(noReader, null)).toBeNull();
  });

  it("holds a card until a reader is ready, and never cash", () => {
    const state = (
      equipment: DeviceEquipment | null,
      fixedReader = null as typeof demo | null,
    ) => ({
      equipment,
      equipmentBusy: false,
      fixedReader,
    });
    expect(heldForEquipment(true, state(ready))).toBe(false);
    expect(heldForEquipment(true, state(noReader))).toBe(true);
    expect(heldForEquipment(true, state(null))).toBe(true);
    expect(heldForEquipment(true, state(null, demo))).toBe(false);
    expect(heldForEquipment(false, state(null))).toBe(false);
    expect(heldForEquipment(false, state(noReader))).toBe(false);
  });

  it("holds every method while an equipment change is out", () => {
    const busy = { equipment: ready, equipmentBusy: true, fixedReader: demo };
    expect(heldForEquipment(true, busy)).toBe(true);
    expect(heldForEquipment(false, busy)).toBe(true);
  });

  it("opens the row only once the equipment is read, and the demo reader counts as ready", () => {
    expect(payRowWantsOpen(null, null)).toBe(false);
    expect(payRowWantsOpen(ready, null)).toBe(false);
    expect(payRowWantsOpen(noReader, null)).toBe(true);
    expect(payRowWantsOpen(noReader, demo)).toBe(false);
    expect(payRowWantsOpen(equipment({ choices: [barra] }), demo)).toBe(true);
  });
});

describe("autoPickReader: a phone's first payment takes the one free reader", () => {
  const offered = (...choices: EquipmentItem[]) => equipment({}, { choices });

  it("one free reader offered to a phone that has had none is picked", () => {
    expect(autoPickReader(offered(lector), false)).toBe("r1");
  });

  it("a phone that had a reader earlier in the page picks nothing", () => {
    expect(autoPickReader(offered(lector), true)).toBeNull();
  });

  it("two readers offered pick nothing, and nor does none", () => {
    expect(autoPickReader(offered(lector, item("r2")), false)).toBeNull();
    expect(autoPickReader(offered(), false)).toBeNull();
  });

  it("a reader another device holds, or is paying on, or that is switched off is never taken", () => {
    const holder = { deviceId: "d2", deviceName: "Phone 2", personName: null };
    expect(autoPickReader(offered({ ...lector, heldBy: holder }), false)).toBeNull();
    expect(autoPickReader(offered({ ...lector, busy: true }), false)).toBeNull();
    expect(autoPickReader(offered({ ...lector, available: false }), false)).toBeNull();
  });

  it("a phone that already has a reader, ready or switched off, or chose one, picks nothing", () => {
    const resolved = { id: "r1", name: "Lector barra", available: true, provider: "sumup" };
    expect(
      autoPickReader(
        equipment({}, { choices: [lector], resolved, chosen: lector, chosenId: "r1" }),
        false,
      ),
    ).toBeNull();
    expect(
      autoPickReader(
        equipment({}, { choices: [lector], resolved: { ...resolved, available: false } }),
        false,
      ),
    ).toBeNull();
    expect(autoPickReader(equipment({}, { choices: [lector], chosenId: "r9" }), false)).toBeNull();
  });

  it("an unread equipment picks nothing", () => {
    expect(autoPickReader(null, false)).toBeNull();
  });
});
