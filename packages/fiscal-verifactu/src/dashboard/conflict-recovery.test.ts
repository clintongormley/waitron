import { active, input, committed, prepared } from "../../test/conflict-browser-fixture.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "lit";
import { applyTokens } from "@waitron/ui";
import {
  createRequest,
  currentLocale,
  setLocale,
  type DashboardRequest,
  type DashboardScreenHandle,
} from "@waitron/dashboard-kit";
import type { WtMasterKeyInput } from "@waitron/ui";
import { encodeMasterKeyCode } from "@waitron/shared";
import { MAX_PACK_PDF } from "@waitron/recovery-pack/src/pack-file.js";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { ConflictRecovery } from "./conflict-recovery.js";
import { parseConflictResult, type ConflictRequest } from "../conflict-recovery-contract.js";

const hosts: HTMLElement[] = [];
let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("en");
  sessionStorage.removeItem("vf-conflict-attempt");
});
afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
  setLocale(previousLocale);
  sessionStorage.removeItem("vf-conflict-attempt");
});

it("opens key-only recovery without a session or disclosing conflicts before key entry", async () => {
  const request = vi.fn(async () => {
    throw new Error("No request before key entry");
  });
  const pages = (
    VERIFACTU_DASHBOARD as typeof VERIFACTU_DASHBOARD & {
      publicPages?: readonly {
        path: string;
        create(ctx: { request: DashboardRequest; locale: "en" | "es" }): DashboardScreenHandle;
      }[];
    }
  ).publicPages;
  const page = pages?.find((entry) => entry.path === "/recovery/fiscal-conflict");
  expect(page, "The module must supply its key-only public page").toBeDefined();
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(page!.create({ request: request as DashboardRequest, locale: "en" }).render(), host);
  const screen = host.querySelector("vf-conflict-recovery") as HTMLElement & {
    updateComplete: Promise<boolean>;
  };
  await screen.updateComplete;
  applyTokens(screen.parentElement!);
  const title = screen.shadowRoot!.querySelector("h1");
  expect(title).not.toBeNull();
  const size = (token: string) => {
    const probe = document.createElement("span");
    probe.style.fontSize = `var(${token})`;
    screen.shadowRoot!.append(probe);
    const value = getComputedStyle(probe).fontSize;
    probe.remove();
    return value;
  };
  expect(getComputedStyle(title!).fontSize).toBe(size("--wt-font-size-xl"));
  expect(title!.textContent).toBe("Recover from an invoice identity conflict");
  await keyField(screen as ConflictRecovery).updateComplete;
  await keyInput(screen as ConflictRecovery).updateComplete;
  const native = nativeKey(screen as ConflictRecovery);
  expect(native.type).toBe("password");
  expect(native.value).toBe("");
  expect(native.autocomplete).toBe("off");
  expect(keyField(screen as ConflictRecovery).maxPdfBytes).toBe(MAX_PACK_PDF);
  expect(screen.shadowRoot!.querySelector("[data-conflict]")).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("makes the inspect action primary only after the key is entered", async () => {
  const { screen } = await mount(async () => ({
    kind: "status",
    active: [],
    event: { kind: "none" },
  }));
  const action = () =>
    screen.shadowRoot!.querySelector("[data-action=inspect]") as HTMLElement & { variant: string };
  expect(action().variant).toBe("secondary");
  await key(screen, "current-key");
  expect(action().variant).toBe("primary");
});

async function mount(
  answer: (body: ConflictRequest) => Promise<unknown>,
  locale: "en" | "es" = "en",
) {
  const calls: ConflictRequest[] = [];
  const request: DashboardRequest = async <T>(_path: string, _method: string, body?: unknown) => {
    calls.push(structuredClone(body as ConflictRequest));
    return (await answer(body as ConflictRequest)) as T;
  };
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(VERIFACTU_DASHBOARD.publicPages![0]!.create({ request, locale }).render(), host);
  const screen = host.querySelector("vf-conflict-recovery") as ConflictRecovery;
  await settled(screen);
  return { screen, calls };
}
/** A whole printed master key standing for `label`, so each case names its keys. */
function printedKey(label: string): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < label.length; i++)
    bytes[i % 16] = (bytes[i % 16]! * 31 + label.charCodeAt(i)) & 0xff;
  return encodeMasterKeyCode(bytes);
}
function keyField(screen: ConflictRecovery): WtMasterKeyInput {
  return screen.shadowRoot!.querySelector("wt-master-key-input")!;
}
function keyInput(screen: ConflictRecovery): HTMLElement & { updateComplete: Promise<boolean> } {
  return keyField(screen).shadowRoot!.querySelector("wt-input")!;
}
function nativeKey(screen: ConflictRecovery): HTMLInputElement {
  return keyInput(screen).shadowRoot!.querySelector("input")!;
}
async function settled(screen: ConflictRecovery) {
  await screen.updateComplete;
  await keyField(screen)?.updateComplete;
  await screen.updateComplete;
}
async function typeKey(screen: ConflictRecovery, text: string) {
  const input = keyInput(screen);
  await input.updateComplete;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await settled(screen);
}
async function key(screen: ConflictRecovery, label: string) {
  await typeKey(screen, printedKey(label));
}
async function click(screen: ConflictRecovery, action: string) {
  const button = screen.shadowRoot!.querySelector<HTMLElement>(`[data-action=${action}]`);
  expect(button, `Missing ${action} action`).not.toBeNull();
  button!.click();
  await screen.updateComplete;
}
async function confirm(screen: ConflictRecovery, name: string) {
  const field = screen.shadowRoot!.querySelector(`wt-switch[name=${name}]`);
  expect(field).not.toBeNull();
  field!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
async function inspect(screen: ConflictRecovery) {
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
  );
}
async function compare(screen: ConflictRecovery) {
  await confirm(screen, "oldMachineOffline");
  await confirm(screen, "noParallelRecovery");
  await click(screen, "compare");
}

