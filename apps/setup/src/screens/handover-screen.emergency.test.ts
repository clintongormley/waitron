import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtFileInput } from "@waitron/ui";
import { formatDuration } from "@waitron/shared";
import { SetupApi } from "../api/client.js";
import { format, setLocale, t } from "../i18n/t.js";
import { handoverEs } from "../i18n/strings/handover.js";
import { chooseFiles, drawnFileName, fileControl } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupHandoverScreen } from "./handover-screen.js";

const MAIN = "https://box-aaaa.waitron.local";
const signIn = { email: "owner@example.com", password: "correct horse", totp: "123456" };
const saved = {
  operationId: "emergency-one",
  reason: "The old box has failed",
  declaredAtMs: 1792147200000,
};
const preview = {
  sourceNodeId: "old",
  destinationNodeId: "new",
  sourceServersUrl: "https://main.example/servers",
  copy: {
    source: "followed-copy",
    sourceId: "c".repeat(64),
    identifier: "a".repeat(64),
    lastChangeAtMs: null,
  },
  joinedAtMs: 1789819200000,
  operation: null,
};
const heldActivityMs = 1790078400000;
// A zone the browser running this test is not in, so passing the device's zone fails.
const venueZone =
  Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Madrid"
    ? "Atlantic/Canary"
    : "Europe/Madrid";
const status = {
  operationId: saved.operationId,
  role: "destination",
  scenario: "emergency",
  state: "emergency_declared",
  sourceNodeId: "old",
  destinationNodeId: "new",
  waitingReason: null,
  timeZone: venueZone,
};
const binding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: saved.operationId,
  sourceId: "old",
  targetNodeId: "new",
};
const selectedInput = {
  allocation: {
    installationIdentity: "0CSQW",
    series: [
      { code: "A-0CSQW", purpose: "standard" },
      { code: "FF-0CSQW", purpose: "full" },
      { code: "R-0CSQW", purpose: "corrective" },
    ],
  },
};
const q = <T extends HTMLElement>(el: HTMLElement, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector)!;
/** The form's one message: drawn by the page itself on Preparing and Ready, else by its button row. */
const actions = (el: SetupHandoverScreen) =>
  (
    el.shadowRoot!.querySelector(".form-message") ??
    q(el, "wt-form-actions")?.shadowRoot!.querySelector("[data-error]")
  )?.textContent ?? "";
async function backupControlDisabled(el: SetupHandoverScreen): Promise<boolean> {
  await useDifferentCopy(el);
  const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
  await picker.updateComplete;
  return fileControl(picker).disabled;
}
async function edit(el: LitElement, name: string, value: string) {
  const field = q<LitElement>(el, `[name="${name}"]`);
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input,textarea",
  )!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}
async function mount(
  options: {
    saved?: boolean;
    lostAnswer?: boolean;
    expired?: boolean;
    refusal?: string;
    activationMismatch?: boolean;
    activationExpired?: boolean;
    statusUnavailable?: boolean;
    lostBeforeWrite?: boolean;
    changeBeforeDeclare?: boolean;
    backup?: boolean;
    backupRefusal?: string;
    backupRefusalReason?: string;
    backupNeedsKeyCode?: string;
    theme?: "light" | "dark";
    /** The spare still holds its joining copy; takes answer these in turn, the last repeating. */
    held?: boolean;
    takes?: string[];
    /** Each take waits for this before answering. */
    takeGate?: Promise<void>;
    /** Each preview sent after a take waits for this before answering. */
    previewGate?: Promise<void>;
    joinedAtMs?: null;
    /** After a refused take the old process answers one more preview before it goes down. */
    lateRestart?: boolean;
    /** The signed-in person was enrolled after joining: only a followed copy knows them. */
    unknownToHeld?: boolean;
    /** A backup chosen earlier is already placed. */
    backupPlaced?: boolean;
    /**
     * Once a take, a backup choice or a declaration has been sent, previews answer these in turn: an
     * error code, `lost` (no answer), `unplaced` (a chosen backup not yet in place), `declared` (a
     * declaration saved elsewhere) or `ok`.
     */
    later?: string[];
    /** The first declaration answers this refusal, having been recorded or not. */
    declareRefusal?: { code: string; recorded: boolean };
    /** Every clock-step request is refused with this code. */
    preparationRefusal?: string;
    /** The preview names a controlled handover already under way. */
    controlledOperation?: boolean;
    /** The state progress reads report. */
    statusState?: string;
    /** The first preview gets no answer. */
    firstPreviewLost?: boolean;
    pageUrl?: string;
    /** What `GET /api/node/main` answers; a string mounts without waiting for the first step. */
    mainUrl?: string | null;
    /** How long `GET /api/node/main` says the spare has found the main box silent. */
    silentForMs?: number | null;
    /** Mounts on the page that explains the switch, without pressing Start switching. */
    explanation?: boolean;
    /** Replaces the answer to `GET /api/node/main`. */
    mainRead?: () => Promise<Response>;
    /** How `${MAIN}/api/node` answers the page's own check, by call from 0. */
    mainAnswers?: (call: number) => Promise<Response>;
    /** The spare's passkey challenges and proof cookie, kept across mounts like a reload. */
    proof?: SwitchProof;
    /** The clock comparison has no internet time, so the person confirms the time. */
    noInternetTime?: boolean;
    /** The proof lapses as the first select arrives. */
    proofLapsesAtSelect?: boolean;
    /** When the main box's latest copy last changed; otherwise it has no dated activity. */
    followedChangeAtMs?: number;
    /**
     * Activation answers that this box had already taken over, with no restart, and progress cannot
     * be read after it.
     */
    alreadyActivated?: boolean;
  } = {},
) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const probes: (RequestInit | undefined)[] = [];
  let recorded = options.saved ?? false;
  let activated = false;
  let rejected = false;
  let attemptedActivation = false;
  let copyChanged = false;
  let backupSelected = options.backupPlaced ?? false;
  let followedPlaced = !options.held;
  let restartsLeft = 0;
  let answersBeforeRestart = 0;
  let takes = 0;
  let sent = false;
  let previewLost = false;
  let proofLapsed = false;
  const later = [...(options.later ?? [])];
  const api = new SetupApi("", async (input, init) => {
    const path = String(input);
    if (path === "/api/node/main")
      return (
        options.mainRead?.() ??
        new Response(
          JSON.stringify({
            mainUrl: options.mainUrl ?? null,
            ...(options.silentForMs === undefined ? {} : { silentForMs: options.silentForMs }),
          }),
        )
      );
    if (path === `${MAIN}/api/node`) {
      probes.push(init);
      return options.mainAnswers!(probes.length - 1);
    }
    const proof = options.proof;
    if (proof && path.endsWith("/emergency/passkey-challenge")) {
      const challenge = `chal${String(proof.issued.size).padStart(4, "0")}`;
      proof.issued.set(challenge, Date.now());
      return new Response(JSON.stringify({ options: { challenge, rpId: location.hostname } }));
    }
    if (
      init?.method === "GET" &&
      (options.statusUnavailable || (options.alreadyActivated && activated))
    )
      throw new TypeError("progress unavailable");
    if (init?.method === "GET")
      return new Response(
        JSON.stringify({
          body: {
            ...status,
            operationId: saved.operationId,
            state: activated ? "activated" : (options.statusState ?? status.state),
          },
        }),
      );
    const body =
      init?.body instanceof FormData
        ? (JSON.parse(String(init.body.get("request"))) as Record<string, unknown>)
        : (JSON.parse(init!.body as string) as Record<string, unknown>);
    posts.push({ path, body });
    const take = path.endsWith("/emergency/followed")
      ? (options.takes ?? ["taken"])[Math.min(takes, (options.takes ?? ["taken"]).length - 1)]
      : undefined;
    if (
      proof &&
      options.proofLapsesAtSelect &&
      !proofLapsed &&
      (body.proposal as { action?: string } | undefined)?.action === "select"
    ) {
      proofLapsed = true;
      proof.cookie = false;
    }
    const proofRefusal = proof && switchSignIn(proof, path, body.signIn, take);
    if (proofRefusal) return proofRefusal;
    if (path.endsWith("/emergency/backup")) {
      expect(init!.body).toBeInstanceOf(FormData);
      expect((init!.body as FormData).get("artifact")).toBeInstanceOf(File);
      if (typeof body.recoveryKey === "string" && body.recoveryKey.length < 12) {
        return new Response(
          JSON.stringify({
            error: { code: "backup.new_recovery_key_too_short", params: { min: 12 } },
          }),
          { status: 400 },
        );
      }
      if (options.backupRefusal || body.recoveryKey === undefined) {
        const code =
          options.backupRefusal ?? options.backupNeedsKeyCode ?? "handover.backup_key_missing";
        return new Response(
          JSON.stringify({
            error: { code, params: { reason: options.backupRefusalReason } },
          }),
          { status: code === "recovery.passphrase_invalid" ? 422 : 409 },
        );
      }
      sent = true;
      backupSelected = true;
      return new Response(JSON.stringify({ restarting: true }));
    }
    if (path.endsWith("/emergency/followed")) {
      // A copy already placed at the follower's position, or a chosen backup, answers taken.
      const answers = options.takes ?? ["taken"];
      const answer = answers[Math.min(takes++, answers.length - 1)]!;
      await options.takeGate;
      sent = true;
      if (answer === "lost") throw new TypeError("take answer lost");
      // The box restarts after every refusal that follows a stopped follower.
      if (answer.includes(".")) {
        if (options.lateRestart) answersBeforeRestart = 1;
        else restartsLeft = 2;
        return new Response(JSON.stringify({ error: { code: answer } }), { status: 409 });
      }
      if (answer === "restarting") restartsLeft = 2;
      if (answer === "restarting" || answer === "taken") followedPlaced = true;
      return new Response(JSON.stringify({ state: answer }));
    }
    if (path.endsWith("/emergency/preview")) {
      if (sent) await options.previewGate;
      if (restartsLeft > 0) {
        restartsLeft -= 1;
        throw new TypeError("box restarting");
      }
      if (options.firstPreviewLost && !previewLost) {
        previewLost = true;
        throw new TypeError("preview answer lost");
      }
      if (answersBeforeRestart > 0 && --answersBeforeRestart === 0) restartsLeft = 2;
      const next = sent ? later.shift() : undefined;
      if (next === "lost") throw new TypeError("preview answer lost");
      if (next !== undefined && next.includes("."))
        return new Response(JSON.stringify({ error: { code: next } }), { status: 409 });
      if (options.unknownToHeld && !followedPlaced)
        return new Response(JSON.stringify({ error: { code: "password.invalid" } }), {
          status: 401,
        });
      if (options.activationMismatch && attemptedActivation)
        return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
          status: 409,
        });
      if (options.refusal)
        return new Response(
          JSON.stringify({
            error: {
              code: options.refusal,
              params:
                options.refusal === "handover.controlled_unresolved"
                  ? { operationId: "controlled" }
                  : options.refusal === "handover.source_still_answering"
                    ? { sourceServersUrl: preview.sourceServersUrl }
                    : {},
            },
          }),
          { status: 409 },
        );
      return new Response(
        JSON.stringify({
          ...preview,
          ...(options.joinedAtMs === null ? { joinedAtMs: null } : {}),
          copy: {
            ...(followedPlaced
              ? preview.copy
              : {
                  source: "mirror-copy",
                  identifier: "d".repeat(64),
                  lastChangeAtMs: heldActivityMs,
                }),
            ...(backupSelected && next !== "unplaced"
              ? { source: "selected-backup", sourceId: "b".repeat(64) }
              : {}),
            ...(followedPlaced
              ? {
                  lastChangeAtMs: copyChanged
                    ? 1792152000000
                    : (options.followedChangeAtMs ?? null),
                }
              : {}),
          },
          operation:
            recorded || next === "declared"
              ? saved
              : options.controlledOperation
                ? { operationId: "controlled one", reason: null, declaredAtMs: null }
                : null,
        }),
      );
    }
    if (path.endsWith("/emergency/declare")) {
      sent = true;
      if (options.changeBeforeDeclare && !copyChanged) {
        copyChanged = true;
        return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
          status: 409,
        });
      }
      if (options.expired && !rejected) {
        rejected = true;
        return new Response(JSON.stringify({ error: { code: "password.invalid" } }), {
          status: 401,
        });
      }
      if (options.lostBeforeWrite && !rejected) {
        rejected = true;
        throw new TypeError("request lost before recording");
      }
      if (options.declareRefusal && !rejected) {
        rejected = true;
        if (options.declareRefusal.recorded) {
          recorded = true;
          saved.operationId = body.operationId as string;
        }
        return new Response(JSON.stringify({ error: { code: options.declareRefusal.code } }), {
          status: 503,
        });
      }
      recorded = true;
      saved.operationId = body.operationId as string;
      if (options.lostAnswer) throw new TypeError("declaration answer lost");
      return new Response(
        JSON.stringify({
          declaration: {
            body: {
              binding: { operationId: saved.operationId },
              declaredAtMs: saved.declaredAtMs,
            },
          },
        }),
      );
    }
    if (path.endsWith("/activate")) {
      attemptedActivation = true;
      if (options.activationExpired)
        return new Response(JSON.stringify({ error: { code: "password.invalid" } }), {
          status: 401,
        });
      if (options.activationMismatch)
        return new Response(JSON.stringify({ error: { code: "handover.copy_mismatch" } }), {
          status: 409,
        });
      activated = true;
      return new Response(
        JSON.stringify({ activated: true, restarting: !options.alreadyActivated }),
      );
    }
    if (!path.endsWith("/preparation")) throw new Error(`Unexpected request: ${path}`);
    if (options.preparationRefusal)
      return new Response(JSON.stringify({ error: { code: options.preparationRefusal } }), {
        status: 429,
      });
    const action = (body.proposal as { action: string }).action;
    const clock = {
      usable: (options.noInternetTime ? ["box", "browser"] : ["box", "internet", "browser"]).map(
        (source) => ({ source, lowerMs: Date.now(), upperMs: Date.now() }),
      ),
      unavailable: options.noInternetTime
        ? [{ source: "internet", result: "unavailable", reason: "offline" }]
        : [],
      secondClock: true,
      disagreement: false,
      releaseBlocked: false,
      rangeBlocked: false,
    };
    return new Response(
      JSON.stringify(
        action === "clock-challenge"
          ? { id: "challenge" }
          : action === "compare-clocks"
            ? { id: "comparison", clock }
            : {
                status: "selected",
                identity: "0CSQW",
                binding: { ...binding, eventId: saved.operationId },
                input: selectedInput,
              },
      ),
    );
  });
  const { el, host } = await mountWidget<SetupHandoverScreen>(
    "setup-handover-screen",
    {
      api,
      emergency: true,
      ...(options.pageUrl ? { pageUrl: options.pageUrl } : {}),
    },
    options.theme,
  );
  if (options.explanation)
    await vi.waitFor(() => expect(q(el, "[data-test=start-switching]")).not.toBeNull());
  else if (typeof options.mainUrl !== "string") await startSwitching(el);
  return { el, host, posts, probes };
}
/** Presses Start switching on the page that explains the switch, which opens the sign-in. */
async function startSwitching(el: SetupHandoverScreen) {
  await vi.waitFor(() => expect(q(el, "[data-test=start-switching]")).not.toBeNull());
  q(el, "[data-test=start-switching]").click();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-preview]")).not.toBeNull());
}
interface SwitchProof {
  cookie: boolean;
  /** When each challenge was issued; one is live for two minutes. */
  issued: Map<string, number>;
  used: Set<string>;
  /**
   * Codes the next passkey answers are refused with, in turn, after their challenge is taken:
   * `passkey.verification_failed` as for a wrong key, or `passkey.not_registered` as for a passkey
   * the copy checked does not hold.
   */
  refusals: string[];
}
const refusal = (code: string, status: number) =>
  new Response(JSON.stringify({ error: { code } }), { status });
