import { baseStyles } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-button.js";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import "../widgets/course-list.js";
import type { CourseList } from "../widgets/course-list.js";

@customElement("dashboard-courses-screen")
export class CoursesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }
      h1 {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
      }
      .header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: center;
      }
      .description {
        margin: 0 0 var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  @query("dashboard-course-list") private list!: CourseList;

  override render() {
    return html`
      <div class="heading">
        <h1>${t("kitchen.courses_title")}</h1>
        ${
          this.readOnly
            ? nothing
            : html`<div class="header-actions">
                <wt-button
                  data-test="add-course"
                  variant="primary"
                  @click=${() => this.list.startAdding()}
                  >${t("kitchen.add_course")}</wt-button
                >
              </div>`
        }
      </div>
      <p class="description">
        ${t(this.readOnly ? "courses.description_read_only" : "courses.description")}
      </p>
      <dashboard-course-list
        .api=${this.api}
        .readOnly=${this.readOnly}
        .showAddButton=${false}
      ></dashboard-course-list>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-courses-screen": CoursesScreen;
  }
}