it("validates the key before any network work and allows a corrected key", async () => {
  const { screen, calls } = await mount(async () => ({
    kind: "status",
    active: [active],
    event: { kind: "none" },
  }));
  await click(screen, "inspect");
  expect(calls).toEqual([]);
  expect(keyInput(screen).shadowRoot!.textContent).toContain(
    "Enter the venue's current master key.",
  );
  await key(screen, "paper-secret");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")?.textContent).toContain(
      "A-0CNQA/19",
    ),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]!.recoveryKey).toBe(printedKey("paper-secret"));
  expect(calls[0]!.command).toEqual({ kind: "status" });
  expect(screen.shadowRoot!.innerHTML).not.toContain(printedKey("paper-secret"));
});

it("clears a refused master key and lets the operator authenticate again", async () => {
  const { screen, calls } = await mount(async (body) => {
    if (body.recoveryKey === printedKey("replaced-key"))
      throw { code: "promotion.break_glass_invalid", status: 403 };
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await key(screen, "replaced-key");
  await click(screen, "inspect");
  await vi.waitFor(() => expect(nativeKey(screen).value).toBe(""));
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
  );
  expect(calls.map((c) => c.recoveryKey)).toEqual([
    printedKey("replaced-key"),
    printedKey("current-key"),
  ]);
});

it("the conflict page sends the decoded key", async () => {
  const { screen, calls } = await mount(async () => ({
    kind: "status",
    active: [active],
    event: { kind: "none" },
  }));
  await typeKey(screen, "88dp74baypvbrrm5xfv2wpqyb5m5");
  await click(screen, "inspect");
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.recoveryKey).toBe("88DP 74BA YPVB RRM5 XFV2 WPQY B5M5");
});

it("a key that is not whole is not sent and the field says so", async () => {
  const { screen, calls } = await mount(async () => ({
    kind: "status",
    active: [active],
    event: { kind: "none" },
  }));
  await typeKey(screen, "88dp74baypvb");
  await click(screen, "inspect");
  await settled(screen);
  expect(calls).toEqual([]);
  expect(keyInput(screen).shadowRoot!.textContent).toContain(
    "Not a whole master key. Check it against the recovery pack.",
  );
  expect(
    (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
  ).toBe("Correct the highlighted fields to continue.");
});

const REFUSED_NAME = "2026-10-17 · K7QX";
for (const [locale, line, invalid] of [
  [
    "en",
    `Wrong master key. Use the one dated ${REFUSED_NAME}.`,
    "Correct the highlighted fields to continue.",
  ],
  [
    "es",
    `Clave maestra incorrecta. Usa la del ${REFUSED_NAME}.`,
    "Corrige los campos señalados para continuar.",
  ],
] as const)
  it(`a refused key shows 'Wrong master key. Use the one dated {name}.' with the name the box sent (${locale})`, async () => {
    const { screen, calls } = await mount(async (body) => {
      if (body.recoveryKey === printedKey("replaced-key"))
        throw {
          code: "promotion.break_glass_invalid",
          params: { keyName: REFUSED_NAME },
          status: 401,
        };
      return { kind: "status", active: [active], event: { kind: "none" } };
    }, locale);
    await key(screen, "replaced-key");
    await click(screen, "inspect");
    await vi.waitFor(() => expect(keyInput(screen).shadowRoot!.textContent).toContain(line));
    expect(nativeKey(screen).value).toBe("");
    const actions = screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
      error: string;
    };
    expect(actions.error).toBe(invalid);
    expect(screen.shadowRoot!.textContent).not.toContain(line);
    expect(calls).toHaveLength(1);
  });

