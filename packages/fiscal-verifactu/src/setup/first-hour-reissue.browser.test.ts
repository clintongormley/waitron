import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import type {
  InitialSetupActions,
  InitialSetupNodeKey,
} from "@waitron/module/src/setup-contract.js";
import { readRecoveryPdf } from "../recovery-reader.js";
import { FISCAL_SETUP } from "./first-fiscal-screen.js";

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  vi.restoreAllMocks();
});
const context = {
  status: "claimed",
  environment: "production",
  venue: {
    legalName: "Olivo SL",
    country: "ES",
    taxId: "B12345674",
    seriesCode: "A",
    fullSeriesCode: "FF",
    correctiveSeriesCode: "R",
    name: "Olivo",
    city: "Madrid",
    fiscalTerritory: "ES-common",
    timeZone: "Europe/Madrid",
  },
};
const input = {
  allocation: {
    installationIdentity: "0CSQW",
    series: [
      { code: "A-0CSQW", purpose: "standard" },
      { code: "FF-0CSQW", purpose: "full" },
      { code: "R-0CSQW", purpose: "corrective" },
      { code: "RF-0CSQW", purpose: "full_corrective" },
    ],
  },
};
const pair = (name: string, stageId: string, secret: string): InitialSetupNodeKey => ({
  stage: { stageId, nodeId: "node", name },
  key: { nodeId: "node", name, secret },
  masterKey: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5",
  masterKeyName: "2026-11-23 · QZJV",
});
const old = pair("Old key", "old", "AbCdEfGhIjKlMnOpQrStUvWxYz012345");
const replacement = pair("New key", "replacement", "012345AbCdEfGhIjKlMnOpQrStUvWxYz");
const control = (el: LitElement, name: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${name}]`)!;
const download = (el: LitElement) =>
  el
    .shadowRoot!.querySelector("wt-master-key-box")
    ?.shadowRoot!.querySelector<HTMLElement>("[data-test=download]") ?? null;
/** The files the step has handed to the browser to save, newest last. */
const saved: string[] = [];
beforeEach(() => {
  saved.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.href);
  });
});
async function mount(stage = async () => old, reissue = async () => replacement) {
  const calls: { action: string; value?: unknown }[] = [];
  const instant = Date.parse("2026-10-18T12:30:00Z");
  const api: InitialSetupActions & { reissueNodeKey?: () => Promise<InitialSetupNodeKey> } = {
    async preparation(value) {
      calls.push({ action: "prepare", value });
      if ((value as { action: string }).action === "clock-challenge") return { id: "challenge" };
      return {
        id: "comparison",
        clock: {
          usable: ["box", "browser"].map((source) => ({
            source,
            lowerMs: instant,
            upperMs: instant,
          })),
          unavailable: [],
          secondClock: true,
          disagreement: false,
          releaseBlocked: false,
          rangeBlocked: false,
        },
      };
    },
    async candidates(value) {
      calls.push({ action: "select", value });
      return { kind: "waitron-hour-setup", status: "selected", identity: "0CSQW", input };
    },
    async request() {
      throw new Error("No reselection during key replacement");
    },
    async importInput(value) {
      calls.push({ action: "input", value });
    },
    async enrol() {
      throw new Error("No enrolment during key replacement");
    },
    async confirm() {
      throw new Error("No activation during key replacement");
    },
    async stageNodeKey() {
      calls.push({ action: "stage" });
      return stage();
    },
    async reissueNodeKey() {
      calls.push({ action: "reissue" });
      return reissue();
    },
    async registerRecoveryDocument(value) {
      calls.push({ action: "register", value });
    },
    async confirmRecoveryDocument(value) {
      calls.push({ action: "keep", value });
    },
  };
  const host = document.createElement("main");
  document.body.append(host);
  hosts.push(host);
  applyTokens(host);
  const parent = FISCAL_SETUP.create({ locale: "en", request: context, api }) as LitElement;
  host.append(parent);
  await parent.updateComplete;
  const el = parent.shadowRoot!.querySelector<LitElement>("vf-first-setup-hour")!;
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector("[data-clock=read]")).not.toBeNull();
  expect(control(el, "replace-key"), "replacement is offered only for a frozen hour").toBeNull();
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="setup-details-confirmed"]')!,
  );
  await expect.poll(() => control(el, "compare")?.disabled).toBe(false);
  await userEvent.click(control(el, "compare"));
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=selected-hour]")).not.toBeNull();
  expect(control(el, "replace-key"), "no replacement while the box may hold its key").toBeNull();
  return { el, parent, calls, api };
}
const lost = async (): Promise<InitialSetupNodeKey> => {
  throw { code: "setup.node_key_lost" };
};
/** Asks for the key the box has lost, which is what offers the replacement. */
async function loseKey(el: LitElement) {
  await userEvent.click(control(el, "prepare-pdf"));
  await expect.poll(() => control(el, "replace-key")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("wt-form-actions[data-failed=false]")).not.toBeNull();
}
async function keep(el: LitElement) {
  await userEvent.click(control(el, "kept"));
  await expect.poll(() => control(el, "kept").disabled).toBe(true);
}
it("offers explicit replacement after raw-key loss and delivers the new real PDF for the same frozen hour", async () => {
  const { el, calls } = await mount(lost);
  await loseKey(el);
  expect(calls.filter((c) => c.action === "reissue")).toEqual([]);
  const replace = control(el, "replace-key");
  expect(replace, "lost raw key has an explicit replacement action").not.toBeNull();
  expect(replace.disabled).toBe(false);
  await userEvent.click(replace);
  await expect.poll(() => download(el)).not.toBeNull();
  expect(control(el, "replace-key"), "the replacement is offered once per lost key").toBeNull();
  await userEvent.click(download(el)!);
  const decoded = await readRecoveryPdf(
    new Uint8Array(await (await fetch(saved.at(-1)!)).arrayBuffer()),
  );
  expect(decoded.document?.nodeKey).toEqual(replacement.key);
  expect(decoded.document).not.toHaveProperty("installationCodes");
  expect(calls.filter((c) => c.action === "reissue")).toHaveLength(1);
  expect(calls.filter((c) => c.action === "select")).toEqual([
    { action: "select", value: { comparisonId: "comparison", confirmed: true } },
  ]);
  expect(calls.filter((c) => c.action === "input")).toEqual([{ action: "input", value: input }]);
  expect(calls.filter((c) => c.action === "keep")).toEqual([]);
  await keep(el);
  expect(calls.find((c) => c.action === "keep")?.value).toMatchObject({ stageId: "replacement" });
});
it("keeps a refused replacement retryable, and the retried one needs its own use and keep of the newly registered document", async () => {
  let replacements = 0;
  const { el, calls } = await mount(lost, async () => {
    if (++replacements === 1) throw { code: "password.invalid" };
    return replacement;
  });
  await loseKey(el);
  const replace = control(el, "replace-key");
  await userEvent.click(replace);
  await expect.poll(() => calls.filter((c) => c.action === "reissue")).toHaveLength(1);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions[data-failed=true]"))
    .not.toBeNull();
  expect(download(el)).toBeNull();
  await expect.poll(() => control(el, "replace-key")?.disabled).toBe(false);
  await userEvent.click(control(el, "replace-key"));
  await expect.poll(() => download(el)).not.toBeNull();
  expect(control(el, "kept"), "Continue waits for Download, Print or Copy").toBeNull();
  await userEvent.click(download(el)!);
  expect(saved).toHaveLength(1);
  expect(control(el, "kept").disabled).toBe(false);
  expect(el.shadowRoot!.textContent).not.toContain("Recovery pack confirmed.");
  const registrations = calls.filter((c) => c.action === "register");
  expect(registrations).toHaveLength(1);
  expect(registrations[0]!.value).toMatchObject({
    stageId: "replacement",
    statement: { nodeKey: { nodeId: "node", name: "New key" } },
  });
  expect(calls.filter((c) => c.action === "keep")).toHaveLength(0);
  await keep(el);
  expect(calls.filter((c) => c.action === "keep")[0]!.value).toMatchObject({
    stageId: "replacement",
  });
  expect(control(el, "replace-key"), "no replacement after keeping a PDF").toBeNull();
  expect(calls.filter((c) => c.action === "select")).toHaveLength(1);
});
it("drops a delayed replacement after its module context changes", async () => {
  let release!: (value: InitialSetupNodeKey) => void;
  const { el, parent, calls } = await mount(
    lost,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await loseKey(el);
  const replace = control(el, "replace-key");
  expect(replace).not.toBeNull();
  await userEvent.click(replace);
  await expect.poll(() => release).toBeTypeOf("function");
  (parent as LitElement & { context: unknown }).context = {
    ...context,
    venue: { ...context.venue, taxId: "B87654321" },
  };
  await parent.updateComplete;
  release(replacement);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(download(el)).toBeNull();
  expect(calls.filter((c) => c.action === "register")).toEqual([]);
  expect(calls.filter((c) => c.action === "keep")).toEqual([]);
});
