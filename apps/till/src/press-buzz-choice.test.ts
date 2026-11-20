import { afterEach, expect, test, vi } from "vitest";
import {
  PRESS_BUZZ_STORAGE_KEY,
  pressBuzzOn,
  setPressBuzz,
  subscribePressBuzz,
} from "./press-buzz-choice.js";

afterEach(() => {
  vi.restoreAllMocks();
  setPressBuzz(true);
  window.localStorage.removeItem(PRESS_BUZZ_STORAGE_KEY);
});

test("the buzz is on when nothing is stored", () => {
  expect(window.localStorage.getItem(PRESS_BUZZ_STORAGE_KEY)).toBeNull();
  expect(pressBuzzOn()).toBe(true);
});

test("turning it off stores off and reads back off", () => {
  setPressBuzz(false);
  expect(window.localStorage.getItem("waitron-press-buzz")).toBe("off");
  expect(pressBuzzOn()).toBe(false);
});

test("turning it off survives a reload of the page", async () => {
  setPressBuzz(false);
  vi.resetModules();
  const reloaded = await import("./press-buzz-choice.js");
  expect(reloaded.pressBuzzOn()).toBe(false);
});

test("turning it back on removes the stored value", () => {
  setPressBuzz(false);
  setPressBuzz(true);
  expect(window.localStorage.getItem(PRESS_BUZZ_STORAGE_KEY)).toBeNull();
  expect(pressBuzzOn()).toBe(true);
});

test("storage that cannot be read leaves the buzz on", () => {
  window.localStorage.setItem(PRESS_BUZZ_STORAGE_KEY, "off");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  expect(pressBuzzOn()).toBe(true);
});

test("storage that refuses the save still honours the choice on the open page", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  setPressBuzz(false);
  expect(window.localStorage.getItem(PRESS_BUZZ_STORAGE_KEY)).toBeNull();
  expect(pressBuzzOn()).toBe(false);
});

test("storage that refuses removing the value still turns the buzz back on for the page", () => {
  setPressBuzz(false);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  setPressBuzz(true);
  expect(pressBuzzOn()).toBe(true);
});

function otherTabSaved(key: string | null, storageArea: Storage = localStorage): void {
  window.dispatchEvent(new StorageEvent("storage", { key, storageArea }));
}

test("a subscriber hears another tab's change to the choice or another tab clearing local storage", () => {
  const listener = vi.fn();
  const unsubscribe = subscribePressBuzz(listener);
  try {
    window.localStorage.setItem(PRESS_BUZZ_STORAGE_KEY, "off");
    otherTabSaved(PRESS_BUZZ_STORAGE_KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(pressBuzzOn()).toBe(false);
    otherTabSaved("other");
    otherTabSaved(PRESS_BUZZ_STORAGE_KEY, sessionStorage);
    otherTabSaved(null, sessionStorage);
    expect(listener).toHaveBeenCalledOnce();
    window.localStorage.removeItem(PRESS_BUZZ_STORAGE_KEY);
    otherTabSaved(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(pressBuzzOn()).toBe(true);
  } finally {
    unsubscribe();
  }
  otherTabSaved(PRESS_BUZZ_STORAGE_KEY);
  expect(listener).toHaveBeenCalledTimes(2);
});

test("a storage event when this page cannot reach localStorage keeps a choice it could not save", () => {
  const unsubscribe = subscribePressBuzz(() => {});
  try {
    const area = localStorage;
    const get = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    setPressBuzz(false);
    window.dispatchEvent(
      new StorageEvent("storage", { key: PRESS_BUZZ_STORAGE_KEY, storageArea: area }),
    );
    expect(pressBuzzOn()).toBe(false);
    get.mockRestore();
  } finally {
    unsubscribe();
  }
});

test("another tab's change replaces a choice this page could not save", () => {
  const unsubscribe = subscribePressBuzz(() => {});
  try {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    setPressBuzz(false);
    expect(pressBuzzOn()).toBe(false);
    setItem.mockRestore();
    otherTabSaved(PRESS_BUZZ_STORAGE_KEY);
    expect(pressBuzzOn()).toBe(true);
  } finally {
    unsubscribe();
  }
});
