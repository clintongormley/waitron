import type { LitElement, ReactiveController } from "lit";
import { TABLE_SEPARATOR } from "@waitron/shared";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Chromium draws a text field's `text-overflow: ellipsis` only while the field does not have the
 * cursor, and the name windows open with the cursor in it, so the placeholder is shortened as text.
 * Whole names of the list are kept where one fits; otherwise the first is cut between characters.
 */
export function fitPlaceholder(
  text: string,
  width: number,
  measure: (text: string) => number,
  separator: string = TABLE_SEPARATOR,
): string {
  if (measure(text) <= width) return text;
  const names = text.split(separator);
  for (let count = names.length - 1; count > 0; count--) {
    const shortened = `${names.slice(0, count).join(separator)}${separator}…`;
    if (measure(shortened) <= width) return shortened;
  }
  const characters = Array.from(graphemes.segment(names[0]!), ({ segment }) => segment);
  for (let length = characters.length; length > 0; length--) {
    const shortened = `${characters.slice(0, length).join("").trimEnd()}…`;
    if (measure(shortened) <= width) return shortened;
  }
  return "…";
}

/** Keeps `placeholder` fitted to the host's one `wt-input`, as its width, fonts and text change. */
export class PlaceholderFit implements ReactiveController {
  placeholder = "";
  /** The name field's text box less a pixel to spare; infinite until the field is first measured. */
  #textBox = Number.POSITIVE_INFINITY;
  #fitted?: string;
  #resize?: ResizeObserver;
  readonly #measure = document.createElement("canvas").getContext("2d")!;
  /** A web font that finishes loading changes the text's width but not the field's, so no resize
   * reports it. */
  readonly #fontsLoaded = () => {
    const field = this.#field();
    if (field) this.#measureField(field);
  };

  constructor(
    private readonly host: LitElement,
    private readonly text: () => string,
    private readonly separator: string,
  ) {
    host.addController(this);
  }

  hostUpdate(): void {
    if (this.text() !== this.#fitted) this.#fit();
  }

  hostConnected(): void {
    document.fonts.addEventListener("loadingdone", this.#fontsLoaded);
  }

  hostUpdated(): void {
    // An update queued before the host was removed still finishes after it.
    if (this.#resize || !this.host.isConnected) return;
    const field = this.#field();
    if (!field) return;
    this.#resize = new ResizeObserver(() => this.#measureField(field));
    this.#resize.observe(field);
  }

  hostDisconnected(): void {
    document.fonts.removeEventListener("loadingdone", this.#fontsLoaded);
    this.#resize?.disconnect();
    this.#resize = undefined;
  }

  #field(): HTMLElement | null {
    return this.host.renderRoot.querySelector<HTMLElement>("wt-input");
  }

  #measureField(field: HTMLElement): void {
    const input = field.shadowRoot!.querySelector("input")!;
    const control = getComputedStyle(input);
    const placeholder = getComputedStyle(input, "::placeholder");
    this.#measure.font = placeholder.font;
    this.#measure.letterSpacing = placeholder.letterSpacing;
    this.#textBox =
      input.clientWidth - parseFloat(control.paddingLeft) - parseFloat(control.paddingRight) - 1;
    const shown = this.placeholder;
    this.#fit();
    if (this.placeholder !== shown) this.host.requestUpdate();
  }

  #fit(): void {
    this.#fitted = this.text();
    this.placeholder = fitPlaceholder(
      this.#fitted,
      this.#textBox,
      (text) => this.#measure.measureText(text).width,
      this.separator,
    );
  }
}
