import axe from "axe-core";
import { commands, page } from "vitest/browser";
import { beforeEach, expect, vi, type Mock } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { normaliseDraftLines } from "@waitron/shared";
import type {
  AdjustmentReason,
  Draft,
  DraftLine,
  DraftSave,
  DraftSubmission,
  BillEditState,
  BillDraftSnapshot,
  DraftTakeover,
  PartyDraftSnapshot,
  GroupLine,
  GroupRelease,
  SubmittedDraft,
  SubmittedGroups,
} from "../api/client.js";
import type { DocumentMember, ServedMenu } from "@waitron/catalogue/src/menu-document-types.js";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    // Moves the real cursor off every element, clearing CSS `:hover`. See `parkPointer` in
    // packages/ui/src/vitest-park-pointer.ts for why `userEvent.unhover()` cannot be used for this.
    parkPointer: () => Promise<void>;
  }
}

/**
 * Mounts by ASSIGNING PROPERTIES, where `packages/ui/src/test-helpers.ts` parses an HTML string: till
 * widgets take objects as `@property({ attribute: false })`, which cannot travel through markup.
 */

// Standalone widget fixtures use a Spanish venue; app roots replace this with their API configuration.
beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

/**
 * Starts every test with the mouse cursor off the page, so nothing inherits a `:hover` that an
 * earlier test's click or hover left behind — the cursor belongs to the shared page, not to the test
 * that moved it, and it outlives the file that moved it.
 */
beforeEach(() => commands.parkPointer());

export type Theme = "light" | "dark";

const mounted: HTMLElement[] = [];
const originalUrl = location.href;
const originalHistoryState: unknown = history.state;

/** The element under test plus the themed host it was mounted into (pass the host to axe). */
export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/**
 * Mounts a custom element `tag` with `props` assigned before connection, inside a fresh themed
 * host, and waits for its first render. It paints the host's `--wt-color-bg` as a real deployment
 * does. Pass `theme` to pin `data-theme` so a color-contrast a11y check means what it means in the app;
 * omit it to render in whatever theme the environment resolves to.
 */
export async function mountWidget<T extends HTMLElement>(
  tag: string,
  props: Partial<T>,
  theme?: Theme,
): Promise<Mounted<T>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  host.style.background = "var(--wt-color-bg)";
  paintCanvas(host);
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/**
 * Paints the page canvas as `index.html` does in the app. The harness themes only `host`, and axe
 * composites any element it cannot trace back to `host` (one pushed off-viewport, say) against the page
 * canvas — white by default, a false contrast failure for the dark theme. `<body>`/`<html>` are not theme
 * roots, so the concrete colour is read off `host` rather than passing the `var()`.
 */
function paintCanvas(host: HTMLElement): void {
  const bg = getComputedStyle(host).backgroundColor;
  document.body.style.background = bg;
  document.documentElement.style.background = bg;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
  history.replaceState(originalHistoryState, "", originalUrl);
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

export function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
      return `${violation.id} [${violation.impact}]: ${violation.help}\n  targets: ${targets}`;
    })
    .join("\n\n");
}

/** The trigger's drawn text and the name a screen reader hears, at one viewport width. */
export interface ChooserFace {
  shown: string[];
  name: string;
}

/**
 * Checks what a `wt-language-chooser` trigger draws and is named at 1280 and at 390 wide,
 * restoring the viewport after.
 */
export async function expectChooserFaces(
  chooser: Element,
  expected: { wide: ChooserFace; phone: ChooserFace },
): Promise<void> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const expectFaceAt = async (w: number, face: ChooserFace): Promise<void> => {
    await page.viewport(w, 844);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const trigger = chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!;
    expect(
      [...trigger.querySelectorAll<HTMLElement>("[part]")]
        .filter((part) => getComputedStyle(part).display !== "none")
        .map((part) => (part.querySelector(".code-text") ?? part).textContent!.trim()),
    ).toEqual(face.shown);
    await expect
      .element(page.elementLocator(trigger.shadowRoot!.querySelector("button")!))
      .toHaveAccessibleName(face.name);
  };
  try {
    await expectFaceAt(1280, expected.wide);
    await expectFaceAt(390, expected.phone);
  } finally {
    await page.viewport(width, height);
  }
}

// The reasons in axe's colour-contrast messages (`locales/_template.json`) counted as being about
// the colours themselves. axe 4.14.0 never sets `fgAlpha`.
const UNDECIDED_COLOUR_READINGS = new Set(["equalRatio", "fgAlpha", "colorParse"]);

