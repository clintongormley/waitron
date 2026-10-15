import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import {
  t as tKit,
  type CalendarViewEntry,
  type CalendarViewHost,
  type DashboardModuleContext,
  type DashboardScreenHandle,
} from "@waitron/dashboard-kit";
import {
  baseStyles,
  decodePathSegment,
  leaveCoordinatorFor,
  UrlStateController,
  navigationGuardFor,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./season-painter.js";
import type { PainterNavigation } from "./season-painter.js";
import "./opening-hours-year.js";
import "./opening-hours-month.js";
import "./ordinary-date-dialog.js";
import type { OrdinaryDateOpen } from "./opening-hours-month.js";
import { seasonTints } from "./season-tint.js";
import {
  calendarViewPath,
  hoursPath,
  openingHoursPath,
  seasonPainterPath,
  specialDayPainterPath,
} from "./opening-hours-paths.js";
import { segmentedStyles } from "./segmented-styles.js";
import "./special-day-painter.js";
import type { SpecialDayAction } from "./special-day-action.js";
import type { OpeningHoursMonth, OpeningHoursYear } from "../opening-hours-calendar.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { businessDateToday } from "./business-date.js";
import { isLocalDate, parseCalendarMonth, parseCalendarYear } from "../hours-rules.js";
import { browserToday, format } from "./hours-view.js";
import { t } from "./strings.js";
import { chosenSeasonId } from "./season-choice.js";

type View = "year" | "month";
/** The Year panel's Delete of a special day, asked in the screen's own confirmation. */
type OpenSpecialDay = Omit<SpecialDayAction, "specialDay"> & {
  clockRevision: number;
  detail?: SpecialDayDetail;
};
/** What a painter address names, as written; `painterTarget` resolves it against the model. */
type PainterAddress = { seasonId: string; departmentId: string; zoneId: string };
/** A special-day painter address: a stored day, with a date to add to it, or a new day on `date`. */
type SpecialAddress = { specialDayId: string | null; date: LocalDate | null };
const painterEntryKey = "openingHoursPainter";
/** The other modules' views the Calendar offers beside Opening hours, as the app worked them out. */
export type CalendarViews = {
  ctx: DashboardModuleContext;
  views: readonly CalendarViewEntry[];
};
/** The module view an address names: its id and the `<key>/<value>` pairs after it. */
type ModuleAddress = { id: string; params: Readonly<Record<string, string>> };

@customElement("dashboard-opening-hours-screen")
export class OpeningHoursScreen extends LitElement {
  static override styles = [
    baseStyles,
    segmentedStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .month-back {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        cursor: pointer;
        min-height: var(--wt-tap-min);
        text-transform: capitalize;
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-4);
        margin-block-end: var(--wt-space-4);
      }
      .title h1 {
        margin: 0;
      }
      .month-back:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ type: Boolean }) readOnly = false;
  @property({ attribute: false }) calendar?: CalendarViews;
  /** Set while the address names one of `calendar`'s views. */
  @state() private moduleView?: ModuleAddress;
  /** Each view's handle, created the first time it is shown and kept for this screen's life. */
  private readonly viewHandles = new Map<string, DashboardScreenHandle>();
  @state() private model?: OpeningHoursModel;
  @state() private departmentId = "";
  @state() private view: View = "year";
  /** The address's year, or 0 for the venue's current one. */
  @state() private requestedYear = 0;
  @state() private yearModel?: OpeningHoursYear;
  @state() private yearReadError = "";
  @state() private knownSpecialDays: readonly { id: string; name: string }[] = [];
  private yearDetach?: () => void;
  private watchedYear = 0;
  private knownSpecialDaysRead = {};
  /** The address's month, or "" for the venue's current one. */
  @state() private requestedMonth = "";
  @state() private monthModel?: OpeningHoursMonth;
  @state() private monthReadError = "";
  private monthDetach?: () => void;
  private watchedMonth = "";
  @state() private ordinary?: OrdinaryDateOpen;
  @state() private readError = "";
  @state() private busy = false;
  @state() private namedAction?: OpenSpecialDay;
  @state() private namedDeleteError = "";
  @state() private specialReadError = "";
  private detach?: () => void;
  private generation = {};
  /** Set while the address is the season painter's; the view underneath stays as it was. */
  @state() private painter?: PainterAddress;
  /** Set while the address is the special-day painter's, over the view underneath as above. */
  @state() private special?: SpecialAddress;
  /** The public holidays the view that opened the special-day painter sent with its date. */
  private sentHolidays?: { date: LocalDate; holidays: readonly HolidayFact[] };
  /** The month read for a new special day's date when no other read covers it. */
  @state() private holidayRead?: { month: string; holidays: readonly HolidayFact[] };
  private holidayDetach?: () => void;
  private watchedHolidayMonth = "";
  /** The address of the view the painter opened over, or none on a direct load. */
  private baseHref?: string;
  /** The history entry this screen pushed the painter into over `base`: only from that entry
   *  does closing go back, because only there is the entry below known to be the base view. */
  private pushedPainter?: { entry: string; base: string | undefined };
  private readonly url = new UrlStateController(this, () => this.followUrl(), {
    basePath: "/manage",
    primary: "dashboard",
    children: {
      "opening-hours": {
        view: "view",
        season: "season",
        department: "department",
        zone: "zone",
        "special-day": "special-day",
        date: "date",
        year: "year",
        month: "month",
      },
    },
  });
  private followUrl() {
    if (this.url.read("dashboard") !== "opening-hours") return;
    const view = this.url.read("view");
    if (this.calendarView(view)) {
      this.painter = undefined;
      this.special = undefined;
      this.moduleView = { id: view!, params: this.moduleParams() };
      return;
    }
    this.moduleView = undefined;
    const named = {
      seasonId: this.url.read("season") ?? "",
      departmentId: this.url.read("department") ?? "",
      zoneId: this.url.read("zone") ?? "",
    };
    const date = this.url.read("date") ?? "";
    if (view === "season") {
      this.special = undefined;
      this.painter = named;
      if (this.baseHref === undefined) this.view = "year";
      this.namePainterTarget();
      return;
    }
    if (view === "special-day") {
      this.painter = undefined;
      this.special = {
        specialDayId: this.url.read("special-day") || null,
        date: isLocalDate(date) ? date : null,
      };
      if (this.baseHref === undefined) this.view = "year";
      return;
    }
    if (view === "date") {
      void Promise.resolve(
        this.url.write(
          {
            dashboard: "opening-hours",
            view: "month",
            month: isLocalDate(date) ? date.slice(0, 7) : null,
            date: null,
          },
          true,
        ),
      ).then(() => this.followUrl());
      return;
    }
    const href = navigationGuardFor(window)?.href ?? location.href;
    const shown: View | undefined =
      view === "year" || view === "month"
        ? view
        : view === "calendar" || (view === null && !this.namesWeek(new URL(href)))
          ? "year"
          : undefined;
    if (!shown) {
      this.replaceAddress(this.painterUrl(named));
      return;
    }
    this.painter = undefined;
    this.special = undefined;
    this.baseHref = href;
    if (shown !== this.view) this.specialReadError = "";
    this.view = shown;
    this.departmentId = named.departmentId;
    this.requestedYear = parseCalendarYear(this.url.read("year")) ?? 0;
    this.requestedMonth = parseCalendarMonth(this.url.read("month")) ?? "";
  }
  private calendarView(id: string | null) {
    return this.calendar?.views.find(({ view }) => view.id === id);
  }
  /** Every `<key>/<value>` pair of the address but `view`, read from the path itself because the
   *  URL controller reads only the keys it is configured with. */
  private moduleParams() {
    const path = new URL(navigationGuardFor(window)?.href ?? location.href).pathname;
    const parts = path.slice(openingHoursPath.length + 1).split("/");
    const params: Record<string, string> = {};
    for (let i = 0; i + 1 < parts.length; i += 2) {
      if (parts[i] === "view") continue;
      try {
        params[decodePathSegment(parts[i]!)] = decodePathSegment(parts[i + 1]!);
      } catch {
        // A malformed escape leaves that pair out, as the URL controller does with the address.
      }
    }
    return params;
  }
  /** Read only by a view's host, which exists only once the model has loaded. */
  private moduleMonth() {
    return (
      parseCalendarMonth(this.moduleView?.params["month"]) ??
      (businessDateToday(this.model!) || browserToday()).slice(0, 7)
    );
  }
  /** Moves the Calendar to a module view, or with `"hours"` back to Opening hours (its month when
   *  `params.month` names one, else its year). A view it was not given is ignored. */
  private openCalendarView(view: string, params: Record<string, string>) {
    if (!this.isConnected) return;
    if (view === "hours") return void this.writeAddress(this.hoursUrl(params));
    if (!this.calendarView(view)) return;
    void this.writeAddress(this.calendarUrl(calendarViewPath(view, params)));
  }
  private calendarUrl(pathname: string) {
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    url.searchParams.delete("station");
    url.pathname = pathname;
    return url;
  }
  private hoursUrl(params: Readonly<Record<string, string>>) {
    return this.calendarUrl(hoursPath(parseCalendarMonth(params["month"])));
  }
  /** The switch carries the month the page shows, when it shows one. */
  private chooseCalendarView(id: string) {
    const month = this.moduleView
      ? this.moduleView.params["month"]
      : this.view === "month"
        ? this.shownMonth()
        : "";
    this.openCalendarView(id, month ? { month } : {});
  }
  private static readonly ViewHost = class implements CalendarViewHost {
    constructor(
      private readonly screen: OpeningHoursScreen,
      private readonly id: string,
    ) {}
    get month() {
      return this.screen.moduleMonth();
    }
    get params() {
      const shown = this.screen.moduleView;
      return shown?.id === this.id ? shown.params : {};
    }
    get canWrite() {
      return this.screen.calendarView(this.id)?.canWrite ?? false;
    }
    /** A field, so a view may hand `host.open` on alone. */
    readonly open = (view: string, params: Record<string, string>) =>
      this.screen.openCalendarView(view, params);
  };
  private viewHandle({ view }: CalendarViewEntry) {
    let handle = this.viewHandles.get(view.id);
    if (!handle) {
      handle = view.create(this.calendar!.ctx, new OpeningHoursScreen.ViewHost(this, view.id));
      this.viewHandles.set(view.id, handle);
    }
    return handle;
  }
  private calendarHeading() {
    const views = this.calendar?.views ?? [];
    const heading = html`<h1>${t("nav.calendar")}</h1>`;
    if (views.length === 0) return heading;
    const chosen = this.moduleView?.id ?? "hours";
    const option = (value: string, label: string) =>
      html`<label
        ><input
          type="radio"
          name="calendarView"
          value=${value}
          .checked=${live(chosen === value)}
          @change=${() => this.chooseCalendarView(value)}
        /><span>${label}</span></label
      >`;
    return html`<div class="title">
      ${heading}
      <div
        class="segmented"
        role="radiogroup"
        aria-label=${t("nav.calendar")}
        data-test="calendar-switch"
      >
        ${option("hours", t("opening.title"))}
        ${views.map(({ view }) => option(view.id, tKit(view.labelKey)))}
      </div>
    </div>`;
  }
  private moduleContent(address: ModuleAddress) {
    const entry = this.calendarView(address.id)!;
    return this.viewHandle(entry).render(!entry.canWrite);
  }
  /** Whether an address with no view names a department, zone, season or an old `?station=`, which
   *  opens the season painter rather than the Year (ruling R3). */
  private namesWeek(url: URL) {
    return (
      ["department", "zone", "season"].some((key) => this.url.read(key) !== null) ||
      url.searchParams.has("station")
    );
  }
  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        const first = !this.model;
        this.model = model;
        if (first) this.namePainterTarget();
        this.readError = "";
      },
      () => {
        this.readError = t("opening.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.detach?.();
    this.monthDetach?.();
    this.watchedMonth = "";
    this.yearDetach?.();
    this.watchedYear = 0;
    this.holidayDetach?.();
    this.watchedHolidayMonth = "";
    this.generation = {};
    this.busy = false;
    super.disconnectedCallback();
  }
  private department() {
    const departments = this.model?.departments ?? [];
    return (
      departments.find((d) => d.id === this.departmentId) ??
      departments.find((d) => d.active) ??
      departments[0]
    );
  }
  protected override willUpdate(changed: PropertyValues<this>) {
    // A new list without the shown view returns to Opening hours, replacing the address naming it.
    if (changed.has("calendar") && this.moduleView && !this.calendarView(this.moduleView.id)) {
      const { params } = this.moduleView;
      this.moduleView = undefined;
      this.replaceAddress(this.hoursUrl(params));
    }
    if (!this.model) return;
    this.watchYear();
    this.watchMonth();
    this.watchHolidays();
  }
  private shownYear() {
    if (this.view !== "year" || !this.model) return 0;
    return (
      this.requestedYear ||
      Number((businessDateToday(this.model) || String(new Date().getFullYear())).slice(0, 4))
    );
  }
  private watchYear() {
    const year = this.shownYear();
    if (year === this.watchedYear) return;
    this.yearDetach?.();
    this.yearDetach = undefined;
    this.watchedYear = year;
    this.yearReadError = "";
    // The last year stays drawn until the next one arrives, so the pressed ‹ or › keeps focus.
    if (!year) {
      this.yearModel = undefined;
      return;
    }
    const current = () => this.isConnected && this.watchedYear === year;
    this.yearDetach = this.api.watchYear(
      year,
      (model) => {
        if (!current()) return;
        this.yearModel = model;
        this.yearReadError = "";
      },
      () => {
        if (!current()) return;
        this.yearReadError = t("opening.load_error");
        if (this.yearModel?.year !== year) this.yearModel = undefined;
      },
      () => {
        if (current()) this.yearReadError = "";
      },
    );
  }
  private shownMonth() {
    if (!this.model || this.view !== "month") return "";
    if (this.requestedMonth) return this.requestedMonth;
    const today = businessDateToday(this.model);
    return (today || browserToday()).slice(0, 7);
  }
  private watchMonth() {
    const month = this.shownMonth();
    if (month === this.watchedMonth) return;
    this.monthDetach?.();
    this.monthDetach = undefined;
    this.watchedMonth = month;
    this.monthReadError = "";
    if (!month) {
      this.monthModel = undefined;
      return;
    }
    this.monthDetach = this.api.watchMonth(
      month,
      (model) => {
        this.monthModel = model;
        this.monthReadError = "";
      },
      () => {
        this.monthReadError = t("opening.load_error");
        if (this.monthModel?.month !== month) this.monthModel = undefined;
      },
      () => {
        this.monthReadError = "";
      },
    );
  }
  /** The public holidays this screen already holds for `date`'s month, or none when it holds no
   *  read covering it. */
  private heldHolidays(date: LocalDate): readonly HolidayFact[] | undefined {
    const month = date.slice(0, 7);
    if (this.sentHolidays?.date === date) return this.sentHolidays.holidays;
    if (this.monthModel?.month === month)
      return this.monthModel.days.flatMap((day) => day.holidays);
    if (this.yearModel?.year === Number(date.slice(0, 4)))
      return this.yearModel.days.flatMap((day) => day.holidays);
    if (this.holidayRead?.month === month) return this.holidayRead.holidays;
    return undefined;
  }
  /** A new special day on a date opens pre-filled only if its holidays are known as it opens, so
   *  on an address alone (a reload, Back or Forward) the date's month is read for them. */
  private holidayMonthNeeded() {
    const date = this.special?.specialDayId === null ? this.special.date : null;
    if (!date || this.sentHolidays?.date === date) return "";
    const month = date.slice(0, 7);
    if (this.watchedMonth === month && !this.monthReadError) return "";
    if (this.watchedYear === Number(date.slice(0, 4)) && !this.yearReadError) return "";
    return month;
  }
  private watchHolidays() {
    const month = this.holidayMonthNeeded();
    if (month === this.watchedHolidayMonth) return;
    this.holidayDetach?.();
    this.holidayDetach = undefined;
    this.watchedHolidayMonth = month;
    if (!month) return;
    const settled = (holidays: readonly HolidayFact[]) => {
      if (this.watchedHolidayMonth === month) this.holidayRead = { month, holidays };
    };
    this.holidayDetach = this.api.watchMonth(
      month,
      (model) => settled(model.days.flatMap((day) => day.holidays)),
      // A failed read opens the day unfilled rather than not at all.
      () => {
        if (this.holidayRead?.month !== month) settled([]);
      },
      () => {},
    );
  }
  /** Feeds only the season dialog's naming of a refusal, so a failed read keeps the last list. */
  private readKnownSpecialDays() {
    const read = (this.knownSpecialDaysRead = {});
    void this.api.specialDays.listSpecialDays({ passive: true }).then(
      (days) => {
        if (this.isConnected && this.knownSpecialDaysRead === read)
          this.knownSpecialDays = days.map(({ id, name }) => ({ id, name }));
      },
      () => {},
    );
  }
  private readonly areaWrites = {
    saveHolidayArea: (areaKey: string) => this.api.specialDays.saveHolidayArea(areaKey),
    rereadWatches: () => this.api.rereadWithSpecialDays(),
  };
  private openMonth(event: CustomEvent<{ date: string }>) {
    event.stopPropagation();
    void Promise.resolve(
      this.url.write({
        dashboard: "opening-hours",
        view: "month",
        month: event.detail.date.slice(0, 7),
        year: null,
      }),
    ).then(() => this.followUrl());
  }
  private async writeAddress(url: URL, replace = false) {
    const generation = this.generation;
    const view = this.view;
    const painter = this.painter;
    const special = this.special;
    const guard = navigationGuardFor(window);
    if (guard) {
      await guard.write(url, replace);
      if (this.isConnected && generation === this.generation) this.followUrl();
      return;
    }
    const proceed = () => {
      if (
        !this.isConnected ||
        generation !== this.generation ||
        this.view !== view ||
        this.painter !== painter ||
        this.special !== special
      )
        return;
      if (replace) history.replaceState(history.state, "", url);
      else history.pushState(history.state, "", url);
      this.followUrl();
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) await coordinator.request({ scopes: "all", reason: "navigation", proceed });
    else proceed();
  }
  /** Rewrites the address in place without the leave question: the painter keeps its draft across
   *  a department switch, and a guarded write would offer to discard it. */
  private replaceAddress(url: URL) {
    const guard = navigationGuardFor(window);
    if (guard) {
      if (leaveCoordinatorFor(this)?.isDirty()) guard.rewrite(url);
      else void guard.write(url, true);
      return;
    }
    history.replaceState(history.state, "", url);
    this.followUrl();
  }
  private painterUrl({ seasonId, departmentId, zoneId }: PainterAddress) {
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    url.pathname = seasonPainterPath({ seasonId, departmentId, zoneId });
    url.searchParams.delete("station");
    return url;
  }
  /** Opens the painter on `seasonId` for the department the screen shows, over the current view. */
  private async openPainter(seasonId: string) {
    const department = this.department();
    const wasOpen = this.overlaid();
    await this.writeAddress(
      this.painterUrl({
        seasonId,
        departmentId: department?.active ? department.id : "",
        zoneId: "",
      }),
    );
    this.markPushedPainter(wasOpen);
  }
  /** Whether a painter, of a season or of a special day, is drawn over the view. */
  private overlaid() {
    return this.painter !== undefined || this.special !== undefined;
  }
  private specialUrl({ specialDayId, date }: SpecialAddress) {
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    url.pathname = specialDayPainterPath({ specialDayId, date });
    url.searchParams.delete("station");
    return url;
  }
  /** Opens the special-day painter over the current view; `holidays` are the ones the view sent. */
  private async openSpecialPainter(address: SpecialAddress, holidays: readonly HolidayFact[] = []) {
    if (!this.isConnected || this.readOnly || this.busy || this.namedAction || this.overlaid())
      return;
    this.specialReadError = "";
    this.sentHolidays = address.date ? { date: address.date, holidays } : undefined;
    await this.writeAddress(this.specialUrl(address));
    this.markPushedPainter(false);
  }
  private markPushedPainter(wasOpen: boolean) {
    if (wasOpen || !this.isConnected || !this.overlaid()) return;
    const guard = navigationGuardFor(window);
    let entry: string;
    if (guard) {
      const { epoch, index } = guard.position;
      entry = `${epoch}:${index}`;
    } else {
      entry = crypto.randomUUID();
      history.replaceState(
        { ...Object(history.state), [painterEntryKey]: entry },
        "",
        location.href,
      );
    }
    this.pushedPainter = { entry, base: this.baseHref };
  }
  private atPushedPainter() {
    const pushed = this.pushedPainter;
    if (!pushed || pushed.base !== this.baseHref) return false;
    const guard = navigationGuardFor(window);
    if (!guard) return Object(history.state)[painterEntryKey] === pushed.entry;
    const { epoch, index } = guard.position;
    return `${epoch}:${index}` === pushed.entry;
  }
  private painterTarget(model: OpeningHoursModel, named: PainterAddress) {
    const active = model.departments.filter((department) => department.active);
    const department = active.find((candidate) => candidate.id === named.departmentId) ?? active[0];
    return {
      seasonId: chosenSeasonId(model.seasons, model.currentSeasonId, named.seasonId),
      departmentId: department?.id ?? "",
      zoneId: department?.zones.find((zone) => zone.id === named.zoneId)?.id ?? "",
    };
  }
  /** Puts what the painter shows in the address when it names a season, department or zone it
   *  cannot show. Only on arrival: a refresh that removes the shown season is the painter's to tell. */
  private namePainterTarget() {
    const named = this.painter;
    if (!named || !this.model) return;
    const target = this.painterTarget(this.model, named);
    if (
      target.seasonId !== named.seasonId ||
      target.departmentId !== named.departmentId ||
      target.zoneId !== named.zoneId
    )
      this.replaceAddress(this.painterUrl(target));
  }
  /** A painter the screen has already let go of may still finish an update and announce it. */
  private currentPainter(event: Event) {
    return (
      this.isConnected &&
      this.overlaid() &&
      event.currentTarget ===
        this.shadowRoot?.querySelector(this.painter ? "season-painter" : "special-day-painter")
    );
  }
  /** Closes either painter: back to the entry it was pushed over, else to the view it drew over. */
  private closePainter() {
    const pushed = this.atPushedPainter();
    this.pushedPainter = undefined;
    if (pushed) history.back();
    else this.replaceAddress(new URL(this.baseHref ?? hoursPath(), location.href));
  }
  /** The painter is given what the address names, not what that resolves to, so that when a
   *  refresh removes it the painter sees it go and tells (ruling R11). */
  private seasonPainter() {
    const named = this.painter;
    if (!named || !this.model) return nothing;
    return html`<season-painter
      .open=${true}
      .api=${this.api}
      .model=${this.model}
      .seasonId=${named.seasonId}
      .departmentId=${named.departmentId}
      .zoneId=${named.zoneId}
      .readOnly=${this.readOnly}
      @painter-navigate=${(event: CustomEvent<PainterNavigation>) => {
        event.stopPropagation();
        if (!this.currentPainter(event)) return;
        const { seasonId, departmentId, zoneId } = event.detail;
        this.replaceAddress(this.painterUrl({ seasonId, departmentId, zoneId: zoneId ?? "" }));
      }}
      @painter-close=${(event: Event) => {
        event.stopPropagation();
        if (this.currentPainter(event)) this.closePainter();
      }}
      @click=${(event: MouseEvent) => {
        const link = event
          .composedPath()
          .find(
            (node): node is HTMLAnchorElement =>
              node instanceof HTMLAnchorElement && node.dataset["test"] === "periods-link",
          );
        if (
          !link ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        void this.writeAddress(new URL(link.href));
      }}
    ></season-painter>`;
  }
  private specialPainter() {
    const address = this.special;
    if (!address || !this.model) return nothing;
    const { specialDayId, date } = address;
    const held = date ? this.heldHolidays(date) : [];
    // Only a new day's opening depends on them: they decide its pre-filled name.
    if (held === undefined && specialDayId === null) return nothing;
    const holidays = [
      ...(held ?? []),
      ...(this.monthModel?.days.flatMap((day) => day.holidays) ?? []),
      ...(this.yearModel?.days.flatMap((day) => day.holidays) ?? []),
    ];
    return html`<special-day-painter
      .open=${true}
      .api=${this.api}
      .model=${this.model}
      .specialDayId=${specialDayId}
      .date=${specialDayId === null ? date : null}
      .addDate=${specialDayId === null ? null : date}
      .holidays=${holidays}
      .readOnly=${this.readOnly}
      @special-day-saved=${(event: CustomEvent<{ detail: SpecialDayDetail }>) => {
        event.stopPropagation();
        if (this.currentPainter(event) && this.special?.specialDayId === null)
          this.replaceAddress(
            this.specialUrl({ specialDayId: event.detail.detail.id, date: null }),
          );
      }}
      @special-day-navigate=${(event: CustomEvent<{ specialDayId: string }>) => {
        event.stopPropagation();
        if (this.currentPainter(event))
          this.replaceAddress(
            this.specialUrl({ specialDayId: event.detail.specialDayId, date: null }),
          );
      }}
      @special-day-deleted=${(event: Event) => {
        // The painter closes itself next, and its painter-close closes the address.
        event.stopPropagation();
      }}
      @painter-close=${(event: Event) => {
        event.stopPropagation();
        if (this.currentPainter(event)) this.closePainter();
      }}
    ></special-day-painter>`;
  }
  private openNamedDay(event: CustomEvent<SpecialDayAction>) {
    event.stopPropagation();
    if (
      ![
        this.shadowRoot?.querySelector("opening-hours-year"),
        this.shadowRoot?.querySelector("opening-hours-month"),
      ].some((component) => component === event.currentTarget)
    )
      return;
    const action = event.detail;
    if (action.kind === "delete") {
      void this.askDeleteSpecial(action);
      return;
    }
    const date = isLocalDate(action.date) ? action.date : null;
    void this.openSpecialPainter(
      action.specialDay
        ? { specialDayId: action.specialDay.id, date: null }
        : { specialDayId: null, date },
      action.visibleHolidays ?? action.holidays,
    );
  }
  /** The Year panel's Delete: reads the special day, then asks in the screen's own confirmation. */
  private async askDeleteSpecial(sentAction: SpecialDayAction) {
    if (!this.isConnected || this.readOnly || this.busy || this.namedAction || this.overlaid())
      return;
    const { specialDay, ...detail } = sentAction;
    if (!specialDay) return;
    const action: OpenSpecialDay = { ...detail, clockRevision: this.model!.clockRevision };
    this.namedDeleteError = "";
    this.specialReadError = "";
    const generation = this.generation;
    this.busy = true;
    let opened: OpenSpecialDay;
    try {
      opened = { ...action, detail: await this.api.specialDays.readSpecialDay(specialDay.id) };
    } catch {
      if (this.isConnected && generation === this.generation)
        this.specialReadError = t("opening.load_error");
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (!this.isConnected || generation !== this.generation || this.namedAction) return;
    this.namedAction = opened;
  }
  private closeNamedDay(action: OpenSpecialDay) {
    if (!this.isConnected || this.namedAction !== action || this.busy) return;
    this.namedAction = undefined;
    void this.updateComplete.then(() => action.returnTo()?.focus());
  }
  private async deleteNamedDay(action: OpenSpecialDay) {
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.namedAction !== action ||
      !action.detail
    )
      return;
    const generation = this.generation;
    this.busy = true;
    this.namedDeleteError = "";
    try {
      await this.api.specialDays.deleteSpecialDay(action.detail.id, action.clockRevision);
    } catch {
      if (this.isConnected && generation === this.generation && this.namedAction === action)
        this.namedDeleteError = t("hours.save_error");
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (!this.isConnected || generation !== this.generation || this.namedAction !== action) return;
    this.closeNamedDay(action);
    this.api.rereadWithSpecialDays();
  }
  private namedDialog() {
    const action = this.namedAction;
    if (!action) return nothing;
    const current = () => this.isConnected && this.namedAction === action && !this.busy;
    return keyed(
      action,
      html`<wt-dialog
        open
        data-test="delete-special-day"
        heading=${t("hours.delete")}
        .dismissible=${!this.busy}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) this.closeNamedDay(action);
        }}
      >
        <p>
          ${format(action.detail!.repeatsYearly ? "special.delete_repeat" : "special.delete", { name: action.detail!.name })}
        </p>
        ${this.namedDeleteError ? html`<p role="alert">${this.namedDeleteError}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => {
              if (current()) this.closeNamedDay(action);
            }}
            >${t("hours.cancel")}</wt-button
          ><wt-button
            data-test="confirm-special-delete"
            variant="danger"
            ?disabled=${this.busy}
            ?loading=${this.busy}
            @click=${() => this.deleteNamedDay(action)}
            >${t("hours.delete")}</wt-button
          ></wt-form-actions
        >
      </wt-dialog>`,
    );
  }
  private openSeasonWeek(event: CustomEvent<{ seasonId: string }>) {
    event.stopPropagation();
    if (!this.isConnected || this.painter) return;
    void this.openPainter(event.detail.seasonId);
  }
  private openOrdinary(event: CustomEvent<OrdinaryDateOpen>) {
    event.stopPropagation();
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.namedAction ||
      this.ordinary ||
      event.currentTarget !== this.shadowRoot?.querySelector("opening-hours-month")
    )
      return;
    this.ordinary = event.detail;
    this.readKnownSpecialDays();
  }
  private ordinaryDialog() {
    const open = this.ordinary;
    const seasons = this.monthModel?.seasons ?? [];
    if (!open) return nothing;
    const season = seasons.find((row) => row.id === open.seasonId);
    const leave = (event: Event) => {
      event.stopPropagation();
      if (!this.isConnected || this.ordinary !== open) return false;
      this.ordinary = undefined;
      return true;
    };
    return keyed(
      open,
      html`<ordinary-date-dialog
        .open=${true}
        .date=${open.date}
        .season=${season ? { id: season.id, name: season.name } : undefined}
        .tint=${season ? (seasonTints(seasons).get(season.id) ?? "") : ""}
        .specialDays=${this.knownSpecialDays}
        .returnTo=${open.returnTo}
        @ordinary-date-close=${leave}
        @ordinary-date-edit-week=${(event: CustomEvent<{ seasonId: string }>) => {
          if (!leave(event)) return;
          void this.openPainter(event.detail.seasonId);
        }}
        @ordinary-date-make-special=${(event: CustomEvent<{ date: string }>) => {
          if (!leave(event)) return;
          void this.openSpecialPainter({ specialDayId: null, date: event.detail.date });
        }}
        @ordinary-date-add-to-special=${(
          event: CustomEvent<{ date: string; specialDayId: string }>,
        ) => {
          if (!leave(event)) return;
          const { date, specialDayId } = event.detail;
          void this.openSpecialPainter({ specialDayId, date });
        }}
      ></ordinary-date-dialog>`,
    );
  }
  private month() {
    const write = (changes: Record<string, string | null>) =>
      void Promise.resolve(this.url.write({ dashboard: "opening-hours", ...changes })).then(() =>
        this.followUrl(),
      );
    return html`${this.monthReadError ? html`<p role="alert" data-test="month-read-error">${this.monthReadError}</p>` : nothing}
      <opening-hours-month
        .model=${this.monthModel}
        .month=${this.shownMonth()}
        .departmentId=${this.departmentId}
        .departments=${this.model!.departments}
        .api=${this.api}
        .specialDays=${this.knownSpecialDays}
        .readOnly=${this.readOnly}
        @special-day-action=${this.openNamedDay}
        @ordinary-date-open=${this.openOrdinary}
        @season-dialog-open=${() => this.readKnownSpecialDays()}
        @season-week-open=${this.openSeasonWeek}
        @season-changed=${(event: Event) => {
          event.stopPropagation();
          this.api.rereadWithSpecialDays();
        }}
        @month-change=${(event: CustomEvent<{ month: string }>) => {
          event.stopPropagation();
          write({ view: "month", month: event.detail.month, date: null });
        }}
        @month-year-open=${(event: CustomEvent<{ year: number }>) => {
          event.stopPropagation();
          write({
            view: "year",
            year: String(event.detail.year).padStart(4, "0"),
            month: null,
            date: null,
          });
        }}
        @month-department-change=${(event: CustomEvent<{ departmentId: string }>) => {
          event.stopPropagation();
          write({ department: event.detail.departmentId || null, zone: null });
        }}
      ></opening-hours-month>`;
  }
  override render() {
    return html`${this.calendarHeading()}
    ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}${
      !this.model
        ? nothing
        : this.moduleView
          ? this.moduleContent(this.moduleView)
          : html` <wt-tabs
              label=${t("opening.title")}
              .value=${this.view === "month" ? "year" : this.view}
              .items=${[{ key: "year", label: t("opening.tab.year") }]}
              @wt-tab-change=${(event: CustomEvent<{ value: View }>) => {
                if (event.target !== event.currentTarget) return;
                (event.currentTarget as HTMLElementTagNameMap["wt-tabs"]).value =
                  this.view === "month" ? "year" : this.view;
                void this.url.write({
                  dashboard: "opening-hours",
                  view: event.detail.value,
                  year: null,
                  month: null,
                  date: null,
                });
                this.followUrl();
              }}
            >
              <div slot="year">
                ${
                  this.view === "year"
                    ? html`${this.yearReadError ? html`<p role="alert" data-test="year-read-error">${this.yearReadError}</p>` : nothing}
                        <opening-hours-year
                          .model=${this.yearModel}
                          .year=${this.shownYear()}
                          .api=${this.api}
                          .areaApi=${this.areaWrites}
                          .specialDays=${this.knownSpecialDays}
                          .readOnly=${this.readOnly}
                          @special-day-action=${this.openNamedDay}
                          @season-dialog-open=${() => this.readKnownSpecialDays()}
                          @season-week-open=${this.openSeasonWeek}
                          @season-changed=${(event: Event) => {
                            event.stopPropagation();
                            this.api.rereadWithSpecialDays();
                          }}
                          @year-change=${(event: CustomEvent<{ year: number }>) => {
                            event.stopPropagation();
                            void Promise.resolve(
                              this.url.write({
                                dashboard: "opening-hours",
                                view: "year",
                                year: String(event.detail.year).padStart(4, "0"),
                              }),
                            ).then(() => this.followUrl());
                          }}
                          @year-month-open=${this.openMonth}
                        ></opening-hours-year>`
                    : this.shownMonth()
                      ? this.month()
                      : nothing
                }
              </div>
            </wt-tabs>`
    }
    ${this.specialReadError ? html`<p role="alert" data-test="special-read-error">${this.specialReadError}</p>` : nothing}
    ${this.namedDialog()} ${this.ordinaryDialog()} ${this.seasonPainter()} ${this.specialPainter()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-opening-hours-screen": OpeningHoursScreen;
  }
}
