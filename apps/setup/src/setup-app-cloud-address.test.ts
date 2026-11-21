import { afterEach, expect, it } from "vitest";
import type { WtAddressLookup } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import { wizardApi } from "../test/first-setup-browser.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { SetupApp } from "./setup-app.js";

const route = "/setup-api/cloud/sign-in/address-lookup";
const tab = "bd185bdc-b7dd-4abb-991a-a9c3d613d38e";
const suggestion = "Calle Mayor 1, Madrid";
let app: SetupApp | undefined;
const locale = currentLocale();
afterEach(() => {
  app?.remove();
  for (const key of ["tab", "return", "result", "signed-in"])
    sessionStorage.removeItem("waitron-setup-cloud-" + key);
  setLocale(locale);
});

it.each(["missing", "partial"])(
  "keeps manual text after a %s Cloud address draft and starts a new search",
  async (draft) => {
    sessionStorage.setItem("waitron-setup-cloud-tab", tab);
    sessionStorage.setItem(
      "waitron-setup-cloud-return",
      JSON.stringify({ mode: "prepare", locale: "en" }),
    );
    sessionStorage.setItem("waitron-setup-cloud-result", "signed-in");
    const { api, requests } = wizardApi({
      intercept: (path, body) => {
        if (path === "/setup-api/status")
          return Response.json({
            provisioned: false,
            environment: "preproduction",
            needs: ["venue"],
            cloudSignInAvailable: true,
          });
        if (path !== route) return;
        const { kind } = body as { kind: string };
        if (kind === "available") return Response.json({ available: true });
        if (kind === "suggest") return Response.json({ candidates: [{ text: suggestion }] });
        if (
          requests.filter(
            (r) => r.path === route && (r.body as { kind: string }).kind === "validate",
          ).length === 1
        )
          return Response.json(
            draft === "missing"
              ? {}
              : {
                  fields: {
                    addressLine1: "",
                    addressLine2: null,
                    postalCode: "",
                    city: "Madrid",
                    province: "Madrid",
                    countryCode: "ES",
                  },
                },
          );
        return Response.json({
          fields: {
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            countryCode: "ES",
          },
        });
      },
    });
    app = new SetupApp();
    app.api = api;
    document.body.append(app);
    const screen = (name: string) => app!.shadowRoot?.querySelector(`[data-test=screen-${name}]`);
    await expect.poll(() => screen("admin")).not.toBeNull();
    app
      .shadowRoot!.querySelector("main")!
      .dispatchEvent(
        new CustomEvent("setup-goto", {
          detail: { screen: "venue" },
          bubbles: true,
          composed: true,
        }),
      );
    await expect.poll(() => screen("venue")).not.toBeNull();
    const form = screen("venue")!.shadowRoot!;
    const widget = form.querySelector<WtAddressLookup>("[data-test=address-lookup]")!;
    const street = form.querySelector("[data-test=addressLine1]") as HTMLElement & {
      value: string;
    };
    const postal = form.querySelector("[data-test=postalCode]") as HTMLInputElement;
    await expect.poll(() => widget.hidden).toBe(false);
    for (const [field, value] of [
      [street, "Manual address"],
      [postal, "28001"],
    ] as const)
      field.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value },
          bubbles: true,
          composed: true,
        }),
      );
    widget.delay = 0;
    const input = widget.shadowRoot!.querySelector("input")!;
    const option = () => widget.shadowRoot!.querySelector('[role="option"]');
    const search = async (query: string) => {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await expect.poll(() => option()?.textContent).toContain(suggestion);
    };
    await search("Calle");
    expect(option()?.textContent).toContain("Google Maps");
    await search("Calle Mayor");
    await userEvent.click(option()!);
    await expect
      .poll(() => widget.shadowRoot!.querySelector('[role="status"]')?.textContent)
      .toContain("Type the address below");
    expect(street.value).toBe("Manual address");
    expect(postal.value).toBe("28001");

    await search("Calle Mayor 1");
    await userEvent.click(option()!);
    await expect.poll(() => street.value).toBe("Calle Mayor 1");
    expect(postal.value).toBe("28013");
    expect((form.querySelector("[data-test=province]") as HTMLInputElement).value).toBe("28");

    const bodies = requests.filter((r) => r.path === route).map((r) => r.body);
    const first = (bodies[1] as { workflowId: string }).workflowId;
    const second = (bodies[4] as { workflowId: string }).workflowId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(bodies).toEqual([
      { tab, kind: "available" },
      { tab, kind: "suggest", workflowId: first, query: "Calle", language: "en" },
      { tab, kind: "suggest", workflowId: first, query: "Calle Mayor", language: "en" },
      { tab, kind: "validate", workflowId: first, selectedText: suggestion },
      { tab, kind: "suggest", workflowId: second, query: "Calle Mayor 1", language: "en" },
      { tab, kind: "validate", workflowId: second, selectedText: suggestion },
    ]);
  },
);