function undecidedColourReadings(incomplete: axe.Result[]): string[] {
  return incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) =>
      result.nodes.flatMap((node) =>
        node.any
          .filter((check) =>
            UNDECIDED_COLOUR_READINGS.has(
              (check.data as { messageKey?: string } | null)?.messageKey ?? "",
            ),
          )
          .map(
            (check) =>
              `${result.id} [undecided]: ${check.message}\n  targets: ${node.target.join(" ")}`,
          ),
      ),
    );
}

/**
 * Runs the full default axe ruleset against `context` and fails the test on any violation, or on a
 * colour-contrast check axe left undecided for a reason about the colours themselves (`equalRatio`,
 * `fgAlpha`, `colorParse`).
 */
export async function expectNoA11yViolations(context: Element): Promise<void> {
  const results = await axe.run(context);
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
  const colourReadings = undecidedColourReadings(results.incomplete);
  expect(colourReadings, colourReadings.join("\n\n")).toEqual([]);
}

type ServedFields = Pick<ServedMenu, "structure" | "home" | "orderable" | "sendable" | "audience">;

/** An offer a {@link servedMenus} structure lists; with `section`, inside a section of that name. */
export interface ServedOffer {
  id: string;
  menuId: string;
  productId: string;
  section?: string;
}

/**
 * Gives each menu what a zone-offers body serves beside it: a structure listing that menu's own
 * offers in order, a section placed where its first offer falls, and a Device Home Page at the
 * default display settings with no shortcuts, so a menu browser shows each offer once. With
 * `shortcuts`, each menu's shortcuts are its offers.
 */
export function servedMenus<M extends { id: string }>(
  menus: readonly M[],
  offers: readonly ServedOffer[],
  { shortcuts = false }: { shortcuts?: boolean } = {},
): (M & ServedFields)[] {
  return menus.map((menu) => {
    const own = offers.filter((offer) => offer.menuId === menu.id);
    const members: DocumentMember[] = [];
    for (const offer of own) {
      const placed: DocumentMember = {
        kind: "product",
        menuItemId: offer.id,
        productId: offer.productId,
      };
      if (offer.section === undefined) {
        members.push(placed);
        continue;
      }
      const sectionId = `${menu.id}/${offer.section}`;
      let section = members.find(
        (member): member is Extract<DocumentMember, { kind: "section" }> =>
          member.kind === "section" && member.sectionId === sectionId,
      );
      if (section === undefined) {
        section = {
          kind: "section",
          sectionId,
          internalName: offer.section,
          names: { en: offer.section },
          image: null,
          color: null,
          members: [],
        };
        members.push(section);
      }
      section.members.push(placed);
    }
    return {
      orderable: true,
      sendable: true,
      audience: "customer",
      ...menu,
      structure: { members },
      home: {
        shortcuts: shortcuts
          ? own.map((offer) => ({ kind: "product" as const, productId: offer.productId }))
          : [],
        handheld: HOME_DISPLAY_DEFAULTS.handheld,
        till: HOME_DISPLAY_DEFAULTS.till,
      },
    };
  });
}

/** A submitted group with its lines read back from the drafts they were saved in, each in the shape
 * a group submission carries: a null or empty field left out. */
export interface SentGroup {
  release: GroupRelease;
  lines: GroupLine[];
}

