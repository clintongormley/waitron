import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContentLanguageController,
  currentContentLanguages,
  setContentLanguages,
  subscribeContentLanguages,
} from "./content-languages.js";

afterEach(() => setContentLanguages({ defaultLanguage: "en", languages: ["en"] }));

describe("content language context", () => {
  // Runs first on purpose: after any other case the afterEach has already written the same
  // configuration back, so this is the only point where the module's own starting value shows.
  it("starts at the fallback language before anything configures it", () => {
    expect(currentContentLanguages()).toEqual({ defaultLanguage: "en", languages: ["en"] });
  });

  it("releases nothing when a view is disconnected without ever connecting", () => {
    const host = { addController: vi.fn(), requestUpdate: vi.fn() };
    const controller = new ContentLanguageController(host);
    expect(() => controller.hostDisconnected()).not.toThrow();
    setContentLanguages({ defaultLanguage: "fr", languages: ["fr"] });
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });

  it("repaints a connected view and releases its subscription on disconnect", () => {
    const host = { addController: vi.fn(), requestUpdate: vi.fn() };
    const controller = new ContentLanguageController(host);
    expect(host.addController).toHaveBeenCalledWith(controller);
    controller.hostConnected();
    setContentLanguages({ defaultLanguage: "fr", languages: ["fr"] });
    expect(host.requestUpdate).toHaveBeenCalledOnce();
    controller.hostDisconnected();
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    expect(host.requestUpdate).toHaveBeenCalledOnce();
    controller.hostConnected();
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    expect(host.requestUpdate).toHaveBeenCalledTimes(2);
    controller.hostDisconnected();
  });
  it("shares configured languages and notifies subscribed views", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeContentLanguages(listener);
    setContentLanguages({ defaultLanguage: "fr", languages: ["fr", "en"] });
    expect(currentContentLanguages()).toEqual({ defaultLanguage: "fr", languages: ["fr", "en"] });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("notifies when the list of languages changes but the default stays", () => {
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    const listener = vi.fn();
    const unsubscribe = subscribeContentLanguages(listener);
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "fr"] });
    expect(listener).toHaveBeenCalledOnce();
    expect(currentContentLanguages()).toEqual({ defaultLanguage: "en", languages: ["en", "fr"] });
    unsubscribe();
  });

  it("notifies when one language is swapped for another and the count stays", () => {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "fr"] });
    const listener = vi.fn();
    const unsubscribe = subscribeContentLanguages(listener);
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
    expect(listener).toHaveBeenCalledOnce();
    expect(currentContentLanguages()).toEqual({ defaultLanguage: "en", languages: ["en", "es"] });
    unsubscribe();
  });

  it("notifies when only the default language changes", () => {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "fr"] });
    const listener = vi.fn();
    const unsubscribe = subscribeContentLanguages(listener);
    setContentLanguages({ defaultLanguage: "fr", languages: ["en", "fr"] });
    expect(listener).toHaveBeenCalledOnce();
    expect(currentContentLanguages()).toEqual({ defaultLanguage: "fr", languages: ["en", "fr"] });
    unsubscribe();
  });

  it("does not notify for unchanged configuration or expose mutable shared state", () => {
    const config = { defaultLanguage: "en", languages: ["en"] };
    setContentLanguages(config);
    config.languages.push("fr");
    const listener = vi.fn();
    const unsubscribe = subscribeContentLanguages(listener);
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    expect(listener).not.toHaveBeenCalled();
    expect(currentContentLanguages().languages).toEqual(["en"]);
    unsubscribe();
  });
});
