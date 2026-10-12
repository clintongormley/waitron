import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import type { DepartmentReceiptWrite } from "@waitron/shared";
import type { ReceiptPreview, PrintPaperWidth } from "./client.js";

export interface DepartmentReceiptModel extends DepartmentReceiptWrite {
  receiptLanguage: string;
  languages: string[];
  warningLanguages: string[];
  venueAddress: string[];
}
export interface DepartmentReceiptClient {
  readonly liveData: LiveData;
  readonly imageLibraryRequest: DashboardRequest;
  readonly background?: DepartmentReceiptClient;
  getDepartmentReceipt(id: string): Promise<DepartmentReceiptModel>;
  putDepartmentReceipt(id: string, input: DepartmentReceiptWrite): Promise<void>;
  previewReceiptDraft(
    input: DepartmentReceiptWrite & {
      departmentId: string;
      language?: string;
      paperWidth?: PrintPaperWidth;
    },
    options?: { passive?: boolean },
  ): Promise<ReceiptPreview>;
}

export function createDepartmentReceiptClient(
  request: DashboardRequest,
  liveData: LiveData,
): DepartmentReceiptClient {
  const make = (passive: boolean): DepartmentReceiptClient => ({
    liveData,
    imageLibraryRequest: request,
    getDepartmentReceipt: (id) =>
      request(`/management-api/venue-service/departments/${id}/receipt`, "GET", undefined, {
        passive,
      }),
    putDepartmentReceipt: (id, input) =>
      request(`/management-api/venue-service/departments/${id}/receipt`, "PUT", input),
    previewReceiptDraft: (input, options = {}) =>
      request(
        "/management-api/receipt-preview",
        "POST",
        options.passive === true ? { ...input, passive: true } : input,
      ),
  });
  const active = make(false);
  const background = make(true);
  return { ...active, background };
}