for (const [locale, line] of [
  ["en", "The master key was refused. Enter the current master key and try again."],
  [
    "es",
    "La clave maestra se ha rechazado. Introduce la clave maestra actual e inténtalo de nuevo.",
  ],
] as const)
  it(`a refusal that names no key says the master key was refused (${locale})`, async () => {
    const { screen } = await mount(async () => {
      throw { code: "promotion.break_glass_invalid", params: {}, status: 401 };
    }, locale);
    await key(screen, "replaced-key");
    await click(screen, "inspect");
    await vi.waitFor(() =>
      expect((keyInput(screen) as unknown as { error: string }).error).toBe(line),
    );
    expect(nativeKey(screen).value).toBe("");
  });

it("a key refused twice shows the wrong-key line both times", async () => {
  const { screen, calls } = await mount(async () => {
    throw { code: "promotion.break_glass_invalid", params: { keyName: REFUSED_NAME }, status: 401 };
  });
  const line = `Wrong master key. Use the one dated ${REFUSED_NAME}.`;
  await key(screen, "first-key");
  await click(screen, "inspect");
  await vi.waitFor(() => expect(keyInput(screen).shadowRoot!.textContent).toContain(line));
  await key(screen, "second-key");
  expect(keyInput(screen).shadowRoot!.textContent).not.toContain(line);
  await click(screen, "inspect");
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  await vi.waitFor(() => expect(keyInput(screen).shadowRoot!.textContent).toContain(line));
});

it("after a refusal that named an older key, the current pack's key is taken and sent", async () => {
  const currentKey = printedKey("rotated-key");
  const { screen, calls } = await mount(async (body) => {
    if (body.recoveryKey !== currentKey)
      throw {
        code: "promotion.break_glass_invalid",
        params: { keyName: REFUSED_NAME },
        status: 401,
      };
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await key(screen, "first-key");
  await click(screen, "inspect");
  await vi.waitFor(() => expect(keyInput(screen).shadowRoot!.textContent).toContain(REFUSED_NAME));
  expect(keyField(screen).keyName).toBeUndefined();
  await choosePack(screen, await packFor(currentKey, "2026-11-24 · AB23"));
  expect(nativeKey(screen).value).toBe(currentKey);
  expect(keyInput(screen).shadowRoot!.textContent).not.toContain(REFUSED_NAME);
  await click(screen, "inspect");
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]!.recoveryKey).toBe(currentKey);
});

/** A recovery pack PDF holding `masterKey` under `masterKeyName`, as the box prints it. */
async function packFor(masterKey: string, masterKeyName: string): Promise<Uint8Array<ArrayBuffer>> {
  const { renderRecoveryPack } = await import("@waitron/recovery-pack");
  const { default: regularUrl } = await import("../assets/register-noto-sans.ttf?url");
  const { default: monoUrl } = await import("../assets/register-noto-sans-mono.ttf?url");
  const madeAt = "2026-11-24T12:00:00.000Z";
  return renderRecoveryPack({
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFonts: async () => ({
      regular: new Uint8Array(await (await fetch(regularUrl)).arrayBuffer()),
      mono: new Uint8Array(await (await fetch(monoUrl)).arrayBuffer()),
    }),
    pack: { venueName: "Olivo Centro", madeAt, number: 4 },
    parts: [],
    file: {
      kind: "waitron-recovery-pack",
      version: 2,
      number: 4,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      masterKey,
      masterKeyName,
      masterKeyHeldBy: null,
    },
  });
}
/** Chooses `bytes` through the field's own file input and waits until the field shows the result. */
async function choosePack(screen: ConflictRecovery, bytes: Uint8Array<ArrayBuffer>) {
  const field = keyField(screen);
  const chooser = field.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = new DataTransfer();
  files.items.add(new File([bytes], "current.pdf", { type: "application/pdf" }));
  chooser.files = files.files;
  chooser.dispatchEvent(new Event("change", { bubbles: true }));
  await field.pdfRead;
  await settled(screen);
  await keyInput(screen).updateComplete;
}

it("Stop forgets the refused key's name and its line", async () => {
  const { screen } = await mount(async () => {
    throw { code: "promotion.break_glass_invalid", params: { keyName: REFUSED_NAME }, status: 401 };
  });
  await key(screen, "first-key");
  await click(screen, "inspect");
  await vi.waitFor(() => expect(keyInput(screen).shadowRoot!.textContent).toContain(REFUSED_NAME));
  await click(screen, "stop");
  await keyField(screen).updateComplete;
  expect(keyField(screen).keyName).toBeUndefined();
  expect(keyInput(screen).shadowRoot!.textContent).not.toContain(REFUSED_NAME);
});

