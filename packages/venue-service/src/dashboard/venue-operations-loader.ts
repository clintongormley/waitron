import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { QueryController, type LiveData } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceView } from "./client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { t } from "./strings.js";
import "./venue-departments-shell.js";

type OperationSnapshot = { model?: VenueServiceView };
// A shared query keeps its first observer's reader, so action snapshots share its freshness fence.
const operationSnapshots = new WeakMap<LiveData, OperationSnapshot>();

export class VenueOperationsLoader extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      [role="alert"] {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @state() private model?: VenueServiceView;
  @state() private loadError = "";
  #loaded = false;
  #snapshot: OperationSnapshot = {};
  #watchingApi?: VenueServiceApi;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = t("venue.load_error");
    },
  );
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.#watchingApi = undefined;
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (this.api && this.api !== this.#watchingApi) {
      this.#watchingApi = this.api;
      void this.#load();
    }
  }
  async #load() {
    const data = this.api.liveData;
    const snapshot = data ? (operationSnapshots.get(data) ?? {}) : {};
    if (data) operationSnapshots.set(data, snapshot);
    this.#snapshot = snapshot;
    let initial = !this.#loaded;
    this.#loaded = true;
    await this.#queries
      .watch(
        "venue",
        {
          key: "venue-service:operations",
          dependencies: QUERY_DEPENDENCIES.operations.map((type) => ({ type })),
          refreshMs: 60_000,
          read: async () => {
            const api = initial ? this.api : this.api.background;
            initial = false;
            const before = snapshot.model;
            try {
              const model = await api.load();
              if (snapshot.model && snapshot.model !== before) return snapshot.model;
              snapshot.model = model;
              return model;
            } catch (error) {
              if (snapshot.model && snapshot.model !== before) return snapshot.model;
              throw error;
            }
          },
        },
        (model) => {
          this.model = snapshot.model ?? model;
          this.loadError = "";
        },
      )
      .catch(() => {});
  }
  #modelChange(event: CustomEvent<{ model: VenueServiceView }>) {
    event.stopPropagation();
    this.#snapshot.model = event.detail.model;
    this.model = event.detail.model;
    this.loadError = "";
    this.api.liveData?.invalidate(QUERY_DEPENDENCIES.operations.map((type) => ({ type })));
  }
  override render() {
    return html`${this.loadError ? html`<p role="alert">${this.loadError}</p>` : nothing}${this.model ? html`<venue-departments-shell .api=${this.api} .model=${this.model} @model-change=${this.#modelChange}></venue-departments-shell>` : nothing}`;
  }
}
