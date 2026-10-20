import { html, nothing, type LitElement, type ReactiveController } from "lit";
import type { AllergyCommand, AllergySendTarget, PartyAllergyRead } from "@waitron/module";
import type { TillApi } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { limited, TABLE_REQUEST_LIMIT_MS } from "./draft-sync.js";
import { prepareAllergySend, type AllergySendResult } from "./party-allergy-flow.js";
import {
  TillPartyAllergyDialog,
  type AllergyConfirmDetail,
  type AllergyFieldRefusal,
} from "../widgets/party-allergy-dialog.js";
import "../widgets/party-allergy-dialog.js";

interface Opening {
  key: string;
  view: PartyAllergyRead;
  current: () => boolean;
  resolve: (result: AllergySendResult) => void;
  busy: boolean;
  refusal?: string;
  fieldRefusal?: AllergyFieldRefusal;
}

export class KitchenAllergySend implements ReactiveController {
  #open?: Opening;
  #generation = 0;
  #active?: { current: () => boolean; abort: AbortController };

  constructor(
    private readonly host: LitElement & { api: TillApi },
    private readonly orientation: () => string,
  ) {
    host.addController(this);
  }

  hostDisconnected(): void {
    this.#cancel();
  }
  hostUpdate(): void {
    if (this.#active && !this.#active.current()) this.#cancel();
  }

  #cancel(): void {
    this.#generation++;
    this.#active?.abort.abort();
    this.#active = undefined;
    this.#close();
  }

  #close(confirmed = false): void {
    const open = this.#open;
    if (!open) return;
    if (confirmed)
      this.host.renderRoot
        .querySelector<TillPartyAllergyDialog>("till-party-allergy-dialog")
        ?.commitConfirmed(open.key);
    open.resolve({ kind: "cancelled" });
    this.#open = undefined;
    this.host.requestUpdate();
  }

  async #request<T>(abort: AbortSignal, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const limit = limited(TABLE_REQUEST_LIMIT_MS, abort);
    let stop!: () => void;
    try {
      return await Promise.race([
        call(limit.signal),
        new Promise<never>((_, reject) => {
          stop = () => reject(new DOMException("Allergy request ended", "AbortError"));
          if (limit.signal.aborted) stop();
          else limit.signal.addEventListener("abort", stop, { once: true });
        }),
      ]);
    } finally {
      limit.signal.removeEventListener("abort", stop);
      limit.done();
    }
  }

  async run(
    target: Extract<AllergySendTarget, { kind: "group" | "course" }>,
    partyId: string | null,
    expectedRevision: number | undefined,
    write: (command?: AllergyCommand) => Promise<unknown>,
  ): Promise<boolean> {
    if (this.#active) return false;
    const api = this.host.api;
    const orientation = this.orientation();
    const generation = ++this.#generation;
    const abort = new AbortController();
    const current = () =>
      this.host.isConnected &&
      api === this.host.api &&
      orientation === this.orientation() &&
      generation === this.#generation;
    this.#active = { current, abort };
    try {
      if (target.kind === "course") {
        const bill = await this.#request(abort.signal, (signal) =>
          api.getFindBill(target.orderId, { signal }),
        );
        if (!current()) return false;
        partyId = bill.partyId;
      }
      if (partyId === null) {
        await write();
        return current();
      }
      let preview: PartyAllergyRead | undefined;
      let previewError: unknown;
      const key = crypto.randomUUID();
      const result = await prepareAllergySend(
        {
          previewPartyAllergy: async (id, candidate) => {
            try {
              const view = await this.#request(abort.signal, (signal) =>
                api.previewPartyAllergy(id, candidate, { signal }),
              );
              if (expectedRevision !== undefined && view.snapshot.revision !== expectedRevision)
                throw { code: "party.out_of_date" };
              preview = view;
              return view;
            } catch (error) {
              previewError = error;
              throw error;
            }
          },
        },
        partyId,
        target,
        { key, isCurrent: current },
        (view, key) =>
          new Promise((resolve) => {
            this.#open = { key, view, current, resolve, busy: false };
            this.host.requestUpdate();
          }),
      );
      if (!current() || result.kind === "cancelled") return false;
      if (result.kind !== "ready" || !preview) throw previewError ?? { code: "table.error" };
      let command: AllergyCommand = {
        submissionId: crypto.randomUUID(),
        expectedPartyRevision: preview.snapshot.revision,
        ...(result.patch === undefined ? {} : { allergy: result.patch }),
      };
      for (;;) {
        try {
          await this.#request(abort.signal, () => write(command));
          if (!current()) return false;
          this.#close(true);
          return true;
        } catch (error) {
          if (!current()) return false;
          const code = (error as { code?: string } | null)?.code;
          if (!this.#open || code === "party.out_of_date" || code === "allergy.stale") throw error;
          const open = this.#open;
          const raw = error as {
            guestIndex?: number;
            field?: string;
            params?: { field?: string };
          } | null;
          const field = raw?.field ?? raw?.params?.field;
          const match = /^guests\.(\d+)\.(who|allergens|note)$/.exec(field ?? "");
          const guestIndex = match ? Number(match[1]) : raw?.guestIndex;
          const guestField = match ? match[2] : field;
          const next = await new Promise<AllergySendResult>((resolve) => {
            this.#open = {
              ...open,
              busy: false,
              resolve,
              refusal: codeMessage(code ?? "table.error"),
              fieldRefusal:
                guestIndex !== undefined &&
                (guestField === "who" || guestField === "allergens" || guestField === "note")
                  ? { guestIndex, field: guestField, message: codeMessage(code ?? "table.error") }
                  : undefined,
            };
            this.host.requestUpdate();
          });
          if (next.kind !== "ready" || !current()) return false;
          command = {
            ...command,
            ...(JSON.stringify(next.patch) === JSON.stringify(command.allergy)
              ? {}
              : { submissionId: crypto.randomUUID() }),
            allergy: next.patch,
          };
        }
      }
    } catch (error) {
      if (!current()) return false;
      throw error;
    } finally {
      if (generation === this.#generation) {
        this.#active = undefined;
        this.#close();
      }
    }
  }

  render() {
    const open = this.#open;
    return open
      ? html`<till-party-allergy-dialog
          .view=${open.view}
          .scopeKey=${open.key}
          .busy=${open.busy}
          .draftParent=${this.host}
          .refusal=${open.refusal ?? ""}
          .fieldRefusal=${open.fieldRefusal ?? null}
          @allergy-confirm=${(event: CustomEvent<AllergyConfirmDetail>) => {
            event.stopPropagation();
            if (
              this.#open !== open ||
              open.busy ||
              !open.current() ||
              event.detail.scopeKey !== open.key ||
              event.detail.expectedPartyRevision !== open.view.snapshot.revision
            )
              return;
            this.#open = { ...open, busy: true };
            open.resolve({ kind: "ready", patch: event.detail.patch });
            this.host.requestUpdate();
          }}
          @allergy-cancel=${(event: Event) => {
            event.stopPropagation();
            if (this.#open === open && !open.busy) this.#close();
          }}
        ></till-party-allergy-dialog>`
      : nothing;
  }
}
