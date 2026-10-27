import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  currentContentLanguages,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  subscribeContentLanguages,
  visuallyHiddenStyles,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import {
  MONEY_SCALE,
  decimal,
  foldForSearch,
  textSearch,
  toScale,
  type AppError,
  type TextSearch,
} from "@waitron/shared";
import {
  fixedLanguages,
  parseMenuPatch,
  patchFieldValue,
} from "@waitron/catalogue/src/menu-patch.js";
import type { MenuDocument } from "@waitron/catalogue/src/menu-document-types.js";
import { PATCH_FIELDS } from "@waitron/catalogue/src/menu-patch-types.js";
import { VAT_CLASSES, localToday, vatRateOn } from "@waitron/catalogue/src/vat-rates.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  LiveMenu,
  LocalTime,
  MenuPatchChange,
  MenuPatchResult,
  MenuPatchTarget,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { vatClassName } from "../i18n/domain.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  languageText,
  optionalTextFields,
  priceField,
  textField,
  type FieldContext,
} from "./form-fields.js";
import "./image-upload.js";
import type { ImageUploader } from "./image-upload.js";
import { MenuPatchDraft, patchTree, targetKey, type PatchTreeNode } from "./menu-patch-draft.js";
import {
  changeLines,
  itemNames,
  placeRefusal,
  refusalWords,
  reviewNotes,
  type Refusal,
} from "./menu-patch-review.js";
import { conjunctionList } from "../i18n/list.js";
import { localTimeWords } from "./menu-publications.js";

const TRANSLATED = new Set(["customerName", "names", "description"]);

/** The input name each patch field is drawn under; a translated one adds `-<language>`. */
const INPUT_NAMES: Record<string, string> = {
  name: "name",
  internalName: "internal-name",
  customerName: "customer-name",
  names: "names",
  kitchenName: "kitchen-name",
  description: "description",
  price: "price",
  vatClass: "tax",
};

function refusalText(field: string, error: unknown): string {
  if (field === "name") return t("editor.name_required");
  if (field === "internalName") return t("sections.internal_name_required");
  if (field === "price") return t("editor.price_invalid");
  return codeMessage(
    (error as AppError<"menu_patch.invalid">).params.reason ?? "menu_patch.invalid",
  );
}

interface Typed {
  target: MenuPatchTarget;
  value: unknown;
  /** The form's own check's sentence, or a refused send's when `refused`; "" when neither. */
  error: string;
  language: string | null;
  /** Whether `error` is a refused send's: its change stays staged, and it never holds back
   * Review. */
  refused: boolean;
}

/** The first language whose text alone the patch's parser refuses, else the first language: a
 * refusal from merging with the stored text names no language. */
function refusedLanguage(
  target: MenuPatchTarget,
  field: string,
  value: Record<string, string>,
): string {
  const languages = Object.keys(value);
  return (
    languages.find((language) => {
      try {
        parseMenuPatch([{ target, field, value: { [language]: value[language] } }]);
        return false;
      } catch {
        return true;
      }
    }) ?? languages[0]!
  );
}

/** One edited field, as the draft scope compares them. */
interface Edit {
  key: string;
  value: unknown;
}

const changeKey = (change: MenuPatchChange) => `${targetKey(change.target)}/${change.field}`;

/** The target key of a `changeKey`; field names hold no "/". */
const targetOf = (key: string) => key.slice(0, key.lastIndexOf("/"));

function matching(nodes: readonly PatchTreeNode[], search: TextSearch): PatchTreeNode[] {
  return nodes.flatMap((node) => {
    if (search.rank(foldForSearch(node.label)) !== undefined) return [node];
    const children = matching(node.children, search);
    return children.length === 0 ? [] : [{ ...node, children }];
  });
}

