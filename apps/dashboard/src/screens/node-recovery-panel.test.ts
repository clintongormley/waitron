import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtInput } from "@waitron/ui";
import { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { NodeRecoveryPanel } from "./node-recovery-panel.js";

afterEach(cleanupWidgets);
const pack = {
  version: 1,
  kind: "node-recovery-pack",
  createdAt: "2026-10-14T10:00:00.000Z",
  nodeRecovery: { nodeId: "node-one", name: "2026-10-14 · K7QF", secret: "held-node-key" },
  modules: { "test-regime": { signed: "public-register" } },
  warnings: [],
};
const q = <T extends Element>(el: NodeRecoveryPanel, name: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test="${name}"]`)!;
async function mount(
  fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(pack))),
) {
  const { el } = await mountWidget<NodeRecoveryPanel>("dashboard-node-recovery", {
    api: new DashboardApi("", fetcher),
  });
  return { el, fetcher };
}
async function key(el: NodeRecoveryPanel, value = "held-node-key") {
  q<WtInput>(el, "node-key").dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}
async function file(
  el: NodeRecoveryPanel,
  content = JSON.stringify({ "test-regime": { signed: "public-register" } }),
) {
  const picker = q<HTMLInputElement>(el, "register-file");
  const files = new DataTransfer();
  files.items.add(new File([content], "register.json", { type: "application/json" }));
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  await el.updateComplete;
}
async function create(el: NodeRecoveryPanel) {
  q<WtButton>(el, "create-pack").click();
  await el.updateComplete;
}

it("starts without a network request and keeps creation quiet until both inputs are present", async () => {
  const { el, fetcher } = await mount();
  expect(q(el, "node-key")).not.toBeNull();
  expect(q<WtInput>(el, "node-key").type).toBe("password");
  expect(q<WtButton>(el, "create-pack").disabled).toBe(true);
  expect(q<WtButton>(el, "create-pack").variant).toBe("secondary");
  await key(el);
  expect(q<WtButton>(el, "create-pack").disabled).toBe(true);
  await file(el);
  expect(q<WtButton>(el, "create-pack").disabled).toBe(false);
  expect(q<WtButton>(el, "create-pack").variant).toBe("primary");
  expect(fetcher).not.toHaveBeenCalled();
});

it("downloads JSON and a self-contained printable handover without displaying the secret", async () => {
  const { el, fetcher } = await mount();
  await key(el);
  await file(el);
  await create(el);
  await vi.waitFor(() => expect(q(el, "download-pack")).not.toBeNull());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/box/recovery-pack",
    expect.objectContaining({
      body: JSON.stringify({
        nodeRecoveryKey: "held-node-key",
        modules: { "test-regime": { signed: "public-register" } },
      }),
    }),
  );
  const json = await fetch(q<HTMLAnchorElement>(el, "download-pack").href).then((r) => r.json());
  expect(json).toEqual(pack);
  const html = await fetch(q<HTMLAnchorElement>(el, "print-pack").href).then((r) => r.text());
  expect(html).toContain("2026-10-14 · K7QF");
  expect(html).toContain("held-node-key");
  expect(html).toContain("public-register");
  expect(el.shadowRoot!.textContent).not.toContain("held-node-key");
  expect(q<WtInput>(el, "node-key").value).toBe("");
  expect(q<HTMLAnchorElement>(el, "print-pack").download).toMatch(/\.html$/);
  const href = q<HTMLAnchorElement>(el, "print-pack").href;
  q<WtButton>(el, "clear-pack").click();
  await el.updateComplete;
  expect(q(el, "print-pack")).toBeNull();
  await expect(fetch(href)).rejects.toThrow();
});

it.each(["not-json", "null", "[]", '"wrong"', '{"secret":"-----BEGIN PRIVATE KEY-----"}'])(
  "refuses unusable register %s before sending the node credential",
  async (content) => {
    const { el, fetcher } = await mount();
    await key(el);
    await file(el, content);
    await create(el);
    await vi.waitFor(() => expect(q(el, "file-error")?.textContent).toBeTruthy());
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("keeps failed input retryable and puts a bad node key beside its field", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "promotion.break_glass_invalid", params: {} } }),
        { status: 400 },
      ),
    )
    .mockImplementation(async () => new Response(JSON.stringify(pack)));
  const { el } = await mount(fetcher);
  await key(el);
  await file(el);
  await create(el);
  await vi.waitFor(() => expect(q<WtInput>(el, "node-key").error).toBeTruthy());
  expect(q<WtButton>(el, "create-pack").disabled).toBe(false);
  await create(el);
  await vi.waitFor(() => expect(q(el, "download-pack")).not.toBeNull());
});

it("ignores a response after leaving and releases download URLs when removed", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  const { el } = await mount(fetcher);
  await key(el);
  await file(el);
  await create(el);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const parent = el.parentNode!;
  el.remove();
  resolve(new Response(JSON.stringify(pack)));
  await el.updateComplete;
  parent.append(el);
  await el.updateComplete;
  expect(q(el, "download-pack")).toBeNull();
  expect(q<WtInput>(el, "node-key").value).toBe("");
  expect(q<HTMLInputElement>(el, "register-file").files).toHaveLength(0);
});

it.each(["en-GB", "es-ES"] as const)("uses the current %s wording", async (locale) => {
  const old = currentLocale();
  try {
    setLocale(locale);
    const { el } = await mount();
    expect(el.shadowRoot!.textContent).toContain(t("node_pack.title"));
  } finally {
    setLocale(old);
  }
});

it("updates an already open form when the language changes", async () => {
  const old = currentLocale();
  try {
    setLocale("en-GB");
    const { el } = await mount();
    setLocale("es-ES");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain("Kit de recuperación del nodo");
  } finally {
    setLocale(old);
  }
});