for (const [locale, label] of [
  ["en", "Master key"],
  ["es", "Clave maestra"],
] as const)
  it(`the field is labelled Master key, with no hint (${locale})`, async () => {
    const { screen } = await mount(async () => {
      throw new Error("No request");
    }, locale);
    const input = keyInput(screen) as ReturnType<typeof keyInput> & { label: string; hint: string };
    await input.updateComplete;
    expect(input.label).toBe(label);
    expect(input.hint).toBe("");
    expect(nativeKey(screen).placeholder).toBe("");
    expect(input.shadowRoot!.querySelector("[data-hint]")).toBeNull();
    expect(screen.shadowRoot!.textContent).not.toMatch(/box key|clave del servidor/i);
    expect(input.shadowRoot!.textContent).not.toMatch(/box key|clave del servidor/i);
  });

it("does not disclose conflict data from a reply outside the public response contract", async () => {
  const { screen } = await mount(async () => ({
    kind: "status",
    active: [active],
    event: { kind: "none" },
    authority: "PRIVATE_AUTHORITY",
  }));
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The request could not be completed",
    ),
  );
  expect(screen.shadowRoot!.querySelector("[data-conflict]")).toBeNull();
  expect(screen.shadowRoot!.innerHTML).not.toContain("PRIVATE_AUTHORITY");
});

it("Stop clears the native key and ignores a late status reply", async () => {
  let finish!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  const { screen, calls } = await mount(async () => held);
  await key(screen, "private-key");
  await click(screen, "inspect");
  expect(calls).toHaveLength(1);
  await click(screen, "stop");
  finish({ kind: "status", active: [active], event: { kind: "none" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(nativeKey(screen).value).toBe("");
  expect(screen.shadowRoot!.querySelector("[data-conflict]")).toBeNull();
  expect(calls).toHaveLength(1);
});

it("requires both isolation answers, compares clocks and switches only on explicit action", async () => {
  const { screen, calls } = await mount(async (body) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : body.command.kind === "activate"
        ? { kind: "committed", result: { ...committed, activationEventId: body.eventId } }
        : prepared(body),
  );
  await inspect(screen);
  await click(screen, "compare");
  expect(calls).toHaveLength(1);
  await confirm(screen, "oldMachineOffline");
  await click(screen, "compare");
  expect(calls).toHaveLength(1);
  await confirm(screen, "noParallelRecovery");
  await click(screen, "compare");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-identity]")?.textContent).toContain("0CNQR"),
  );
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(0);
  expect(
    calls
      .slice(1)
      .map((c) => (c.command.kind === "prepare" ? c.command.proposal.action : c.command.kind)),
  ).toEqual(["clock-challenge", "compare-clocks", "select"]);
  await click(screen, "switch");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-complete]")?.textContent).toContain("A-0CNQR"),
  );
  const activation = calls.find((c) => c.command.kind === "activate")!;
  expect(activation.conflict).toEqual({ registroId: "record-1", sifId: "sif-1" });
  expect(activation.oldMachineOffline).toBe(true);
  expect(activation.noParallelRecovery).toBe(true);
  expect(screen.shadowRoot!.querySelector("wt-master-key-input")).toBeNull();
});

it("does not select or activate when the second clock disagrees", async () => {
  const { screen, calls } = await mount(async (body) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : body.command.kind === "prepare" && body.command.proposal.action === "compare-clocks"
        ? {
            kind: "prepared",
            value: {
              id: "comparison-1",
              clock: {
                usable: [],
                unavailable: [],
                secondClock: true,
                disagreement: true,
                releaseBlocked: false,
                rangeBlocked: false,
              },
            },
          }
        : prepared(body),
  );
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The clocks do not agree",
    ),
  );
  expect(calls).toHaveLength(3);
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
});

/** A box answering as with no internet time: each comparison named afresh, then `after` (agrees by default). */
function deviceOnly(after?: { disagreement: boolean }) {
  let compared = 0;
  const comparedAt = new Map<string, number>();
  return async (body: ConflictRequest) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "compare-clocks") {
      const id = `comparison-${++compared}`;
      comparedAt.set(id, Date.now());
      return {
        kind: "prepared",
        value: {
          id,
          clock: {
            usable: [
              { source: "box", lowerMs: Date.now(), upperMs: Date.now() },
              { source: "browser", lowerMs: Date.now(), upperMs: Date.now() },
            ],
            unavailable: [{ source: "internet", result: "unavailable", reason: "offline" }],
            secondClock: true,
            disagreement: compared > 1 && after !== undefined ? after.disagreement : false,
            releaseBlocked: false,
            rangeBlocked: false,
          },
        },
      };
    }
    if (body.command.kind === "prepare" && body.command.proposal.action === "select") {
      const { comparisonId, confirmed } = body.command.proposal;
      if (confirmed !== true)
        throw { code: "sif.allocation_invalid", params: { reason: "confirmation_required" } };
      if (Date.now() - comparedAt.get(comparisonId)! > 30_000)
        throw { code: "sif.allocation_invalid", params: { reason: "clock_stale" } };
    }
    return prepared(body);
  };
}
const proposals = (calls: ConflictRequest[]) =>
  calls.flatMap((c) => (c.command.kind === "prepare" ? [c.command.proposal] : []));

