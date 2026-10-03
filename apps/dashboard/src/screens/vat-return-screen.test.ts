import { formMessageOf, chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtButton, WtCombobox, WtFormActions } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./vat-return-screen.js";
import type { VatReturnScreen } from "./vat-return-screen.js";

const FILE = new Blob([new Uint8Array([0x4e, 0xd1, 0x0a])]);

function stubApi(download: () => Promise<Blob> = () => Promise.resolve(FILE)): DashboardApi {
  return { downloadVatReturnFile: vi.fn(download) } as unknown as DashboardApi;
}

const field = (el: VatReturnScreen, name: string) =>
  el.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name=${name}]`)!;
const values = (el: VatReturnScreen, name: string) =>
  field(el, name).options.map((option) => option.value);
const button = (el: VatReturnScreen) =>
  el.shadowRoot!.querySelector<WtButton>("[data-test=download]")!;
const actions = (el: VatReturnScreen) =>
  el.shadowRoot!.querySelector<WtFormActions>("wt-form-actions")!;
const bottom = async (el: VatReturnScreen) =>
  (await formMessageOf(actions(el)))?.textContent?.trim() ?? null;

async function flush(el: VatReturnScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api: DashboardApi = stubApi()): Promise<VatReturnScreen> {
  const { el } = await mountWidget<VatReturnScreen>("dashboard-vat-return-screen", { api });
  await flush(el);
  return el;
}

async function press(el: VatReturnScreen): Promise<void> {
  button(el).click();
  await flush(el);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T10:00:00Z"));
  setLocale("en");
});

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setLocale("es-ES");
});

describe("dashboard-vat-return-screen", () => {
  it("offers AEAT's six declaration types, none chosen, and marks all three fields required", async () => {
    const el = await mount();
    expect(values(el, "declarationType")).toEqual(["C", "D", "G", "I", "N", "V"]);
    expect(field(el, "declarationType").value).toBe("");
    for (const name of ["year", "period", "declarationType"]) {
      expect(field(el, name).required).toBe(true);
      expect(field(el, name).getAttribute("name")).toBe(name);
    }
  });

  it.each([
    ["2026-10-03T10:00:00Z", "2026", "3T"],
    ["2026-02-10T10:00:00Z", "2025", "4T"],
  ])("on %s starts on the quarter that ended last, %s %s", async (now, year, period) => {
    vi.setSystemTime(new Date(now));
    const el = await mount();
    expect(field(el, "year").value).toBe(year);
    expect(field(el, "period").value).toBe(period);
    expect(values(el, "year")).toEqual(["2026", "2025", "2024", "2023", "2022"]);
  });

  it("offers the four quarters and then the twelve months, and no other period", async () => {
    const el = await mount();
    expect(values(el, "period")).toEqual([
      "1T",
      "2T",
      "3T",
      "4T",
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ]);
    const groups = field(el, "period").options.map((option) => option.group);
    expect(groups.slice(0, 4)).toEqual(Array(4).fill(t("vat_return.quarters")));
    expect(groups.slice(4)).toEqual(Array(12).fill(t("vat_return.months")));
    expect(field(el, "period").options[0]!.label).toBe("1st quarter (1T)");
    expect(field(el, "period").options[4]!.label).toBe("January (01)");
  });

  it("says nothing until the first press, then marks a missing type and holds the action until one is chosen", async () => {
    const api = stubApi();
    const el = await mount(api);
    expect(field(el, "declarationType").error).toBe("");
    expect(await bottom(el)).toBeNull();
    expect(button(el).disabled).toBe(false);

    await press(el);

    expect(api.downloadVatReturnFile).not.toHaveBeenCalled();
    expect(field(el, "declarationType").error).toBe(t("vat_return.type_required"));
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    expect(button(el).disabled).toBe(true);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(field(el, "declarationType")));

    await chooseOption(field(el, "declarationType"), "I");
    await flush(el);

    expect(field(el, "declarationType").error).toBe("");
    expect(await bottom(el)).toBeNull();
    expect(button(el).disabled).toBe(false);
  });

  it("downloads the chosen period's file under the server's own name, then starts the form again", async () => {
    const api = stubApi();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vat-return");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const el = await mount(api);
    await press(el);
    await chooseOption(field(el, "period"), "2T");
    await chooseOption(field(el, "declarationType"), "N");

    await press(el);

    expect(api.downloadVatReturnFile).toHaveBeenCalledWith({
      year: 2026,
      period: "2T",
      declarationType: "N",
    });
    expect(createObjectURL).toHaveBeenCalledWith(FILE);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("modelo-303-2026-2T.txt");
    expect(clicked[0]!.href).toBe("blob:vat-return");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:vat-return");
    expect(await bottom(el)).toBeNull();
    expect(button(el).disabled).toBe(false);
    expect(field(el, "period").value).toBe("2T");
    expect(field(el, "declarationType").value).toBe("N");
  });

  it("names the file for the period it asked for, even when the fields change before the answer", async () => {
    let answer!: (file: Blob) => void;
    const api = stubApi(() => new Promise<Blob>((resolve) => (answer = resolve)));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vat-return");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const el = await mount(api);
    await chooseOption(field(el, "declarationType"), "I");
    await press(el);

    await chooseOption(field(el, "year"), "2025");
    await chooseOption(field(el, "period"), "01");
    answer(FILE);
    await flush(el);

    expect(api.downloadVatReturnFile).toHaveBeenCalledWith({
      year: 2026,
      period: "3T",
      declarationType: "I",
    });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("modelo-303-2026-3T.txt");
  });

  it("puts a refusal naming a field changed while the file was asked for at the bottom", async () => {
    let refuse!: (reason: unknown) => void;
    const el = await mount(stubApi(() => new Promise<Blob>((_, reject) => (refuse = reject))));
    await chooseOption(field(el, "declarationType"), "I");
    await press(el);

    await chooseOption(field(el, "period"), "01");
    refuse({ code: "management.request_invalid", params: { field: "period" } });
    await flush(el);

    for (const name of ["year", "period", "declarationType"]) {
      expect(field(el, name).error).toBe("");
    }
    expect(await bottom(el)).toBe(codeMessage("management.request_invalid"));
    expect(button(el).disabled).toBe(false);
  });

  it.each([
    ["period", "vat_return.period_refused", "01"],
    ["year", "vat_return.year_refused", "2025"],
    ["declarationType", "vat_return.type_refused", "D"],
  ] as const)(
    "puts a refusal naming %s under that field alone until it changes",
    async (name, sentence, changed) => {
      const el = await mount(
        stubApi(() =>
          Promise.reject({ code: "management.request_invalid", params: { field: name } }),
        ),
      );
      await chooseOption(field(el, "declarationType"), "I");

      await press(el);

      for (const other of ["year", "period", "declarationType"]) {
        expect(field(el, other).error).toBe(other === name ? t(sentence) : "");
      }
      expect(await bottom(el)).toBe(t("form.fix_fields"));
      expect(button(el).disabled).toBe(false);

      await chooseOption(field(el, name), changed);
      await flush(el);

      expect(field(el, name).error).toBe("");
      expect(await bottom(el)).toBeNull();
    },
  );

  it.each([
    [{ code: "authorization.not_permitted" }, "authorization.not_permitted"],
    [{ code: "management.request_invalid" }, "management.request_invalid"],
  ])("shows a refusal that names no shown field at the bottom: %j", async (refusal, code) => {
    const el = await mount(stubApi(() => Promise.reject(refusal)));
    await chooseOption(field(el, "declarationType"), "I");

    await press(el);

    expect(await bottom(el)).toBe(codeMessage(code));
    for (const name of ["year", "period", "declarationType"]) {
      expect(field(el, name).error).toBe("");
    }
    expect(button(el).disabled).toBe(false);
  });

  it("shows the action busy while the file is asked for, and sends one request however often it is pressed", async () => {
    const api = stubApi(() => new Promise<Blob>(() => {}));
    const el = await mount(api);
    await chooseOption(field(el, "declarationType"), "I");

    await press(el);
    await press(el);

    expect(button(el).loading).toBe(true);
    expect(api.downloadVatReturnFile).toHaveBeenCalledOnce();
  });

  it("names the months and the declaration types in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    expect(field(el, "period").options[4]!.label).toBe("Enero (01)");
    expect(field(el, "declarationType").options[3]!.label).toBe("I — Ingreso");
  });
});