function findNode(nodes: readonly PatchTreeNode[], key: string): PatchTreeNode | undefined {
  for (const node of nodes) {
    if (node.target !== null && targetKey(node.target) === key) return node;
    const found = findNode(node.children, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Patches the live version of one menu: a tree of what the version holds, a search narrowing it,
 * and the picked item's form, which shows only the fields a patch may change. Each value is
 * checked by the patch's own parser before it is staged.
 *
 * @fires wt-menu-patched - `detail` is the `MenuPatchResult`, after a patch is put live.
 */
@customElement("dashboard-menu-patch-dialog")
export class MenuPatchDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-5);
      }
      .side {
        display: grid;
        gap: var(--wt-space-3);
        flex: 1 1 calc(var(--wt-field-max-width) / 2);
        min-width: 0;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        flex: 2 1 var(--wt-field-max-width);
        min-width: 0;
      }
      h3 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      h4 {
        margin: 0;
        font-size: var(--wt-font-size-md);
      }
      ul {
        list-style: none;
        margin: 0;
        padding-inline-start: var(--wt-space-4);
      }
      nav > ul {
        padding-inline-start: 0;
      }
      /* The tree scrolls in its own box, so a pick low in it leaves the form beside it in view. A
         dish's form can be taller than the dialog, so the form is not the part held in place. */
      nav {
        max-block-size: calc(var(--wt-tap-min) * 12);
        overflow: auto;
        scrollbar-gutter: stable;
        /* Room for a row's focus ring, which the scrolling box would otherwise clip, also when a
           row is scrolled to its edge. */
        padding: var(--wt-space-1);
        scroll-padding: var(--wt-space-1);
        margin-inline: calc(-1 * var(--wt-space-1));
      }
      .group {
        display: block;
        padding: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-medium);
      }
      .node,
      .link {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: 0 var(--wt-space-2);
        border: 0;
        border-radius: var(--wt-radius-sm);
        background: none;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .node {
        width: 100%;
      }
      .node[aria-current="true"] {
        background: var(--wt-color-surface-sunken);
        font-weight: var(--wt-font-weight-bold);
      }
      .link {
        color: var(--wt-color-primary-text);
        text-decoration: underline;
      }
      .dot {
        flex: none;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
      }
      .flag {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }
      .hidden {
        ${visuallyHiddenStyles}
      }
      .note,
      .message {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .locked {
        display: grid;
        gap: var(--wt-space-1);
      }
      .locked-note {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .review {
        display: grid;
        gap: var(--wt-space-3);
      }
      .changes {
        display: grid;
        gap: var(--wt-space-2);
        padding-inline-start: var(--wt-space-5);
        list-style: disc;
      }
      .error {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-3);
        margin: 0;
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property() menuName = "";
  @property({ type: Boolean }) open = false;

  @state() private live: LiveMenu | null = null;
  @state() private notPublished = false;
  @state() private readError: string | null = null;
  @state() private search = "";
  @state() private picked: string | null = null;
  @state() private step: "edit" | "review" = "edit";
  @state() private busy = false;
  /** A refusal that names no field the form shows. */
  @state() private refusal: Refusal | null = null;
  /** Why the last Reload failed, shown beside the refusal that offered it. */
  @state() private reloadFailure: string | null = null;
  /** How many staged changes newer live versions have dropped since the dialog opened. */
  @state() private dropped = 0;
  /** The `changeKey`s of the changes that have let go of typed text in a language removed since the
   * dialog opened. */
  @state() private trimmed = new Set<string>();
  @state() private queued: LocalTime[] = [];
  /** The newest live version delivered while the draft held work; the draft stays on `live` until
   * Reload, or until a later delivery finds nothing staged and no field failing its check. */
  @state() private newer: LiveMenu | null = null;

  #draft: MenuPatchDraft | null = null;
  /** Whether Review has been pressed since the dialog opened: until then no field shows its own
   * check's error. */
  #pressed = false;
  /** What each field shows, keyed `<target key>/<field>`, once the person has edited it: their own
   * text, so a refresh never replaces it, with its error and, for a translated field, the language
   * the error belongs under. A value failing its own check is not staged. */
  #typed = new Map<string, Typed>();
  #watching: string | null = null;
  /** A live version or language change that arrived while a patch was being sent. Applying it then
   * could drop a change the answer's refusal still has to place, so it waits for the answer. */
  #held: { answer?: LiveMenu | null; languages: boolean; reload?: boolean } | null = null;
  /** The `changeKey` of the change a bottom "no longer fits" refusal names. */
  #refusedKey: string | null = null;
  #scope: DraftScope<Edit[]> | undefined;
  #leave: LeaveCoordinator | undefined;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  /** Replaced whenever the dialog opens or closes, so an answer to an earlier opening is ignored. */
  #session = {};
  #taxCache: { key: string; options: { value: string; label: string }[] } | null = null;
  #imageApi: { api: DashboardApi; uploader: ImageUploader } | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeOf(error);
    },
    () => {
      this.readError = null;
    },
  );

  constructor() {
    super();
    new LocaleChangeController(this);
    new ContentLanguageController(this);
    // The venue's content languages decide what a patch may hold, so the draft follows them.
    let unsubscribe: (() => void) | undefined;
    this.addController({
      hostConnected: () => {
        unsubscribe = subscribeContentLanguages(() => {
          if (this.live === null) return;
          if (this.busy) this.#held = { ...this.#held, languages: true };
          else this.#revalidate();
        });
      },
      hostDisconnected: () => unsubscribe!(),
    });
  }

  /** The staged changes, as a save would send them. */
  get changes(): MenuPatchChange[] {
    return this.#draft?.changes() ?? [];
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") || changed.has("menuId")) this.#follow();
    this.#takeScope();
  }

  /** Taken only while on the page: disposing the scope redraws the dialog, and a scope taken while
   * detached is not the page's to ask about. */
  #takeScope(): void {
    if (this.#scope !== undefined || this.#watching === null || !this.isConnected) return;
    const { coordinator, scope } = draftScopeFor<Edit[]>(this, {
      id: this,
      current: () => this.#current(),
      snapshot: (value) => structuredClone(value),
      equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      restore: () => this.#discard(),
    });
    // The baseline is always no changes, also for edits made before the dialog was put back.
    scope.commit([]);
    this.#scope = scope;
    this.#leave = coordinator;
  }

  #follow(): void {
    const wanted = this.open && this.menuId !== "" ? this.menuId : null;
    if (wanted === this.#watching) return;
    this.#queries.release("getLiveMenu");
    this.#queries.release("getMenuPublications");
    this.#watching = wanted;
    this.#session = {};
    this.live = null;
    this.notPublished = false;
    this.readError = null;
    this.search = "";
    this.picked = null;
    this.step = "edit";
    this.busy = false;
    this.refusal = null;
    this.reloadFailure = null;
    this.dropped = 0;
    this.trimmed = new Set();
    this.queued = [];
    this.newer = null;
    this.#held = null;
    this.#refusedKey = null;
    this.#draft = null;
    this.#pressed = false;
    this.#typed = new Map();
    this.#releaseScope();
    if (wanted !== null) void this.#load(wanted);
  }

  #releaseScope(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }

  /** Each edited field — staged, or holding text its own check refuses — in a fixed order, so two
   * drafts holding the same edits compare equal. */
  #current(): Edit[] {
    const staged = this.changes.map((change) => ({ key: changeKey(change), value: change.value }));
    const failing = this.#failing().map(([key, typed]) => ({ key, value: typed.value }));
    return [...staged, ...failing].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** The baseline is always no changes: the scope starts on an empty draft and the dialog closes
   * once it commits. */
  #discard(): void {
    this.#draft = new MenuPatchDraft(this.live!.document, currentContentLanguages());
    this.#pressed = false;
    this.#typed = new Map();
    this.step = "edit";
    this.requestUpdate();
  }

  async #load(menuId: string): Promise<void> {
    this.readError = null;
    // Each query's error callback records its own failure.
    await Promise.all([
      this.#queries
        .watch("getLiveMenu", [menuId], (answer) => this.#applyLive(answer))
        .catch(() => undefined),
      this.#queries
        .watch("getMenuPublications", [menuId], (answer) => {
          this.queued = answer.editions
            .filter((edition) => edition.state === "queued")
            .map((edition) => edition.local);
        })
        .catch(() => undefined),
    ]);
  }

  /** Takes a live read from the subscription or, with `reload`, from Reload, which moves the draft
   * even when it holds work. A later live version has a higher number (`nextNumber`,
   * `refuseOvertaken` and `requeueAfter`, `packages/catalogue/src/menu-publication.ts`), so an
   * answer numbered below the newest one known is a late read and is ignored. */
  #applyLive(answer: LiveMenu | null, reload = false): void {
    if (this.busy) {
      const held = this.#held;
      const late = answer !== null && held?.answer != null && answer.number < held.answer.number;
      this.#held = {
        languages: false,
        ...held,
        ...(late ? {} : { answer }),
        reload: held?.reload === true || reload,
      };
      return;
    }
    if (answer === null) {
      this.notPublished = true;
      return;
    }
    this.notPublished = false;
    if (this.#draft === null) {
      this.#draft = new MenuPatchDraft(answer.document, currentContentLanguages());
      this.live = answer;
      return;
    }
    const offered =
      this.refusal?.code === "menu_patch.base_changed"
        ? (this.refusal.params.liveNumber as number)
        : 0;
    if (answer.number > Math.max(this.newer?.number ?? 0, this.live!.number, offered))
      this.reloadFailure = null;
    const newest = this.newer !== null && this.newer.number > answer.number ? this.newer : answer;
    if (newest.number > this.live!.number) {
      if (!reload && (this.changes.length > 0 || this.#hasErrors())) {
        this.newer = newest;
        return;
      }
      // A failed Reload offered the version a refused send named, and the refusal still stands
      // while the draft is short of it.
      if (newest.number >= offered) {
        this.reloadFailure = null;
        if (this.refusal?.code === "menu_patch.base_changed") this.refusal = null;
      }
      this.newer = null;
      this.live = newest;
    } else if (!reload) return;
    // Reload checks the draft again even on the version shown: the venue's languages may differ.
    this.#revalidate();
  }

  /** Checks the draft against the shown version with the venue's content languages as they are. */
  #revalidate(): void {
    const { document } = this.live!;
    const { dropped, trimmed } = this.#draft!.rebase(document, currentContentLanguages());
    this.dropped += dropped;
    if (trimmed.length > 0) this.trimmed = new Set([...this.trimmed, ...trimmed]);
    this.#typeSettled();
    this.dropped += this.#forgetSettled(document);
    this.#retireRefusal();
    this.#scope?.changed();
    this.requestUpdate();
  }

  /** After a rebase a staged translated change can hold text the person did not type (stored text
   * in a language they left alone, or a fixed name), so its field takes the change's text and shows
   * what a send carries. */
  #typeSettled(): void {
    const languages = currentContentLanguages();
    for (const change of this.#draft!.changes()) {
      const typed = this.#typed.get(changeKey(change));
      if (!TRANSLATED.has(change.field) || typed === undefined) continue;
      const value = change.value as Record<string, string>;
      typed.value = Object.fromEntries(
        languages.languages.map((language) => [language, value[language] ?? ""]),
      );
    }
  }

  /** A "no longer fits" refusal goes once the change it names is no longer staged. */
  #retireRefusal(): void {
    if (
      this.refusal?.code === "menu_patch.invalid" &&
      !this.#draft!.changes().some((change) => changeKey(change) === this.#refusedKey)
    )
      this.refusal = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The query controller released the watch when the dialog left the page; the draft stays.
    if (this.#watching !== null) void this.#load(this.#watching);
    // Lit runs no update on reconnect, and the scope is taken in one.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#releaseScope();
    super.disconnectedCallback();
  }

  /** After a rebase, a field neither staged nor failing its check shows the newer live value again.
   * A failing field the form can no longer draw is forgotten too, or nothing could clear it;
   * returns how many of those there were. A refusal the form can no longer draw goes, and its
   * change stays staged. */
  #forgetSettled(document: MenuDocument): number {
    const staged = new Set(this.#draft!.changes().map(changeKey));
    const items = itemNames(document);
    const languages = currentContentLanguages();
    let lost = 0;
    for (const [key, typed] of this.#typed) {
      const drawn =
        items.has(targetOf(key)) &&
        patchFieldValue(document, typed.target, key.slice(key.lastIndexOf("/") + 1), languages) !==
          undefined &&
        (typed.language === null || languages.languages.includes(typed.language));
      if (typed.refused) {
        // A refused change is staged, so the rebase does any counting.
        if (!staged.has(key)) this.#typed.delete(key);
        else if (!drawn) Object.assign(typed, { error: "", language: null, refused: false });
        continue;
      }
      if (typed.error !== "" && !drawn) lost += 1;
      if (!staged.has(key) && (!drawn || typed.error === "")) this.#typed.delete(key);
    }
    return lost;
  }

  /** The sentence a field shows: a refusal's at once, its own check's once Review was pressed. */
  #shownError(typed: Typed | undefined): string {
    return typed !== undefined && (typed.refused || this.#pressed) ? typed.error : "";
  }

  /** The target keys of the items holding a field that shows an error, in the order edited. */
  #keysToCorrect(): string[] {
    const keys = [...this.#typed]
      .filter(([, typed]) => this.#shownError(typed) !== "")
      .map(([key]) => targetOf(key));
    return [...new Set(keys)];
  }

  #itemsToCorrect(): string[] {
    const items = itemNames(this.live!.document);
    return this.#keysToCorrect().map((key) => items.get(key)!);
  }

  #close(): void {
    this.open = false;
  }

  /** The fields failing the form's own check, in the order edited; a refusal is not one. */
  #failing(): [string, Typed][] {
    return [...this.#typed].filter(([, typed]) => typed.error !== "" && !typed.refused);
  }

  #hasErrors(): boolean {
    return this.#failing().length > 0;
  }

  /** Review is held back only by an unchanged draft or, once pressed, by the form's own checks. */
  #reviewBlocked(): boolean {
    return saveActionState(this.#scope).unchanged || (this.#pressed && this.#hasErrors());
  }

  async #review(): Promise<void> {
    if (this.#reviewBlocked()) return;
    this.#pressed = true;
    this.requestUpdate();
    if (!this.#hasErrors()) return this.#toStep("review", "h3");
    const failing = this.#failing();
    if (!failing.some(([key]) => targetOf(key) === this.picked))
      this.picked = targetOf(failing[0]![0]);
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector('[data-test="form"]')!);
  }

  /** The button pressed to change step is gone afterwards; without a new focus inside the dialog,
   * Escape and Tab start from the page behind it. */
  async #toStep(step: "edit" | "review", focus: string): Promise<void> {
    this.step = step;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(focus)?.focus();
  }

  async #putLive(): Promise<void> {
    if (this.busy || saveActionState(this.#scope).unchanged) return;
    const session = this.#session;
    const sent = this.changes;
    const submitted = this.#current();
    this.busy = true;
    this.refusal = null;
    this.reloadFailure = null;
    for (const typed of this.#typed.values())
      if (typed.refused) Object.assign(typed, { error: "", language: null, refused: false });
    const outcome = await this.api
      .patchLiveMenu(this.menuId, { baseVersionId: this.live!.versionId, changes: sent })
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
    if (session !== this.#session) return;
    this.busy = false;
    if ("error" in outcome) {
      const onField = await this.#refused(outcome.error, sent);
      const held = this.#held;
      this.#held = null;
      if (held?.languages) this.#revalidate();
      if (held?.answer === undefined) return;
      if (held.reload) await this.#reloaded(held.answer, !onField);
      else this.#applyLive(held.answer);
      return;
    }
    this.#scope?.commit(submitted);
    this.dispatchEvent(
      new CustomEvent("wt-menu-patched", { detail: outcome.result, bubbles: true, composed: true }),
    );
    this.renderRoot.querySelector("wt-modal")!.closeAfter("saved");
    this.#close();
  }

  /** Returns whether the refusal went under a field, which then has focus. */
  async #refused(error: unknown, sent: readonly MenuPatchChange[]): Promise<boolean> {
    const placed = placeRefusal(error, sent);
    if ("refusal" in placed) {
      this.refusal = placed.refusal;
      const named = sent[placed.refusal.params.change as number];
      this.#refusedKey =
        placed.refusal.code === "menu_patch.invalid" && named !== undefined
          ? changeKey(named)
          : null;
      return false;
    }
    const { change, message } = placed;
    // Every staged change was typed into its field.
    Object.assign(this.#typed.get(changeKey(change))!, {
      error: message,
      language: TRANSLATED.has(change.field)
        ? refusedLanguage(change.target, change.field, change.value as Record<string, string>)
        : null,
      refused: true,
    });
    this.picked = targetKey(change.target);
    this.step = "edit";
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector('[data-test="form"]')!);
    return true;
  }

  /** Moves the draft onto the newest live version known: the one read now, or a newer one the
   * subscription delivered while the read was out. */
  async #reload(): Promise<void> {
    const session = this.#session;
    const read = await this.api.getLiveMenu(this.menuId).then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error }),
    );
    if (session !== this.#session) return;
    if ("error" in read) {
      this.reloadFailure = codeOf(read.error);
      return;
    }
    // A read answered during a send waits for the send's answer, still as a Reload.
    if (this.busy) this.#applyLive(read.answer, true);
    else {
      this.refusal = null;
      await this.#reloaded(read.answer);
    }
  }

  /** The Reload button is usually gone afterwards, so with `focus` focus moves to Review, or to
   * Close while Review is unavailable. Without it, focus stays on the refused field unless the
   * version moved onto removed that field. */
  async #reloaded(answer: LiveMenu | null, focus = true): Promise<void> {
    this.reloadFailure = null;
    this.#applyLive(answer, true);
    if (!focus) {
      await this.updateComplete;
      if ((this.renderRoot as ShadowRoot).activeElement !== null) return;
    }
    await this.#toStep(
      "edit",
      this.#reviewBlocked() ? '[data-test="close"]' : '[data-test="review"]',
    );
  }

  #liveValue(target: MenuPatchTarget, field: string): unknown {
    return patchFieldValue(this.live!.document, target, field, currentContentLanguages());
  }

  /** What the field shows: the person's own text, which every staged value has, else the live one;
   * a name language every folder fixes always shows the live text, which no patch changes. */
  #shown(target: MenuPatchTarget, field: string): unknown {
    const typed = this.#typed.get(`${targetKey(target)}/${field}`);
    if (typed === undefined) return this.#liveValue(target, field);
    const languages = currentContentLanguages();
    const fixed = fixedLanguages(this.live!.document, target, field, languages);
    if (fixed.length === 0) return typed.value;
    const live = (this.#liveValue(target, field) ?? {}) as Record<string, string>;
    return {
      ...(typed.value as Record<string, string>),
      ...Object.fromEntries(fixed.map((language) => [language, live[language] ?? ""])),
    };
  }

  #change(target: MenuPatchTarget, field: string, raw: unknown): void {
    const draft = this.#draft!;
    const value = TRANSLATED.has(field)
      ? Object.fromEntries(
          currentContentLanguages().languages.map((language) => [
            language,
            languageText(raw as Record<string, string>, language),
          ]),
        )
      : raw;
    const key = `${targetKey(target)}/${field}`;
    try {
      const [checked] = parseMenuPatch([{ target, field, value }]);
      draft.set({
        target,
        field,
        value:
          field === "price"
            ? toScale(decimal(checked!.value as string), MONEY_SCALE)
            : checked!.value,
      });
      this.#typed.set(key, { target, value: raw, error: "", language: null, refused: false });
    } catch (error) {
      draft.clear(target, field);
      this.#typed.set(key, {
        target,
        value: raw,
        error: refusalText(field, error),
        language: TRANSLATED.has(field)
          ? refusedLanguage(target, field, value as Record<string, string>)
          : null,
        refused: false,
      });
    }
    this.#retireRefusal();
    this.#scope!.changed();
    this.requestUpdate();
  }

  /** Where the form is stacked under the tree, it is scrolled to. Focus stays on a pressed tree
   * item; a pressed variant link goes with its dish's form, so focus moves to the new form's
   * heading. */
  async #pick(target: MenuPatchTarget): Promise<void> {
    const pressed = (this.renderRoot as ShadowRoot).activeElement;
    this.picked = targetKey(target);
    await this.updateComplete;
    const form = this.renderRoot.querySelector('[data-test="form"]')!;
    form.scrollIntoView({ block: "nearest" });
    if (pressed !== null && !pressed.isConnected) form.querySelector("h3")!.focus();
  }

  get #taxes() {
    const today = localToday();
    const key = `${currentLocale()}/${today}`;
    if (this.#taxCache?.key !== key)
      this.#taxCache = {
        key,
        options: VAT_CLASSES.map((id) => ({
          value: id,
          label: `${vatClassName(id)} (${vatRateOn(id, today).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}%)`,
        })),
      };
    return this.#taxCache.options;
  }

  get #uploader(): ImageUploader {
    if (this.#imageApi?.api !== this.api)
      this.#imageApi = {
        api: this.api,
        uploader: { imageLibraryRequest: this.api.imageLibraryRequest },
      };
    return this.#imageApi.uploader;
  }

  override render() {
    const heading =
      this.live === null
        ? ""
        : fill("menu_patch.heading", { number: String(this.live.number), menu: this.menuName });
    return html`<wt-modal
      size="wide"
      .open=${this.open}
      heading=${heading}
      aria-label=${this.menuName}
      .dismissible=${!this.busy}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        this.#close();
      }}
      >${this.#renderBody()}${this.#renderFooter()}</wt-modal
    >`;
  }

  #showsDraft(): boolean {
    return !this.notPublished && this.readError === null && this.live !== null;
  }

  #renderFooter(): TemplateResult | typeof nothing {
    if (!this.#showsDraft()) return nothing;
    const action = saveActionState(this.#scope);
    const toCorrect = this.#itemsToCorrect();
    const errors = toCorrect.length > 0;
    const refusals = this.#refusals();
    const bottom = [
      ...refusals.map(refusalWords),
      ...(this.reloadFailure === null ? [] : [codeMessage(this.reloadFailure)]),
      ...(errors ? [fill("menu_patch.fix_items", { items: conjunctionList(toCorrect) })] : []),
    ].join(" ");
    const count = this.#current().length;
    const reload = refusals.some(
      ({ code }) => code === "menu_patch.base_changed" || code === "menu_patch.invalid",
    )
      ? html`<wt-button
          slot="secondary"
          variant="secondary"
          data-test="reload"
          ?disabled=${this.busy}
          @click=${() => void this.#reload()}
          >${t("menu_patch.reload")}</wt-button
        >`
      : nothing;
    return html`<wt-form-actions slot="footer" .error=${bottom}>
      ${
        this.step === "edit"
          ? html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="close"
                @click=${() => void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel")}
                >${t("action.close")}</wt-button
              >${reload}<wt-button
                variant=${action.variant}
                data-test="review"
                ?disabled=${this.#reviewBlocked()}
                @click=${() => void this.#review()}
                >${
                  count === 1
                    ? t("menu_patch.review_one")
                    : fill("menu_patch.review_many", { count: String(count) })
                }</wt-button
              >`
          : html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="keep-editing"
                ?disabled=${this.busy}
                @click=${() => void this.#toStep("edit", '[data-test="review"]')}
                >${t("menu_patch.keep_editing")}</wt-button
              >${reload}<wt-button
                variant=${action.variant}
                data-test="put-live"
                .loading=${this.busy}
                ?disabled=${action.unchanged}
                @click=${() => void this.#putLive()}
                >${t("menu_patch.put_live")}</wt-button
              >`
      }
    </wt-form-actions>`;
  }

  /** The bottom refusals: the last save's, and a `menu_patch.base_changed` for a newer live version
   * the subscription delivered, which takes the place of a refused save's own unless that names a
   * later version. */
  #refusals(): Refusal[] {
    const newer: Refusal[] =
      this.newer === null
        ? []
        : [{ code: "menu_patch.base_changed", params: { liveNumber: this.newer.number } }];
    if (this.refusal === null) return newer;
    if (this.refusal.code === "menu_patch.base_changed" && newer.length > 0)
      return (this.refusal.params.liveNumber as number) > this.newer!.number
        ? [this.refusal]
        : newer;
    return [this.refusal, ...newer];
  }

  #renderDropped(): TemplateResult {
    return html`${
      this.dropped === 0
        ? nothing
        : html`<p class="note" role="status" data-test="dropped">
            ${
              this.dropped === 1
                ? t("menu_patch.dropped_one")
                : fill("menu_patch.dropped_many", { count: String(this.dropped) })
            }
          </p>`
    }${
      this.trimmed.size === 0
        ? nothing
        : html`<p class="note" role="status" data-test="trimmed">
            ${
              this.trimmed.size === 1
                ? t("menu_patch.trimmed_one")
                : fill("menu_patch.trimmed_many", { count: String(this.trimmed.size) })
            }
          </p>`
    }`;
  }

  #renderReview(): TemplateResult {
    const languages = currentContentLanguages();
    return html`<div class="review" data-test="review-step">
      ${this.#renderDropped()}
      <h3 tabindex="-1">${t("menu_patch.review_heading")}</h3>
      <ul class="changes">
        ${changeLines(this.live!.document, this.changes, languages).map(
          (line) => html`<li data-test="review-line">${line}</li>`,
        )}
      </ul>
      ${reviewNotes(this.queued.map(localTimeWords)).map(
        (note) => html`<p class="note" data-test="review-note">${note}</p>`,
      )}
    </div>`;
  }

  #renderBody(): TemplateResult | typeof nothing {
    if (this.notPublished)
      return html`<p class="error" data-test="read-error">
        ${codeMessage("menu_patch.not_published")}
      </p>`;
    if (this.readError !== null)
      return html`<div class="error" data-test="read-error">
        <span>${codeMessage(this.readError)}</span>
        <wt-button @click=${() => void this.#load(this.menuId)}>${t("menus.retry")}</wt-button>
      </div>`;
    if (this.live === null) return nothing;
    if (this.step === "review") return this.#renderReview();
    const tree = patchTree(this.live.document, t("menu_patch.lists"));
    const search = textSearch(this.search);
    const shown = search === undefined ? tree : matching(tree, search);
    const picked = this.picked === null ? undefined : findNode(tree, this.picked);
    const marked = new Set(this.#keysToCorrect());
    return html`${this.#renderDropped()}
      <div class="layout">
        <div class="side">
          <wt-input
            name="menu-patch-search"
            type="search"
            label=${t("menu_patch.search")}
            placeholder=${t("menu_patch.search_placeholder")}
            .value=${this.search}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.search = event.detail.value;
            }}
          ></wt-input>
          ${
            shown.length === 0
              ? html`<p class="message" data-test="no-matches">${t("menu_patch.no_matches")}</p>`
              : html`<nav aria-label=${t("menu_patch.tree")} data-test="tree">
                  ${this.#renderNodes(shown, marked)}
                </nav>`
          }
        </div>
        ${
          picked === undefined
            ? html`<p class="message" data-test="pick-prompt">${t("menu_patch.pick")}</p>`
            : this.#renderForm(picked.target!, picked.label)
        }
      </div>`;
  }

  /** `marked` holds the target keys of the items with a field to correct. */
  #renderNodes(nodes: readonly PatchTreeNode[], marked: ReadonlySet<string>): TemplateResult {
    return html`<ul>
      ${nodes.map(
        (node) =>
          html`<li>
            ${
              node.target === null
                ? html`<span class="group" data-test="label">${node.label}</span>`
                : this.#renderNode(node.target, node.label, marked)
            }
            ${node.children.length === 0 ? nothing : this.#renderNodes(node.children, marked)}
          </li>`,
      )}
    </ul>`;
  }

  #renderNode(target: MenuPatchTarget, label: string, marked: ReadonlySet<string>): TemplateResult {
    const current = targetKey(target) === this.picked;
    return html`<button
      type="button"
      class="node"
      aria-current=${current ? "true" : nothing}
      @click=${() => void this.#pick(target)}
    >
      <span data-test="label">${label}</span>
      ${
        this.#draft!.changed(target)
          ? html`<span class="dot" data-test="changed"
              ><span class="hidden">${t("menu_patch.changed")}</span></span
            >`
          : nothing
      }
      ${
        marked.has(targetKey(target))
          ? html`<span class="flag" data-test="needs-correcting"
              ><span aria-hidden="true">!</span
              ><span class="hidden">${t("menu_patch.needs_correcting")}</span></span
            >`
          : nothing
      }
    </button>`;
  }

  #renderForm(target: MenuPatchTarget, label: string): TemplateResult {
    const fields = PATCH_FIELDS[target.kind].filter(
      (field) => this.#liveValue(target, field) !== undefined,
    );
    const offer = target.kind === "offer" ? this.live!.document.offers[target.menuItemId]! : null;
    const variants = offer?.variants ?? [];
    return html`<div class="form" data-test="form">
      <h3 tabindex="-1">${label}</h3>
      ${fields.map((field) => this.#renderField(target, field))}
      ${
        variants.length === 0
          ? nothing
          : html`<p class="note" data-test="variants-note">${t("menu_patch.variants_note")}</p>
              <h4>${t("menu_patch.variants")}</h4>
              <ul>
                ${variants.map(
                  (variant) =>
                    html`<li>
                      <button
                        type="button"
                        class="link"
                        data-test="variant-link"
                        @click=${() =>
                          void this.#pick({
                            kind: "variant",
                            menuItemId: offer!.id,
                            variantId: variant.id,
                          })}
                      >
                        ${variant.name}
                      </button>
                    </li>`,
                )}
              </ul>`
      }
    </div>`;
  }

  #renderField(target: MenuPatchTarget, field: string): TemplateResult {
    const value = this.#shown(target, field);
    const typed = this.#typed.get(`${targetKey(target)}/${field}`);
    const error = this.#shownError(typed);
    const languages = currentContentLanguages();
    const name = INPUT_NAMES[field];
    const errorKey =
      typed === undefined || typed.language === null ? name : `${name}-${typed.language}`;
    const context: FieldContext = {
      busy: false,
      locales: languages.languages,
      error: (key) => (key === errorKey ? error : ""),
    };
    const change = (next: unknown) => this.#change(target, field, next);
    switch (field) {
      case "name":
        return textField(context, "name", t("editor.name"), value as string, change, true);
      case "internalName":
        return textField(
          context,
          "internal-name",
          t("sections.internal_name"),
          value as string,
          change,
          true,
        );
      case "customerName":
      case "names":
      case "description": {
        const fixed = fixedLanguages(this.live!.document, target, field, languages);
        return html`${optionalTextFields(
          context,
          name!,
          t(
            field === "customerName"
              ? "editor.customer_name"
              : field === "names"
                ? "sections.customer_name"
                : "editor.description",
          ),
          (value as Record<string, string> | null) ?? {},
          change,
          field === "customerName" ? (this.#shown(target, "name") as string) : "",
          languages.defaultLanguage,
          (locale) => (fixed.includes(locale) ? t("menu_patch.folder_fixed") : ""),
        )}`;
      }
      case "kitchenName":
        return textField(
          context,
          "kitchen-name",
          t("editor.kitchen_name"),
          (value as string | null) ?? "",
          change,
          false,
          this.#shown(target, "name") as string,
        );
      case "price":
        return priceField(context, "price", t("editor.price"), value as string, change, true);
      case "vatClass":
        return html`<wt-combobox
          name="tax"
          label=${t("product.vat")}
          required
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#taxes}
          .value=${value as string}
          error=${error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            change(event.detail.value);
          }}
        ></wt-combobox>`;
      default:
        return html`<dashboard-image-upload
          label=${t("image.label")}
          .api=${this.#uploader}
          .image=${value as string | null}
          .invalid=${error !== ""}
          .error=${error}
          @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
            event.stopPropagation();
            change(event.detail.image);
          }}
        ></dashboard-image-upload>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-patch-dialog": MenuPatchDialog;
  }
  interface HTMLElementEventMap {
    "wt-menu-patched": CustomEvent<MenuPatchResult>;
  }
}
