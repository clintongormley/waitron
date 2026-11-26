import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { decimal, formatMoney } from "@waitron/shared";
import type { BillBalance } from "../api/payments-api.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { beingPaidNotice, overpaidNotice, type OverpaidNotice } from "./bill-money-notice.js";

const money = (amount: string) => formatMoney(decimal(amount), currentLocale());
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

function balance(over: Partial<BillBalance> = {}): BillBalance {
  return {
    workingOrderId: "wo-4",
    status: "open",
    total: "10.00",
    received: "15.00",
    reserved: "0.00",
    outstanding: "-5.00",
    overpaid: "5.00",
    tips: "0.00",
    payments: [],
    ...over,
  };
}

let host: HTMLDivElement;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => host.remove());

function overpaid(over: Partial<OverpaidNotice> = {}) {
  const asked: string[] = [];
  render(
    overpaidNotice({
      balance: balance(),
      tipsEnabled: true,
      busy: false,
      onGiveBack: (excess) => asked.push(`give back ${excess}`),
      onKeepAsTip: (excess) => asked.push(`keep ${excess} as tip`),
      ...over,
    }),
    host,
  );
  return asked;
}

describe("bill money notices", () => {
  it("names the bill the chosen items are being paid on", () => {
    render(beingPaidNotice(balance({ beingPaidOn: { billId: "wo-9", billNumber: 3 } })), host);
    expect(text(host.querySelector("[data-being-paid-on]"))).toBe("Being paid on Bill 3");
  });

  it("says nothing of another bill when none is being paid", () => {
    render(beingPaidNotice(balance()), host);
    expect(host.querySelector("[data-being-paid-on]")).toBeNull();
    render(beingPaidNotice(null), host);
    expect(host.querySelector("[data-being-paid-on]")).toBeNull();
  });

  it("says by how much the bill was overpaid and offers to give it back or keep it as a tip", () => {
    const asked = overpaid();
    expect(text(host.querySelector("[data-overpaid] p"))).toBe(
      fill(t("table.overpaid"), { amount: money("5.00") }),
    );
    expect(text(host.querySelector("[data-give-back]"))).toBe(`Give back ${money("5.00")}`);
    expect(text(host.querySelector("[data-keep-as-tip]"))).toBe(`Keep ${money("5.00")} as tip`);
    host.querySelector<HTMLElement>("[data-give-back]")!.click();
    host.querySelector<HTMLElement>("[data-keep-as-tip]")!.click();
    expect(asked).toEqual(["give back 5.00", "keep 5.00 as tip"]);
  });

  it("offers only Give back while the venue takes no tips", () => {
    overpaid({ tipsEnabled: false });
    expect(host.querySelector("[data-give-back]")).not.toBeNull();
    expect(host.querySelector("[data-keep-as-tip]")).toBeNull();
  });

  it("offers only Give back on a bill that comes to nothing, as there is no sale to tip on", () => {
    const asked = overpaid({
      balance: balance({ total: "0.00", outstanding: "-15.00", overpaid: "15.00" }),
    });
    expect(text(host.querySelector("[data-give-back]"))).toBe(`Give back ${money("15.00")}`);
    expect(host.querySelector("[data-keep-as-tip]")).toBeNull();
    host.querySelector<HTMLElement>("[data-give-back]")!.click();
    expect(asked).toEqual(["give back 15.00"]);
  });

  it("holds both choices while a Keep as tip is unanswered", () => {
    overpaid({ busy: true });
    expect(
      host.querySelector<HTMLElement & { disabled: boolean }>("[data-give-back]")!.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLElement & { disabled: boolean }>("[data-keep-as-tip]")!.disabled,
    ).toBe(true);
  });

  it("draws nothing for a bill paid no more than it comes to, or whose balance names no excess", () => {
    overpaid({ balance: balance({ overpaid: "0.00", outstanding: "0.00" }) });
    expect(host.querySelector("[data-overpaid]")).toBeNull();
    const unnamed = balance();
    delete unnamed.overpaid;
    overpaid({ balance: unnamed });
    expect(host.querySelector("[data-overpaid]")).toBeNull();
  });
});
