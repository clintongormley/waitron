import { afterEach, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtDialog } from "@waitron/ui";
import type { DashboardApi, ReaderRow, AvailableReader } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PaymentsScreen } from "./payments-screen.js";
registerIcons(DASHBOARD_ICONS);
const reader: ReaderRow = {
  id: "r1",
  provider: "test",
  name: "Counter",
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
};
const available: AvailableReader[] = [
  { providerRef: "a1", name: "Counter", status: "available", model: "Solo", serial: "SN1" },
  { providerRef: "a2", name: "Bar", status: "disabled", model: "Solo", serial: "SN2" },
];
class ReaderLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-payments-screen
        .api=${this.api}
        .panels=${[]}
      ></dashboard-payments-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("reader-leave-test-app", ReaderLeaveApp);
afterEach(cleanupWidgets);
function q(screen: PaymentsScreen, selector: string): HTMLElement | null {
  function find(root: ShadowRoot | HTMLElement): HTMLElement | null {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
    for (const child of root.querySelectorAll<HTMLElement>("*")) {
      if (child.shadowRoot) {
        const nested = find(child.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }
  return find(screen.shadowRoot!);
}
async function mount(overrides: Partial<DashboardApi> = {}, discovery = false) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<ReaderLeaveApp>("reader-leave-test-app", {
    api: {
      listPaymentProviders: async () => [
        { providerId: "test", state: "connected", canUnpair: true },
      ],
      listReaders: async () => [
        reader,
        { ...reader, id: "r2", name: "Bar" },
        { ...reader, id: "disabled", active: false },
      ],
      readerStatus: async () => ({ online: true, pairingStatus: "paired" }),
      availableReaders: async () => available,
      listStuckPayments: async () => [],
      listStuckBillPayments: async () => [],
      listStuckBillRefunds: async () => [],
      renameReader: async () => {},
      unpairReader: async () => {},
      adoptReader: async () => ({ id: "r3", status: "paired" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-payments-screen")!;
  await expect.poll(() => q(screen, "[data-test=edit-r1]")).not.toBeNull();
  if (discovery) {
    q(screen, "[data-test=add-reader-test]")!.click();
    await expect.poll(() => q(screen, "[data-test=name-a1]")).not.toBeNull();
  } else await open(screen);
  return { app, screen };
}
async function open(screen: PaymentsScreen, id = "r1", mode = "edit") {
  q(screen, `[data-test=${mode}-${id}]`)!.click();
  await screen.updateComplete;
  await dialog(screen, "reader-editor")!.updateComplete;
}
function dialog(screen: PaymentsScreen, name: string) {
  return q(screen, `[data-test=${name}]`) as WtDialog | null;
}
function change(screen: PaymentsScreen, value: string, field = "edit-reader-name") {
  q(screen, `[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
function unload() {
  return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
}
async function choose(app: ReaderLeaveApp, decision: "keep" | "discard") {
  const confirmation = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => confirmation.open).toBe(true);
  await confirmation.updateComplete;
  confirmation.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => confirmation.open).toBe(false);
}
for (const discovery of [false, true]) {
  const name = discovery ? "discovered name" : "reader rename";
  const field = discovery ? "name-a1" : "edit-reader-name";
  const selector = discovery ? "reader-discovery" : "reader-editor";
  const cancel = discovery ? "cancel-discovery" : "close-reader-editor";
  it(`${name} Cancel and Escape keep values until explicit Discard`, async () => {
    const { app, screen } = await mount({}, discovery);
    change(screen, "New counter", field);
    expect(unload()).toBe(true);
    q(screen, `[data-test=${cancel}]`)!.click();
    await choose(app, "keep");
    expect(dialog(screen, selector)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect((q(screen, `[data-test=${field}]`) as HTMLInputElement).value).toBe("New counter");
    await userEvent.keyboard("{Escape}");
    await choose(app, "discard");
    await expect.poll(() => dialog(screen, selector)).toBeNull();
    expect(unload()).toBe(false);
  });
  it(`${name} normalized revert closes directly`, async () => {
    const { screen } = await mount({}, discovery);
    change(screen, "New counter", field);
    expect(unload()).toBe(true);
    change(screen, " Counter ", field);
    expect(unload()).toBe(false);
    q(screen, `[data-test=${cancel}]`)!.click();
    await expect.poll(() => dialog(screen, selector)).toBeNull();
  });
  it(`${name} failed write keeps the submitted name dirty`, async () => {
    const { app, screen } = await mount(
      {
        renameReader: async () => {
          throw { code: "connection.failed" };
        },
        adoptReader: async () => {
          throw { code: "connection.failed" };
        },
      },
      discovery,
    );
    change(screen, "New counter", field);
    q(screen, `[data-test=${discovery ? "adopt-a1" : "save-reader"}]`)!.click();
    await expect
      .poll(() => dialog(screen, selector)!.querySelector("wt-form-actions")!.error)
      .toBe(codeMessage("connection.failed"));
    expect(unload()).toBe(true);
    q(screen, `[data-test=${cancel}]`)!.click();
    await choose(app, "keep");
    expect((q(screen, `[data-test=${field}]`) as HTMLInputElement).value).toBe("New counter");
  });
  it(`${name} successful write commits before a refused list refresh`, async () => {
    let reads = 0;
    let finish!: () => void;
    const sent: unknown[] = [];
    const { screen } = await mount(
      {
        listReaders: async () => {
          if (reads++) {
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            throw { code: "connection.failed" };
          }
          return [reader];
        },
        renameReader: async (id, value) => {
          sent.push([id, value]);
        },
        adoptReader: async (body) => {
          sent.push(body);
          return { id: "r3", status: "paired" };
        },
      },
      discovery,
    );
    change(screen, " New counter ", field);
    q(screen, `[data-test=${discovery ? "adopt-a1" : "save-reader"}]`)!.click();
    await expect.poll(() => typeof finish).toBe("function");
    try {
      expect(dialog(screen, selector)).toBeNull();
      expect(unload()).toBe(false);
      expect(sent).toEqual(
        discovery
          ? [{ providerId: "test", providerRef: "a1", name: "New counter" }]
          : [["r1", "New counter"]],
      );
    } finally {
      finish();
    }
    await expect
      .poll(() => q(screen, "[role=alert]")?.textContent)
      .toBe(codeMessage("connection.failed"));
    expect(unload()).toBe(false);
  });
}
it("newer delivered rename survives a successful captured write", async () => {
  let finish!: () => void;
  const sent: unknown[] = [];
  const { screen } = await mount({
    renameReader: async (id, name) => {
      sent.push([id, name]);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  change(screen, "Submitted");
  q(screen, "[data-test=save-reader]")!.click();
  await expect.poll(() => sent.length).toBe(1);
  change(screen, "Newer");
  finish();
  await expect
    .poll(() => (q(screen, "[data-test=save-reader]") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect(dialog(screen, "reader-editor")).not.toBeNull();
  expect(unload()).toBe(true);
  change(screen, "Submitted");
  expect(unload()).toBe(false);
  expect(sent).toEqual([["r1", "Submitted"]]);
});
it("adopting one discovery row does not discard another edited name", async () => {
  const { app, screen } = await mount({}, true);
  change(screen, "New counter", "name-a1");
  change(screen, "New bar", "name-a2");
  q(screen, "[data-test=adopt-a1]")!.click();
  await expect
    .poll(() => (q(screen, "[data-test=adopt-a2]") as HTMLButtonElement | null)?.disabled)
    .toBe(false);
  expect(dialog(screen, "reader-discovery")).not.toBeNull();
  expect(unload()).toBe(true);
  expect((q(screen, "[data-test=name-a2]") as HTMLInputElement).value).toBe("New bar");
  q(screen, "[data-test=cancel-discovery]")!.click();
  await choose(app, "keep");
});
it("adoption commits only the submitted name when newer input arrives before its reply", async () => {
  let finish!: () => void;
  const sent: unknown[] = [];
  const { app, screen } = await mount(
    {
      adoptReader: async (body) => {
        sent.push(body);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { id: "r3", status: "paired" };
      },
    },
    true,
  );
  change(screen, "Submitted", "name-a1");
  q(screen, "[data-test=adopt-a1]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  change(screen, "Newer", "name-a1");
  finish();
  await expect
    .poll(() => (q(screen, "[data-test=name-a1]") as HTMLInputElement)?.disabled)
    .toBe(false);
  expect((q(screen, "[data-test=name-a1]") as HTMLInputElement).value).toBe("Newer");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-discovery]")!.click();
  await choose(app, "keep");
  change(screen, "Submitted", "name-a1");
  expect(unload()).toBe(false);
  expect(sent).toEqual([{ providerId: "test", providerRef: "a1", name: "Submitted" }]);
});
it("a departed discovery input cannot rename a reopened row", async () => {
  const { screen } = await mount({}, true);
  const old = q(screen, "[data-test=name-a1]")!;
  q(screen, "[data-test=cancel-discovery]")!.click();
  await expect.poll(() => dialog(screen, "reader-discovery")).toBeNull();
  q(screen, "[data-test=add-reader-test]")!.click();
  await expect.poll(() => q(screen, "[data-test=name-a1]")).not.toBeNull();
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Departed" } }));
  await screen.updateComplete;
  expect((q(screen, "[data-test=name-a1]") as HTMLInputElement).value).toBe("Counter");
  expect(unload()).toBe(false);
});
for (const refuses of [false, true]) {
  it(`an earlier adoption ${refuses ? "refusal" : "success"} cannot finish a replacement discovery`, async () => {
    let finish!: () => void;
    let reads = 0;
    const { screen } = await mount(
      {
        listReaders: async () => {
          reads++;
          return [reader];
        },
        adoptReader: async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          if (refuses) throw { code: "connection.failed" };
          return { id: "r3", status: "paired" };
        },
      },
      true,
    );
    change(screen, "Submitted", "name-a1");
    q(screen, "[data-test=adopt-a1]")!.click();
    await expect.poll(() => typeof finish).toBe("function");
    q(screen, "[data-test=add-reader-test]")!.click();
    await expect
      .poll(() => (q(screen, "[data-test=name-a1]") as HTMLInputElement)?.value)
      .toBe("Counter");
    change(screen, "Replacement", "name-a1");
    const beforeReply = reads;
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await screen.updateComplete;
    expect((q(screen, "[data-test=name-a1]") as HTMLInputElement).value).toBe("Replacement");
    expect((q(screen, "[data-test=adopt-a1]") as HTMLButtonElement).disabled).toBe(false);
    expect(dialog(screen, "reader-discovery")!.querySelector("wt-form-actions")!.error).toBe("");
    expect(reads).toBe(beforeReply);
    expect(unload()).toBe(true);
    change(screen, "Counter", "name-a1");
    expect(unload()).toBe(false);
  });
}
it("details and unpair confirmation remain exempt", async () => {
  const { app, screen } = await mount();
  q(screen, "[data-test=close-reader-editor]")!.click();
  await expect.poll(() => dialog(screen, "reader-editor")).toBeNull();
  for (const mode of ["details", "disable", "unpair"]) {
    await chooseOption(q(screen, "wt-combobox[name=reader-status-filter]")!, "all");
    await screen.updateComplete;
    await open(screen, mode === "unpair" ? "disabled" : "r1", mode);
    expect(unload()).toBe(false);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => dialog(screen, "reader-editor")).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  }
});
for (const action of ["replace", "disconnect"] as const) {
  it(`rename ${action} invalidates a pending leave and releases its draft`, async () => {
    const { app, screen } = await mount();
    change(screen, "New counter");
    q(screen, "[data-test=close-reader-editor]")!.click();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    if (action === "replace") await open(screen, "r2");
    else screen.remove();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
    if (action === "replace")
      expect((q(screen, "[data-test=edit-reader-name]") as HTMLInputElement).value).toBe("Bar");
  });
}
for (const discovery of [false, true]) {
  it(`${discovery ? "adoption" : "rename"} in flight blocks dismissal without asking`, async () => {
    let finish!: () => void;
    const wait = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const { app, screen } = await mount(
      {
        renameReader: wait,
        adoptReader: async () => {
          await wait();
          return { id: "r3", status: "paired" };
        },
      },
      discovery,
    );
    const selector = discovery ? "reader-discovery" : "reader-editor";
    change(screen, "New counter", discovery ? "name-a1" : "edit-reader-name");
    q(screen, `[data-test=${discovery ? "adopt-a1" : "save-reader"}]`)!.click();
    await expect.poll(() => typeof finish).toBe("function");
    try {
      await screen.updateComplete;
      expect(dialog(screen, selector)!.dismissible).toBe(false);
      expect(
        (
          q(
            screen,
            `[data-test=${discovery ? "cancel-discovery" : "close-reader-editor"}]`,
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      await userEvent.keyboard("{Escape}");
      expect(dialog(screen, selector)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
      expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    } finally {
      finish();
    }
    await expect.poll(() => dialog(screen, selector)).toBeNull();
  });
}
for (const refuses of [false, true]) {
  it(`departed rename ${refuses ? "refusal" : "success"} leaves the replacement editor alone`, async () => {
    let finish!: () => void;
    const { screen } = await mount({
      renameReader: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (refuses) throw { code: "connection.failed" };
      },
    });
    change(screen, "Submitted");
    q(screen, "[data-test=save-reader]")!.click();
    await expect.poll(() => typeof finish).toBe("function");
    await open(screen, "r2");
    change(screen, "New bar");
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await screen.updateComplete;
    expect(dialog(screen, "reader-editor")).not.toBeNull();
    expect((q(screen, "[data-test=edit-reader-name]") as HTMLInputElement).value).toBe("New bar");
    expect(dialog(screen, "reader-editor")!.querySelector("wt-form-actions")!.error).toBe("");
    expect(unload()).toBe(true);
  });
}
it("detached rename input cannot alter a replacement editor", async () => {
  const { screen } = await mount();
  const old = q(screen, "[data-test=edit-reader-name]")!;
  q(screen, "[data-test=close-reader-editor]")!.click();
  await expect.poll(() => dialog(screen, "reader-editor")).toBeNull();
  await open(screen, "r2");
  old.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Old draft" } }));
  await screen.updateComplete;
  expect((q(screen, "[data-test=edit-reader-name]") as HTMLInputElement).value).toBe("Bar");
  expect(unload()).toBe(false);
});
for (const discovery of [false, true]) {
  it(`${discovery ? "discovery" : "rename"} reopening survives an earlier native close report`, async () => {
    const { screen } = await mount({}, discovery);
    const selector = discovery ? "reader-discovery" : "reader-editor";
    const native = dialog(screen, selector)!.shadowRoot!.querySelector("dialog")!;
    let held = false;
    native.addEventListener(
      "close",
      (event) => {
        event.stopImmediatePropagation();
        held = true;
      },
      { capture: true, once: true },
    );
    q(screen, `[data-test=${discovery ? "cancel-discovery" : "close-reader-editor"}]`)!.click();
    await expect.poll(() => held).toBe(true);
    await expect.poll(() => dialog(screen, selector)).toBeNull();
    if (discovery) {
      q(screen, "[data-test=add-reader-test]")!.click();
      await expect.poll(() => q(screen, "[data-test=name-a1]")).not.toBeNull();
    } else await open(screen, "r2");
    change(screen, "New name", discovery ? "name-a1" : "edit-reader-name");
    native.dispatchEvent(new Event("close"));
    await screen.updateComplete;
    expect(dialog(screen, selector)).not.toBeNull();
    expect(dialog(screen, selector)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(
      (q(screen, `[data-test=${discovery ? "name-a1" : "edit-reader-name"}]`) as HTMLInputElement)
        .value,
    ).toBe("New name");
    expect(unload()).toBe(true);
  });
}
it("unpair's submitted command retains its direct dismissal exemption", async () => {
  let finish!: () => void;
  let removed = false;
  const { app, screen } = await mount({
    listReaders: async () =>
      removed ? [] : [reader, { ...reader, id: "disabled", active: false }],
    unpairReader: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      removed = true;
    },
  });
  q(screen, "[data-test=close-reader-editor]")!.click();
  await expect.poll(() => dialog(screen, "reader-editor")).toBeNull();
  await chooseOption(q(screen, "wt-combobox[name=reader-status-filter]")!, "all");
  await screen.updateComplete;
  await open(screen, "disabled", "unpair");
  q(screen, "[data-test=confirm-unpair]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  try {
    await screen.updateComplete;
    expect(dialog(screen, "reader-editor")!.dismissible).toBe(true);
    q(screen, "[data-test=close-reader-editor]")!.click();
    await expect.poll(() => dialog(screen, "reader-editor")).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(false);
  } finally {
    finish();
  }
  await expect.poll(() => q(screen, "[data-test=edit-r1]")).toBeNull();
});
