import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContentLanguageController,
  currentContentLanguages,
  setContentLanguages,
  subscribeContentLanguages,
} from "./content-languages.js";

afterEach(() => setContentLanguages({ defaultLanguage: "en", languages: ["en"] }));

describe("content language context", () => {
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
