import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, setContentLanguages, submitOnEnter, type DataTableColumn } from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "../widgets/image-upload.js";
import "../widgets/member-list-editor.js";
import "../widgets/section-add-products.js";
import { colorField, colorFieldStyles } from "../widgets/color-field.js";
import type { AddableProduct } from "../widgets/section-add-products.js";
import type {
  CategorySummary,
  DashboardApi,
  LibrarySection,
  MemberRef,
  Product,
  SectionInput,
  SectionMember,
  SectionUsages,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

/** One place a section appears in the library tree. Every library section is at the top level, and
 * again under each section holding it, so the key is the path of ids from the top. */
interface Occurrence {
  key: string;
  parentKey: string | null;
  section: LibrarySection;
}

type Use = "menu" | "unused" | "sections";

const NO_USAGES: SectionUsages = { menus: [], sections: [] };

function usedInText(usages: SectionUsages): string {
  return [
    ...usages.menus.map((menu) => menu.name),
    ...usages.sections.map((section) => section.internalName),
  ].join(", ");
}

/** The field a refusal belongs beside, by what the error carries (packages/catalogue/src/errors.ts):
 * `menu_section.translation_required` names a language, `menu_section.invalid` a field. */
function fieldOf(error: unknown): string {
  const params = (error as { params?: { field?: unknown; language?: unknown } }).params;
  if (codeOf(error) === "menu_section.translation_required" && typeof params?.language === "string")
    return `names-${params.language}`;
  return typeof params?.field === "string" ? params.field : "_form";
}

/**
 * The reusable sections library. Details are a draft saved with Save; each member change is its own
 * request, sent in order through one queue, because a move leaves the widget's focus on the row.
 */
@customElement("dashboard-sections-screen")
export class SectionsScreen extends LitElement {
  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-xl);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .page-actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--wt-space-4);
      }
      .fields,
      .members {
        display: grid;
        gap: var(--wt-space-4);
      }
      .members {
        margin-top: var(--wt-space-6);
      }
      .field {
        display: grid;
        gap: var(--wt-space-1);
      }
      fieldset.names {
        display: grid;
        gap: var(--wt-space-3);
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      fieldset.names legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
      }
      .note,
      .help {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .help {
        font-size: var(--wt-font-size-sm);
      }
      .error,
      .field-error {
        color: var(--wt-color-danger);
      }
      .error {
        margin: 0;
      }
      .picks {
        display: grid;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      .picks legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
      }
      .pick {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
      }
      .pick input {
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        margin: 0;
        flex: none;
      }
      .kind {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      dl {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
      }
      dt {
        font-weight: var(--wt-font-weight-bold);
      }
      dd {
        margin: 0;
      }
      wt-data-table::part(name) {
        overflow-wrap: anywhere;
        text-align: start;
      }
      /* A tree ancestor kept only to show a match below it. The colour must reach the button in
         wt-button's own shadow root, so the token its ghost variant reads is re-pointed on it. */
      wt-data-table::part(name-muted) {
        --wt-color-text: var(--wt-color-text-muted);
      }
      wt-data-table::part(muted) {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private sections: LibrarySection[] = [];
  @state() private usages: Record<string, SectionUsages> = {};
  @state() private products: Product[] = [];
  @state() private categories: CategorySummary[] = [];
  @state() private locales: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private loadError = false;

  @state() private editorOpen = false;
  /** Null while creating. */
  @state() private editorId: string | null = null;
  @state() private editorView: "details" | "add-products" = "details";
  @state() private internalName = "";
  @state() private names: Record<string, string> = {};
  @state() private image: string | null = null;
  @state() private color: string | null = null;
  @state() private pickerOpen = false;
  @state() private fieldErrors: Record<string, string> = {};
  @state() private memberError: string | null = null;
  @state() private membersReloadError = false;
  @state() private editorMembers: SectionMember[] = [];
  @state() private editorUsages: SectionUsages | null = null;
  @state() private editorUsagesError = false;
  @state() private busy = false;

  @state() private duplicating: { source: LibrarySection; chosen: ReadonlySet<string> } | null =
    null;
  @state() private duplicateName = "";
  @state() private duplicateErrors: Record<string, string> = {};

  @state() private deleting: { id: string; name: string } | null = null;
  @state() private deleteUsages: SectionUsages | null = null;
  @state() private deleteUsagesError = false;
  @state() private deleteError: string | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
  );

  #occurrences: Occurrence[] = [];
  #byId = new Map<string, LibrarySection>();
  #memberProducts: { id: string; name: string }[] = [];
  #productNames = new Map<string, string>();
  #addable: AddableProduct[] = [];
  #sectionChoices: { id: string; internalName: string }[] = [];
  #excluded: string[] = [];

  /** Counts each time the editor opens a section or closes, so an answer for an earlier one is
   * recognised and dropped. */
  #session = 0;
  #deleteGeneration = 0;
  /** Member writes run one after another, in the order asked. */
  #chain: Promise<void> = Promise.resolve();
  #pending = 0;
  /** Bumped when a move is refused: the moves queued behind it were made against an order the
   * server never reached, so they are dropped. */
  #moveGeneration = 0;
  #membersChanged = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("sections")) {
      this.#byId = new Map(this.sections.map((section) => [section.id, section]));
      this.#occurrences = this.#tree();
      this.#sectionChoices = this.sections.map(({ id, internalName }) => ({ id, internalName }));
    }
    // The picker offers Active products; an Inactive one the list already holds is passed too, only
    // so its row keeps its name (the editor never offers a product the list holds).
    if (changed.has("products") || changed.has("editorMembers")) {
      const held = new Set(
        this.editorMembers.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : [])),
      );
      this.#memberProducts = this.products
        .filter((product) => product.active || held.has(product.id))
        .map(({ id, name }) => ({ id, name }));
    }
    if (changed.has("products")) {
      this.#productNames = new Map(this.products.map(({ id, name }) => [id, name]));
      this.#addable = this.products
        .filter((product) => product.active)
        .map(({ id, name, categoryId }) => ({ id, name, categoryId }));
    }
    if (changed.has("sections") || changed.has("editorId")) this.#excluded = this.#holders();
  }

  async #load(): Promise<void> {
    this.loadError = false;
    try {
      await Promise.all([
        this.#queries.watch("listSections", [], (value) => {
          this.sections = value;
        }),
        this.#queries.watch("listSectionUsages", [], (value) => {
          this.usages = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.locales = value;
          setContentLanguages(value);
        }),
        this.#queries.watch("listLibraryProducts", [], (value) => {
          this.products = value;
        }),
        this.#queries.watch("listCategories", [], (value) => {
          this.categories = value;
        }),
      ]);
      // A `?section=<id>` link (the image library's) opens that section's editor once; the
      // parameter is cleared so a refresh does not reopen it.
      const url = new URL(location.href);
      const linked = this.sections.find(({ id }) => id === url.searchParams.get("section"));
      if (linked) {
        this.#openEditor(linked);
        url.searchParams.delete("section");
        history.replaceState(history.state, "", url);
      }
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }

  #tree(): Occurrence[] {
    const out: Occurrence[] = [];
    const walk = (section: LibrarySection, path: string[], parentKey: string | null): void => {
      const here = [...path, section.id];
      const key = here.join("/");
      out.push({ key, parentKey, section });
      for (const { ref } of section.members) {
        if (ref.kind !== "section") continue;
        const child = this.#byId.get(ref.sectionId);
        // The server refuses a loop; a path is still never walked into itself.
        if (child && !here.includes(child.id)) walk(child, here, key);
      }
    };
    for (const section of this.sections) walk(section, [], null);
    return out;
  }

  /** The open section and every section holding it, however deep: adding any of them would make a
   * loop. The server refuses one anyway; this keeps the picker from offering it. */
  #holders(): string[] {
    if (this.editorId === null) return [];
    const parents = new Map<string, string[]>();
    for (const section of this.sections)
      for (const { ref } of section.members)
        if (ref.kind === "section")
          parents.set(ref.sectionId, [...(parents.get(ref.sectionId) ?? []), section.id]);
    const found = new Set([this.editorId]);
    const pending = [this.editorId];
    while (pending.length > 0)
      for (const parent of parents.get(pending.pop()!) ?? [])
        if (!found.has(parent)) {
          found.add(parent);
          pending.push(parent);
        }
    return [...found];
  }

  #usagesOf(id: string): SectionUsages {
    return this.usages[id] ?? NO_USAGES;
  }

  #useOf(id: string): Use {
    const usages = this.#usagesOf(id);
    if (usages.menus.length > 0) return "menu";
    return usages.sections.length === 0 ? "unused" : "sections";
  }

  #customerName(section: LibrarySection): string {
    return resolveEnabledContentText(section.names, currentLocale(), this.locales!);
  }

  #memberName(ref: MemberRef): string {
    const name =
      ref.kind === "product"
        ? this.#productNames.get(ref.productId)
        : this.#byId.get(ref.sectionId)?.internalName;
    return name ?? t("members.missing");
  }

  // ── Editor ────────────────────────────────────────────────────────────────────────────────────

  #openEditor(section: LibrarySection | null): void {
    const session = ++this.#session;
    this.editorOpen = true;
    this.editorId = section?.id ?? null;
    this.editorView = "details";
    this.internalName = section?.internalName ?? "";
    this.names = { ...section?.names };
    this.image = section?.image ?? null;
    this.color = section?.color ?? null;
    this.fieldErrors = {};
    this.memberError = null;
    this.membersReloadError = false;
    this.editorMembers = section?.members ?? [];
    this.editorUsages = null;
    this.editorUsagesError = false;
    if (section)
      void this.#readUsages(
        section.id,
        () => session === this.#session,
        (usages) => {
          if (usages) this.editorUsages = usages;
          else this.editorUsagesError = true;
        },
      );
  }

  #closeEditor(): void {
    this.#session++;
    this.editorOpen = false;
    if (this.#membersChanged) {
      this.#membersChanged = false;
      void this.#load();
    }
  }

  async #readUsages(
    id: string,
    current: () => boolean,
    apply: (usages: SectionUsages | null) => void,
  ): Promise<void> {
    let usages: SectionUsages | null = null;
    try {
      usages = await this.api.getSectionUsages(id);
    } catch {
      // Reported as a failure below rather than as "used nowhere".
    }
    if (current()) apply(usages);
  }

  async #save(): Promise<void> {
    if (this.busy || this.pickerOpen) return;
    const internalName = this.internalName.trim();
    if (internalName === "") {
      this.fieldErrors = { internalName: t("sections.internal_name_required") };
      return;
    }
    const input: SectionInput = {
      internalName,
      names: Object.fromEntries(
        Object.entries(this.names)
          .map(([language, text]) => [language, text.trim()])
          .filter(([, text]) => text !== ""),
      ),
      image: this.image,
      color: this.color,
    };
    this.busy = true;
    this.fieldErrors = {};
    let saved: LibrarySection;
    try {
      saved =
        this.editorId === null
          ? await this.api.createSection(input)
          : await this.api.updateSection(this.editorId, input);
    } catch (error) {
      this.fieldErrors = { [fieldOf(error)]: codeMessage(codeOf(error)) };
      this.busy = false;
      return;
    }
    this.busy = false;
    // The write succeeded, so what follows is never a failed save. A new section stays open as an
    // edit of itself, so members can be added without Save creating it twice.
    if (this.editorId === null) {
      this.editorId = saved.id;
      this.editorMembers = saved.members;
      this.editorUsages = NO_USAGES;
    } else {
      this.#membersChanged = false;
      this.#closeEditor();
    }
    await this.#load();
  }

  #enqueue(task: () => Promise<void>): void {
    this.#pending++;
    this.#chain = this.#chain.then(task).finally(() => {
      this.#pending--;
    });
  }

  /** A write in another editor session leaves nothing to show here, but the list is stale. */
  #wrote(session: number): void {
    if (session === this.#session) this.#membersChanged = true;
    else void this.#load();
  }

  async #reloadMembers(sectionId: string): Promise<void> {
    try {
      this.editorMembers = await this.api.listSectionMembers(sectionId);
    } catch {
      this.membersReloadError = true;
    }
  }

  /** Not `busy`: that would disable the handle the keyboard user is on and drop their focus. */
  #move(memberId: string, to: number): void {
    const sectionId = this.editorId!;
    const session = this.#session;
    const generation = this.#moveGeneration;
    this.memberError = null;
    this.#enqueue(async () => {
      if (generation !== this.#moveGeneration) return;
      try {
        const ordered = await this.api.moveSectionMember(sectionId, memberId, to);
        this.#wrote(session);
        // An earlier answer is already out of date when more moves wait behind it.
        if (session === this.#session && this.#pending === 1) this.editorMembers = ordered;
      } catch (error) {
        this.#moveGeneration++;
        if (session !== this.#session) return;
        this.memberError = codeMessage(codeOf(error));
        await this.#reloadMembers(sectionId);
      }
    });
  }

  /** Adds and removes hold `busy`, which keeps the editor open, so the session cannot change. */
  #memberWrite(write: (sectionId: string) => Promise<unknown>, done?: () => void): void {
    const sectionId = this.editorId!;
    const session = this.#session;
    this.memberError = null;
    this.membersReloadError = false;
    this.busy = true;
    this.#enqueue(async () => {
      try {
        await write(sectionId);
      } catch (error) {
        this.memberError = codeMessage(codeOf(error));
        this.busy = false;
        return;
      }
      this.#wrote(session);
      done?.();
      await this.#reloadMembers(sectionId);
      this.busy = false;
    });
  }

  // ── Duplicate and delete ─────────────────────────────────────────────────────────────────────

  #openDuplicate(section: LibrarySection): void {
    this.duplicating = {
      source: section,
      chosen: new Set(section.members.map((member) => member.id)),
    };
    this.duplicateName = t("sections.copy_name").replace("{name}", section.internalName);
    this.duplicateErrors = {};
  }

  async #duplicate(): Promise<void> {
    const duplicating = this.duplicating!;
    if (this.busy) return;
    const internalName = this.duplicateName.trim();
    if (internalName === "") {
      this.duplicateErrors = { internalName: t("sections.internal_name_required") };
      return;
    }
    const { source, chosen } = duplicating;
    this.busy = true;
    this.duplicateErrors = {};
    try {
      await this.api.duplicateSection(source.id, {
        internalName,
        memberIds: source.members.filter((member) => chosen.has(member.id)).map(({ id }) => id),
      });
    } catch (error) {
      this.duplicateErrors = { [fieldOf(error)]: codeMessage(codeOf(error)) };
      this.busy = false;
      return;
    }
    this.busy = false;
    this.duplicating = null;
    await this.#load();
  }

  #openDelete(section: LibrarySection): void {
    const generation = ++this.#deleteGeneration;
    this.deleting = { id: section.id, name: section.internalName };
    this.deleteUsages = null;
    this.deleteUsagesError = false;
    this.deleteError = null;
    void this.#readUsages(
      section.id,
      () => generation === this.#deleteGeneration,
      (usages) => {
        if (usages) this.deleteUsages = usages;
        else this.deleteUsagesError = true;
      },
    );
  }

  #closeDelete(): void {
    this.#deleteGeneration++;
    this.deleting = null;
  }

  async #delete(): Promise<void> {
    const deleting = this.deleting!;
    if (this.busy || this.deleteUsages === null) return;
    this.busy = true;
    this.deleteError = null;
    try {
      await this.api.deleteSection(deleting.id);
    } catch (error) {
      this.deleteError = codeMessage(codeOf(error));
      this.busy = false;
      return;
    }
    this.busy = false;
    this.#closeDelete();
    await this.#load();
  }

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────

  #columns(): DataTableColumn<Occurrence>[] {
    return [
      {
        key: "name",
        label: t("sections.internal_name"),
        sortValue: ({ section }) => section.internalName,
        searchValue: ({ section }) =>
          [section.internalName, ...Object.values(section.names)].join(" "),
        cell: ({ key, section }, { ancestorOnly }) =>
          html`<wt-button
            variant="ghost"
            part=${ancestorOnly ? "name name-muted" : "name"}
            data-test=${`open-${key}`}
            @click=${() => this.#openEditor(section)}
            ><span data-test="name">${section.internalName}</span></wt-button
          >`,
      },
      {
        key: "customerName",
        label: t("sections.customer_name"),
        sortValue: ({ section }) => this.#customerName(section),
        cell: ({ section }) => this.#customerName(section),
      },
      {
        key: "members",
        label: t("sections.member_count"),
        align: "end",
        sortValue: ({ section }) => section.members.length,
        // Without this the search would fall back to the count and match every section of that size.
        searchValue: () => "",
        cell: ({ section }) => String(section.members.length),
      },
      {
        key: "usedIn",
        label: t("sections.used_in"),
        sortValue: ({ section }) => usedInText(this.#usagesOf(section.id)),
        cell: ({ section }) => {
          const text = usedInText(this.#usagesOf(section.id));
          return text
            ? html`<span data-test="used-in">${text}</span>`
            : html`<span data-test="used-in" part="muted">${t("sections.not_used")}</span>`;
        },
        filter: {
          label: t("sections.used_in"),
          allLabel: t("sections.used_in_any"),
          value: ({ section }) => this.#useOf(section.id),
          options: [
            { value: "menu", label: t("sections.used_in_menu") },
            { value: "unused", label: t("sections.not_used") },
          ],
        },
      },
      {
        key: "actions",
        label: t("sections.actions"),
        cell: ({ key, section }) =>
          html`<wt-row-actions label=${`${t("sections.actions")}: ${section.internalName}`}
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`edit-${key}`}
              @click=${() => this.#openEditor(section)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`duplicate-${key}`}
              @click=${() => this.#openDuplicate(section)}
              >${t("sections.duplicate")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`delete-${key}`}
              @click=${() => this.#openDelete(section)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
  }

  #renderList() {
    return html`<div class="page-actions">
        <wt-button data-test="add-section" variant="primary" @click=${() => this.#openEditor(null)}
          >${t("sections.add")}</wt-button
        >
      </div>
      <wt-data-table
        data-test="sections"
        aria-label=${t("sections.title")}
        searchable
        searchLabel=${t("sections.search")}
        noMatchesMessage=${t("sections.no_matches")}
        viewKey="waitron.sections.table"
        sortKey="name"
        sortDirection="ascending"
        initiallyCollapsed
        collapseLabel=${t("sections.collapse")}
        expandLabel=${t("sections.expand")}
        .rows=${this.#occurrences}
        .columns=${this.#columns()}
        .rowKey=${(row: Occurrence) => row.key}
        .rowParent=${(row: Occurrence) => row.parentKey}
        .emptyMessage=${t("sections.empty")}
      ></wt-data-table>`;
  }

  #summary(errors: string[]) {
    return html`<wt-form-error-summary
      heading=${t("form.error_heading")}
      .errors=${errors}
    ></wt-form-error-summary>`;
  }

  #renderUsedIn() {
    const text = this.editorUsagesError
      ? t("sections.usages_error")
      : this.editorUsages === null
        ? t("sections.usages_loading")
        : this.editorUsages.menus.length + this.editorUsages.sections.length === 0
          ? t("sections.used_nowhere")
          : t("sections.used_in_note").replace("{list}", usedInText(this.editorUsages));
    return html`<p
      class=${this.editorUsagesError ? "error" : "note"}
      data-test="editor-used-in"
      role="status"
    >
      ${text}
    </p>`;
  }

  #renderMemberError() {
    return this.memberError
      ? html`<p class="error" role="alert" data-test="member-error">${this.memberError}</p>`
      : nothing;
  }

  #renderMembers() {
    if (this.editorId === null)
      return html`<p class="note" data-test="members-after-create">
        ${t("sections.members_after_create")}
      </p>`;
    return html`${this.#renderUsedIn()}
      <p class="help">${t("sections.members_saved_note")}</p>
      ${this.#renderMemberError()}
      ${
        this.membersReloadError
          ? html`<p class="error" role="alert" data-test="members-reload-error">
              ${t("sections.members_reload_error")}
            </p>`
          : nothing
      }
      <dashboard-member-list-editor
        .members=${this.editorMembers}
        .products=${this.#memberProducts}
        .sections=${this.#sectionChoices}
        .excludeSectionIds=${this.#excluded}
        .busy=${this.busy}
        label=${t("sections.members_label").replace("{name}", this.internalName)}
        @wt-member-add=${(event: CustomEvent<{ ref: MemberRef }>) => {
          event.stopPropagation();
          const { ref } = event.detail;
          this.#memberWrite((id) => this.api.addSectionMember(id, ref));
        }}
        @wt-member-remove=${(event: CustomEvent<{ memberId: string }>) => {
          event.stopPropagation();
          const { memberId } = event.detail;
          this.#memberWrite((id) => this.api.removeSectionMember(id, memberId));
        }}
        @wt-member-move=${(event: CustomEvent<{ memberId: string; to: number }>) => {
          event.stopPropagation();
          this.#move(event.detail.memberId, event.detail.to);
        }}
        @wt-member-open=${(event: CustomEvent<{ sectionId: string }>) => {
          event.stopPropagation();
          const section = this.#byId.get(event.detail.sectionId);
          if (section) this.#openEditor(section);
        }}
      ></dashboard-member-list-editor>
      <div>
        <wt-button
          data-test="open-add-products"
          variant="secondary"
          .disabled=${this.busy}
          @click=${() => {
            this.memberError = null;
            this.editorView = "add-products";
          }}
          >${t("sections.add_products")}</wt-button
        >
      </div>`;
  }

  #renderDetails() {
    const errors = this.fieldErrors;
    const languages = this.locales!.languages;
    return html`<div class="fields" ?inert=${this.busy}>
        ${this.#summary([...Object.values(errors), ...(this.memberError ? [this.memberError] : [])])}
        <div
          class="fields"
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>('[data-test="editor-save"]'),
            )}
        >
          <div class="field">
            <wt-input
              name="internalName"
              required
              label=${t("sections.internal_name")}
              .value=${this.internalName}
              .error=${errors.internalName ?? ""}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.internalName = event.detail.value;
                const remaining = { ...this.fieldErrors };
                delete remaining.internalName;
                this.fieldErrors = remaining;
              }}
            ></wt-input>
            <p class="help">${t("sections.internal_name_help")}</p>
          </div>
          <fieldset class="names" aria-describedby="section-names-error">
            <legend>${t("sections.customer_names")}</legend>
            ${languages.map(
              (language) =>
                html`<wt-input
                  name=${`names-${language}`}
                  label=${`${t("sections.customer_name")} (${language})`}
                  .value=${this.names[language] ?? ""}
                  .error=${errors[`names-${language}`] ?? ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.names = { ...this.names, [language]: event.detail.value };
                  }}
                ></wt-input>`,
            )}
            <span class="field-error" id="section-names-error">${errors.names ?? nothing}</span>
          </fieldset>
        </div>
        ${colorField({
          color: this.color,
          busy: this.busy,
          error: errors.color ?? "",
          name: "section-color",
          errorId: "section-color-error",
          change: (color) => {
            this.color = color;
          },
        })}
        <dashboard-image-upload
          aria-describedby="section-image-error"
          .api=${this.api}
          .image=${this.image}
          @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
            event.stopPropagation();
            this.pickerOpen = event.detail.open;
          }}
          @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
            event.stopPropagation();
            this.image = event.detail.image;
          }}
        ></dashboard-image-upload>
        <span class="field-error" id="section-image-error">${errors.image ?? nothing}</span>
      </div>
      <section class="members" aria-labelledby="section-members-heading">
        <h2 id="section-members-heading">${t("sections.members")}</h2>
        ${this.#renderMembers()}
      </section>`;
  }

  #renderAddProducts() {
    const held = this.editorMembers.flatMap(({ ref }) =>
      ref.kind === "product" ? [ref.productId] : [],
    );
    return html`${this.#renderMemberError()}
      <dashboard-section-add-products
        .products=${this.#addable}
        .categories=${this.categories}
        .inSection=${held}
        .onMenu=${null}
        .busy=${this.busy}
        @wt-add-products=${(event: CustomEvent<{ productIds: string[] }>) => {
          event.stopPropagation();
          const { productIds } = event.detail;
          this.#memberWrite(
            (id) => this.api.addSectionProducts(id, productIds),
            () => {
              this.editorView = "details";
            },
          );
        }}
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="add-products-back"
          .disabled=${this.busy}
          @click=${() => {
            this.memberError = null;
            this.editorView = "details";
          }}
          >${t("action.back")}</wt-button
        ></dashboard-section-add-products
      >`;
  }

  #editorHeading(): string {
    if (this.editorView === "add-products")
      return t("sections.add_products_heading").replace("{name}", this.internalName);
    return t(this.editorId === null ? "sections.create" : "sections.edit");
  }

  #renderEditor() {
    const details = this.editorView === "details";
    return html`<wt-modal
      data-test="editor"
      .open=${this.editorOpen}
      heading=${this.#editorHeading()}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.editorOpen && !this.busy && !this.pickerOpen) this.#closeEditor();
      }}
    >
      ${this.editorOpen ? (details ? this.#renderDetails() : this.#renderAddProducts()) : nothing}
      ${
        details
          ? html`<wt-form-actions slot="footer"
              ><wt-button
                slot="cancel"
                variant="secondary"
                data-test="editor-cancel"
                .disabled=${this.busy}
                @click=${() => {
                  if (!this.busy) this.#closeEditor();
                }}
                >${t("action.cancel")}</wt-button
              ><wt-button
                variant="primary"
                data-test="editor-save"
                .disabled=${this.busy || this.pickerOpen}
                @click=${() => void this.#save()}
                >${t("action.save")}</wt-button
              ></wt-form-actions
            >`
          : nothing
      }
    </wt-modal>`;
  }

  #renderDuplicate() {
    const duplicating = this.duplicating;
    const errors = this.duplicateErrors;
    return html`<wt-modal
      data-test="duplicate"
      .open=${duplicating !== null}
      heading=${t("sections.duplicate_heading").replace(
        "{name}",
        duplicating?.source.internalName ?? "",
      )}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) this.duplicating = null;
      }}
    >
      ${
        duplicating
          ? html`<div class="fields" ?inert=${this.busy}>
              ${this.#summary(Object.values(errors))}
              <wt-input
                name="internalName"
                required
                label=${t("sections.internal_name")}
                .value=${this.duplicateName}
                .error=${errors.internalName ?? ""}
                @keydown=${(event: KeyboardEvent) =>
                  submitOnEnter(
                    event,
                    this.shadowRoot!.querySelector<HTMLElement>('[data-test="duplicate-save"]'),
                  )}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.duplicateName = event.detail.value;
                  this.duplicateErrors = {};
                }}
              ></wt-input>
              <fieldset class="picks">
                <legend>${t("sections.duplicate_members")}</legend>
                ${duplicating.source.members.map(
                  (member) =>
                    html`<label class="pick">
                      <input
                        type="checkbox"
                        name="member"
                        value=${member.id}
                        .checked=${duplicating.chosen.has(member.id)}
                        @change=${() => {
                          const chosen = new Set(duplicating.chosen);
                          if (!chosen.delete(member.id)) chosen.add(member.id);
                          this.duplicating = { ...duplicating, chosen };
                        }}
                      />
                      <span>${this.#memberName(member.ref)}</span>
                      <span class="kind"
                        >${t(
                          member.ref.kind === "product"
                            ? "members.kind_product"
                            : "members.kind_section",
                        )}</span
                      >
                    </label>`,
                )}
              </fieldset>
              <p class="help">${t("sections.duplicate_note")}</p>
            </div>`
          : nothing
      }
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="duplicate-cancel"
          .disabled=${this.busy}
          @click=${() => {
            this.duplicating = null;
          }}
          >${t("action.cancel")}</wt-button
        ><wt-button
          variant="primary"
          data-test="duplicate-save"
          .disabled=${this.busy}
          @click=${() => void this.#duplicate()}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  #renderDeleteBody() {
    if (this.deleteUsagesError)
      return html`<p class="error" role="alert" data-test="delete-usages-error">
        ${t("sections.delete_usages_error")}
      </p>`;
    const usages = this.deleteUsages;
    if (usages === null) return html`<p role="status">${t("sections.usages_loading")}</p>`;
    if (usages.menus.length + usages.sections.length === 0)
      return html`<p data-test="delete-unused">${t("sections.delete_unused")}</p>`;
    return html`<p>${t("sections.delete_used")}</p>
      <dl>
        ${
          usages.menus.length > 0
            ? html`<dt>${t("sections.delete_menus")}</dt>
                <dd data-test="delete-menus">
                  ${usages.menus.map((menu) => menu.name).join(", ")}
                </dd>`
            : nothing
        }
        ${
          usages.sections.length > 0
            ? html`<dt>${t("sections.delete_sections")}</dt>
                <dd data-test="delete-sections">
                  ${usages.sections.map((section) => section.internalName).join(", ")}
                </dd>`
            : nothing
        }
      </dl>`;
  }

  #renderDelete() {
    return html`<wt-modal
      data-test="delete"
      .open=${this.deleting !== null}
      heading=${t("sections.delete_named").replace("{name}", this.deleting?.name ?? "")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (!this.busy) this.#closeDelete();
      }}
    >
      ${this.deleting ? this.#renderDeleteBody() : nothing}
      ${
        this.deleteError
          ? html`<p class="error" role="alert" data-test="delete-error">${this.deleteError}</p>`
          : nothing
      }
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-test="delete-cancel"
          .disabled=${this.busy}
          @click=${() => this.#closeDelete()}
          >${t("action.cancel")}</wt-button
        ><wt-button
          variant="danger"
          data-test="confirm-delete"
          .disabled=${this.busy || this.deleteUsages === null}
          @click=${() => void this.#delete()}
          >${t("action.delete")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }

  override render() {
    return html`<h1>${t("sections.title")}</h1>
      ${this.loading ? html`<p role="status">${t("sections.loading")}</p>` : nothing}
      ${
        this.loadError
          ? html`<p class="error" role="alert" data-test="load-error">
                ${t("sections.load_error")}
              </p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("sections.retry")}</wt-button
              >`
          : nothing
      }
      ${!this.loading && !this.loadError ? this.#renderList() : nothing} ${this.#renderEditor()}
      ${this.#renderDuplicate()} ${this.#renderDelete()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-sections-screen": SectionsScreen;
  }
}
