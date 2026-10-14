import { afterEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { currentLocale, setLocale } from "../i18n/t.js";
import { orderNumber } from "./order-number.js";

const previousLocale = currentLocale();
afterEach(() => setLocale(previousLocale));

function drawn(n: number, formerNumbers?: number[]): HTMLElement {
  const host = document.createElement("div");
  render(orderNumber(n, formerNumbers), host);
  return host;
}

describe("orderNumber", () => {
  it("draws a plain #N when the order's dishes were never sent under another number", () => {
    expect(drawn(27).textContent!.trim()).toBe("#27");
    expect(drawn(27, []).textContent!.trim()).toBe("#27");
    expect(drawn(27).querySelector(".was")).toBeNull();
  });

  it("follows the number with the numbers its dishes were sent under, in their own span", () => {
    setLocale("en-GB");
    const host = drawn(27, [28]);
    expect(host.textContent!.replace(/\s+/g, " ").trim()).toBe("#27 (was 28)");
    expect(host.querySelector(".was")!.textContent).toBe("(was 28)");
  });

  it("joins several numbers with a comma, in the order the server sent them", () => {
    setLocale("en-GB");
    expect(drawn(27, [28, 30]).querySelector(".was")!.textContent).toBe("(was 28, 30)");
  });

  it("says it in Spanish", () => {
    setLocale("es-ES");
    expect(drawn(27, [28]).querySelector(".was")!.textContent).toBe("(antes 28)");
  });
});