/**
 * The server's switch sign-in: a passkey over a live, unused challenge sets the cookie; no sign-in
 * needs it. A take answers `take`: one still catching up or already taken checks no passkey, and one
 * refused by the copy checks after the early check only checks the challenge is live.
 */
function switchSignIn(
  proof: SwitchProof,
  path: string,
  signIn: unknown,
  take?: string,
): Response | undefined {
  if (!/\/(preview|followed|backup|declare|preparation|activate)$/.test(path)) return undefined;
  const passkey = (signIn as { passkey?: { response: { clientDataJSON: string } } } | undefined)
    ?.passkey;
  if (passkey) {
    if (take === "catching-up" || take === "taken") return undefined;
    const client = passkey.response.clientDataJSON.replace(/-/g, "+").replace(/_/g, "/");
    const { challenge } = JSON.parse(atob(client)) as { challenge: string };
    const issuedAt = proof.issued.get(challenge);
    if (issuedAt === undefined || proof.used.has(challenge) || Date.now() - issuedAt >= 120_000)
      return refusal("passkey.challenge_expired", 400);
    if (take?.includes(".")) return undefined;
    proof.used.add(challenge);
    const refused = proof.refusals.shift();
    if (refused !== undefined) return refusal(refused, 401);
    proof.cookie = true;
    return undefined;
  }
  if (signIn !== undefined || proof.cookie) return undefined;
  return refusal("password.invalid", 401);
}
const newProof = (): SwitchProof => ({
  cookie: false,
  issued: new Map(),
  used: new Set(),
  refusals: [],
});
/**
 * The device's passkey answers whatever challenge a prompt hands it; an autofill request waits
 * until it is cancelled. The WebAuthn library stays real.
 */
function stubPasskey() {
  return vi
    .spyOn(navigator.credentials, "get")
    .mockImplementation(async (request) =>
      request?.mediation === "conditional" ? cancelledOnly(request) : credentialFor(request),
    );
}
/** Settles only by rejecting when the request is cancelled, as a waiting autofill request does. */
function cancelledOnly(request: CredentialRequestOptions): Promise<never> {
  return new Promise((_, reject) => {
    request.signal?.addEventListener("abort", () => reject(request.signal!.reason));
  });
}
function credentialFor(request: CredentialRequestOptions | undefined): Credential {
  {
    const challenge = new Uint8Array(request!.publicKey!.challenge as ArrayBuffer);
    const encoded = btoa(String.fromCharCode(...challenge))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return {
      id: "AQ",
      rawId: new Uint8Array([1]).buffer,
      type: "public-key",
      response: {
        clientDataJSON: new TextEncoder().encode(
          JSON.stringify({ type: "webauthn.get", challenge: encoded }),
        ).buffer,
        authenticatorData: new Uint8Array([3]).buffer,
        signature: new Uint8Array([4]).buffer,
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
      authenticatorAttachment: null,
    } as unknown as Credential;
  }
}
/** Enters the email and presses Continue, unless the sign-in already asks how to sign in. */
async function toMethods(el: SetupHandoverScreen, email = signIn.email) {
  if (!q(el, "[data-test=sign-in-passkey]")) {
    await edit(el, "handover-email", email);
    q(el, "[data-test=emergency-preview]").click();
  }
  await vi.waitFor(() => expect(q(el, "[data-test=sign-in-passkey]")).not.toBeNull());
}
/** Presses Use your passkey, entering the email first when the sign-in asks for it. */
async function choosePasskey(el: SetupHandoverScreen) {
  await toMethods(el);
  q(el, "[data-test=sign-in-passkey]").click();
  await el.updateComplete;
}
/** Enters the email, presses Continue, then signs in with the password and any code. */
async function passwordSignIn(
  el: SetupHandoverScreen,
  email: string,
  password: string,
  code?: string,
) {
  await toMethods(el, email);
  await edit(el, "handover-password", password);
  if (code !== undefined) await edit(el, "handover-code", code);
  q(el, "[data-test=sign-in-password]").click();
}
async function authenticate(el: SetupHandoverScreen) {
  await passwordSignIn(el, signIn.email, signIn.password, signIn.totp);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
}
/** Proceeds from the prepared copy, then completes Ready to switch. */
async function declarationFields(el: SetupHandoverScreen) {
  if (q(el, "[data-test=proceed]")) await proceed(el);
  await edit(el, "emergency-reason", saved.reason);
  for (const field of el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    field.checked = true;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
  await el.updateComplete;
}
/** Opens the backup choice on Preparing the venue. */
async function useDifferentCopy(el: SetupHandoverScreen) {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=upload-backup]")?.click();
  await el.updateComplete;
}
async function startVenue(el: SetupHandoverScreen) {
  const entry = q<LitElement>(el, "vf-recovery-hour");
  await entry.updateComplete;
  const tick = q<HTMLInputElement>(entry, '[name="recovery-details-confirmed"]');
  tick.checked = true;
  tick.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(entry, "[data-test=compare]").disabled).toBe(
      false,
    ),
  );
  q(entry, "[data-test=compare]").click();
}
/** Presses Continue under the new series, the step that lets the venue start. */
async function continueOn(el: SetupHandoverScreen) {
  const entry = q<LitElement>(el, "vf-recovery-hour");
  await vi.waitFor(() => expect(q(entry, "[data-test=continue]")).not.toBeNull());
  q(entry, "[data-test=continue]").click();
  await el.updateComplete;
}
beforeEach(() => {
  // Passkey autofill only where a case asks for it, so prompt counts stay the page's own.
  vi.spyOn(PublicKeyCredential, "isConditionalMediationAvailable").mockResolvedValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
  saved.operationId = "emergency-one";
});

it("draws the backup picker's words in the chooser's language, not the browser's", async () => {
  const { el } = await mount({ backup: true });
  await authenticate(el);
  await useDifferentCopy(el);
  setLocale("es-ES");
  await el.updateComplete;
  const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
  expect(picker).not.toBeNull();
  await picker.updateComplete;
  const words = picker.shadowRoot!.textContent!;
  expect(words).toContain(t("file_input.drop", "es-ES"));
  expect(words).toContain(t("file_input.choose", "es-ES"));
  expect(words).not.toContain(t("file_input.choose", "en-GB"));
});

it("writes the chosen backup's size in the chooser's language", async () => {
  setLocale("es-ES");
  const { el } = await mount({ backup: true });
  await authenticate(el);
  await useDifferentCopy(el);
  const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
  chooseFiles(picker, new File([new Uint8Array(48_200)], "venue.enc"));
  await el.updateComplete;
  await picker.updateComplete;
  expect(picker.shadowRoot!.textContent!).toContain("48,2 kB");
});

it.each(
  ["en-GB", "es-ES"].flatMap((locale) =>
    ["light", "dark"].map((theme) => ({ locale, theme: theme as "light" | "dark" })),
  ),
)(
  "asks for the archive key, resumes its preview, and declares that source ($locale, $theme)",
  async ({ locale, theme }) => {
    setLocale(locale);
    const { el, posts } = await mount({
      backup: true,
      theme,
      backupNeedsKeyCode:
        theme === "dark" ? "recovery.passphrase_invalid" : "handover.backup_key_missing",
    });
    await authenticate(el);
    await useDifferentCopy(el);
    const input = q(el, 'wt-file-input[name="handover-backup"]');
    expect(input).not.toBeNull();
    chooseFiles(input, new File(["archive"], "venue.enc"));
    await el.updateComplete;
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() => expect(q(el, '[name="handover-backup-key"]')).not.toBeNull());
    if (import.meta.env.VITE_A1188_VISUAL === "1") {
      const { page } = await import("vitest/browser");
      try {
        for (const width of [390, 1280]) {
          await page.viewport(width, 1400);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `__screenshots__/a1188-key-${locale}-${theme}-${width}.png`,
          });
        }
      } finally {
        await page.viewport(1280, 720);
      }
    }
    await edit(el, "handover-backup-key", "synthetic-recovery-key");
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.selected_backup"),
      ),
    );
    expect(posts.filter(({ path }) => path.endsWith("/backup")).map(({ body }) => body)).toEqual([
      { signIn },
      { signIn, recoveryKey: "synthetic-recovery-key" },
    ]);
    await proceed(el);
    await edit(el, "emergency-reason", saved.reason);
    for (const field of el.shadowRoot!.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      field.checked = true;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await el.updateComplete;
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
    expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual({
      ...preview.copy,
      source: "selected-backup",
      sourceId: "b".repeat(64),
    });
  },
);

it.each(["en-GB", "es-ES"])(
  "says a typed archive key is too short and keeps asking for it (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ backup: true });
    await authenticate(el);
    await useDifferentCopy(el);
    chooseFiles(q(el, 'wt-file-input[name="handover-backup"]'), new File(["archive"], "venue.enc"));
    await el.updateComplete;
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() => expect(q(el, '[name="handover-backup-key"]')).not.toBeNull());
    await edit(el, "handover-backup-key", "short");
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() =>
      expect(actions(el)).toContain(t("handover.emergency.backup_key_too_short")),
    );
    expect(actions(el)).not.toContain(t("handover.emergency.backup_key_missing"));
    expect(q(el, '[name="handover-backup-key"]')).not.toBeNull();
    expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(false);
  },
);

it.each([
  ["handover.copy_predates_destination", "handover.emergency.backup_too_old", "en-GB", undefined],
  ["restore.archive_resource_limit", "shell.restore.archive_resource_limit", "en-GB", undefined],
  ["restore.archive_resource_limit", "shell.restore.archive_resource_limit", "es-ES", undefined],
  ["restore.manifest_invalid", "shell.restore.manifest_invalid", "en-GB", "invalid"],
  ["restore.manifest_invalid", "shell.restore.manifest_invalid", "es-ES", "invalid"],
  ["restore.manifest_invalid", "shell.restore.manifest_unsupported", "en-GB", "unsupported"],
  ["restore.manifest_invalid", "shell.restore.manifest_unsupported", "es-ES", "unsupported"],
] as const)(
  "keeps the archive choice after admission is refused: %s (%s, %s)",
  async (code, key, locale, reason) => {
    setLocale(locale);
    const { el, posts } = await mount({
      backup: true,
      backupRefusal: code,
      backupRefusalReason: reason,
    });
    await authenticate(el);
    await useDifferentCopy(el);
    const input = q(el, 'wt-file-input[name="handover-backup"]');
    expect(input).not.toBeNull();
    chooseFiles(input, new File(["archive"], "venue.enc"));
    await el.updateComplete;
    q(el, "[data-test=emergency-backup]").click();
    await vi.waitFor(() => expect(actions(el)).toContain(t(key)));
    const picker = q<WtFileInput>(el, 'wt-file-input[name="handover-backup"]');
    expect(picker.files[0]?.name).toBe("venue.enc");
    await picker.updateComplete;
    expect(drawnFileName(picker)).toBe("venue.enc");
    expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(false);
  },
);

it.each(["en-GB", "es-ES"])(
  "requires all emergency declarations and explains the one-way choice in %s",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount();
    await authenticate(el);
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.no_date"));
    await proceed(el);
    const action = q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-declare]");
    expect(action.disabled).toBe(true);
    await edit(el, "emergency-reason", "x".repeat(501));
    expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    await vi.waitFor(() => expect(actions(el)).toContain(t("handover.fix")));
    await edit(el, "emergency-reason", saved.reason);
    for (const field of el.shadowRoot!.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )) {
      expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
      field.checked = true;
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await el.updateComplete;
    }
    expect(action.disabled).toBe(false);
    action.click();
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
    const declaration = posts.find(({ path }) => path.endsWith("/declare"))!;
    expect(declaration.body).toEqual({
      operationId: expect.any(String),
      expectedCopy: { ...preview.copy },
      signIn,
      statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
      reason: saved.reason,
      locale: locale.startsWith("es") ? "es" : "en",
    });
  },
);

