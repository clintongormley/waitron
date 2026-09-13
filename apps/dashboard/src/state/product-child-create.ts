import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { EditorChoice } from "../widgets/product-editor-model.js";

export type ProductChildKind = "unit" | "category" | "modifier";
interface Effects {
  accept(kind: ProductChildKind, value: EditorChoice): void;
  refresh(kind: ProductChildKind): Promise<void>;
  loadError(error: unknown): void;
  focus(kind: ProductChildKind): void;
}

/** The composing screen owns lookups and child forms; this controller owns only the create lifecycle. */
export class ProductChildCreate implements ReactiveController {
  kind: ProductChildKind | null = null;
  busy = false;
  error: unknown = null;
  #generation = 0;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly effects: Effects,
  ) {
    host.addController(this);
  }
  hostDisconnected(): void {
    this.reset();
  }

  /** Every product switch or close invalidates requests started by the preceding editor. */
  reset(): void {
    this.#generation++;
    this.kind = null;
    this.busy = false;
    this.error = null;
    this.host.requestUpdate();
  }
  open(kind: ProductChildKind): void {
    if (this.kind !== null) return;
    this.kind = kind;
    this.error = null;
    this.host.requestUpdate();
  }
  cancel(): void {
    if (this.busy || this.kind === null) return;
    const kind = this.kind;
    this.kind = null;
    this.error = null;
    this.host.requestUpdate();
    void this.#focus(kind, this.#generation);
  }
  async #focus(kind: ProductChildKind, generation: number): Promise<void> {
    await this.host.updateComplete;
    if (generation === this.#generation && this.kind === null) this.effects.focus(kind);
  }
  async submit(write: () => Promise<EditorChoice>): Promise<void> {
    if (this.busy || this.kind === null) return;
    const generation = this.#generation;
    const kind = this.kind;
    this.busy = true;
    this.error = null;
    this.host.requestUpdate();
    let value: EditorChoice;
    try {
      value = await write();
    } catch (error) {
      if (generation === this.#generation) {
        this.busy = false;
        this.error = error;
        this.host.requestUpdate();
      }
      return;
    }
    if (generation !== this.#generation) return;
    this.kind = null;
    this.busy = false;
    this.host.requestUpdate();
    // The write is durable. A failed lookup refresh must not reopen a form that can create it twice.
    try {
      this.effects.accept(kind, value);
      await this.#focus(kind, generation);
      if (generation !== this.#generation) return;
      await this.effects.refresh(kind);
    } catch (error) {
      if (generation === this.#generation) this.effects.loadError(error);
    }
  }
}
