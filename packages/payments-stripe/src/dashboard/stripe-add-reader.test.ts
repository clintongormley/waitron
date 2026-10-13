import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  codeMessage,
  currentLocale,
  registerCodeMessages,
  setLocale,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { t } from "./strings.js";
import { StripeAddReader } from "./stripe-add-reader.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

const READERS_PATH = "/management-api/payments/readers";

function q(el: StripeAddReader, sel: string): HTMLElement | null {
  return el.shadowRoot!.querySelector<HTMLElement>(sel);
}

async function setInput(el: StripeAddReader, testId: string, value: string): Promise<void> {
  q(el, `[data-test=${testId}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function bottomOf(el: StripeAddReader): Promise<string> {
  const actions = q(el, "wt-form-actions") as HTMLElementTagNameMap["wt-form-actions"];
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

function fieldError(el: StripeAddReader, testId: string): string {
  return (q(el, `[data-test=${testId}]`) as unknown as { error: string }).error;
}

function addDisabled(el: StripeAddReader): boolean {
  return q(el, "[data-test=add]")!.hasAttribute("disabled");
}

function focused(el: StripeAddReader, testId: string): boolean {
  const field = q(el, `[data-test=${testId}]`)!;
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The text of `node` and of every shadow root beneath it, as the operator would read it. */
function deepText(node: Node): string {
  let text = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const shadow = (child as Element).shadowRoot;
      if (shadow) text += deepText(shadow);
      if (!["STYLE", "SCRIPT"].includes((child as Element).tagName)) text += deepText(child);
    }
  }
  return text;
}

async function add(el: StripeAddReader): Promise<void> {
  q(el, "[data-test=add]")!.click();
  await el.updateComplete;
  await el.updateComplete;
}

// The dashboard's code table is not loaded here; without this the code reads as the generic
// server-failure sentence, which a misplaced message would also show.
registerCodeMessages({
  "reader.reference_unknown": {
    en: "Unknown reader ID copy for this test",
    es: "Unknown reader ID copy for this test",
  },
});

describe("stripe-add-reader", () => {
  it("posts the reader reference and emits onAdded then closes", async () => {
    const request = vi.fn(async () => ({
      id: "row-1",
      status: "paired",
    })) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });

    expect(q(el, "[data-test=reader-id]")).not.toBeNull();

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(request).toHaveBeenCalledWith(READERS_PATH, "POST", {
      providerId: "stripe",
      name: "Bar terminal",
      reference: "tmr_ABC123",
    });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits a new reader with Save", async () => {
    const before = currentLocale();
    setLocale("en-GB");
    try {
      const request = vi.fn() as unknown as DashboardRequest;
      const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });
      expect(q(el, "[data-test=add]")!.textContent!.trim()).toBe("Save");
    } finally {
      setLocale(before);
    }
  });

  it("blocks the add until the name and reference are filled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await add(el);

    expect(request).not.toHaveBeenCalled();
    expect(fieldError(el, "reader-name")).toBe(t("payments.stripe.reader_name_required"));
    expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_required"));
  });

  it("names the Reader ID field once and gives its help as the field's placeholder", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    const label = t("payments.stripe.reader_id");
    expect(deepText(el.shadowRoot!).split(label).length - 1).toBe(1);
    expect(q(el, "wt-help-tooltip")).toBeNull();
    const input = q(el, "[data-test=reader-id]")!.shadowRoot!.querySelector("input")!;
    expect(input.placeholder).toBe(t("payments.stripe.reader_id_hint"));
  });

  it("puts a reader id Stripe does not know under the Reader ID field, leaving Add working", async () => {
    const request = vi.fn(async () => {
      throw {
        code: "reader.reference_unknown",
        params: { providerId: "stripe", field: "reference" },
      };
    }) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onAdded });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    await vi.waitFor(() =>
      expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_unknown")),
    );
    expect(fieldError(el, "reader-name")).toBe("");
    expect(await bottomOf(el)).toBe(t("payments.stripe.fix_fields"));
    expect(addDisabled(el)).toBe(false);
    await vi.waitFor(() => expect(focused(el, "reader-id")).toBe(true));
    expect(onAdded).not.toHaveBeenCalled();

    await setInput(el, "reader-name", "Bar 2");
    expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_unknown"));

    await setInput(el, "reader-id", "tmr_good");
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(addDisabled(el)).toBe(false);
  });

  it("drops the Reader ID refusal on the next press", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw {
          code: "reader.reference_unknown",
          params: { providerId: "stripe", field: "reference" },
        };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);
    await vi.waitFor(() =>
      expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_unknown")),
    );

    await add(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("drops a Reader ID refusal that arrives after the Reader ID was changed", async () => {
    const pending = deferred<{ id: string; status: string }>();
    const request = vi.fn(() => pending.promise) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    await setInput(el, "reader-id", "tmr_good");

    pending.reject({
      code: "reader.reference_unknown",
      params: { providerId: "stripe", field: "reference" },
    });
    await vi.waitFor(() =>
      expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(false),
    );
    await el.updateComplete;
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));

    expect(fieldError(el, "reader-id")).toBe("");
    expect(focused(el, "reader-id")).toBe(false);
    expect(await bottomOf(el)).toBe("");
    expect((q(el, "[data-test=reader-id]") as unknown as { value: string }).value).toBe("tmr_good");
    expect(addDisabled(el)).toBe(false);
  });

  it("shows the server-failure sentence at the bottom when the request rejects with null", async () => {
    const request = vi.fn(async () => {
      throw null;
    }) as unknown as DashboardRequest;
    const rejections: unknown[] = [];
    const onReject = (e: PromiseRejectionEvent): void => {
      e.preventDefault();
      rejections.push(e.reason);
    };
    window.addEventListener("unhandledrejection", onReject);
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });
    try {
      await setInput(el, "reader-name", "Bar");
      await setInput(el, "reader-id", "tmr_bad");
      await add(el);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      window.removeEventListener("unhandledrejection", onReject);
    }

    expect(rejections).toEqual([]);
    expect(await bottomOf(el)).toBe(codeMessage("server.internal"));
    expect(fieldError(el, "reader-id")).toBe("");
  });

  it("puts the refusal's own sentence at the bottom when it names no field the form shows", async () => {
    const request = vi.fn(async () => {
      throw { code: "reader.reference_unknown", params: { providerId: "stripe" } };
    }) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    expect(await bottomOf(el)).toBe(codeMessage("reader.reference_unknown"));
    expect(fieldError(el, "reader-id")).toBe("");
    expect(addDisabled(el)).toBe(false);
  });

  it("closes without adding when cancelled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onClose });

    q(el, "[data-test=cancel]")!.click();
    await el.updateComplete;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("completes an add when the host sets neither onAdded nor onClose", async () => {
    const request = vi.fn(async () => ({
      id: "row-1",
      status: "paired",
    })) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(request).toHaveBeenCalledWith(READERS_PATH, "POST", {
      providerId: "stripe",
      name: "Bar terminal",
      reference: "tmr_ABC123",
    });
    expect(await bottomOf(el)).toBe("");
    expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(false);
  });

  it("calls onClose once when the dialog is dismissed with Escape", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });
    const dialog = q(el, "wt-dialog") as HTMLElement & { updateComplete: Promise<unknown> };
    await dialog.updateComplete;
    const native = dialog.shadowRoot!.querySelector("dialog")!;
    expect(native.open).toBe(true);
    // The browser reports a close a task after the dialog shuts, which can be after the key press
    // resolves; this listener runs after wt-dialog's own, so onClose has been called by then.
    const reported = new Promise<void>((resolve) => {
      native.addEventListener("close", () => resolve(), { once: true });
    });

    await userEvent.keyboard("{Escape}");

    expect(native.open).toBe(false);
    await reported;
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("sends one add request when Add is pressed twice before the first answers", async () => {
    const pending = deferred<{ id: string; status: string }>();
    const request = vi.fn(() => pending.promise) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    // `.click()` on the host reaches the handler even while the inner button is disabled, so only
    // the single-flight guard stops the second request.
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;

    expect(request).toHaveBeenCalledTimes(1);
    expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(true);
    expect(onAdded).not.toHaveBeenCalled();

    pending.resolve({ id: "row-1", status: "paired" });
    await el.updateComplete;
    await el.updateComplete;

    expect(request).toHaveBeenCalledTimes(1);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect((q(el, "[data-test=add]") as unknown as { loading: boolean }).loading).toBe(false);
  });

  it("calls onClose once when Cancel is pressed while Add is pending, and still reports the added reader", async () => {
    const pending = deferred<{ id: string; status: string }>();
    const request = vi.fn(() => pending.promise) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    q(el, "[data-test=cancel]")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    pending.resolve({ id: "row-1", status: "paired" });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose when the dialog was detached while Add was pending", async () => {
    const pending = deferred<{ id: string; status: string }>();
    const request = vi.fn(() => pending.promise) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const onClose = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", {
      request,
      onAdded,
      onClose,
    });

    await setInput(el, "reader-name", "Bar terminal");
    await setInput(el, "reader-id", "tmr_ABC123");
    q(el, "[data-test=add]")!.click();
    await el.updateComplete;
    el.remove();

    pending.resolve({ id: "row-1", status: "paired" });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the shared server-failure copy at the bottom when the server fails internally", async () => {
    const request = vi.fn(async () => {
      throw { code: "server.internal" };
    }) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onAdded });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    expect(await bottomOf(el)).toBe(codeMessage("server.internal"));
    expect(fieldError(el, "reader-id")).toBe("");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("shows the shared code copy for any other rejection", async () => {
    registerCodeMessages({
      "payment.provider_unknown": {
        en: "Stripe add-reader copy for this test",
        es: "Stripe add-reader copy for this test",
      },
    });
    const request = vi.fn(async () => {
      throw { code: "payment.provider_unknown" };
    }) as unknown as DashboardRequest;
    const onAdded = vi.fn();
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request, onAdded });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(await bottomOf(el)).toBe("Stripe add-reader copy for this test");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("says nothing about errors before the first press, and Add works", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-name", "");

    expect(fieldError(el, "reader-name")).toBe("");
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(addDisabled(el)).toBe(false);
  });

  it("on an invalid press marks the fields, says so above Add, focuses the first and disables Add", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-id", "tmr_ABC123");
    await add(el);

    expect(request).not.toHaveBeenCalled();
    expect(fieldError(el, "reader-name")).toBe(t("payments.stripe.reader_name_required"));
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe(t("payments.stripe.fix_fields"));
    expect(addDisabled(el)).toBe(true);
    await vi.waitFor(() => expect(focused(el, "reader-name")).toBe(true));
    expect((q(el, "[data-test=reader-id]") as unknown as { value: string }).value).toBe(
      "tmr_ABC123",
    );
  });

  it("re-checks every change after a failed press, and Add works again once both are filled", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await add(el);
    await setInput(el, "reader-name", "Bar");
    expect(fieldError(el, "reader-name")).toBe("");
    expect(fieldError(el, "reader-id")).toBe(t("payments.stripe.reader_id_required"));
    expect(addDisabled(el)).toBe(true);

    await setInput(el, "reader-id", "tmr_ABC123");
    expect(fieldError(el, "reader-id")).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(addDisabled(el)).toBe(false);

    await setInput(el, "reader-name", " ");
    expect(fieldError(el, "reader-name")).toBe(t("payments.stripe.reader_name_required"));
    expect(addDisabled(el)).toBe(true);
  });

  it("leaves Add working after a refusal that names no field, and drops it on the next press", async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw { code: "server.internal" };
      })
      .mockImplementationOnce(() => new Promise(() => {})) as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    await setInput(el, "reader-name", "Bar");
    await setInput(el, "reader-id", "tmr_bad");
    await add(el);

    expect(await bottomOf(el)).toBe(codeMessage("server.internal"));
    expect(fieldError(el, "reader-id")).toBe("");
    expect(addDisabled(el)).toBe(false);

    await add(el);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await bottomOf(el)).toBe("");
  });

  it("ends in one action row with Cancel on the left and Add as the primary action", async () => {
    const request = vi.fn() as unknown as DashboardRequest;
    const { el } = await mountWidget<StripeAddReader>("stripe-add-reader", { request });

    const actions = q(el, "wt-form-actions")!;
    expect(actions.getAttribute("slot")).toBe("footer");
    expect(actions.querySelector("[data-test=cancel]")!.getAttribute("slot")).toBe("cancel");
    expect(actions.querySelector("[data-test=add]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "wt-form-error-summary")).toBeNull();
  });
});