it("recovers a lost declaration answer through preview, without declaring it again", async () => {
  const { el, posts } = await mount({ lostAnswer: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
  expect(posts.map(({ path }) => path.split("/").at(-1)).slice(0, 5)).toEqual([
    "preview",
    "followed",
    "preview",
    "declare",
    "preview",
  ]);
  expect(location.pathname).toBe(`/handover/${saved.operationId}`);
});

it("resumes a saved declaration on another page, prepares and starts without replaying the declaration", async () => {
  const { el, posts } = await mount({ saved: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await continueOn(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.done")));
  expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(false);
  const preparation = posts.filter(({ path }) => path.endsWith("/preparation"));
  expect(preparation.map(({ body }) => (body.proposal as { action: string }).action)).toEqual(
    expect.arrayContaining(["clock-challenge", "compare-clocks", "select"]),
  );
  expect(posts.filter(({ path }) => path.endsWith("/activate"))).toHaveLength(1);
  for (const { body } of posts) expect(body.signIn).toEqual(signIn);
  expect(Reflect.get(el, "password")).toBe("");
  expect(Reflect.get(el, "code")).toBe("");
});

it("the switch page's clock step is told it is the switch page", async () => {
  const { el } = await mount({ saved: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const entry = q<LitElement & { context: { scenario: string; timeZone: string } }>(
    el,
    "vf-recovery-hour",
  );
  expect(entry.context.scenario).toBe("emergency");
  expect(entry.context.timeZone).toBe(venueZone);
});

it("keeps the reason and statements when a code expires, and retries the same declaration with the new code", async () => {
  const { el, posts } = await mount({ expired: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.code_expired")));
  await edit(el, "handover-code", "654321");
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const calls = posts.filter(({ path }) => path.endsWith("/declare"));
  expect(calls).toHaveLength(2);
  expect(calls[1]!.body).toEqual({ ...calls[0]!.body, signIn: { ...signIn, totp: "654321" } });
});

const SIGN_IN_AGAIN = new Set<string>(["password.throttled", "authorization.not_permitted"]);
// A sign-in refusal from the held copy goes on to the take, which signs in against the newer copy.
it.each([
  [
    "handover.source_still_answering",
    "handover.emergency.source_answered",
    "https://main.example/servers",
    ["preview"],
  ],
  [
    "handover.controlled_unresolved",
    "handover.emergency.controlled",
    "/handover/controlled",
    ["preview"],
  ],
  ["handover.copy_mismatch", "handover.emergency.copy_unchecked", null, ["preview"]],
  ["password.throttled", "handover.emergency.throttled", null, ["preview"]],
  ["node.operation_page_required", "handover.emergency.connection", null, ["preview"]],
  ["authorization.not_permitted", "handover.emergency.permission", null, ["preview", "followed"]],
  ["node.read_only", "handover.emergency.changed", null, ["preview"]],
  ["handover.source_no_longer_main", "handover.emergency.changed", null, ["preview"]],
  ["handover.source_not_established", "handover.emergency.trust", null, ["preview"]],
  ["handover.peer_unknown", "handover.emergency.trust", null, ["preview"]],
] as const)("offers the next step for %s", async (refusal, key, link, requests) => {
  const { el, posts } = await mount({ refusal, takes: [refusal] });
  await passwordSignIn(el, signIn.email, signIn.password);
  await vi.waitFor(() => expect(actions(el)).toContain(t(key)));
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual(requests);
  if (link)
    expect(el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[href="${link}"]`)!.textContent).toBe(
      t(
        link.startsWith("/handover/")
          ? "handover.emergency.progress"
          : "handover.emergency.servers",
      ),
    );
  expect(el.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="/"]')!.textContent).toBe(
    t("handover.emergency.leave"),
  );
  // A refusal answered by signing in again goes back to the choice of method; others offer Try again.
  const again = SIGN_IN_AGAIN.has(refusal) ? "sign-in-password" : "emergency-preview";
  expect(q(el, `[data-test=${again}]`).shadowRoot!.querySelector("button")!.disabled).toBe(false);
});

it("clears saved reason and secret inputs on an account change, and clears secrets when the page closes", async () => {
  const { el } = await mount({ saved: true, preparationRefusal: "password.invalid" });
  await authenticate(el);
  // After Declare only a refusal that needs the sign-in opens the fields again.
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await vi.waitFor(() => expect(q(el, "[data-test=change-email]")).not.toBeNull());
  expect(el.shadowRoot!.textContent).toContain(saved.reason);
  q(el, "[data-test=change-email]").click();
  await el.updateComplete;
  await edit(el, "handover-email", "another@example.com");
  expect(el.shadowRoot!.textContent).not.toContain(saved.reason);
  await toMethods(el, "another@example.com");
  expect(q(el, '[name="handover-password"]').shadowRoot!.querySelector("input")!.value).toBe("");
  await edit(el, "handover-password", signIn.password);
  await edit(el, "handover-code", signIn.totp);
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  await el.updateComplete;
  expect(q(el, '[name="handover-password"]').shadowRoot!.querySelector("input")!.value).toBe("");
  expect(q(el, '[name="handover-code"]').shadowRoot!.querySelector("input")!.value).toBe("");
});

it("stops activation when the post-restart comparison finds a changed copy", async () => {
  const { el, posts } = await mount({ saved: true, activationMismatch: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await continueOn(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.copy_failed")));
  expect(q(el, "[data-test=retry-activation]")).toBeNull();
  expect(q(el, "[data-test=authenticate]").shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  expect(posts.filter(({ path }) => path.endsWith("/preview"))).toHaveLength(2);
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(0);
});

it("moves keyboard focus to the page heading when a changed copy leaves no action to offer", async () => {
  const { el } = await mount({ saved: true, activationMismatch: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  const entry = q<LitElement>(el, "vf-recovery-hour");
  await vi.waitFor(() => expect(q(entry, "[data-test=continue]")).not.toBeNull());
  const button = q<LitElement>(entry, "[data-test=continue]");
  await button.updateComplete;
  button.focus();
  expect(button.shadowRoot!.activeElement).toBe(button.shadowRoot!.querySelector("button"));
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.copy_failed")));
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "h1")));
});

it("checks an uncertain declaration before retrying the same frozen request", async () => {
  const { el, posts } = await mount({ lostBeforeWrite: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.failed")));
  expect(q(el, '[name="emergency-reason"]').shadowRoot!.querySelector("textarea")!.disabled).toBe(
    true,
  );
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const declarations = posts.filter(({ path }) => path.endsWith("/declare"));
  expect(declarations).toHaveLength(2);
  expect(declarations[1]!.body).toEqual(declarations[0]!.body);
  expect(posts.map(({ path }) => path.split("/").at(-1)).slice(0, 7)).toEqual([
    "preview",
    "followed",
    "preview",
    "declare",
    "preview",
    "preview",
    "declare",
  ]);
});

it("leaves the declaration form after a successful write even when progress cannot load", async () => {
  const { el, posts } = await mount({ statusUnavailable: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.read_failed")));
  expect(q(el, '[name="emergency-reason"]')).toBeNull();
  expect(q(el, "[data-test=emergency-declare]")).toBeNull();
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
  expect(q(el, "wt-form-actions").shadowRoot!.querySelector("[data-error]")).toBeNull();
});

it("asks for password and code checks on the first refused sign-in, without assuming code expiry", async () => {
  const { el, posts } = await mount({ refusal: "password.invalid", takes: ["password.invalid"] });
  await passwordSignIn(el, signIn.email, "mistyped", signIn.totp);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.sign_in_failed")));
  expect(actions(el)).not.toContain(t("handover.emergency.code_expired"));
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual(["preview", "followed"]);
  expect(posts[1]!.body).toEqual({ signIn: { ...signIn, password: "mistyped" } });
});

it("shows a fresh copy and asks for confirmation again when it changed before declaration", async () => {
  const { el, posts } = await mount({ changeBeforeDeclare: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain("The copy changed while you were reading"));
  expect(heading(el)).toBe(t("handover.emergency.preparing_heading"));
  expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
    new Date(1792152000000).toLocaleString("en-GB"),
  );
  await proceed(el);
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
      (input) => input.checked,
    ),
  ).toEqual([false, false, false]);
  expect(q(el, '[name="emergency-reason"]').shadowRoot!.querySelector("textarea")!.disabled).toBe(
    false,
  );
  expect(q(el, "[data-test=emergency-declare]").shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const declarations = posts.filter(({ path }) => path.endsWith("/declare"));
  expect(declarations.map(({ body }) => body.expectedCopy)).toEqual([
    { ...preview.copy, lastChangeAtMs: null },
    { ...preview.copy, lastChangeAtMs: 1792152000000 },
  ]);
});

it("a changed copy whose fresh check gets no answer drops the old copy and offers Try again", async () => {
  const { el } = await mount({ changeBeforeDeclare: true, later: ["ok", "lost"] });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.failed")));
  expect(heading(el)).toBe(t("handover.emergency.preparing_heading"));
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(q(el, "[data-test=proceed]")).toBeNull();
  const again = q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-preview]");
  expect(again.textContent!.trim()).toBe(t("handover.try_again"));
  expect(again.disabled).toBe(false);
  again.click();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]")?.textContent).toContain(
      new Date(1792152000000).toLocaleString("en-GB"),
    ),
  );
  expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=proceed]").disabled).toBe(false);
});

it.each([
  ["its answer was lost", { lostAnswer: true }, 1],
  [
    "it was refused though saved, and Switch is pressed again",
    { declareRefusal: { code: "server.unavailable", recorded: true } },
    2,
  ],
] as const)(
  "a switch that may be saved, whose copy then fails its check (%s), stays on Ready to switch offering no backup",
  async (_case, options, presses) => {
    const { el, posts } = await mount({ ...options, later: ["ok", "handover.copy_check_failed"] });
    await authenticate(el);
    await declarationFields(el);
    for (let press = 1; press <= presses; press++) {
      q(el, "[data-test=emergency-declare]").click();
      await vi.waitFor(() => expect(Reflect.get(el, "busy")).toBe(false));
    }
    await vi.waitFor(() =>
      expect(actions(el)).toContain(t("handover.emergency.copy_unchecked_only")),
    );
    expect(heading(el)).toBe(t("handover.emergency.ready_heading"));
    expect(q(el, "[data-test=upload-backup]")).toBeNull();
    expect(
      q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-declare]").disabled,
    ).toBe(true);
    expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
  },
);

it("a copy that fails its check at Switch goes back to Preparing the venue, offering a backup and Try again", async () => {
  const { el } = await mount({
    declareRefusal: { code: "handover.chain_broken", recorded: false },
  });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.copy_unchecked")));
  expect(heading(el)).toBe(t("handover.emergency.preparing_heading"));
  expect(q(el, ".form-message").nextElementSibling).toBe(q(el, ".choices"));
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(q(el, "[data-test=upload-backup]")).not.toBeNull();
  const again = q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-preview]");
  expect(again.textContent!.trim()).toBe(t("handover.try_again"));
  expect(again.disabled).toBe(false);
  again.click();
  await vi.waitFor(() =>
    expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=proceed]")?.disabled).toBe(false),
  );
  expect(actions(el)).toBe("");
  await proceed(el);
  expect(
    [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
      (input) => input.checked,
    ),
  ).toEqual([false, false, false]);
});

it("explains a second code expiry after replacing only the code and pressing Try again", async () => {
  const { el, posts } = await mount({ saved: true, activationExpired: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await continueOn(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.code_expired")));
  await edit(el, "handover-code", "654321");
  q(el, "[data-test=retry-activation]").click();
  await vi.waitFor(() =>
    expect(posts.filter(({ path }) => path.endsWith("/activate"))).toHaveLength(2),
  );
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.code_expired")));
  expect(posts.filter(({ path }) => path.endsWith("/preview"))).toHaveLength(1);
  expect(
    posts
      .filter(({ path }) => path.endsWith("/activate"))
      .map(({ body }) => (body.signIn as { totp: string }).totp),
  ).toEqual(["123456", "654321"]);
});

const followedTakes = (posts: { path: string }[]) =>
  posts.filter(({ path }) => path.endsWith("/emergency/followed")).length;
async function check(el: SetupHandoverScreen) {
  await passwordSignIn(el, signIn.email, signIn.password, signIn.totp);
}

it("Continue first brings the copy up to date, waits for the restart, then shows it", async () => {
  const { el, posts } = await mount({ held: true, takes: ["restarting"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
  );
  await vi.waitFor(
    () =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.followed"),
      ),
    { timeout: 10_000 },
  );
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
    "preview",
    "preview",
  ]);
  expect(followedTakes(posts)).toBe(1);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
  expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual(
    preview.copy,
  );
});

it("while the spare catches up the page waits and says so, then offers the copy this spare holds", async () => {
  const { el, posts } = await mount({ held: true, takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() => catchingUp(el));
  expect(followedTakes(posts)).toBe(1);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  await useDifferentCopy(el);
  expect(q(el, 'wt-file-input[name="handover-backup"]')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  expect(followedTakes(posts)).toBe(2);
  await vi.advanceTimersByTimeAsync(56_000);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  await el.updateComplete;
  expect(q(el, "[data-test=emergency-held]")).not.toBeNull();
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.still_catching_up"));
  expect(await backupControlDisabled(el)).toBe(false);
  const taken = followedTakes(posts);
  vi.useRealTimers();
  q(el, "[data-test=emergency-held]").click();
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]").textContent).toContain(t("handover.emergency.copy")),
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  expect(followedTakes(posts)).toBe(taken);
  expect(step(el, "follow")).not.toBe("working");
  expect(Reflect.get(el, "following")).toBe(false);
});

it.each([
  ["handover.copy_predates_destination", "handover.emergency.followed_not_admitted"],
  ["handover.chain_broken", "handover.emergency.followed_failed"],
  ["provisioning.database_ahead", "handover.emergency.followed_ahead"],
  ["restore.schema_too_new", "handover.emergency.followed_ahead"],
  ["handover.copy_damaged", "handover.emergency.followed_failed"],
  ["handover.copy_check_failed", "handover.emergency.followed_failed"],
] as const)(
  "a refused take (%s) names its cause and, once the box answers again, offers the copy this spare holds",
  async (code, key) => {
    const { el, posts } = await mount({ held: true, takes: [code] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await check(el);
    await vi.waitFor(() => expect(actions(el)).toContain(t(key)));
    expect(q(el, "[data-test=emergency-held]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.held_waiting"));
    // Reading a response body takes a real browser task, so each answer is awaited, not assumed.
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull());
    expect(actions(el)).toContain(t(key));
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
    await useDifferentCopy(el);
    expect(q(el, 'wt-file-input[name="handover-backup"]')).not.toBeNull();
    expect(q(el, "[data-test=emergency-copy]")).toBeNull();
    expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
      "preview",
      "followed",
      "preview",
      "preview",
      "preview",
    ]);
  },
);

it("says the held copy is from when this spare joined when the joining date is unknown", async () => {
  const { el } = await mount({ held: true, takes: ["handover.chain_broken"], joinedAtMs: null });
  await check(el);
  await vi.waitFor(() => expect(q(el, "[data-test=held-copy]")).not.toBeNull(), {
    timeout: 10_000,
  });
  expect(q(el, "[data-test=held-copy]").textContent).toContain(
    t("handover.emergency.held_undated"),
  );
});

it("from the press, waits visibly with Choose a backup open, and offers the held copy at 60 seconds even while a take is still held", async () => {
  let release!: () => void;
  const takeGate = new Promise<void>((resolve) => (release = resolve));
  const { el, posts } = await mount({ held: true, takes: ["catching-up"], takeGate });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() => expect(followedTakes(posts)).toBe(1));
  await el.updateComplete;
  catchingUp(el);
  expect(await backupControlDisabled(el)).toBe(false);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  await vi.advanceTimersByTimeAsync(1000);
  await el.updateComplete;
  expect(q(el, "[data-test=emergency-held]")).not.toBeNull();
  expect(followedTakes(posts)).toBe(1);
  release();
});

it.each(["en-GB", "es-ES"])(
  "the held-copy action says it is the copy from when this spare joined, with its date (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ held: true, takes: ["handover.chain_broken"] });
    await check(el);
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull(), {
      timeout: 10_000,
    });
    const joined = new Date(preview.joinedAtMs).toLocaleString(locale);
    const activity = new Date(heldActivityMs).toLocaleString(locale);
    const offer = q(el, "[data-test=held-copy]").textContent!;
    expect(offer).toContain(format("handover.emergency.held_joined", { joined }));
    expect(offer).toContain(`${t("handover.emergency.latest_activity")} ${activity}`);
    expect(q(el, "[data-test=emergency-held]").textContent).toContain(
      t("handover.emergency.use_held"),
    );
    q(el, "[data-test=emergency-held]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
    const copy = q(el, "[data-test=emergency-copy]").textContent!;
    expect(copy).toContain(t("handover.emergency.copy"));
    expect(copy).toContain(format("handover.emergency.held_joined", { joined }));
    expect(q(el, "[data-test=emergency-held]")).toBeNull();
    await declarationFields(el);
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
    expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual({
      source: "mirror-copy",
      identifier: "d".repeat(64),
      lastChangeAtMs: heldActivityMs,
    });
    expect(followedTakes(posts)).toBe(1);
  },
);

it("a saved declaration is resumed without taking a copy again", async () => {
  const { el, posts } = await mount({ saved: true, held: true, takes: ["restarting"] });
  await check(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(saved.reason));
  expect(followedTakes(posts)).toBe(0);
});

it("the waiting line renders in Spanish", async () => {
  setLocale("es-ES");
  const waiting = t("handover.emergency.step_follow");
  expect(waiting).not.toBe(t("handover.emergency.step_follow", "en-GB"));
  const { el } = await mount({ held: true, takes: ["catching-up"] });
  await check(el);
  await vi.waitFor(() => catchingUp(el));
  expect(q(el, "[data-test=step-follow] .label").textContent).toBe(waiting);
});

it("a take answering taken shows the followed copy without waiting for a restart", async () => {
  const { el, posts } = await mount({ held: true, takes: ["taken"] });
  await check(el);
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
      t("handover.emergency.followed"),
    ),
  );
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
  ]);
});

it("pressing the held copy while the old process is still going down waits for the restart", async () => {
  const { el, posts } = await mount({
    held: true,
    takes: ["handover.chain_broken"],
    lateRestart: true,
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.followed_failed")));
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull());
  q(el, "[data-test=emergency-held]").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.held_waiting")),
  );
  expect(actions(el)).not.toContain(t("handover.emergency.failed"));
  expect(await backupControlDisabled(el)).toBe(false);
  await vi.advanceTimersByTimeAsync(4000);
  await vi.waitFor(() =>
    expect(q(el, "[data-test=emergency-copy]").textContent).toContain(t("handover.emergency.copy")),
  );
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
    "preview",
    "preview",
    "preview",
  ]);
});

it.each(["en-GB", "es-ES"])(
  "a person only the up-to-date copy knows reaches the take and sees the copy it placed (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ held: true, unknownToHeld: true, takes: ["restarting"] });
    await check(el);
    await vi.waitFor(
      () =>
        expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
          t("handover.emergency.followed"),
        ),
      { timeout: 10_000 },
    );
    expect(followedTakes(posts)).toBe(1);
    expect(posts.find(({ path }) => path.endsWith("/followed"))!.body).toEqual({ signIn });
    expect(actions(el)).not.toContain(t("handover.emergency.sign_in_failed"));
  },
);

it("a person only the up-to-date copy knows waits for it, with no held copy to offer", async () => {
  const { el, posts } = await mount({ held: true, unknownToHeld: true, takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() => catchingUp(el));
  await vi.advanceTimersByTimeAsync(62_000);
  await el.updateComplete;
  expect(followedTakes(posts)).toBeGreaterThan(1);
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  expect(q(el, "[data-test=held-copy]")).toBeNull();
  expect(actions(el)).not.toContain(t("handover.emergency.sign_in_failed"));
  expect(await backupControlDisabled(el)).toBe(false);
});

it("a followed copy placed earlier goes through the take, which may find a newer one", async () => {
  const { el, posts } = await mount({ takes: ["restarting"] });
  await check(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
  );
  await vi.waitFor(
    () =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.followed"),
      ),
    { timeout: 10_000 },
  );
  expect(followedTakes(posts)).toBe(1);
});

it.each(["en-GB", "es-ES"])(
  "a followed copy placed earlier is offered as the held copy when a newer take is refused, and named as held once chosen (%s)",
  async (locale) => {
    setLocale(locale);
    const { el, posts } = await mount({ takes: ["handover.chain_broken"] });
    await check(el);
    await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.followed_failed")));
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull(), {
      timeout: 10_000,
    });
    expect(q(el, "[data-test=emergency-copy]")).toBeNull();
    expect(q(el, "[data-test=held-copy]").textContent).toContain(t("handover.emergency.no_date"));
    q(el, "[data-test=emergency-held]").click();
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
    const heading = q(el, "[data-test=emergency-copy] h2").textContent!.trim();
    expect(heading).toBe(t("handover.emergency.copy"));
    expect(heading).not.toBe(t("handover.emergency.followed"));
    await declarationFields(el);
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/declare"))).toBe(true));
    expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.expectedCopy).toEqual(
      preview.copy,
    );
    expect(followedTakes(posts)).toBe(1);
  },
);

it("a backup placed earlier is shown without a take", async () => {
  const { el, posts } = await mount({ backupPlaced: true, takes: ["restarting"] });
  await authenticate(el);
  expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
    t("handover.emergency.selected_backup"),
  );
  expect(followedTakes(posts)).toBe(0);
});

it("while a newer copy catches up, an earlier followed copy is offered as held without calling it the joining copy", async () => {
  const { el } = await mount({ takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await check(el);
  await vi.waitFor(() => catchingUp(el));
  await vi.advanceTimersByTimeAsync(60_000);
  await el.updateComplete;
  expect(q(el, "[data-test=emergency-held]")).not.toBeNull();
  const offer = q(el, "[data-test=held-copy]").textContent!;
  expect(offer).not.toContain(
    format("handover.emergency.held_joined", {
      joined: new Date(preview.joinedAtMs).toLocaleString("en-GB"),
    }),
  );
  expect(offer).toContain(t("handover.emergency.no_date"));
});

const previews = (posts: { path: string }[]) =>
  posts.filter(({ path }) => path.endsWith("/emergency/preview")).length;
const button = (el: SetupHandoverScreen, test: string) =>
  q(el, `[data-test=${test}]`).shadowRoot!.querySelector("button")!;

it("a lost take answer says the take failed and stops waiting for it", async () => {
  const { el, posts } = await mount({ takes: ["lost"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.failed")));
  expect(step(el, "follow")).not.toBe("working");
  expect(Reflect.get(el, "following")).toBe(false);
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(button(el, "emergency-preview").disabled).toBe(false);
  expect(followedTakes(posts)).toBe(1);
});

it("a lost first check says the check failed and takes nothing", async () => {
  const { el, posts } = await mount({ firstPreviewLost: true });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.failed")));
  expect(followedTakes(posts)).toBe(0);
  expect(button(el, "emergency-preview").disabled).toBe(false);
});

it("a take refused by the main box itself names the cause, with no progress link to follow", async () => {
  const { el } = await mount({ takes: ["handover.source_still_answering"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.source_answered")));
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.progress"));
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.servers"));
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
});

it("a declaration refused because the main box answers links that copy's servers page, named as Servers", async () => {
  const { el } = await mount({
    declareRefusal: { code: "handover.source_still_answering", recorded: false },
  });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.source_answered")));
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>(
    `a[href="${preview.sourceServersUrl}"]`,
  );
  expect(link?.textContent).toBe(t("handover.emergency.servers"));
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.progress"));
});

it("a declaration that was recorded though its answer was refused carries on to the clock without declaring again", async () => {
  const { el, posts } = await mount({
    declareRefusal: { code: "server.unavailable", recorded: true },
  });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.failed")));
  expect(q(el, "vf-recovery-hour")).toBeNull();
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
  expect(location.pathname).toBe(`/handover/${saved.operationId}`);
});

it.each([
  ["activated", "handover.done"],
  ["abandoned", "handover.closed"],
] as const)(
  "a saved declaration whose handover is already %s says so instead of asking again",
  async (statusState, key) => {
    const { el } = await mount({ saved: true, statusState });
    await check(el);
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t(key)));
    expect(q(el, '[name="handover-password"]')).toBeNull();
    expect(q(el, "vf-recovery-hour")).toBeNull();
  },
);

it("a controlled handover already under way is linked from the copy, without the backup picker", async () => {
  const { el } = await mount({ controlledOperation: true });
  await authenticate(el);
  expect(q(el, 'wt-file-input[name="handover-backup"]')).toBeNull();
  // No other copy can be chosen here, so nothing offers one.
  expect(q(el, "[data-test=upload-backup]")).toBeNull();
  expect(heading(el)).toBe(t("handover.emergency.preparing_heading"));
  expect(q(el, 'a[href="/handover/controlled%20one"]').textContent).toBe(
    t("handover.emergency.controlled_link"),
  );
  await proceed(el);
  const link = q<HTMLAnchorElement>(
    el,
    '[data-test=emergency-ready] a[href="/handover/controlled%20one"]',
  );
  expect(link.textContent).toBe(t("handover.emergency.controlled_link"));
  expect(q(el, 'wt-file-input[name="handover-backup"]')).toBeNull();
  expect(q(el, "[data-test=emergency-declare]")).not.toBeNull();
});

it("a refused clock step on a saved declaration says why", async () => {
  const { el, posts } = await mount({ saved: true, preparationRefusal: "password.throttled" });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")));
  expect(posts.some(({ path }) => path.endsWith("/activate"))).toBe(false);
});

it("a taken copy whose check is then refused says why and shows no copy", async () => {
  const { el } = await mount({ held: true, takes: ["taken"], later: ["password.throttled"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")));
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(step(el, "follow")).not.toBe("working");
  expect(Reflect.get(el, "following")).toBe(false);
});

it("after a refused take, a declaration saved elsewhere meanwhile is resumed instead of offering the held copy", async () => {
  const { el } = await mount({ held: true, takes: ["handover.chain_broken"], later: ["declared"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.followed_failed")));
  await vi.advanceTimersByTimeAsync(6000);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(saved.reason));
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
  expect(location.pathname).toBe(`/handover/${saved.operationId}`);
});

it("after a refused take, a refused check once the box is back says why and stops waiting", async () => {
  const { el, posts } = await mount({
    held: true,
    takes: ["handover.chain_broken"],
    later: ["password.throttled"],
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await check(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.followed_failed")));
  await vi.advanceTimersByTimeAsync(6000);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")));
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
  expect(q(el, "[data-test=emergency-held]")).toBeNull();
  const asked = previews(posts);
  await vi.advanceTimersByTimeAsync(4000);
  expect(previews(posts)).toBe(asked);
});

it("the held copy is offered with no sign-in field left to empty, and a refused check of it says why", async () => {
  const { el, posts } = await mount({
    held: true,
    takes: ["handover.chain_broken"],
    later: ["ok", "password.throttled"],
  });
  await check(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-held]")).not.toBeNull(), {
    timeout: 10_000,
  });
  for (const selector of [
    '[name="handover-email"]',
    '[name="handover-password"]',
    "[data-test=sign-in-passkey]",
  ])
    expect(q(el, selector)).toBeNull();
  expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-held]").disabled).toBe(
    false,
  );
  expect(q(el, "[data-test=emergency-held]").getAttribute("variant")).toBe("primary");
  const asked = previews(posts);
  q(el, "[data-test=emergency-held]").click();
  q(el, "[data-test=emergency-held]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")));
  expect(previews(posts)).toBe(asked + 1);
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting"));
  expect(button(el, "sign-in-password").disabled).toBe(false);
});

it("choosing a backup while the spare catches up stops the catching up", async () => {
  const { el, posts } = await mount({ held: true, takes: ["catching-up"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await check(el);
  await vi.waitFor(() => catchingUp(el));
  await useDifferentCopy(el);
  chooseFiles(q(el, 'wt-file-input[name="handover-backup"]'), new File(["archive"], "venue.enc"));
  await el.updateComplete;
  q(el, "[data-test=emergency-backup]").click();
  await vi.waitFor(() => expect(q(el, '[name="handover-backup-key"]')).not.toBeNull());
  const taken = followedTakes(posts);
  await vi.advanceTimersByTimeAsync(6000);
  expect(followedTakes(posts)).toBe(taken);
  expect(step(el, "follow")).not.toBe("working");
  expect(Reflect.get(el, "following")).toBe(false);
});

async function chooseBackup(el: SetupHandoverScreen) {
  await authenticate(el);
  await useDifferentCopy(el);
  chooseFiles(q(el, 'wt-file-input[name="handover-backup"]'), new File(["archive"], "venue.enc"));
  await el.updateComplete;
  q(el, "[data-test=emergency-backup]").click();
  await vi.waitFor(() => expect(q(el, '[name="handover-backup-key"]')).not.toBeNull());
  await edit(el, "handover-backup-key", "synthetic-recovery-key");
  q(el, "[data-test=emergency-backup]").click();
  q(el, "[data-test=emergency-backup]").click();
}

it("after choosing a backup, the page keeps waiting until the box shows that backup in place", async () => {
  const { el, posts } = await mount({ backup: true, later: ["ok", "unplaced"] });
  await chooseBackup(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.backup_restarting")),
  );
  // The answer naming the copy still in place arrives, and the next check is 2 seconds away.
  await vi.waitFor(() => expect(previews(posts)).toBe(3));
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.backup_restarting"));
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(q(el, "[data-test=proceed]")).toBeNull();
  await vi.waitFor(
    () =>
      expect(q(el, "[data-test=emergency-copy]").textContent).toContain(
        t("handover.emergency.selected_backup"),
      ),
    { timeout: 10_000 },
  );
  expect(posts.filter(({ path }) => path.endsWith("/backup"))).toHaveLength(2);
  expect(previews(posts)).toBe(4);
});

it("after choosing a backup, a changed copy is waited out but a refused check ends the wait and says why", async () => {
  const { el, posts } = await mount({
    backup: true,
    later: ["ok", "handover.copy_mismatch", "password.throttled"],
  });
  await chooseBackup(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")), {
    timeout: 10_000,
  });
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.backup_restarting"));
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(previews(posts)).toBe(4);
});

// Before a declaration is saved, a refused copy check offers the backup choice where one is drawn.
it.each([
  // Without a controlled handover, Check takes the main box's copy and reads one more preview.
  [false, "handover.emergency.copy_unchecked", ["ok", "handover.copy_damaged"]],
  [true, "handover.emergency.copy_unchecked_only", ["handover.copy_damaged"]],
] as const)(
  "a copy check refused before any declaration does not mention one (unfinished controlled handover: %s)",
  async (controlledOperation, key, later) => {
    const { el } = await mount({
      controlledOperation,
      changeBeforeDeclare: true,
      later: [...later],
    });
    await authenticate(el);
    await declarationFields(el);
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(actions(el)).toContain(t(key)));
    expect(actions(el)).not.toContain(t("handover.emergency.copy_failed"));
    if (controlledOperation) expect(q(el, "[data-test=upload-backup]")).toBeNull();
    else {
      await useDifferentCopy(el);
      expect(q(el, 'wt-file-input[name="handover-backup"]')).not.toBeNull();
    }
  },
);

it("a changed copy whose fresh check is refused says why instead of asking to confirm again", async () => {
  const { el } = await mount({ changeBeforeDeclare: true, later: ["ok", "password.throttled"] });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")));
  expect(actions(el)).not.toContain(t("handover.emergency.copy_changed"));
});

it("a lost declaration whose check is refused says why rather than that it failed", async () => {
  const { el, posts } = await mount({ lostBeforeWrite: true, later: ["ok", "password.throttled"] });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.throttled")));
  expect(actions(el)).not.toContain(t("handover.emergency.failed"));
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toHaveLength(1);
});

it("pressing Check twice before the page redraws checks once", async () => {
  const { el, posts } = await mount();
  await toMethods(el);
  await edit(el, "handover-password", signIn.password);
  q(el, "[data-test=sign-in-password]").click();
  q(el, "[data-test=sign-in-password]").click();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual([
    "preview",
    "followed",
    "preview",
  ]);
});

it("after the page was left, Check acts on its answers instead of discarding them", async () => {
  const { el, posts } = await mount();
  await toMethods(el);
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  await edit(el, "handover-password", signIn.password);
  q(el, "[data-test=sign-in-password]").click();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(previews(posts)).toBe(2);
});

const spareSwitchPage = (back: string) =>
  `https://box-b.waitron.local/handover/emergency?back=${encodeURIComponent(back)}`;

async function stopAndContinueLinks(pageUrl: string) {
  const { el } = await mount({ saved: true, pageUrl });
  const stop = [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a")].find((link) =>
    [t("handover.emergency.leave"), t("handover.emergency.leave_till")].includes(link.textContent!),
  )!;
  const stopHref = stop.getAttribute("href");
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await continueOn(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.done")));
  const proceed = [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a")].find(
    (link) => link.textContent === t("handover.continue"),
  )!;
  return { stop: stopHref, proceed: proceed.getAttribute("href") };
}

it("Stop and Continue go back to the till named in back", async () => {
  expect(await stopAndContinueLinks(spareSwitchPage("https://waitron.local/till/tabs"))).toEqual({
    stop: "https://waitron.local/till/tabs",
    proceed: "https://waitron.local/till/tabs",
  });
});

it("Stop and Continue keep the till when the venue's own address sent it to the switch", async () => {
  expect(
    await stopAndContinueLinks(
      "https://waitron.local/handover/emergency?back=https%3A%2F%2Fwaitron.local%2Ftill%2Ftabs%2Fcounter",
    ),
  ).toEqual({
    stop: "https://waitron.local/till/tabs/counter",
    proceed: "https://waitron.local/till/tabs/counter",
  });
});

it("a switch at the venue address ignores a return to a sibling box", async () => {
  expect(
    await stopAndContinueLinks(
      "https://waitron.local/handover/emergency?back=https%3A%2F%2Fbox-b.waitron.local%2Ftill%2F",
    ),
  ).toEqual({ stop: "/", proceed: "/" });
});

it.each([
  "https://evil.example/",
  "http://waitron.local/",
  "https://waitron.local.evil.example/",
  "https://box-b.waitron.local/",
  "not a url",
])("a back on another site, or not https, is ignored: %s", async (back) => {
  expect(await stopAndContinueLinks(spareSwitchPage(back))).toEqual({ stop: "/", proceed: "/" });
});

async function declareAndReload(pageUrl: string) {
  const { el } = await mount({ pageUrl });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  const replaced = new URL(location.pathname + location.search, "https://box-b.waitron.local");
  const api = el.api;
  cleanupWidgets();
  const { el: reloaded } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api,
    operationId: saved.operationId,
    pageUrl: replaced.href,
  });
  const stop = await vi.waitFor(() => {
    const link = [...reloaded.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a")].find(
      (candidate) => candidate.textContent === t("handover.emergency.leave_saved"),
    );
    expect(link).toBeDefined();
    return link!;
  });
  return { address: replaced, stop: stop.getAttribute("href") };
}

it("a reload after declaring keeps the way back to the till", async () => {
  const { address, stop } = await declareAndReload(
    spareSwitchPage("https://waitron.local/till/tabs"),
  );
  expect(address.pathname).toBe(`/handover/${saved.operationId}`);
  expect(address.searchParams.get("back")).toBe("https://waitron.local/till/tabs");
  expect(stop).toBe("https://waitron.local/till/tabs");
});

it("a back that was ignored is not carried into the operation's address", async () => {
  const { address, stop } = await declareAndReload(spareSwitchPage("https://evil.example/"));
  expect(address.pathname).toBe(`/handover/${saved.operationId}`);
  expect(address.search).toBe("");
  expect(stop).toBe("/");
});

async function mainAnsweringRefusal(el: SetupHandoverScreen) {
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.main_answering")),
  );
  const link = [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a")].find(
    (candidate) => candidate.getAttribute("href") === `${MAIN}/servers`,
  );
  expect(link?.textContent).toBe(t("handover.emergency.main_servers"));
  expect(q(el, "[data-test=emergency-preview]")).toBeNull();
}
const answers = () => Promise.resolve(new Response(null));
const silent = () => Promise.reject(new TypeError("no answer"));

it("when the main server answers, the page refuses and links to its Servers page", async () => {
  const { el, probes } = await mount({ mainUrl: MAIN, mainAnswers: answers });
  await mainAnsweringRefusal(el);
  expect(probes).toHaveLength(1);
  expect(probes[0]).toMatchObject({ mode: "no-cors", cache: "no-store" });
  expect(probes[0]!.signal).toBeInstanceOf(AbortSignal);
  expect(q(el, "[data-test=main-check-again]").textContent).toContain(
    t("handover.emergency.main_check_again"),
  );
});

it("Check again lets the switch go on once the main box is silent, and Continue asks it again", async () => {
  let answering = true;
  const { el, posts } = await mount({
    mainUrl: MAIN,
    mainAnswers: () => (answering ? answers() : silent()),
  });
  await mainAnsweringRefusal(el);
  answering = false;
  q(el, "[data-test=main-check-again]").click();
  await startSwitching(el);
  expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.main_answering"));
  answering = true;
  await passwordSignIn(el, signIn.email, signIn.password);
  await mainAnsweringRefusal(el);
  expect(posts).toEqual([]);
});

it("a main server that comes back before Declare stops the switch there, sending nothing", async () => {
  let answering = false;
  const { el, posts } = await mount({
    mainUrl: MAIN,
    mainAnswers: () => (answering ? answers() : silent()),
  });
  await startSwitching(el);
  await authenticate(el);
  await declarationFields(el);
  answering = true;
  q(el, "[data-test=emergency-declare]").click();
  await mainAnsweringRefusal(el);
  expect(posts.filter(({ path }) => path.endsWith("/declare"))).toEqual([]);
});

it("a page restored from the back-forward cache asks the main server again, and a slower earlier check does not overrule it", async () => {
  let silenceFirst: ((reason: unknown) => void) | undefined;
  const { el } = await mount({
    mainUrl: MAIN,
    mainAnswers: (call) =>
      call === 0
        ? new Promise((_resolve, reject) => {
            silenceFirst = reject;
          })
        : answers(),
  });
  await vi.waitFor(() => expect(silenceFirst).toBeDefined());
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await mainAnsweringRefusal(el);
  silenceFirst!(new TypeError("no answer"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await mainAnsweringRefusal(el);
});

it.each(["the address read", "the main server's answer"])(
  "a check that waits over 3 seconds for %s lets the switch go on",
  async (stage) => {
    // vi.waitFor moves fake time on, so the wait for the request uses the real clock.
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let asked = false;
    const never = () => {
      asked = true;
      return new Promise<Response>(() => {});
    };
    const { el } = await mount({
      mainUrl: MAIN,
      ...(stage === "the address read" ? { mainRead: never } : { mainAnswers: never }),
    });
    for (let turn = 0; turn < 100 && !asked; turn += 1)
      await new Promise((resolve) => realSetTimeout(resolve, 20));
    expect(asked).toBe(true);
    await vi.advanceTimersByTimeAsync(2999);
    await el.updateComplete;
    expect(q(el, "[data-test=emergency-preview]")).toBeNull();
    expect(q(el, "[data-test=start-switching]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.main_checking"));
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(q(el, "[data-test=start-switching]")).not.toBeNull());
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.main_answering"));
  },
);

it("no mainUrl lets the switch go on", async () => {
  const { el, probes } = await mount({ mainUrl: null });
  expect(q(el, "[data-test=emergency-preview]")).not.toBeNull();
  expect(probes).toEqual([]);
});

it.each([
  { outcome: "answers", mainAnswers: answers, key: "handover.emergency.main_answering" },
  { outcome: "is silent", mainAnswers: silent, key: "handover.emergency.silent_heading" },
] as const)(
  "when the check finds the main box $outcome, focus moves to the new page's heading",
  async ({ mainAnswers, key }) => {
    const { el } = await mount({ mainUrl: MAIN, mainAnswers });
    await vi.waitFor(() => expect(heading(el)).toBe(t(key)));
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(q(el, "h1"));
  },
);

it.each(["Continue", "Switch to this box"])(
  "a check at %s that finds the main box answering moves focus to the heading",
  async (step) => {
    let answering = false;
    const { el } = await mount({
      mainUrl: MAIN,
      mainAnswers: () => (answering ? answers() : silent()),
    });
    await startSwitching(el);
    if (step === "Switch to this box") {
      await authenticate(el);
      await declarationFields(el);
    } else {
      await toMethods(el);
      await edit(el, "handover-password", signIn.password);
    }
    (el.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    expect(el.shadowRoot!.activeElement).toBeNull();
    answering = true;
    q(
      el,
      step === "Switch to this box"
        ? "[data-test=emergency-declare]"
        : "[data-test=sign-in-password]",
    ).click();
    await mainAnsweringRefusal(el);
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(q(el, "h1"));
  },
);

it("a check that settles after the page is hidden starts no count and moves no focus", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  let release: (() => void) | undefined;
  const { el } = await mount({
    mainUrl: MAIN,
    mainRead: () =>
      new Promise((resolve) => {
        release = () =>
          resolve(new Response(JSON.stringify({ mainUrl: null, silentForMs: 1_000 })));
      }),
  });
  await vi.waitFor(() => expect(release).toBeDefined());
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  release!();
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(vi.getTimerCount()).toBe(0);
  expect(el.shadowRoot!.activeElement).toBeNull();
});

const heading = (el: SetupHandoverScreen) => q(el, "h1").textContent!.trim();
const goBack = (el: SetupHandoverScreen) => q<HTMLAnchorElement>(el, "[data-test=go-back]");
const TILL = "https://waitron.local/till/tabs";

it("while the main box is being checked, says so and offers nothing to press", async () => {
  const { el } = await mount({ mainUrl: MAIN, mainAnswers: () => new Promise(() => {}) });
  await vi.waitFor(() => expect(heading(el)).toBe(t("handover.emergency.checking_heading")));
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.spare_intro"));
  const status = q(el, '[role="status"]');
  expect(status.textContent!.trim()).toBe(t("handover.emergency.main_checking"));
  expect(status.querySelector("wt-spinner")).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll("wt-button, a, input, wt-input")).toHaveLength(0);
});

it("when the main box answers, going back is the main action and the handover is folded away", async () => {
  let answering = true;
  const { el } = await mount({
    mainUrl: MAIN,
    pageUrl: spareSwitchPage(TILL),
    mainAnswers: () => (answering ? answers() : silent()),
  });
  await mainAnsweringRefusal(el);
  expect(heading(el)).toBe(t("handover.emergency.main_answering"));
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.main_answering_body"));
  expect(goBack(el).getAttribute("href")).toBe(TILL);
  expect(goBack(el).textContent!.trim()).toBe(t("handover.emergency.leave_till"));
  expect(goBack(el).classList.contains("primary")).toBe(true);
  const details = q<HTMLDetailsElement>(el, "details");
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")!.textContent!.trim()).toBe(
    t("handover.emergency.still_move"),
  );
  expect(details.textContent).toContain(t("handover.emergency.still_move_body"));
  expect(details.querySelector(`a[href="${MAIN}/servers"]`)).not.toBeNull();
  expect(details.contains(q(el, "[data-test=main-check-again]"))).toBe(true);
  answering = false;
  q(el, "[data-test=main-check-again]").click();
  await vi.waitFor(() => expect(q(el, "[data-test=start-switching]")).not.toBeNull());
  expect(heading(el)).toBe(t("handover.emergency.silent_heading"));
});

it.each(["en-GB", "es-ES"])(
  "when the main box is silent, explains the switch before offering it (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount({ explanation: true });
    expect(heading(el)).toBe(t("handover.emergency.silent_heading"));
    const text = el.shadowRoot!.textContent!;
    for (const key of [
      "handover.emergency.silent_copy",
      "handover.emergency.before_heading",
      "handover.emergency.before_body",
      "handover.emergency.what_heading",
      "handover.emergency.what_body",
    ] as const)
      expect(text).toContain(t(key));
    // The spare did not say how long, so no sentence guesses.
    expect(q(el, "h1 + p").textContent!.trim()).toBe(t("handover.emergency.silent_copy"));
    expect(q(el, "[data-test=start-switching]").getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=start-switching]").textContent!.trim()).toBe(
      t("handover.emergency.start"),
    );
    expect(goBack(el).getAttribute("href")).toBe("/");
    expect(goBack(el).textContent!.trim()).toBe(t("handover.emergency.leave"));
    expect(goBack(el).classList.contains("primary")).toBe(false);
    expect(q(el, '[name="handover-email"]')).toBeNull();
    expect(q(el, "[data-test=emergency-preview]")).toBeNull();
  },
);

it("counts up how long the spare has found the main box silent, from the spare's own figure", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const { el } = await mount({ explanation: true, silentForMs: 65_000 });
  const sentence = (ms: number) =>
    format("handover.emergency.silent_for", { duration: formatDuration(ms, "en-GB") });
  expect(el.shadowRoot!.textContent).toContain(sentence(65_000));
  await vi.advanceTimersByTimeAsync(5_000);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain(sentence(70_000));
  q(el, "[data-test=start-switching]").click();
  await el.updateComplete;
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["light", "dark"] as const)(
  "the secondary Go back link is painted like a secondary wt-button, at rest and hovered (%s)",
  async (theme) => {
    const { el } = await mount({ explanation: true, theme });
    const probe = document.createElement("wt-button");
    probe.setAttribute("variant", "secondary");
    probe.textContent = "probe";
    q(el, ".choices").append(probe);
    await (probe as LitElement).updateComplete;
    const button = probe.shadowRoot!.querySelector("button")!;
    const paint = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        color: style.color,
        border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        radius: style.borderTopLeftRadius,
        weight: style.fontWeight,
        padding: style.padding,
        minHeight: style.minHeight,
      };
    };
    // The pointer stays where the previous case left it, which can be over this link.
    await userEvent.hover(q(el, "h1"));
    expect(paint(goBack(el))).toEqual(paint(button));
    await userEvent.hover(button);
    const hoveredButton = paint(button);
    await userEvent.hover(goBack(el));
    expect(paint(goBack(el))).toEqual(hoveredButton);
  },
);

it("stops counting when the page is hidden", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  await mount({ explanation: true, silentForMs: 1_000 });
  expect(vi.getTimerCount()).toBe(1);
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  expect(vi.getTimerCount()).toBe(0);
});

it("Start switching opens the sign-in under Sign in to switch and moves focus to it", async () => {
  const { el } = await mount({ explanation: true });
  q(el, "[data-test=start-switching]").click();
  await vi.waitFor(() => expect(q(el, '[name="handover-email"]')).not.toBeNull());
  expect(heading(el)).toBe(t("handover.emergency.sign_in_heading"));
  expect(el.shadowRoot!.activeElement).toBe(q(el, "h1"));
  expect(q(el, "[data-test=start-switching]")).toBeNull();
});

it.each([
  { back: TILL, href: TILL, label: "handover.emergency.leave_till" },
  { back: "https://evil.example/", href: "/", label: "handover.emergency.leave" },
] as const)(
  "names the till in Go back only when the page has a till to go back to: $back",
  async ({ back, href, label }) => {
    const { el } = await mount({ explanation: true, pageUrl: spareSwitchPage(back) });
    expect(goBack(el).getAttribute("href")).toBe(href);
    expect(goBack(el).textContent!.trim()).toBe(t(label));
    await startSwitching(el);
    const leave = [...el.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.getAttribute("href") === href,
    )!;
    expect(leave.textContent!.trim()).toBe(t(label));
  },
);

it("a page reopened on a declared switch goes straight to the sign-in", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ body: { ...status, waitingReason: null } })),
  );
  const { el } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
    api: new SetupApi("", fetcher),
    operationId: saved.operationId,
  });
  await vi.waitFor(() => expect(q(el, '[name="handover-email"]')).not.toBeNull());
  expect(q(el, "[data-test=start-switching]")).toBeNull();
  expect(heading(el)).toBe(t("handover.emergency.switching_heading"));
  expect(fetcher.mock.calls.map(([input]) => String(input))).not.toContain("/api/node/main");
});