it("with only this device agreeing, shows both times and selects with confirmed only after Confirm the time", async () => {
  const { screen, calls } = await mount(deviceOnly());
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(
      screen.shadowRoot!.querySelector("[data-action=confirm-time]")?.textContent?.trim(),
    ).toBe("Confirm the time"),
  );
  expect(screen.shadowRoot!.querySelector("[data-confirm-time]")?.textContent).toContain(
    "The box could not check its time over the internet. Check that both times below are right, then press Confirm the time.",
  );
  expect(screen.shadowRoot!.querySelectorAll("[data-confirm-time] dt")).toHaveLength(2);
  const zone = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short" })
    .formatToParts(Date.now())
    .find((part) => part.type === "timeZoneName")!.value;
  for (const time of screen.shadowRoot!.querySelectorAll("[data-confirm-time] dd"))
    expect(time.textContent?.trim()).toContain(` ${zone}`);
  expect(proposals(calls).map((p) => p.action)).toEqual(["clock-challenge", "compare-clocks"]);
  await click(screen, "confirm-time");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-identity]")?.textContent).toContain("0CNQR"),
  );
  expect(proposals(calls).slice(2)).toEqual([
    { action: "clock-challenge" },
    expect.objectContaining({ action: "compare-clocks" }),
    { action: "select", comparisonId: "comparison-2", confirmed: true },
  ]);
  expect(screen.shadowRoot!.querySelector("[data-confirm-time]")).toBeNull();
});

it("a press whose fresh comparison disagrees shows the disagreement and sends no select", async () => {
  const { screen, calls } = await mount(deviceOnly({ disagreement: true }));
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=confirm-time]")).not.toBeNull(),
  );
  await click(screen, "confirm-time");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The clocks do not agree",
    ),
  );
  expect(proposals(calls).filter((p) => p.action === "select")).toEqual([]);
  expect(screen.shadowRoot!.querySelector("[data-confirm-time]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
});

it("a press 31 seconds after the first comparison compares again and is accepted", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { screen, calls } = await mount(deviceOnly());
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=confirm-time]")).not.toBeNull(),
  );
  vi.setSystemTime(Date.now() + 31_000);
  await click(screen, "confirm-time");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-identity]")?.textContent).toContain("0CNQR"),
  );
  expect(proposals(calls).at(-1)).toEqual({
    action: "select",
    comparisonId: "comparison-2",
    confirmed: true,
  });
});

it.each([
  { code: "promotion.break_glass_invalid", reason: undefined, then: "inspect" },
  { code: "sif.allocation_invalid", reason: "old_machine_active", then: "compare" },
  { code: "sif.allocation_invalid", reason: "parallel_recovery", then: "compare" },
  { code: "sif.allocation_invalid", reason: "uncertain_prior_activation", then: "inspect" },
])(
  "a Confirm the time press refused with $code/$reason drops the times shown for confirmation",
  async ({ code, reason, then }) => {
    const box = deviceOnly();
    let challenges = 0;
    const { screen } = await mount(async (body) => {
      if (
        body.command.kind === "prepare" &&
        body.command.proposal.action === "clock-challenge" &&
        ++challenges === 2
      )
        throw { code, ...(reason === undefined ? {} : { params: { reason } }) };
      return box(body);
    });
    await inspect(screen);
    await compare(screen);
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-confirm-time]")).not.toBeNull(),
    );
    await click(screen, "confirm-time");
    await vi.waitFor(() =>
      expect(
        (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
          .error,
      ).not.toBe(""),
    );
    expect(screen.shadowRoot!.querySelector("[data-confirm-time]")).toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-action=confirm-time]")).toBeNull();
    expect(screen.shadowRoot!.querySelector(`[data-action=${then}]`)).not.toBeNull();
  },
);

it("with the internet's time among the clocks, selects by itself and never sends confirmed", async () => {
  const { screen, calls } = await mount(async (body) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : prepared(body),
  );
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-identity]")).not.toBeNull(),
  );
  expect(proposals(calls).filter((p) => p.action === "select")).toEqual([
    { action: "select", comparisonId: "comparison-1" },
  ]);
  expect(screen.shadowRoot!.querySelector("[data-action=confirm-time]")).toBeNull();
});

