import { expect, test } from "vitest";
import {
  dispatchAdoptRequested,
  dispatchBucketRestoreRequested,
  dispatchConfigurationRequested,
  dispatchFiscalTestRequested,
  dispatchProvisionRequested,
  dispatchResetRequested,
  dispatchRestoreRequested,
  dispatchSetupAdvance,
  dispatchSetupGoto,
  dispatchSetupPatch,
  dispatchTaxpayerChosen,
} from "./events.js";

function capture(type: string, fire: (el: EventTarget) => void): CustomEvent {
  const el = document.createElement("div");
  let heard: CustomEvent | undefined;
  el.addEventListener(type, (e) => {
    heard = e as CustomEvent;
  });
  fire(el);
  if (heard === undefined) throw new Error(`no ${type} event was dispatched`);
  return heard;
}

test("dispatchSetupPatch fires a composed, bubbling setup-patch wrapping the patch", () => {
  const e = capture("setup-patch", (el) => dispatchSetupPatch(el, { mode: "demo" }));
  expect(e.detail).toEqual({ patch: { mode: "demo" } });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchSetupGoto fires a composed, bubbling setup-goto carrying the screen", () => {
  const e = capture("setup-goto", (el) => dispatchSetupGoto(el, "venue"));
  expect(e.detail).toEqual({ screen: "venue" });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchSetupAdvance fires a composed, bubbling setup-advance with no detail", () => {
  const e = capture("setup-advance", (el) => dispatchSetupAdvance(el));
  expect(e.detail).toBeNull();
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchProvisionRequested fires a composed, bubbling provision-requested with no detail", () => {
  const e = capture("provision-requested", (el) => dispatchProvisionRequested(el));
  expect(e.detail).toBeNull();
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchAdoptRequested fires a composed, bubbling adopt-requested wrapping the body", () => {
  const body = {
    primaryUrl: "https://waitron.local",
    credential: { email: "op1@example.com", password: "correct horse", totp: "123456" },
  };
  const e = capture("adopt-requested", (el) => dispatchAdoptRequested(el, body));
  expect(e.detail).toEqual({ body });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchResetRequested fires a composed, bubbling reset-requested wrapping the login", () => {
  const credential = { email: "op1@example.com", password: "correct horse" };
  const e = capture("reset-requested", (el) => dispatchResetRequested(el, credential));
  expect(e.detail).toEqual({ credential });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchConfigurationRequested fires a composed, bubbling configuration-requested wrapping the request", () => {
  const request = {
    artifact: new File(["encrypted"], "prepared.waitron-config"),
    passphrase: "pw",
  };
  const e = capture("configuration-requested", (el) => dispatchConfigurationRequested(el, request));
  expect(e.detail).toEqual({ request });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchTaxpayerChosen fires a composed, bubbling taxpayer-chosen carrying the choice", () => {
  const e = capture("taxpayer-chosen", (el) => dispatchTaxpayerChosen(el, true));
  expect(e.detail).toEqual({ newTaxpayer: true });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchRestoreRequested fires a composed, bubbling restore-requested wrapping the request", () => {
  const request = {
    artifact: new File(["archive"], "venue.waitron-backup"),
    recoveryKey: "recovery key",
    environment: "production" as const,
    oldBoxGone: true,
  };
  const e = capture("restore-requested", (el) => dispatchRestoreRequested(el, request));
  expect(e.detail).toEqual({ request });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchBucketRestoreRequested fires a composed, bubbling bucket-restore-requested wrapping the request", () => {
  const request = {
    kit: "restore kit",
    environment: "preproduction" as const,
    oldBoxGone: false,
    venueConfirmed: null,
  };
  const e = capture("bucket-restore-requested", (el) =>
    dispatchBucketRestoreRequested(el, request),
  );
  expect(e.detail).toEqual({ request });
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});

test("dispatchFiscalTestRequested fires a composed, bubbling fiscal-test-requested with no detail", () => {
  const e = capture("fiscal-test-requested", (el) => dispatchFiscalTestRequested(el));
  expect(e.detail).toBeNull();
  expect(e.bubbles).toBe(true);
  expect(e.composed).toBe(true);
});
