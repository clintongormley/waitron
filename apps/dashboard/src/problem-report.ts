import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  currentThemeChoice,
  draftScopeFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import {
  captureClientReport,
  renderClientReport,
  reportDescriptionValid,
  type ClientReportSnapshot,
} from "@waitron/diagnostics";
import "@waitron/ui/src/components/wt-report-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import { diag, reportBuild } from "./diagnostics.js";
import { currentLocale, t } from "./i18n/t.js";
import { LocaleChangeController } from "./state/locale-controller.js";

@customElement("dashboard-problem-report")
export class DashboardProblemReport extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
    }
    :host([compact]) .trigger-label {
      display: none;
    }
  `;
  @property({ type: Boolean, reflect: true }) compact = false;
  @state() private snapshot?: ClientReportSnapshot;
  @state() private description = "";
  @state() private downloadError = "";
  private scope?: DraftScope<string>;
  private leave?: LeaveCoordinator;
  private opener: HTMLElement | null = null;
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  private show(event: Event): void {
    event.stopPropagation();
    if (this.snapshot) return;
    this.opener = event.currentTarget as HTMLElement;
    const choice = currentThemeChoice(),
      agent = navigator.userAgent;
    this.snapshot = captureClientReport({
      app: "dashboard",
      trail: diag.snapshot(),
      client: {
        build: reportBuild,
        locale: currentLocale().startsWith("es") ? "es" : "en",
        theme:
          choice === "device"
            ? matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : choice,
        viewport: { width: innerWidth, height: innerHeight },
        online: navigator.onLine,
        browser: /Firefox\//.test(agent)
          ? "firefox"
          : /(?:Chrome|Chromium|Edg)\//.test(agent)
            ? "chromium"
            : /Safari\//.test(agent)
              ? "safari"
              : "other",
      },
    });
    this.description = "";
    this.downloadError = "";
    const draft = draftScopeFor(this, {
      id: {},
      current: () => this.description,
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: () => {
        this.description = "";
        this.downloadError = "";
      },
    });
    this.scope = draft.scope;
    this.leave = draft.coordinator;
    this.scope.commit("");
  }
  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.leave ||
    !this.scope ||
    (await this.leave.request({ scopes: [this.scope.id], reason, proceed() {} })) === "proceeded";
  private close(): void {
    this.scope?.dispose();
    this.scope = undefined;
    this.leave = undefined;
    this.snapshot = undefined;
    this.description = "";
    this.downloadError = "";
    this.opener = null;
  }
  override disconnectedCallback(): void {
    this.close();
    super.disconnectedCallback();
  }
  private edited(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.description = event.detail.value;
    this.downloadError = "";
    this.scope?.changed();
  }
  private download(event: CustomEvent<{ description: string; preview: string }>): void {
    event.stopPropagation();
    if (!this.snapshot || !reportDescriptionValid(this.description)) return;
    const anchor = document.createElement("a");
    let url: string | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([event.detail.preview], { type: "text/markdown;charset=utf-8" }),
      );
      anchor.href = url;
      anchor.download = `problem-report-${this.snapshot.id}.md`;
      document.body.append(anchor);
      anchor.click();
      this.close();
    } catch {
      this.downloadError = t("problem_report.download_failed");
    } finally {
      anchor.remove();
      if (url) URL.revokeObjectURL(url);
    }
  }
  override render() {
    if (
      !isSecureContext ||
      (location.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))
    )
      return nothing;
    const file = this.snapshot ? renderClientReport(this.snapshot, this.description) : undefined;
    return html`<wt-button
        data-report-problem
        variant="ghost"
        shape=${this.compact ? "round" : "default"}
        aria-label=${t("problem_report.title")}
        title=${t("problem_report.title")}
        @click=${this.show}
        ><wt-icon name="report-problem"></wt-icon
        ><span class="trigger-label">${t("problem_report.title")}</span></wt-button
      >
      <wt-report-dialog
        .open=${this.snapshot !== undefined}
        .description=${this.description}
        .preview=${file?.text ?? ""}
        .validationError=${file ? "" : t("problem_report.description_invalid")}
        .downloadError=${this.downloadError}
        .opener=${this.opener}
        .beforeClose=${this.beforeClose}
        .copy=${{
          heading: t("problem_report.title"),
          scope: t("problem_report.scope"),
          warning: t("problem_report.warning"),
          description: t("problem_report.description"),
          preview: t("problem_report.preview"),
          invalid: t("problem_report.invalid"),
          cancel: t("action.cancel"),
          download: t("problem_report.download"),
        }}
        @wt-description-change=${this.edited}
        @wt-report-download=${this.download}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.close();
        }}
      ></wt-report-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-problem-report": DashboardProblemReport;
  }
}