it("waits five seconds between automatic minute checks and never activates from a countdown", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return {
        kind: "prepared",
        value: { status: "waiting", targetMs: Date.now() + 60000, remainingMs: 60000 },
      };
    if (body.command.kind === "prepare" && body.command.proposal.action === "preview")
      return { kind: "prepared", value: { status: "preview", identity: "0CNQR" } };
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.advanceTimersByTimeAsync(0);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")).not.toBeNull();
  const count = calls.length;
  await vi.advanceTimersByTimeAsync(4999);
  expect(calls).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(1);
  await screen.updateComplete;
  expect(calls).toHaveLength(count + 1);
  expect(calls.at(-1)!.command).toEqual({ kind: "prepare", proposal: { action: "preview" } });
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
  await vi.advanceTimersByTimeAsync(60000);
  expect(calls).toHaveLength(count + 1);
});

it("releases the countdown after a failed automatic check so Compare clocks can be retried", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return {
        kind: "prepared",
        value: { status: "waiting", remainingMs: 60000, targetMs: Date.now() + 60000 },
      };
    if (body.command.kind === "prepare" && body.command.proposal.action === "preview")
      throw { code: "connection.failed" };
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(5000);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")).toBeNull();
  const action = screen.shadowRoot!.querySelector("[data-action=compare]") as HTMLElement & {
    disabled: boolean;
  };
  expect(action.disabled).toBe(false);
  const before = calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(calls).toHaveLength(before);
});

it("retains only event and conflict across Stop and reopening, and authenticates the exact attempt", async () => {
  const answer = async (body: ConflictRequest) =>
    body.command.kind === "status"
      ? { kind: "status", active: [active], event: { kind: "none" } }
      : prepared(body);
  const first = await mount(answer);
  await inspect(first.screen);
  await compare(first.screen);
  await vi.waitFor(() =>
    expect(first.screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  const before = first.calls.at(-1)!;
  await click(first.screen, "stop");
  const retained = JSON.parse(sessionStorage.getItem("vf-conflict-attempt")!);
  expect(retained).toEqual({
    eventId: before.eventId,
    conflict: { registroId: "record-1", sifId: "sif-1" },
  });
  first.screen.remove();
  const second = await mount(answer);
  await inspect(second.screen);
  expect(second.calls[0]!.eventId).toBe(before.eventId);
  expect(second.calls[0]!.conflict).toEqual(before.conflict);
  expect(second.calls[0]!.recoveryKey).toBe(printedKey("current-key"));
});

it("requires a new event and key after an interrupted retained attempt", async () => {
  let retained = false;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return {
        kind: "status",
        active: [active],
        event: { kind: retained ? "restart-required" : "none" },
      };
    if (body.command.kind === "activate") {
      retained = true;
      throw { code: "connection.failed" };
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  await click(screen, "switch");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=again]")).not.toBeNull(),
  );
  const original = calls[0]!.eventId;
  await click(screen, "again");
  retained = false;
  expect(nativeKey(screen).value).toBe("");
  await inspect(screen);
  expect(calls.at(-1)!.eventId).not.toBe(original);
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(1);
});

it("keeps a rate-limit refusal actionable without starting an automatic retry loop", async () => {
  let limited = true;
  const { screen, calls } = await mount(async () => {
    if (limited) throw { code: "recovery.rate_limited", status: 429 };
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "Wait a minute",
    ),
  );
  expect(calls).toHaveLength(1);
  expect(nativeKey(screen).value).toBe("");
  await key(screen, "current-key");
  expect(
    (
      screen.shadowRoot!.querySelector("[data-action=inspect]") as HTMLElement & {
        disabled: boolean;
      }
    ).disabled,
  ).toBe(false);
  limited = false;
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
  );
});

it("refuses a selected allocation for another event before offering Switch", async () => {
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return { kind: "prepared", value: { status: "selected", identity: "0CNQR", input } };
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")!.shadowRoot!.textContent).toContain(
      "The request could not be completed",
    ),
  );
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(0);
});

it("Stop during activation hides late completion and reopening reconciles the same event", async () => {
  let finish!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  let activated = false;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return {
        kind: "status",
        active: activated ? [] : [active],
        event: activated
          ? { kind: "committed", result: { ...committed, activationEventId: body.eventId } }
          : { kind: "none" },
      };
    if (body.command.kind === "activate") {
      activated = true;
      return held;
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  await click(screen, "switch");
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")?.textContent).toContain(
    "Switch identity",
  );
  await click(screen, "stop");
  finish({ kind: "committed", result: { ...committed, activationEventId: calls[0]!.eventId } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-complete]")).toBeNull();
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-complete]")).not.toBeNull(),
  );
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(1);
});

