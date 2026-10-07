import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
import {
  baseStyles,
  focusFirstInvalid,
  leaveCoordinatorFor,
  submitOnEnter,
  type DataTableColumn,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  ActivationTime,
  DashboardApi,
  LocalTime,
  MenuPreview,
  MenuPublicationsAnswer,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { conjunctionList } from "../i18n/list.js";
import type { StringKey } from "../i18n/strings.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

type Edition = MenuPublicationsAnswer["editions"][number];

const STATE_KEYS: Record<Edition["state"], StringKey> = {
  queued: "menu_publications.state_queued",
  cancelled: "menu_publications.state_cancelled",
  activated: "menu_publications.state_activated",
};

/** Fills `{key}` placeholders; each value is inserted once, never re-read as a placeholder. */
function fill(key: StringKey, values: Record<string, string>): string {
  return t(key).replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

function screenLocale(): string {
  return currentLocale().startsWith("es") ? "es-ES" : "en-GB";
}

/** A venue-local `YYYY-MM-DD` in the screen language ("8 Oct 2026"). */
function localDateWords(value: string): string {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(screenLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** A venue-local time in the screen language ("8 Oct 2026, 08:00"), its offset added only when the
 * venue clock shows that minute twice. */
export function localTimeWords(local: LocalTime): string {
  const date = localDateWords(local.date);
  const words = fill("menu_publications.time", { date, time: local.time });
  return local.repeated
    ? fill("menu_publications.repeated_time", { time: words, offset: local.offset })
    : words;
}

function versionWords(edition: Edition): string {
  return fill("menu_publications.version", { number: String(edition.number) });
}

const IN_THE_WAY = {
  earlier: ["menu_publications.in_the_way_earlier", "menu_publications.in_the_way_earlier_many"],
  later: ["menu_publications.in_the_way_later", "menu_publications.in_the_way_later_many"],
} as const satisfies Record<string, readonly [StringKey, StringKey]>;

/**
 * What to do about the editions an `overtakes_queued` refusal names, one sentence for those that
 * must go live first and one for those that must go live after. `placed` is the number of the
 * edition being moved, or null for one not yet numbered. Null when the list read after the refusal
 * lacks a named edition.
 */
export function overtakeSentence(
  overtaken: readonly { versionId: string }[],
  placed: number | null,
  answer: MenuPublicationsAnswer,
): string | null {
  const named: Edition[] = [];
  for (const { versionId } of overtaken) {
    const edition = answer.editions.find((listed) => listed.versionId === versionId);
    if (edition === undefined) return null;
    named.push(edition);
  }
  named.sort((a, b) => a.number - b.number);
  const groups = [
    [named.filter((edition) => placed === null || edition.number < placed), IN_THE_WAY.earlier],
    [named.filter((edition) => placed !== null && edition.number > placed), IN_THE_WAY.later],
  ] as const;
  const sentences = groups.flatMap(([group, [one, many]]) => {
    if (group.length === 0) return [];
    if (group.length === 1)
      return [
        fill(one, { number: String(group[0]!.number), time: localTimeWords(group[0]!.local) }),
      ];
    const items = group.map((edition) =>
      fill("menu_publications.in_the_way_item", {
        number: String(edition.number),
        time: localTimeWords(edition.local),
      }),
    );
    return [fill(many, { list: conjunctionList(items) })];
  });
  return sentences.length === 0 ? null : sentences.join(" ");
}

interface ScheduleDraft {
  date: string;
  time: string;
  occurrence: string;
}

/**
 * A refusal placed under the field it names, or in the bottom message when `field` is null, kept
 * untranslated so a language change rewords it. A null `code` is a press with no preview to
 * schedule; `answer` is the list read after an overtake refusal, and `placed` the number of the
 * version being moved, null for a new one.
 */
interface ScheduleRefusal {
  field: "date" | "time" | "occurrence" | null;
  code: string | null;
  params: Record<string, unknown>;
  placed: number | null;
  answer?: MenuPublicationsAnswer | null;
}

function refusalMessage({ code, params, placed, answer }: ScheduleRefusal): string {
  if (code === null) return t("menu_publications.preview_unavailable");
  if (code === "menu_publication.overtakes_queued" && answer && Array.isArray(params.overtaken))
    return (
      overtakeSentence(params.overtaken as { versionId: string }[], placed, answer) ??
      codeMessage(code)
    );
  if (
    code === "menu_publication.time_skipped" &&
    typeof params.date === "string" &&
    typeof params.time === "string"
  )
    return fill("menu_publications.time_skipped", {
      time: params.time,
      date: localDateWords(params.date),
    });
  return codeMessage(code);
}

/** The two instants a repeated venue-local minute names, earlier first, as the route lists them. */
interface RepeatedTime {
  date: string;
  time: string;
  offsets: [string, string];
}

const REQUEST_FIELDS: Record<string, ScheduleRefusal["field"]> = {
  "activatesAt.date": "date",
  "activatesAt.time": "time",
  "activatesAt.occurrence": "occurrence",
};

function repeatedTime(params: Record<string, unknown>): RepeatedTime | null {
  const { date, time, occurrences } = params;
  if (typeof date !== "string" || typeof time !== "string" || !Array.isArray(occurrences))
    return null;
  const offsets = occurrences.map((occurrence: { offset?: unknown }) => occurrence?.offset);
  if (offsets.length !== 2 || !offsets.every((offset) => typeof offset === "string")) return null;
  return { date, time, offsets: offsets as [string, string] };
}

/**
 * A menu's scheduled versions, soonest first, then the latest settled ones, each with its
 * venue-local time and state. A queued version can be cancelled after a confirmation, or moved to
 * another time through the schedule form.
 */
@customElement("dashboard-menu-publications")
export class MenuPublicationsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* The preview panel lets its text break anywhere, which would also let the table squeeze
         the pinned Actions heading mid-word. */
      :host {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
        overflow-wrap: normal;
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .retry {
        display: flex;
      }
      wt-data-table::part(settled) {
        color: var(--wt-color-text-muted);
      }
      .question {
        margin: 0;
        color: var(--wt-color-text);
      }
      .schedule {
        display: flex;
      }
      .intro {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text);
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property() menuName = "";
  @property({ attribute: false }) preview: MenuPreview | null = null;

  @state() private answer: MenuPublicationsAnswer | null = null;
  @state() private loading = true;
  @state() private readError: string | null = null;
  /** A Cancel waiting for its confirmation; a refused one stays open with its refusal. */
  @state() private cancelling: Edition | null = null;
  @state() private cancelError: string | null = null;
  @state() private busy = false;
  @state() private scheduling = false;
  /** The queued version the schedule form moves; null when it schedules the preview. */
  @state() private moving: Edition | null = null;
  @state() private scheduleBusy = false;
  @state() private date = "";
  @state() private time = "";
  @state() private occurrence = "";
  @state() private repeated: RepeatedTime | null = null;
  @state() private attempted = false;
  @state() private scheduleRefusal: ScheduleRefusal | null = null;

  /** The menu whose editions are followed. */
  #watching: string | null = null;
  /** Numbers each list read as it starts; a live answer counts as started when it lands. */
  #readCount = 0;
  /** The number of the read whose answer the table shows, so an older one never replaces it. */
  #shownRead = 0;
  /** A row menu's popover closes on the click, so the dialog hands focus back to its trigger. */
  #focusTarget: HTMLElement | null = null;
  /** Replaced at each opening of the schedule form, so a late answer cannot reach a later one. */
  #opening = {};
  #scope?: DraftScope<ScheduleDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.scheduleBusy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

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
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#follow();
  }

  override disconnectedCallback(): void {
    this.#disposeDraft();
    super.disconnectedCallback();
    // The query controller releases every observation when its host leaves the page.
    this.#watching = null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("menuId")) this.#follow();
  }

  #follow(): void {
    if (!this.isConnected || this.menuId === "" || this.menuId === this.#watching) return;
    this.answer = null;
    this.cancelling = null;
    this.cancelError = null;
    this.#opening = {};
    this.#disposeDraft();
    this.scheduling = false;
    void this.#load();
  }

  async #load(): Promise<void> {
    const menuId = this.menuId;
    this.#watching = menuId;
    this.loading = true;
    this.readError = null;
    try {
      await this.#queries.watch("getMenuPublications", [menuId], (answer) => {
        this.#shownRead = ++this.#readCount;
        this.answer = answer;
        // The controller's recovery fires only for its own failed reads, not a failed re-read.
        this.readError = null;
      });
    } catch {
      // The query's error callback has already recorded the failure.
    } finally {
      if (menuId === this.menuId) this.loading = false;
    }
  }

  /** After a write: a failed read here is a load failure, not a failed cancel. */
  async #refresh(): Promise<MenuPublicationsAnswer | null> {
    const menuId = this.menuId;
    const read = ++this.#readCount;
    const current = () => menuId === this.menuId && this.#shownRead < read;
    try {
      const answer = await this.api.getMenuPublications(menuId);
      if (current()) {
        this.#shownRead = read;
        this.answer = answer;
        this.readError = null;
      }
      return answer;
    } catch (error) {
      if (current()) this.readError = codeOf(error);
      return null;
    }
  }

  #rememberRowMenu(event: Event): void {
    const menu = (event.currentTarget as HTMLElement).closest("wt-row-actions")!;
    this.#focusTarget = menu.shadowRoot!.querySelector("button");
  }

  #openCancel(edition: Edition, event: Event): void {
    this.#rememberRowMenu(event);
    this.cancelError = null;
    this.cancelling = edition;
  }

  #openMove(edition: Edition, event: Event): void {
    this.#rememberRowMenu(event);
    this.#openSchedule(edition);
  }

  #close(): void {
    this.cancelling = null;
    this.cancelError = null;
    requestAnimationFrame(() => {
      if (this.#focusTarget?.isConnected) this.#focusTarget.focus();
      else this.renderRoot.querySelector<HTMLElement>("h2")?.focus();
    });
  }

  async #confirmCancel(): Promise<void> {
    const target = this.cancelling;
    if (target === null || this.busy) return;
    this.busy = true;
    this.cancelError = null;
    try {
      await this.api.cancelMenuPublication(this.menuId, target.versionId);
    } catch (error) {
      this.cancelError = codeOf(error);
      // The row the refusal came from is out of date.
      if (
        this.cancelError === "menu_publication.not_queued" ||
        this.cancelError === "menu_publication.not_found"
      )
        void this.#refresh();
      return;
    } finally {
      this.busy = false;
    }
    // The cancelled row loses its menu, so focus goes to the heading.
    this.#focusTarget = null;
    this.#close();
    await this.#refresh();
  }

  /** Not while the draft cannot be published, nor when it is the edition it would follow. */
  #canSchedule(): boolean {
    const { preview, answer } = this;
    if (preview === null || preview.clashes.length > 0 || answer === null) return false;
    const { status } = preview;
    let latest =
      status.state === "unpublished" ? null : { number: status.version, hash: status.hash };
    for (const edition of answer.editions)
      if (edition.state === "queued" && (latest === null || edition.number > latest.number))
        latest = { number: edition.number, hash: edition.contentHash };
    return latest?.hash !== preview.hash;
  }

  #draft(): ScheduleDraft {
    return { date: this.date, time: this.time, occurrence: this.occurrence };
  }

  #disposeDraft(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
  }

  #openSchedule(moving: Edition | null): void {
    this.#opening = {};
    this.moving = moving;
    this.date = moving?.local.date ?? "";
    this.time = moving?.local.time ?? "";
    this.occurrence = "";
    this.repeated = null;
    this.attempted = false;
    this.scheduleRefusal = null;
    this.#disposeDraft();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<ScheduleDraft>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.date === b.date && a.time === b.time && a.occurrence === b.occurrence,
      restore: (value) => {
        this.date = value.date;
        this.time = value.time;
        this.occurrence = value.occurrence;
      },
    });
    this.scheduling = true;
  }

  #scheduleClosed(): void {
    this.#opening = {};
    this.#disposeDraft();
    this.scheduling = false;
    const moved = this.moving !== null;
    requestAnimationFrame(() => {
      const opener = moved
        ? this.#focusTarget?.isConnected
          ? this.#focusTarget
          : null
        : this.renderRoot.querySelector<HTMLElement>('[data-test="schedule-open"]');
      (opener ?? this.renderRoot.querySelector<HTMLElement>("h2"))?.focus();
    });
  }

  #scheduleDialog(): HTMLElementTagNameMap["wt-dialog"] {
    return this.renderRoot.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
      'wt-dialog[data-test="schedule-dialog"]',
    )!;
  }

  /** A changed date or time is a different instant, so what was said about the old one goes. */
  #changeWhen(field: "date" | "time", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.scheduleBusy) return;
    this[field] = event.detail.value;
    this.repeated = null;
    this.occurrence = "";
    if (this.scheduleRefusal?.field != null) this.scheduleRefusal = null;
    this.#scope?.changed();
  }

  #changeOccurrence(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.scheduleBusy) return;
    this.occurrence = event.detail.value;
    if (this.scheduleRefusal?.field === "occurrence") this.scheduleRefusal = null;
    this.#scope?.changed();
  }

  #ownErrors(): Partial<Record<"date" | "time" | "occurrence", string>> {
    const errors: Partial<Record<"date" | "time" | "occurrence", string>> = {};
    if (this.date === "") errors.date = t("menu_publications.date_required");
    if (this.time === "") errors.time = t("menu_publications.time_required");
    if (this.repeated !== null && this.occurrence === "")
      errors.occurrence = fill("menu_publications.time_repeated", {
        time: this.repeated.time,
        date: localDateWords(this.repeated.date),
      });
    return errors;
  }

  async #submitSchedule(): Promise<void> {
    const preview = this.preview;
    const moving = this.moving;
    if (this.scheduleBusy) return;
    this.attempted = true;
    this.scheduleRefusal = null;
    if (moving === null && preview === null) {
      this.scheduleRefusal = { field: null, code: null, params: {}, placed: null };
      return;
    }
    if (Object.keys(this.#ownErrors()).length > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.#scheduleDialog());
      return;
    }
    const activatesAt: ActivationTime = { date: this.date, time: this.time };
    if (this.repeated !== null) activatesAt.occurrence = this.occurrence as "earlier" | "later";
    const submitted = this.#draft();
    const opening = this.#opening;
    const menuId = this.menuId;
    this.scheduleBusy = true;
    try {
      if (moving === null)
        await this.api.scheduleMenuPublication(menuId, {
          expectedHash: preview!.hash,
          activatesAt,
        });
      else await this.api.rescheduleMenuPublication(menuId, moving.versionId, { activatesAt });
    } catch (error) {
      await this.#placeRefusal(error, menuId, opening, moving?.number ?? null);
      return;
    } finally {
      this.scheduleBusy = false;
    }
    if (opening !== this.#opening) return;
    this.#scope?.commit(submitted);
    this.#scheduleDialog().closeAfter("saved");
    this.#scheduleClosed();
    await this.#refresh();
  }

  async #placeRefusal(
    error: unknown,
    menuId: string,
    opening: object,
    placed: number | null,
  ): Promise<void> {
    const code = codeOf(error);
    const params = (error as { params?: Record<string, unknown> }).params ?? {};
    const refusal: ScheduleRefusal = { field: null, code, params, placed };
    if (code === "menu_publication.time_repeated") {
      const repeated = repeatedTime(params);
      if (opening === this.#opening && repeated !== null) {
        this.repeated = repeated;
        this.occurrence = "";
        this.scheduleBusy = false;
        await this.updateComplete;
        await focusFirstInvalid(this.#scheduleDialog());
        return;
      }
    } else if (code === "menu_publication.overtakes_queued") {
      refusal.field = "time";
      // Read once more to name each edition in the way as the list now stands.
      if (Array.isArray(params.overtaken) && menuId === this.menuId)
        refusal.answer = await this.#refresh();
    } else if (code === "menu_publication.time_past" || code === "menu_publication.time_skipped") {
      refusal.field = "time";
    } else if (code === "management.request_invalid" && typeof params.field === "string") {
      const field = REQUEST_FIELDS[params.field] ?? null;
      refusal.field = field === "occurrence" && this.repeated === null ? null : field;
    } else if (code === "menu_publication.not_queued" || code === "menu_publication.not_found") {
      // The row being moved is out of date.
      void this.#refresh();
    }
    if (opening !== this.#opening) return;
    this.scheduleRefusal = refusal;
    if (refusal.field !== null) {
      // The fields are disabled while the request is out, and a disabled field cannot take focus.
      this.scheduleBusy = false;
      await this.updateComplete;
      await focusFirstInvalid(this.#scheduleDialog());
    }
  }

  #columns(): DataTableColumn<Edition>[] {
    return [
      {
        key: "version",
        label: t("menu_publications.version_column"),
        cell: (edition) =>
          html`<span data-test=${`version-${edition.versionId}`}>${versionWords(edition)}</span>`,
      },
      {
        key: "time",
        label: t("menu_publications.time_column"),
        cell: (edition) =>
          html`<span data-test=${`time-${edition.versionId}`}
            >${localTimeWords(edition.local)}</span
          >`,
      },
      {
        key: "state",
        label: t("menu_publications.state_column"),
        cell: (edition) =>
          html`<span
            part=${edition.state === "queued" ? "state" : "state settled"}
            data-test=${`state-${edition.versionId}`}
            >${t(STATE_KEYS[edition.state])}</span
          >`,
      },
      {
        key: "actions",
        label: t("menu_publications.actions"),
        pinned: "end",
        cell: (edition) =>
          edition.state !== "queued"
            ? nothing
            : html`<wt-row-actions
                label=${`${t("menu_publications.actions")}: ${versionWords(edition)}`}
                ><wt-button
                  align="start"
                  variant="ghost"
                  data-test=${`move-${edition.versionId}`}
                  @click=${(event: Event) => this.#openMove(edition, event)}
                  >${t("menu_publications.move")}</wt-button
                ><wt-button
                  align="start"
                  variant="ghost"
                  data-test=${`cancel-${edition.versionId}`}
                  @click=${(event: Event) => this.#openCancel(edition, event)}
                  >${t("menu_publications.cancel")}</wt-button
                ></wt-row-actions
              >`,
      },
    ];
  }

  #renderDialog(): TemplateResult {
    const target = this.cancelling;
    return html`<wt-dialog
      data-test="cancel-dialog"
      heading=${t("menu_publications.cancel_heading")}
      .open=${target !== null}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.cancelling !== null) this.#close();
      }}
    >
      ${
        target === null
          ? nothing
          : html`<p class="question" data-test="cancel-question">
              ${fill("menu_publications.cancel_question", {
                number: String(target.number),
                time: localTimeWords(target.local),
              })}
            </p>`
      }
      <wt-form-actions
        slot="footer"
        .error=${target === null || this.cancelError === null ? "" : codeMessage(this.cancelError)}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-keep"
          ?disabled=${this.busy}
          @click=${() => this.#close()}
          >${t("menu_publications.keep")}</wt-button
        >
        <wt-button
          variant="danger"
          data-test="cancel-confirm"
          .loading=${this.busy && target !== null}
          @click=${() => void this.#confirmCancel()}
          >${t("menu_publications.cancel")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  #renderSchedule(): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : {};
    const refusal = this.scheduleRefusal;
    const errors = { ...own };
    if (refusal?.field != null) errors[refusal.field] ??= refusalMessage(refusal);
    const marked = Object.values(errors).some(Boolean);
    const bottom = [
      ...(refusal !== null && refusal.field === null ? [refusalMessage(refusal)] : []),
      ...(marked ? [t("form.fix_fields")] : []),
    ].join(" ");
    const invalid = Object.keys(own).length > 0;
    const repeated = this.repeated;
    const moving = this.moving;
    const zone = this.answer?.timeZone ?? "";
    return html`<wt-dialog
      data-test="schedule-dialog"
      heading=${
        moving === null
          ? fill("menu_publications.schedule_heading", { menu: this.menuName })
          : fill("menu_publications.move_heading", { number: String(moving.number) })
      }
      .open=${this.scheduling}
      .dismissible=${!this.scheduleBusy}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.scheduling) this.#scheduleClosed();
      }}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.renderRoot.querySelector<HTMLElement>('[data-test="schedule-submit"]'),
        )}
    >
      <p class="intro" data-test="schedule-intro">
        ${
          moving === null
            ? fill("menu_publications.schedule_intro", { zone })
            : fill("menu_publications.move_intro", {
                number: String(moving.number),
                menu: this.menuName,
                zone,
              })
        }
      </p>
      <wt-input
        class="field"
        name="date"
        type="date"
        required
        label=${t("menu_publications.date_label")}
        ?disabled=${this.scheduleBusy}
        error=${errors.date ?? ""}
        .value=${this.date}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeWhen("date", event)}
      ></wt-input>
      <wt-input
        class="field"
        name="time"
        type="time"
        required
        label=${t("menu_publications.time_label")}
        ?disabled=${this.scheduleBusy}
        error=${errors.time ?? ""}
        .value=${this.time}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeWhen("time", event)}
      ></wt-input>
      ${
        repeated === null
          ? nothing
          : html`<wt-combobox
              class="field"
              name="occurrence"
              required
              search="never"
              placeholder=${t("menu_publications.occurrence_choose")}
              ?disabled=${this.scheduleBusy}
              label=${fill("menu_publications.occurrence_label", { time: repeated.time })}
              .options=${[
                {
                  value: "earlier",
                  label: fill("menu_publications.occurrence_earlier", {
                    time: repeated.time,
                    offset: repeated.offsets[0],
                  }),
                },
                {
                  value: "later",
                  label: fill("menu_publications.occurrence_later", {
                    time: repeated.time,
                    offset: repeated.offsets[1],
                  }),
                },
              ]}
              .value=${this.occurrence}
              error=${errors.occurrence ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeOccurrence(event)}
            ></wt-combobox>`
      }
      <wt-form-actions slot="footer" .error=${this.scheduling ? bottom : ""}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="schedule-close"
          ?disabled=${this.scheduleBusy}
          @click=${() => void this.#scheduleDialog().requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="schedule-submit"
          .loading=${this.scheduleBusy}
          ?disabled=${invalid}
          @click=${() => void this.#submitSchedule()}
          >${t(
            moving === null ? "menu_publications.schedule_action" : "menu_publications.move_action",
          )}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }

  override render(): TemplateResult {
    return html`<h2 tabindex="-1">${t("menu_publications.heading")}</h2>
      ${
        this.#canSchedule()
          ? html`<div class="schedule">
              <wt-button
                variant="secondary"
                data-test="schedule-open"
                @click=${() => this.#openSchedule(null)}
                >${t("menu_publications.schedule")}</wt-button
              >
            </div>`
          : nothing
      }
      <wt-data-table
        data-test="editions"
        aria-label=${t("menu_publications.heading")}
        noMatchesMessage=${tableNoMatches()}
        .rows=${this.answer?.editions ?? []}
        .columns=${this.#columns()}
        .rowKey=${(edition: Edition) => edition.versionId}
        .loading=${this.loading}
        .loadingMessage=${t("menu_publications.loading")}
        .emptyMessage=${t("menu_publications.empty")}
        .errorMessage=${this.readError === null ? "" : codeMessage(this.readError)}
      ></wt-data-table>
      ${
        this.readError === null
          ? nothing
          : html`<div class="retry">
              <wt-button
                data-test="editions-retry"
                variant="secondary"
                @click=${() => void this.#load()}
                >${t("menus.retry")}</wt-button
              >
            </div>`
      }
      ${this.#renderDialog()} ${this.#renderSchedule()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-publications": MenuPublicationsPanel;
  }
}
