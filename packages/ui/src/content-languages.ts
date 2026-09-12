import { FALLBACK_LOCALE, contentLanguageCode, type ContentLanguages } from "@waitron/shared";
import type { ReactiveController, ReactiveControllerHost } from "lit";

export class ContentLanguageController implements ReactiveController {
  #unsubscribe?: () => void;
  constructor(
    private readonly host: Pick<ReactiveControllerHost, "addController" | "requestUpdate">,
  ) {
    host.addController(this);
  }
  hostConnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = subscribeContentLanguages(() => this.host.requestUpdate());
  }
  hostDisconnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}

const initial = contentLanguageCode(FALLBACK_LOCALE);
let config: ContentLanguages = { defaultLanguage: initial, languages: [initial] };
const listeners = new Set<() => void>();

export function currentContentLanguages(): ContentLanguages {
  return { defaultLanguage: config.defaultLanguage, languages: [...config.languages] };
}

export function setContentLanguages(next: ContentLanguages): void {
  if (
    config.defaultLanguage === next.defaultLanguage &&
    config.languages.length === next.languages.length &&
    config.languages.every((language, index) => language === next.languages[index])
  )
    return;
  config = { defaultLanguage: next.defaultLanguage, languages: [...next.languages] };
  for (const listener of listeners) listener();
}

export function subscribeContentLanguages(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