function asGroupLine(line: DraftLine): GroupLine {
  if (line.sourceLineId != null)
    throw { code: "management.request_invalid", status: 400, field: "sourceLineId" };
  return {
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    ...(line.variantId === null ? {} : { variantId: line.variantId }),
    ...(line.menuVersionId === null ? {} : { menuVersionId: line.menuVersionId }),
    ...(line.options.length === 0 ? {} : { options: line.options }),
    ...(line.extras.length === 0 ? {} : { extras: line.extras }),
    ...(line.note === null ? {} : { note: line.note }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
  };
}

/** Submission assertions read that revision's rows even after later saves. */
export function draftSnapshot(draft: Draft): BillDraftSnapshot {
  return {
    draft,
    edit: {
      billId: draft.billId,
      editorId: draft.ownerId,
      editorName: draft.ownerName,
      editorVersion: 1,
      draftId: draft.id,
      draftRevision: draft.revision,
    },
  };
}

export function partyDraftSnapshot(drafts: Draft[]): PartyDraftSnapshot {
  return { drafts, billEdits: drafts.map((draft) => draftSnapshot(draft).edit) };
}

export function draftServer(
  answer: (partyId: string) => SubmittedGroups = () => ({
    tabId: "wo-4",
    revision: 4,
    groups: [],
  }),
) {
  let ids = 0;
  const versions = new Map<string, number>();
  const observed = new Map<string, { editorId: string | null; draftId: string | null }>();
  const replies = new Map<string, SubmittedDraft>();
  const clone = <T>(value: T): T => structuredClone(value);
  const rowsAtRevision = new Map<number, Map<string, DraftLine>>();
  const remember = (draft: Draft): void => {
    const rows = rowsAtRevision.get(draft.revision) ?? new Map<string, DraftLine>();
    for (const line of draft.lines) rows.set(line.id, clone(line));
    rowsAtRevision.set(draft.revision, rows);
  };
  const reidentify = (lines: DraftSave["lines"]): DraftLine[] =>
    normaliseDraftLines(
      lines.map((line) => (line.sourceLineId != null ? { ...line, noMerge: true as const } : line)),
    ).map((line) => {
      let saved: DraftLine;
      if (line.sourceLineId != null) {
        const prior =
          server.linesById.get(line.id) ??
          server.drafts.flatMap((draft) => draft.lines).find((row) => row.id === line.id);
        if (prior?.sourceLineId !== line.sourceLineId)
          throw { code: "management.request_invalid", status: 400, field: "sourceLineId" };
        saved = {
          ...prior,
          quantity: line.quantity,
          note: line.note,
          courseId: line.courseId,
          makeAt: line.makeAt,
          slot: line.slot,
          joinGroupId: line.joinGroupId,
          afterGroupId: line.afterGroupId,
          noMerge: true,
          unavailable: false,
        };
      } else {
        saved = {
          ...line,
          sourceLineId: null,
          source: null,
          id: line.id ?? `line-${++ids}`,
          unavailable: false,
        };
      }
      server.linesById.set(saved.id, saved);
      return saved;
    });
  const server = {
    personId: "p1",
    personName: "Ana",
    drafts: [] as Draft[],
    linesById: new Map<string, DraftLine>(),
    /** The menu items the server reads as unavailable when it answers a line. */
    unavailable: new Set<string>(),
    answer,
    bills: new Set(["wo-4", "wo-check", "bill-1"]),
    edit(billId: string): BillEditState {
      const draft = server.drafts.find(
        (draft) => draft.billId === billId && draft.lines.length > 0,
      );
      const prior = observed.get(billId);
      const current = { editorId: draft?.ownerId ?? null, draftId: draft?.id ?? null };
      if (
        prior !== undefined &&
        (prior.editorId !== current.editorId || prior.draftId !== current.draftId)
      )
        versions.set(billId, (versions.get(billId) ?? (prior.editorId === null ? 0 : 1)) + 1);
      observed.set(billId, current);
      return {
        billId,
        editorId: draft?.ownerId ?? null,
        editorName: draft?.ownerName ?? null,
        editorVersion: versions.get(billId) ?? (draft === undefined ? 0 : 1),
        draftId: draft?.id ?? null,
        draftRevision: draft?.revision ?? null,
      };
    },
    snapshot(draft: Draft | null, billId = draft!.billId): BillDraftSnapshot {
      return { draft: server.flagged(clone(draft)), edit: server.edit(billId) };
    },
    listDrafts: vi.fn(async (partyId: string) => ({
      drafts: server.flagged(clone(server.drafts.filter((draft) => draft.partyId === partyId))),
      billEdits: [...new Set([...server.bills, ...server.drafts.map((draft) => draft.billId)])].map(
        (id) => server.edit(id),
      ),
    })),
    saveDraft: vi.fn(async (partyId: string, save: DraftSave) => {
      server.compare(save.billId, save.expectedEdit);
      const before = server.edit(save.billId);
      if (save.lines.length === 0 && before.draftId === null)
        return server.snapshot(null, save.billId);
      const draft = server.save(partyId, save);
      if (draft.lines.length === 0) {
        server.drafts.splice(server.drafts.indexOf(draft), 1);
        return server.snapshot(null, save.billId);
      }
      return server.snapshot(draft);
    }),
    submitDraft: vi.fn(async (partyId: string, draftId: string, submission: DraftSubmission) =>
      clone(server.apply(partyId, draftId, submission)),
    ),
    takeOverDraft: vi.fn(async (partyId: string, draftId: string, ask: DraftTakeover) => {
      const edit = server.edit(ask.expectedEdit.billId);
      server.compare(edit.billId, ask.expectedEdit, true);
      const draft = server.takeOver(partyId, draftId, ask.revision);
      return server.snapshot(draft);
    }),
    compare(billId: string, expected: DraftSave["expectedEdit"], takeover = false): void {
      const edit = server.edit(billId);
      if (!takeover && edit.editorId !== null && edit.editorId !== server.personId)
        throw {
          code: "draft.taken_over",
          status: 409,
          billId,
          draftId: edit.draftId,
          ownerId: edit.editorId,
          ownerName: edit.editorName,
          edit,
        };
      if (
        expected.editorVersion !== edit.editorVersion ||
        expected.draftId !== edit.draftId ||
        expected.draftRevision !== edit.draftRevision
      )
        throw {
          code: "draft.out_of_date",
          status: 409,
          billId,
          draftId: edit.draftId,
          revision: edit.draftRevision,
          edit,
        };
    },
    /** `unavailable` worked out on each answer, as the server does, never stored. */
    flagged<T extends Draft | Draft[] | null>(answer: T): T {
      for (const draft of answer === null ? [] : Array.isArray(answer) ? answer : [answer])
        for (const line of draft.lines)
          if (line.sourceLineId === null)
            line.unavailable = server.unavailable.has(line.menuItemId);
      return answer;
    },
    save(partyId: string, save: Omit<DraftSave, "expectedEdit">): Draft {
      const own = server.drafts.find(
        (draft) =>
          draft.partyId === partyId &&
          draft.ownerId === server.personId &&
          draft.billId === save.billId,
      );
      let draft: Draft;
      if (save.draftId === null) {
        if (own !== undefined) throw refusal("draft.out_of_date", own);
        draft = {
          id: `draft-${++ids}`,
          partyId,
          billId: save.billId,
          ownerId: server.personId,
          ownerName: server.personName,
          revision: 0,
          lines: [],
          takenOverFrom: null,
        };
        server.drafts.push(draft);
      } else {
        draft = server.open(partyId, save.draftId, save.revision);
      }
      draft.revision += 1;
      draft.lines = reidentify(save.lines);
      remember(draft);
      return draft;
    },
    takeOver(partyId: string, draftId: string, revision: number): Draft {
      const draft = server.drafts.find(
        (candidate) => candidate.id === draftId && candidate.partyId === partyId,
      );
      if (draft === undefined) throw { code: "draft.not_found", status: 404, draftId };
      if (draft.ownerId === server.personId) return draft;
      if (draft.revision !== revision) throw refusal("draft.out_of_date", draft);
      draft.takenOverFrom = { personId: draft.ownerId, name: draft.ownerName };
      draft.ownerId = server.personId;
      draft.ownerName = server.personName;
      draft.revision += 1;
      remember(draft);
      return draft;
    },
    /** A submission as the server takes it, whether or not its answer reaches the till. */
    apply(partyId: string, draftId: string, submission: DraftSubmission): SubmittedDraft {
      const replay = replies.get(submission.submissionId);
      if (replay !== undefined) return replay;
      const draft = server.open(partyId, draftId, submission.draftRevision);
      const named = submission.groups.flatMap((group) => group.lineIds);
      if (!named.every((id) => draft.lines.some((line) => line.id === id)))
        throw { code: "management.request_invalid", status: 400, field: "groups" };
      draft.lines = draft.lines.filter((line) => !named.includes(line.id));
      draft.revision += 1;
      remember(draft);
      if (draft.lines.length === 0) server.drafts.splice(server.drafts.indexOf(draft), 1);
      const reply = {
        ...server.answer(partyId),
        edit: server.edit(draft.billId),
        draft: draft.lines.length === 0 ? null : server.flagged(clone(draft)),
      };
      replies.set(submission.submissionId, reply);
      return reply;
    },
    open(partyId: string, draftId: string, revision: number): Draft {
      const draft = server.drafts.find(
        (candidate) => candidate.id === draftId && candidate.partyId === partyId,
      );
      if (draft === undefined) throw { code: "draft.not_found", status: 404 };
      if (draft.ownerId !== server.personId)
        throw {
          code: "draft.taken_over",
          status: 409,
          draftId,
          ownerId: draft.ownerId,
          ownerName: draft.ownerName,
        };
      if (draft.revision !== revision) throw refusal("draft.out_of_date", draft);
      return draft;
    },
    /** The groups a submission sent, their lines read back by id. */
    sentGroups(submission: DraftSubmission): SentGroup[] {
      return submission.groups.map((group) => ({
        release: group.release,
        lines: group.lineIds.map((id) =>
          asGroupLine(
            rowsAtRevision.get(submission.draftRevision)?.get(id) ?? server.linesById.get(id)!,
          ),
        ),
      }));
    },
  };
  return server;
}

function refusal(code: string, draft: Draft) {
  return { code, status: 409, draftId: draft.id, revision: draft.revision };
}

export type DraftServer = ReturnType<typeof draftServer>;

/** A reason that allows a cancel and needs nobody's approval. */
export const cancelReason: AdjustmentReason = {
  id: "r-cancel",
  name: "Mistake",
  actions: ["cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "staff",
  approverRole: "staff",
};

/** An app API stub's adjustment calls: the cancel reason, a preview nobody need approve, and an
 * apply answering the party at `partyRevision`. */
export function adjustmentStubs(
  partyRevision = 4,
): Record<"listAdjustmentReasons" | "previewAdjustment" | "applyAdjustment", Mock> {
  return {
    listAdjustmentReasons: vi.fn().mockResolvedValue([cancelReason]),
    previewAdjustment: vi.fn().mockResolvedValue({
      reduction: "1.00",
      nominalValue: "1.00",
      needsApproval: null,
      lines: [],
    }),
    applyAdjustment: vi.fn().mockResolvedValue({
      adjustmentIds: ["a-1"],
      revision: 1,
      party: { id: "v1", revision: partyRevision },
    }),
  };
}

function emitFrom(source: Element, type: string, detail: unknown = {}): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/**
 * Cancels line `lineId` of the app's open order as a waiter does: the table screen asks for the
 * cancel dialog, {@link cancelReason} is chosen and previewed, then confirmed unless the preview
 * was refused. `quantity` "1" takes one unit of several. `settle` lets the app finish each step's
 * requests.
 */
export async function cancelThroughDialog(
  app: HTMLElement,
  screen: Element,
  lineId: string,
  settle: () => Promise<void>,
  quantity?: "1",
): Promise<void> {
  const target = {
    lineId,
    name: lineId,
    quantity: quantity === undefined ? "1" : "2",
    total: "2.00",
    unitTotal: quantity === undefined ? null : "1.00",
  };
  emitFrom(screen, "adjust", { kind: "cancel", target });
  await settle();
  const dialog = app.shadowRoot!.querySelector("till-adjustment-dialog")!;
  expect(dialog).not.toBeNull();
  const choice = { action: "cancel", reasonId: cancelReason.id, note: null };
  emitFrom(dialog, "adjust-preview", quantity === undefined ? choice : { ...choice, quantity });
  await settle();
  // A refused preview leaves the dialog on its form, where there is nothing to confirm.
  if ((dialog as HTMLElement & { preview: unknown }).preview === null) return;
  emitFrom(dialog, "adjust-confirm");
  await settle();
}

const placeholderInput = (el: HTMLElement) =>
  el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;

/** Measured with the page's own layout, not the window's canvas: a span in the placeholder's font
 * and letter spacing, against the field's unrounded box less its borders and padding. */
export function drawn(el: HTMLElement) {
  const input = placeholderInput(el);
  const control = getComputedStyle(input);
  const placeholder = getComputedStyle(input, "::placeholder");
  const px = (value: string) => parseFloat(value);
  return {
    placeholder: input.placeholder,
    width(text: string): number {
      const probe = document.createElement("span");
      probe.style.cssText = "position: absolute; visibility: hidden; white-space: pre";
      probe.style.font = placeholder.font;
      probe.style.letterSpacing = placeholder.letterSpacing;
      probe.textContent = text;
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    },
    textBox:
      input.getBoundingClientRect().width -
      px(control.borderLeftWidth) -
      px(control.borderRightWidth) -
      px(control.paddingLeft) -
      px(control.paddingRight),
  };
}

/** Adds a placeholder rule inside the `wt-input`'s own shadow tree. */
export function stylePlaceholder(el: HTMLElement, rule: string): void {
  const style = document.createElement("style");
  style.textContent = `.field-control::placeholder { ${rule} }`;
  el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.append(style);
}

/** A ResizeObserver reports after the frame's animation callbacks, so this waits two frames. */
export async function measured(): Promise<void> {
  for (let frame = 0; frame < 2; frame++)
    await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Presses the floor's List/Map toggle: the toolbar's button, or on a phone the zone menu's item. */
export async function toggleFloorView(
  floor: HTMLElement & { updateComplete: Promise<unknown> },
): Promise<void> {
  const root = floor.shadowRoot!;
  const toggle =
    root.querySelector<HTMLElement>("[data-view-toggle]") ??
    root
      .querySelector("till-floor-zone-menu")!
      .shadowRoot!.querySelector<HTMLElement>('[data-menu-item="view"]')!;
  toggle.click();
  await floor.updateComplete;
}