it("reconciles a lost activation reply using the exact event and conflict without resending activation", async () => {
  let activated = false;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return {
        kind: "status",
        active: activated ? [] : [active],
        event: activated
          ? { kind: "committed", result: { ...committed, activationEventId: body.eventId } }
          : { kind: "none" },
      };
    if (body.command.kind === "activate") {
      activated = true;
      throw { code: "connection.failed" };
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).not.toBeNull(),
  );
  await click(screen, "switch");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-complete]")).not.toBeNull(),
  );
  expect(calls.filter((c) => c.command.kind === "activate")).toHaveLength(1);
  expect(calls.at(-1)!.command).toEqual({ kind: "status" });
  expect(calls.at(-1)!.eventId).toBe(calls.at(-2)!.eventId);
  expect(calls.at(-1)!.conflict).toEqual(calls.at(-2)!.conflict);
});

it.each(["connection.failed", "promotion.break_glass_invalid"])(
  "ignores a late %s failure after Stop and a new key inspection",
  async (code) => {
    let reject!: (error: unknown) => void;
    const held = new Promise((_resolve, refuse) => {
      reject = refuse;
    });
    let first = true;
    const { screen } = await mount(async () => {
      if (first) {
        first = false;
        return held;
      }
      return { kind: "status", active: [active], event: { kind: "none" } };
    });
    await key(screen, "old-key");
    await click(screen, "inspect");
    await click(screen, "stop");
    await key(screen, "new-key");
    await click(screen, "inspect");
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
    );
    reject({ code });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await screen.updateComplete;
    expect(nativeKey(screen).value).toBe(printedKey("new-key"));
    expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull();
    expect(
      (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
        .error,
    ).toBe("");
  },
);

function refusedHttp(code: string, reason?: string) {
  return createRequest({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ error: { code, params: reason === undefined ? {} : { reason } } }),
        {
          status: code === "node.operation_page_required" ? 403 : 409,
          headers: { "content-type": "application/json" },
        },
      ),
  });
}

it.each([
  { code: "node.operation_page_required", words: "HTTPS recovery address directly" },
  { code: "node.read_only", words: "cannot write invoices" },
  {
    code: "sif.allocation_invalid",
    reason: "old_machine_active",
    words: "Confirm both isolation answers",
  },
  {
    code: "sif.allocation_invalid",
    reason: "parallel_recovery",
    words: "Confirm both isolation answers",
  },
])("explains an actionable recovery refusal: $code/$reason", async ({ code, reason, words }) => {
  const request = refusedHttp(code, reason);
  const { screen } = await mount((body) =>
    reason !== undefined && body.command.kind === "status"
      ? Promise.resolve({ kind: "status", active: [active], event: { kind: "none" } })
      : request("/api/module-recovery/fiscal-verifactu/conflict", "POST", body),
  );
  await key(screen, "current-key");
  await click(screen, "inspect");
  if (reason !== undefined) {
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-conflict]")).not.toBeNull(),
    );
    await compare(screen);
  }
  await vi.waitFor(() =>
    expect(
      (screen.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & { error: string })
        .error,
    ).toContain(words),
  );
  expect(screen.shadowRoot!.querySelector("[data-action=stop]")).not.toBeNull();
});

it("reconciles an uncertain preparation before offering a new attempt", async () => {
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "prepare")
      return refusedHttp("sif.allocation_invalid", "uncertain_prior_activation")(
        "/api/module-recovery/fiscal-verifactu/conflict",
        "POST",
        body,
      );
    return { kind: "status", active: [active], event: { kind: "none" } };
  });
  await inspect(screen);
  const eventId = calls[0]!.eventId;
  await compare(screen);
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=inspect]")).not.toBeNull(),
  );
  expect(screen.shadowRoot!.querySelector("[data-action=again]")).toBeNull();
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-action=again]")).not.toBeNull(),
  );
  expect(calls.at(-1)!.eventId).toBe(eventId);
  expect(calls.at(-1)!.command).toEqual({ kind: "status" });
  expect(calls.filter((call) => call.command.kind === "activate")).toEqual([]);
});

it("updates the countdown locally and keeps repeated waits five seconds apart", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  let previews = 0;
  const { screen, calls } = await mount(async (body) => {
    if (body.command.kind === "status")
      return { kind: "status", active: [active], event: { kind: "none" } };
    if (body.command.kind === "prepare" && body.command.proposal.action === "select")
      return {
        kind: "prepared",
        value: { status: "waiting", targetMs: Date.now() + 7000, remainingMs: 7000 },
      };
    if (body.command.kind === "prepare" && body.command.proposal.action === "preview") {
      previews++;
      return previews === 1
        ? {
            kind: "prepared",
            value: { status: "waiting", targetMs: Date.now() + 2000, remainingMs: 2000 },
          }
        : { kind: "prepared", value: { status: "preview", identity: "0CNQR" } };
    }
    return prepared(body);
  });
  await inspect(screen);
  await compare(screen);
  await vi.advanceTimersByTimeAsync(0);
  const count = calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")?.textContent).toContain("5 seconds");
  expect(calls).toHaveLength(count);
  await vi.advanceTimersByTimeAsync(3000);
  expect(previews).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-wait]")?.textContent).toContain("1 seconds");
  await vi.advanceTimersByTimeAsync(4000);
  await screen.updateComplete;
  expect(previews).toBe(2);
  expect(screen.shadowRoot!.querySelector("[data-wait]")).toBeNull();
  expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
  const finished = calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(calls).toHaveLength(finished);
  expect(calls.filter((call) => call.command.kind === "activate")).toEqual([]);
});