it("offers a passkey beside the password, and the passkey needs no password", async () => {
  const { el } = await mount({ proof: newProof() });
  await toMethods(el);
  expect(
    [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>(
        "[data-test=sign-in-passkey], [data-test=sign-in-password]",
      ),
    ].map((b) => b.textContent!.trim()),
  ).toEqual([t("handover.emergency.use_passkey"), t("handover.emergency.sign_in_password")]);
  expect(q(el, '[name="handover-password"]')).not.toBeNull();
  expect(q(el, '[name="handover-email"]')).toBeNull();
  expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=sign-in-passkey]").disabled).toBe(
    false,
  );
});

/** Turns passkey autofill on; each autofill request waits until `pick` answers it or it is cancelled. */
function stubAutofill() {
  vi.mocked(PublicKeyCredential.isConditionalMediationAvailable).mockResolvedValue(true);
  const autofills: { request: CredentialRequestOptions; pick: () => void }[] = [];
  const get = vi.spyOn(navigator.credentials, "get").mockImplementation(async (request) => {
    if (request?.mediation !== "conditional") return credentialFor(request);
    return new Promise<Credential>((resolve, reject) => {
      autofills.push({ request, pick: () => resolve(credentialFor(request)) });
      request.signal?.addEventListener("abort", () => reject(request.signal!.reason));
    });
  });
  const prompts = () =>
    get.mock.calls.filter(([request]) => request?.mediation !== "conditional").length;
  return { get, autofills, prompts };
}

