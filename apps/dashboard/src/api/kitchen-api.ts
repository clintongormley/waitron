import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import { EmailThemeApi } from "./email-theme-api.js";

// ── Kitchen-station + routing types ──────────────────────────────────────────────────────────────

export interface Station {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
  showsRestOfOrder: boolean;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

export interface Course {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  inUse?: boolean;
}

export class KitchenApi extends EmailThemeApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  // ── Kitchen stations + routing ─────────────────────────────────────────────────────────────────

  listStations(): Promise<Station[]> {
    return this.#request<Station[]>("/management-api/stations", "GET");
  }
  createStation(input: {
    name: string;
    isDefault?: boolean;
    warmAfterMinutes?: number;
    overdueAfterMinutes?: number;
    forgottenAfterMinutes?: number;
  }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/stations", "POST", input);
  }
  updateStation(
    id: string,
    patch: {
      name?: string;
      showsRestOfOrder?: boolean;
      warmAfterMinutes?: number;
      overdueAfterMinutes?: number;
      forgottenAfterMinutes?: number;
    },
  ): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}`, "PATCH", patch);
  }
  getStationDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/stations/${encodeURIComponent(id)}/delete-impact`,
      "GET",
    );
  }
  deleteStation(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/stations/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
  setDefaultStation(id: string): Promise<void> {
    return this.#request<void>(`/management-api/stations/${id}/default`, "POST");
  }
  // ── Kitchen courses + fire control ─────────────────────────────────────────────────────────────

  listCourses(): Promise<Course[]> {
    return this.#request<Course[]>("/management-api/courses", "GET");
  }
  getCourseDeleteImpact(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/courses/${encodeURIComponent(id)}/delete-impact`,
      "GET",
    );
  }
  deleteCourse(id: string): Promise<DeleteImpact> {
    return this.#request<DeleteImpact>(
      `/management-api/courses/${encodeURIComponent(id)}`,
      "DELETE",
    );
  }
  createCourse(input: { name: string; displayOrder?: number }): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/courses", "POST", input);
  }
  updateCourse(id: string, patch: { name?: string; displayOrder?: number }): Promise<void> {
    return this.#request<void>(`/management-api/courses/${id}`, "PATCH", patch);
  }
  moveCourse(id: string, to: number): Promise<Course[]> {
    return this.#request<Course[]>(`/management-api/courses/${id}/position`, "PUT", { to });
  }
}