it.each(["status", "clock-challenge", "compare-clocks", "select", "preview-selection"])(
  "refuses a schema-valid reply for the wrong %s command without activating",
  async (stage) => {
    const { screen, calls } = await mount(async (body) => {
      if (body.command.kind === "status")
        return stage === "status"
          ? {
              kind: "prepared",
              value: { id: "unexpected-challenge", boxInstantMs: Date.now(), expiresInMs: 5000 },
            }
          : { kind: "status", active: [active], event: { kind: "none" } };
      if (body.command.kind === "prepare" && body.command.proposal.action === stage)
        return { kind: "status", active: [active], event: { kind: "none" } };
      if (
        stage === "preview-selection" &&
        body.command.kind === "prepare" &&
        body.command.proposal.action === "select"
      )
        return { kind: "prepared", value: { status: "preview", identity: "0CNQR" } };
      return prepared(body);
    });
    if (stage === "status") {
      await key(screen, "current-key");
      await click(screen, "inspect");
    } else {
      await inspect(screen);
      await compare(screen);
    }
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("wt-form-actions")?.error).toContain(
        "The request could not be completed",
      ),
    );
    expect(screen.shadowRoot!.querySelector("[data-action=switch]")).toBeNull();
    expect(screen.shadowRoot!.querySelector("[data-complete]")).toBeNull();
    expect(calls.filter((call) => call.command.kind === "activate")).toEqual([]);
    expect(screen.shadowRoot!.querySelector("[data-action=stop]")).not.toBeNull();
  },
);

it("refuses a committed result for another event without clearing the current key", async () => {
  const { screen, calls } = await mount(async () => ({
    kind: "status",
    active: [],
    event: { kind: "committed", result: { ...committed, activationEventId: "another-event" } },
  }));
  await key(screen, "current-key");
  await click(screen, "inspect");
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("wt-form-actions")?.error).toContain(
      "The request could not be completed",
    ),
  );
  expect(screen.shadowRoot!.querySelector("[data-complete]")).toBeNull();
  expect(nativeKey(screen).value).toBe(printedKey("current-key"));
  expect(calls).toHaveLength(1);
});

it.each(["en", "es"] as const)(
  "%s recovers a lookup-only conflict using its observation id through the existing screen",
  async (locale) => {
    const rest = Object.fromEntries(Object.entries(active).filter(([key]) => key !== "registroId"));
    const observed = { ...rest, lookupId: "lookup-1" };
    const { screen, calls } = await mount(async (body) => {
      if (body.command.kind === "status")
        return { kind: "status", active: [observed], event: { kind: "none" } };
      if (body.command.kind === "activate")
        return { kind: "committed", result: { ...committed, activationEventId: body.eventId } };
      const answer = parseConflictResult(prepared(body))!;
      if (
        answer.kind === "prepared" &&
        "status" in answer.value &&
        answer.value.status === "selected"
      )
        return {
          ...answer,
          value: {
            ...answer.value,
            input: {
              ...answer.value.input,
              approval: {
                ...answer.value.input.approval,
                sourceId: '["lookup-conflict","sif-1","lookup-1"]',
              },
            },
          },
        };
      return answer;
    });
    screen.locale = locale;
    await screen.updateComplete;
    await inspect(screen);
    expect(screen.shadowRoot!.textContent).toContain(
      locale === "en"
        ? "filing response or an AEAT lookup"
        : "respuesta de envío o una consulta a Hacienda",
    );
    expect(screen.shadowRoot!.textContent).toContain(
      locale === "en"
        ? "Existing filing results and cases stay unchanged"
        : "Los resultados de envío y las incidencias existentes no cambian",
    );
    await confirm(screen, "oldMachineOffline");
    await confirm(screen, "noParallelRecovery");
    await click(screen, "compare");
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-identity]")?.textContent).toContain("0CNQR"),
    );
    await click(screen, "switch");
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-complete]")?.textContent).toContain("A-0CNQR"),
    );
    expect(calls.find((body) => body.command.kind === "activate")?.conflict).toEqual({
      lookupId: "lookup-1",
      sifId: "sif-1",
    });
  },
);