it("asks for the email alone first, then how to sign in, and Change goes back keeping the email", async () => {
  const { el, posts } = await mount();
  const email = q<LitElement>(el, '[name="handover-email"]');
  expect(email.getAttribute("autocomplete")).toContain("webauthn");
  expect(email.getAttribute("type")).toBe("email");
  expect(q(el, '[name="handover-password"]')).toBeNull();
  expect(q(el, "[data-test=sign-in-passkey]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.sign_in"));
  await edit(el, "handover-email", signIn.email);
  const input = email.shadowRoot!.querySelector("input")!;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await vi.waitFor(() => expect(q(el, "[data-test=sign-in-passkey]")).not.toBeNull());
  expect(q(el, '[name="handover-email"]')).toBeNull();
  expect(q(el, "[data-test=sign-in-email]").textContent).toContain(signIn.email);
  expect(q(el, "[data-test=change-email]").textContent!.trim()).toBe(
    t("handover.emergency.change_email"),
  );
  expect(q(el, '[name="handover-password"]')).not.toBeNull();
  expect(q(el, '[name="handover-code"]')).not.toBeNull();
  await edit(el, "handover-password", signIn.password);
  q(el, "[data-test=change-email]").click();
  await vi.waitFor(() => expect(q(el, '[name="handover-email"]')).not.toBeNull());
  const back = q<LitElement>(el, '[name="handover-email"]');
  await back.updateComplete;
  expect(back.shadowRoot!.querySelector("input")!.value).toBe(signIn.email);
  expect(q(el, '[name="handover-password"]')).toBeNull();
  await toMethods(el);
  const password = q<LitElement>(el, '[name="handover-password"]');
  await password.updateComplete;
  expect(password.shadowRoot!.querySelector("input")!.value).toBe("");
  expect(posts).toEqual([]);
});

