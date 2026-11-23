import { afterEach, describe, expect, it, vi } from "vitest";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { printEquipmentLabel } from "./print-label.js";

/** A one-pixel image, so the printed frame has something to decode. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const BROKEN = "data:image/png;base64,bm90IGFuIGltYWdl";
/** Twice as wide as it is tall, so a label that sized only one side would print it oblong. */
const WIDE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAC0lEQVR4nGNgAAMAAAcAAbKGrPQAAAAASUVORK5CYII=";

const frames = () => [...document.querySelectorAll("iframe")];

async function printed(label: Parameters<typeof printEquipmentLabel>[0]): Promise<Window> {
  const print = vi.fn<(view: Window) => void>();
  printEquipmentLabel(label, print);
  await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  return print.mock.calls[0]![0];
}

afterEach(() => {
  for (const frame of frames()) frame.remove();
});

describe("printEquipmentLabel", () => {
  it("prints a hidden frame holding only the QR, the name and the code, and removes it after", async () => {
    const view = await printed({ qr: PIXEL, code: "CODE", name: "<b>Bar</b>" });
    const body = view.document.body;
    expect([...body.children].map((child) => child.tagName)).toEqual(["IMG", "P", "P"]);
    const image = body.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(PIXEL);
    expect(image.getAttribute("alt")).toBe("");
    expect([...body.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "<b>Bar</b>",
      "CODE",
    ]);
    expect(body.querySelector("b")).toBeNull();
    const frame = frames().find((f) => f.contentWindow === view)!;
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.style.position).toBe("fixed");
    expect(frame.getBoundingClientRect().width).toBe(0);
    expect(frame.getBoundingClientRect().height).toBe(0);
    expect(getComputedStyle(frame).borderTopStyle).toBe("none");
    expect(view.document.title).toBe("Waitron");
    view.dispatchEvent(new Event("afterprint"));
    expect(frame.isConnected).toBe(false);
  });

  it("puts the name above the QR, and the note under the code, when the label has a note", async () => {
    const view = await printed({ qr: PIXEL, code: "CODE", name: "Box", note: "<i>Scan</i>" });
    const body = view.document.body;
    expect([...body.children].map((child) => child.tagName)).toEqual(["P", "IMG", "P", "P"]);
    expect([...body.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Box",
      "CODE",
      "<i>Scan</i>",
    ]);
    expect(body.querySelector("i")).toBeNull();
    view.dispatchEvent(new Event("afterprint"));
  });

  it("prints the name larger and bolder than the code, in Waitron's own type, with the QR 40 mm square", async () => {
    const view = await printed({ qr: WIDE, code: "CODE", name: "Bar" });
    const doc = view.document;
    const [name, code] = [...doc.querySelectorAll("p")];
    const look = (element: Element) => view.getComputedStyle(element);
    expect(parseFloat(look(name!).fontSize)).toBeGreaterThan(parseFloat(look(code!).fontSize));
    expect(Number(look(name!).fontWeight)).toBeGreaterThan(Number(look(code!).fontWeight));
    const root = doc.documentElement.style;
    expect(root.getPropertyValue("--wt-font-size-md")).toBe("14px");
    expect(root.getPropertyValue("--wt-font-size-xl")).toBe("22px");
    expect(root.getPropertyValue("--wt-font-weight-bold")).toBe("600");
    expect(root.getPropertyValue("--wt-font-family")).toBe(
      WAITRON_DEFAULTS.structure["--wt-font-family"],
    );
    expect(look(doc.body).fontSize).toBe("14px");
    expect(look(doc.body).textAlign).toBe("center");
    expect(look(doc.body).marginTop).toBe("0px");
    expect(look(name!).fontSize).toBe("22px");
    expect(look(code!).overflowWrap).toBe("anywhere");
    const image = doc.querySelector("img")!;
    expect(look(image).width).toBe(look(image).height);
    expect(parseFloat(look(image).width)).toBeCloseTo((40 * 96) / 25.4, 0);
    view.dispatchEvent(new Event("afterprint"));
  });

  it("prints nothing and removes the frame when the QR cannot be decoded", async () => {
    const before = frames().length;
    const print = vi.fn<(view: Window) => void>();
    printEquipmentLabel({ qr: BROKEN, code: "CODE", name: "Bar" }, print);
    expect(frames().length).toBe(before + 1);
    await vi.waitFor(() => expect(frames().length).toBe(before));
    expect(print).not.toHaveBeenCalled();
  });

  it("prints through the frame's own window when no printer is given", async () => {
    const print = vi.fn();
    const added = new Promise<HTMLIFrameElement>((resolve) => {
      new MutationObserver((changes, observer) => {
        const frame = changes
          .flatMap((change) => [...change.addedNodes])
          .find((node): node is HTMLIFrameElement => node instanceof HTMLIFrameElement);
        if (frame === undefined) return;
        observer.disconnect();
        resolve(frame);
      }).observe(document.body, { childList: true });
    });
    printEquipmentLabel({ qr: PIXEL, code: "CODE", name: "Bar" });
    const frame = await added;
    frame.addEventListener("load", () => {
      frame.contentWindow!.print = print;
    });
    await vi.waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });
});