it("Continue with an email that is not one marks the field and sends nothing", async () => {
  const { el, posts } = await mount();
  await edit(el, "handover-email", "owner");
  q(el, "[data-test=emergency-preview]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.fix")));
  const email = q<LitElement & { error: string }>(el, '[name="handover-email"]');
  expect(email.error).toBe(t("handover.required"));
  expect(q(el, "[data-test=sign-in-passkey]")).toBeNull();
  expect(q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-preview]").disabled).toBe(
    true,
  );
  expect(posts).toEqual([]);
});

it("offers a saved passkey in the email field, and one picked there signs in with no second prompt", async () => {
  const { get, autofills, prompts } = stubAutofill();
  const { el, posts } = await mount({ proof: newProof() });
  await vi.waitFor(() => expect(autofills).toHaveLength(1));
  expect(autofills[0]!.request.mediation).toBe("conditional");
  expect(posts).toEqual([]);
  autofills[0]!.pick();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(1);
  expect(prompts()).toBe(0);
  const first = posts[0]!;
  expect(first.path.endsWith("/preview")).toBe(true);
  expect(Object.keys(first.body.signIn as object)).toEqual(["passkey"]);
});

it("renews the passkey offer each minute while the email step shows, and cancels it when the step goes", async () => {
  const { autofills } = stubAutofill();
  const { el } = await mount({ proof: newProof(), explanation: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await startSwitching(el);
  await vi.waitFor(() => expect(autofills).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(59_000);
  expect(autofills).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000);
  await vi.waitFor(() => expect(autofills).toHaveLength(2));
  expect(autofills[0]!.request.signal!.aborted).toBe(true);
  expect(autofills[1]!.request.signal!.aborted).toBe(false);
  await toMethods(el);
  await vi.waitFor(() => expect(autofills[1]!.request.signal!.aborted).toBe(true));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(autofills).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("Use your passkey opens one prompt when the box asks for it, and none when its proof is enough", async () => {
  const get = stubPasskey();
  const proof = newProof();
  const first = await mount({ proof });
  await choosePasskey(first.el);
  await vi.waitFor(() => expect(q(first.el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0]![0]!.mediation).not.toBe("conditional");
  cleanupWidgets();
  expect(proof.cookie).toBe(true);
  const { el, posts } = await mount({ proof });
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(1);
  expect(posts.every(({ body }) => body.signIn === undefined)).toBe(true);
});

it("Sign in with password sends the email, password and code", async () => {
  const { el, posts } = await mount();
  await passwordSignIn(el, signIn.email, signIn.password, signIn.totp);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(posts[0]!.path.endsWith("/preview")).toBe(true);
  expect(posts[0]!.body.signIn).toEqual(signIn);
});

it("a refused sign-in goes back to how to sign in, keeping the email, and does not say whether the account exists", async () => {
  const { el } = await mount({ refusal: "password.invalid", takes: ["password.invalid"] });
  await passwordSignIn(el, signIn.email, "mistyped", signIn.totp);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.sign_in_failed")));
  expect(heading(el)).toBe(t("handover.emergency.sign_in_heading"));
  expect(q(el, "[data-test=sign-in-passkey]")).not.toBeNull();
  expect(q(el, '[name="handover-email"]')).toBeNull();
  expect(q(el, "[data-test=sign-in-email]").textContent).toContain(signIn.email);
  expect(actions(el)).toBe(t("handover.emergency.sign_in_failed"));
  expect(actions(el)).not.toContain(signIn.email);
});

it("on Ready to switch, Use your passkey in a sign-in a refusal opened switches with one more prompt", async () => {
  const get = stubPasskey();
  const proof = newProof();
  const { el, posts } = await mount({ proof });
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  await declarationFields(el);
  proof.cookie = false;
  proof.refusals = ["passkey.verification_failed"];
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.passkey_failed")));
  expect(get).toHaveBeenCalledTimes(2);
  expect(heading(el)).toBe(t("handover.emergency.ready_heading"));
  const declared = posts.filter(({ path }) => path.endsWith("/declare")).length;
  const passkey = q<HTMLElement & { disabled: boolean }>(el, "[data-test=sign-in-passkey]");
  await vi.waitFor(() => expect(passkey.disabled).toBe(false));
  passkey.click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(3);
  // The declaration already sent checks the copy first, so the prompt comes at that check.
  expect(posts.filter(({ path }) => path.endsWith("/declare")).length).toBe(declared + 1);
});

it("a passkey switch unlocks once and the later steps lean on the proof, through to activation", async () => {
  const get = stubPasskey();
  const { el, posts } = await mount({ proof: newProof() });
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await continueOn(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.done")));
  expect(get).toHaveBeenCalledTimes(1);
  const steps = posts.map(({ path, body }) => [
    path.split("/").at(-1),
    body.signIn === undefined ? "none" : "passkey" in (body.signIn as object) ? "passkey" : "other",
  ]);
  expect(steps.slice(0, 4)).toEqual([
    ["preview", "none"],
    ["preview", "passkey"],
    ["followed", "none"],
    ["preview", "none"],
  ]);
  expect(steps.slice(4).every(([, signIn]) => signIn === "none")).toBe(true);
  expect(steps.slice(4).map(([step]) => step)).toEqual(
    expect.arrayContaining(["declare", "preparation", "activate"]),
  );
});

it("a reload after the take carries on with the proof, without a new unlock", async () => {
  const get = stubPasskey();
  const proof = newProof();
  const first = await mount({ proof });
  await choosePasskey(first.el);
  await vi.waitFor(() => expect(q(first.el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(first.posts.some(({ path }) => path.endsWith("/followed"))).toBe(true);
  cleanupWidgets();
  const { el } = await mount({ proof });
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(1);
});

it("never writes the passkey answer to the address or to storage", async () => {
  stubPasskey();
  const { el, posts } = await mount({ proof: newProof() });
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  const answer = posts.find(({ body }) => body.signIn !== undefined)!.body.signIn as {
    passkey: { response: { clientDataJSON: string } };
  };
  const written = [
    location.href,
    JSON.stringify({ ...localStorage }),
    JSON.stringify({ ...sessionStorage }),
  ];
  for (const place of written) {
    expect(place).not.toContain(answer.passkey.response.clientDataJSON);
    expect(place).not.toContain("chal0000");
  }
});

it("a refused passkey, or a lapsed proof, offers the passkey again rather than ending the switch", async () => {
  const get = stubPasskey();
  const proof = newProof();
  const { el } = await mount({ proof });
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  await declarationFields(el);
  proof.cookie = false;
  proof.refusals = ["passkey.verification_failed"];
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.passkey_failed")));
  expect(get).toHaveBeenCalledTimes(2);
  expect(q(el, "[data-test=sign-in-passkey]")).not.toBeNull();
  const declare = q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-declare]");
  await vi.waitFor(() => expect(declare.disabled).toBe(false));
  declare.click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(get).toHaveBeenCalledTimes(3);
});

it("a passkey prompt the person cancels says the passkey did not sign in, and sends no answer", async () => {
  const get = vi
    .spyOn(navigator.credentials, "get")
    .mockRejectedValue(new DOMException("The operation was cancelled.", "NotAllowedError"));
  const { el, posts } = await mount({ proof: newProof() });
  await choosePasskey(el);
  q(el, "[data-test=emergency-preview]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.passkey_failed")));
  expect(get).toHaveBeenCalledTimes(1);
  expect(q(el, "[data-test=emergency-copy]")).toBeNull();
  expect(q(el, '[name="handover-sign-in-method"]')).not.toBeNull();
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual(["preview"]);
  expect(posts.every(({ body }) => body.signIn === undefined)).toBe(true);
});

it("with no internet time, a passkey switch confirms the time, and a proof lapsed by the select asks for the passkey again", async () => {
  const get = stubPasskey();
  const { el, posts } = await mount({
    proof: newProof(),
    noInternetTime: true,
    proofLapsesAtSelect: true,
  });
  const selects = () =>
    posts
      .filter(
        ({ path, body }) =>
          path.endsWith("/preparation") &&
          (body.proposal as { action: string }).action === "select",
      )
      .map(({ body }) => [
        body.proposal,
        body.signIn === undefined
          ? "none"
          : "passkey" in (body.signIn as object)
            ? "passkey"
            : "other",
      ]);
  await choosePasskey(el);
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  const entry = q<LitElement>(el, "vf-recovery-hour");
  await vi.waitFor(() => expect(q(entry, "[data-test=confirm-time]")).not.toBeNull());
  expect(selects()).toEqual([]);
  expect(get).toHaveBeenCalledTimes(1);
  q(entry, "[data-test=confirm-time]").click();
  await continueOn(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.done")));
  const confirmed = { action: "select", comparisonId: "comparison", confirmed: true };
  expect(selects()).toEqual([
    [confirmed, "none"],
    [confirmed, "passkey"],
  ]);
  expect(
    posts
      .filter(({ path }) => path.endsWith("/preparation"))
      .map(({ body }) => (body.proposal as { action: string }).action),
  ).toEqual([
    "clock-challenge",
    "compare-clocks",
    "clock-challenge",
    "compare-clocks",
    "select",
    "select",
  ]);
  expect(get).toHaveBeenCalledTimes(2);
});

it.each(["passkey.not_registered", "passkey.verification_failed"])(
  "a passkey the held copy refuses with %s goes on to the take with a fresh answer",
  async (code) => {
    const get = stubPasskey();
    const proof = newProof();
    proof.refusals = [code];
    const { el, posts } = await mount({ proof, takes: ["restarting"] });
    await choosePasskey(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
    );
    const sent = posts
      .filter(({ body }) => body.signIn !== undefined)
      .map(({ path, body }) => {
        const { clientDataJSON } = (
          body.signIn as { passkey: { response: { clientDataJSON: string } } }
        ).passkey.response;
        const client = clientDataJSON.replace(/-/g, "+").replace(/_/g, "/");
        return [
          path.split("/").at(-1),
          (JSON.parse(atob(client)) as { challenge: string }).challenge,
        ];
      });
    expect(sent.map(([step]) => step)).toEqual(["preview", "followed"]);
    expect(sent[0]![1]).not.toBe(sent[1]![1]);
    expect(get).toHaveBeenCalledTimes(2);
  },
);

it.each(["passkey.not_registered", "passkey.verification_failed"])(
  "a passkey the take also refuses with %s says the passkey did not sign in",
  async (code) => {
    stubPasskey();
    const proof = newProof();
    proof.refusals = [code, code];
    const { el, posts } = await mount({ proof, takes: ["restarting"] });
    await choosePasskey(el);
    await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.passkey_failed")));
    expect(posts.filter(({ path }) => path.endsWith("/followed"))).toHaveLength(2);
  },
);

it("a passkey answer that lapses while the spare catches up says so, and checking again asks anew", async () => {
  const get = stubPasskey();
  const proof = newProof();
  proof.refusals = ["passkey.not_registered", "passkey.not_registered"];
  const { el, posts } = await mount({
    proof,
    takes: [...Array<string>(66).fill("catching-up"), "restarting"],
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await choosePasskey(el);
  await vi.waitFor(() => catchingUp(el));
  // One take without a sign-in, 66 that wait while catching up, then the one caught up.
  while (followedTakes(posts) < 68) {
    const sent = followedTakes(posts);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(followedTakes(posts)).toBeGreaterThan(sent));
  }
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.passkey_lapsed")));
  expect(actions(el)).not.toContain(t("handover.emergency.passkey_failed"));
  expect(get).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
  const again = q<HTMLElement & { disabled: boolean }>(el, "[data-test=sign-in-passkey]");
  await vi.waitFor(() => expect(again.disabled).toBe(false));
  again.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
  );
  expect(get).toHaveBeenCalledTimes(4);
});

it("a passkey take the held copy refused, then sent to the held copy, keeps the take's explanation", async () => {
  stubPasskey();
  const proof = newProof();
  proof.refusals = ["passkey.not_registered"];
  const { el } = await mount({ proof, held: true, takes: ["handover.copy_predates_destination"] });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await choosePasskey(el);
  await vi.waitFor(() =>
    expect(actions(el)).toContain(t("handover.emergency.followed_not_admitted")),
  );
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.held_waiting")),
  );
  expect(proof.cookie).toBe(false);
  expect(actions(el)).toContain(t("handover.emergency.followed_not_admitted"));
  expect(actions(el)).toContain(t("handover.emergency.held_passkey_refused"));
  expect(actions(el)).not.toContain(t("handover.emergency.passkey_failed"));
  // The message asks for the password, so the sign-in's choice of method is back.
  expect(q(el, "[data-test=sign-in-password]")).not.toBeNull();
  expect(q(el, '[name="handover-password"]')).not.toBeNull();
});

it.each([
  ["en-GB", "Open the box's HTTPS address"],
  ["es-ES", handoverEs["handover.emergency.connection"]],
] as const)("shows HTTPS advice without taking a newer copy in %s", async (locale, words) => {
  setLocale(locale);
  const { el, posts } = await mount({ refusal: "node.operation_page_required" });
  expect(words).toContain("HTTPS");
  if (locale === "es-ES") expect(words).not.toContain("This operation");
  await passwordSignIn(el, signIn.email, signIn.password);
  await vi.waitFor(() => expect(actions(el)).toContain(words));
  expect(posts.map(({ path }) => path.split("/").at(-1))).toEqual(["preview"]);
});

const signInDrawn = (el: SetupHandoverScreen) =>
  [
    "[data-test=sign-in-passkey]",
    '[name="handover-email"], [data-test=sign-in-email]',
    '[name="handover-password"]',
    '[name="handover-code"]',
    'wt-file-input[name="handover-backup"]',
  ].map((selector) => el.shadowRoot!.querySelector(selector) !== null);
const leaveLink = (el: SetupHandoverScreen) =>
  el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[href="/"]`)!;

it.each(["en-GB", "es-ES"])(
  "the sign-in page has no backup choice; Preparing the venue has no sign-in, and its backup link opens only the backup choice (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount();
    expect(signInDrawn(el)).toEqual([false, true, false, false, false]);
    await toMethods(el);
    expect(signInDrawn(el)).toEqual([true, true, true, true, false]);
    await authenticate(el);
    expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.sign_in"));
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.backup_intro"));
    const upload = q(el, "[data-test=upload-backup]");
    expect(upload.textContent!.trim()).toBe(t("handover.emergency.upload_backup"));
    expect(upload.getAttribute("variant")).toBe("link");
    upload.click();
    await el.updateComplete;
    expect(signInDrawn(el)).toEqual([false, false, false, false, true]);
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.backup_intro"));
    expect(q(el, "[data-test=upload-backup]")).toBeNull();
  },
);

it("a folded sign-in is still sent with the declaration", async () => {
  const { el, posts } = await mount();
  await authenticate(el);
  expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(posts.find(({ path }) => path.endsWith("/declare"))!.body.signIn).toEqual(signIn);
  expect(q(el, "[data-test=upload-backup]")).toBeNull();
  expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
});

it("a refusal that needs the sign-in opens it again, before Declare", async () => {
  const { el } = await mount({ expired: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.code_expired")));
  // Ready to switch draws the sign-in again; the backup choice stays on Preparing the venue.
  expect(heading(el)).toBe(t("handover.emergency.ready_heading"));
  expect(signInDrawn(el)).toEqual([true, true, true, true, false]);
  const code = q<LitElement>(el, '[name="handover-code"]');
  await code.updateComplete;
  expect(code.shadowRoot!.querySelector("input")!.value).toBe(signIn.totp);
});

it("an expired code at the clock check opens the sign-in again, without Upload a backup file instead", async () => {
  const { el } = await mount({ saved: true, preparationRefusal: "password.invalid" });
  await authenticate(el);
  expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  await startVenue(el);
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.emergency.code_expired")));
  // After Switch to this box the copy cannot change, so the backup choice stays away.
  expect(signInDrawn(el)).toEqual([true, true, true, true, false]);
  expect(q(el, "[data-test=upload-backup]")).toBeNull();
});

it("a successful start whose progress cannot be read asks for nothing until the step is pressed again", async () => {
  const { el } = await mount({ saved: true, alreadyActivated: true });
  await authenticate(el);
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
  await startVenue(el);
  await continueOn(el);
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain(t("handover.read_failed")));
  expect(actions(el)).not.toContain(t("handover.fix"));
  expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
  // Pressing the step again needs the password the start cleared, so the fields come back marked.
  q(el, "[data-test=authenticate]").click();
  await vi.waitFor(() => expect(actions(el)).toContain(t("handover.fix")));
  expect(signInDrawn(el)).toEqual([true, true, true, true, false]);
  const password = q<LitElement & { error: string }>(el, '[name="handover-password"]');
  expect(password.error).toBe(t("handover.required"));
  await password.updateComplete;
  expect(password.shadowRoot!.querySelector("input")!.value).toBe("");
});

it("a successful Switch folds a sign-in a refusal opened on Ready to switch", async () => {
  const { el } = await mount({ expired: true });
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(signInDrawn(el)).toEqual([true, true, true, true, false]));
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(signInDrawn(el)).toEqual([false, false, false, false, false]);
});

it("a fresh declaration's Details show the time it was saved", async () => {
  const { el } = await mount();
  await authenticate(el);
  await declarationFields(el);
  q(el, "[data-test=emergency-declare]").click();
  await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
  expect(q(el, "[data-test=emergency-details]").textContent).toContain(
    `${t("handover.emergency.declared_at")} ${new Date(saved.declaredAtMs).toLocaleString("en-GB")}`,
  );
});

it.each(["en-GB", "es-ES"])(
  "the main box's latest copy is named by its latest sale or order, without when this spare joined (%s)",
  async (locale) => {
    setLocale(locale);
    const changed = 1791000000000;
    const { el } = await mount({ followedChangeAtMs: changed });
    await authenticate(el);
    const copy = q(el, "[data-test=emergency-copy]").textContent!;
    expect(copy).toContain(t("handover.emergency.followed"));
    expect(copy).toContain(new Date(changed).toLocaleString(locale));
    expect(copy).not.toContain(
      format("handover.emergency.spare_joined", {
        joined: new Date(preview.joinedAtMs).toLocaleString(locale),
      }),
    );
    expect(copy).not.toContain(t("handover.emergency.held_undated"));
  },
);

it("Enter on Upload a backup file instead moves focus to the backup file it reveals", async () => {
  const { el } = await mount();
  await authenticate(el);
  q(el, "[data-test=upload-backup]").shadowRoot!.querySelector("button")!.focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.activeElement).toBe(q(el, 'wt-file-input[name="handover-backup"]')),
  );
});

it.each(["en-GB", "es-ES"])(
  "names the copy by its times, not its fingerprint, and asks the statements with nothing above them (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount();
    await authenticate(el);
    const copy = q(el, "[data-test=emergency-copy]");
    expect(copy.textContent).not.toContain(preview.copy.identifier);
    expect(copy.textContent).toContain(t("handover.emergency.no_date"));
    await proceed(el);
    const statements = q(el, ".statements");
    expect(statements.previousElementSibling).toBeNull();
    expect([...statements.querySelectorAll("label")].map((label) => label.textContent)).toEqual(
      (["sourceSwitchedOff", "noParallelRecovery", "missingTailAccepted"] as const).map(
        (key) => `${t(`handover.emergency.${key}`)} *`,
      ),
    );
  },
);

it.each(["en-GB", "es-ES"])(
  "the leave link says it goes back before Declare and that the switch is saved after (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount();
    expect(leaveLink(el).textContent).toBe(t("handover.emergency.leave"));
    await authenticate(el);
    await proceed(el);
    expect(leaveLink(el).textContent).toBe(t("handover.emergency.leave"));
    await declarationFields(el);
    q(el, "[data-test=emergency-declare]").click();
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
    expect(leaveLink(el).textContent).toBe(t("handover.emergency.leave_saved"));
  },
);

it.each(["en-GB", "es-ES"])(
  "after Declare, says the switch is saved and folds the copy's details, the reason and the time (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount({ saved: true });
    await authenticate(el);
    const copy = q(el, "[data-test=emergency-copy]");
    const saved_ = [...copy.querySelectorAll(":scope > p")].map((p) => p.textContent!.trim());
    expect(saved_).toEqual([t("handover.emergency.saved")]);
    const details = copy.querySelector<HTMLDetailsElement>(":scope > details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent!.trim()).toBe(
      t("handover.emergency.details"),
    );
    expect(details.textContent).toContain(saved.reason);
    expect(details.textContent).toContain(t("handover.emergency.declared_at"));
    expect(details.textContent).toContain(t("handover.emergency.no_date"));
    expect(details.querySelector<HTMLAnchorElement>("a")!.getAttribute("href")).toBe(
      preview.sourceServersUrl,
    );
    q(el, "[data-test=authenticate]").click();
    await vi.waitFor(() => expect(q(el, "vf-recovery-hour")).not.toBeNull());
    expect(details.contains(q(el, "vf-recovery-hour"))).toBe(false);
  },
);

/** The follow step shows as working while the page asks the take again every 2 seconds. */
function catchingUp(el: SetupHandoverScreen) {
  expect(step(el, "follow")).toBe("working");
  expect(Reflect.get(el, "following")).toBe(true);
}
const step = (el: SetupHandoverScreen, name: "follow" | "check") =>
  el.shadowRoot!.querySelector(`[data-test=step-${name}]`)?.getAttribute("data-state");
const enabledButtons = (el: SetupHandoverScreen) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>("wt-button")]
    .filter((button) => !button.disabled)
    .map((button) => button.textContent!.trim());
async function signInFields(el: SetupHandoverScreen) {
  await toMethods(el);
  await edit(el, "handover-password", signIn.password);
  await edit(el, "handover-code", signIn.totp);
}
async function proceed(el: SetupHandoverScreen) {
  q(el, "[data-test=proceed]").click();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-ready]")).not.toBeNull());
}

it.each(["en-GB", "es-ES"])(
  "Continue leads to Preparing the venue: its two steps, then the copy's latest sale or order, Proceed and the backup link (%s)",
  async (locale) => {
    setLocale(locale);
    const changed = 1791000000000;
    const { el } = await mount({ followedChangeAtMs: changed });
    expect(q(el, "[data-test=emergency-preview]").textContent!.trim()).toBe(
      t("handover.emergency.continue"),
    );
    await signInFields(el);
    const signInButton = q(el, "[data-test=sign-in-password]");
    expect(signInButton.textContent!.trim()).toBe(t("handover.emergency.sign_in_password"));
    signInButton.click();
    await vi.waitFor(() => expect(heading(el)).toBe(t("handover.emergency.preparing_heading")));
    expect(q(el, '[name="handover-email"]')).toBeNull();
    const rows = [...el.shadowRoot!.querySelectorAll("ol.progress > li")];
    expect(rows.map((row) => row.querySelector(".label")!.textContent!.trim())).toEqual([
      t("handover.emergency.step_follow"),
      t("handover.emergency.step_check"),
    ]);
    await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
    expect([step(el, "follow"), step(el, "check")]).toEqual(["done", "done"]);
    const facts = q(el, "[data-test=emergency-copy]").textContent!;
    expect(facts).toContain(
      `${t("handover.emergency.latest_activity")} ${new Date(changed).toLocaleString(locale)}`,
    );
    expect(facts).not.toContain(
      format("handover.emergency.spare_joined", {
        joined: new Date(preview.joinedAtMs).toLocaleString(locale),
      }),
    );
    expect(el.shadowRoot!.querySelector(`a[href="${preview.sourceServersUrl}"]`)).toBeNull();
    expect(q(el, "[data-test=proceed]").textContent!.trim()).toBe(t("handover.emergency.proceed"));
    expect(q(el, "[data-test=proceed]").getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=upload-backup]").textContent!.trim()).toBe(
      t("handover.emergency.upload_backup"),
    );
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.keep_open"));
    expect(q(el, ".statements")).toBeNull();
    expect(q(el, "[data-test=emergency-declare]")).toBeNull();
  },
);

it("enables no button but the backup link while catching up, and none while the copy is checked", async () => {
  let open!: () => void;
  const { el, posts } = await mount({
    takes: ["catching-up", "taken"],
    previewGate: new Promise<void>((resolve) => (open = resolve)),
  });
  await signInFields(el);
  q(el, "[data-test=sign-in-password]").click();
  await vi.waitFor(() => expect(posts.some(({ path }) => path.endsWith("/followed"))).toBe(true));
  await el.updateComplete;
  // While it catches up, only the way to a backup instead is offered.
  expect(enabledButtons(el)).toEqual([t("handover.emergency.upload_backup")]);
  catchingUp(el);
  // The take answers taken, and the copy's check waits on its answer.
  await vi.waitFor(
    () => expect(posts.filter(({ path }) => path.endsWith("/preview")).length).toBe(2),
    { timeout: 5000 },
  );
  await el.updateComplete;
  expect(enabledButtons(el)).toEqual([]);
  expect(q(el, "[data-test=upload-backup]")).toBeNull();
  expect([step(el, "follow"), step(el, "check")]).toEqual(["done", "working"]);
  open();
  await vi.waitFor(() => expect(q(el, "[data-test=emergency-copy]")).not.toBeNull());
  expect(enabledButtons(el)).toEqual([
    t("handover.emergency.proceed"),
    t("handover.emergency.upload_backup"),
  ]);
});

it("offers the backup file on Preparing the venue behind its link, never on the sign-in page", async () => {
  const { el } = await mount({ backup: true });
  expect(q(el, 'wt-file-input[name="handover-backup"]')).toBeNull();
  expect(q(el, "[data-test=upload-backup]")).toBeNull();
  await authenticate(el);
  expect(q(el, 'wt-file-input[name="handover-backup"]')).toBeNull();
  q(el, "[data-test=upload-backup]").click();
  await el.updateComplete;
  expect(q(el, 'wt-file-input[name="handover-backup"]')).not.toBeNull();
  expect(q(el, "[data-test=upload-backup]")).toBeNull();
  expect(q(el, '[name="handover-email"]')).toBeNull();
  expect(heading(el)).toBe(t("handover.emergency.preparing_heading"));
});

it.each(["en-GB", "es-ES"])(
  "Proceed opens Ready to switch, whose Switch waits for all three statements and a reason (%s)",
  async (locale) => {
    setLocale(locale);
    const { el } = await mount({ pageUrl: spareSwitchPage(TILL) });
    await authenticate(el);
    await proceed(el);
    expect(heading(el)).toBe(t("handover.emergency.ready_heading"));
    expect(el.shadowRoot!.activeElement).toBe(q(el, "h1"));
    expect(q(el, "[data-test=emergency-copy]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("handover.emergency.latest_activity"));
    expect(q(el, "[data-test=upload-backup]")).toBeNull();
    expect(
      [...el.shadowRoot!.querySelectorAll(".statements label")].map((label) =>
        label.textContent!.trim(),
      ),
    ).toEqual(
      (["sourceSwitchedOff", "noParallelRecovery", "missingTailAccepted"] as const).map(
        (key) => `${t(`handover.emergency.${key}`)} *`,
      ),
    );
    expect(q<HTMLElement & { label: string }>(el, '[name="emergency-reason"]').label).toBe(
      t("handover.emergency.reason"),
    );
    const declare = q<HTMLElement & { disabled: boolean }>(el, "[data-test=emergency-declare]");
    expect(declare.textContent!.trim()).toBe(t("handover.emergency.declare"));
    expect(declare.disabled).toBe(true);
    await edit(el, "emergency-reason", saved.reason);
    const boxes = [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    for (const [index, box] of boxes.entries()) {
      expect(declare.disabled).toBe(true);
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      await el.updateComplete;
      if (index < boxes.length - 1) expect(declare.disabled).toBe(true);
    }
    expect(declare.disabled).toBe(false);
    expect(declare.getAttribute("variant")).toBe("danger");
    await edit(el, "emergency-reason", " ");
    expect(declare.disabled).toBe(true);
    const back = q<HTMLAnchorElement>(el, "[data-test=go-back]");
    expect(back.classList.contains("button")).toBe(true);
    expect(back.getAttribute("href")).toBe(TILL);
    expect(back.textContent!.trim()).toBe(t("handover.emergency.leave_till"));
    expect(q(el, "[data-test=emergency-ready]").getAttribute("data-wording-version")).toBe(
      "a1018-emergency-v2",
    );
  },
);

it.each(["en-GB", "es-ES"])(
  "a page reopened after Switch says the switch is unfinished and asks for a sign-in (%s)",
  async (locale) => {
    setLocale(locale);
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ body: { ...status, waitingReason: null } })),
    );
    const { el } = await mountWidget<SetupHandoverScreen>("setup-handover-screen", {
      api: new SetupApi("", fetcher),
      operationId: saved.operationId,
    });
    await vi.waitFor(() => expect(q(el, '[name="handover-email"]')).not.toBeNull());
    expect(heading(el)).toBe(t("handover.emergency.switching_heading"));
    expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.switching_body"));
    expect(q(el, "[data-test=emergency-preview]").textContent!.trim()).toBe(
      t("handover.emergency.continue"),
    );
  },
);

it.each([
  [spareSwitchPage(TILL), TILL, "handover.emergency.leave_till"],
  [undefined, "/", "handover.emergency.leave"],
] as const)(
  "Preparing the venue always offers Go back as a full-width button (%s)",
  async (pageUrl, href, label) => {
    const { el } = await mount({
      held: true,
      takes: ["catching-up", "restarting"],
      ...(pageUrl ? { pageUrl } : {}),
    });
    const goesBack = () => {
      const back = q<HTMLAnchorElement>(el, ".choices > a.button[data-test=go-back]");
      expect(back.getAttribute("href")).toBe(href);
      expect(back.textContent!.trim()).toBe(t(label));
    };
    await check(el);
    await vi.waitFor(() => catchingUp(el));
    goesBack();
    await vi.waitFor(
      () =>
        expect(el.shadowRoot!.textContent).toContain(t("handover.emergency.followed_restarting")),
      { timeout: 5000 },
    );
    goesBack();
    await vi.waitFor(() => expect(q(el, "[data-test=proceed]")).not.toBeNull(), {
      timeout: 10_000,
    });
    goesBack();
  },
);
