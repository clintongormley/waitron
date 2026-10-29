import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  modules: [] as { fiscal?: { id: string; certificate?: { diagnoseInChild?: () => void } } }[],
  select: undefined as undefined | ((id: string) => unknown),
}));
vi.mock("@waitron/composition", () => ({ ALL_MODULES: state.modules }));
vi.mock("./fiscal-certificate-diagnosis-dispatch.js", () => ({
  runCertificateDiagnosisEntry: async (select: (id: string) => unknown) => {
    state.select = select;
  },
}));
afterEach(() => {
  state.modules.length = 0;
  state.select = undefined;
});

it("the built entry selects exactly the requested module's child capability", async () => {
  const certificate = { diagnoseInChild() {} };
  state.modules.push({}, { fiscal: { id: "other" } }, { fiscal: { id: "selected", certificate } });
  vi.resetModules();
  await import("./fiscal-certificate-diagnosis-entry.js");
  expect(state.select!("selected")).toBe(certificate);
});
it.each(["missing", "duplicate", "no-seat", "no-child"])(
  "entry selection refuses %s capability",
  async (mode) => {
    const certificate = { diagnoseInChild() {} };
    if (mode === "duplicate")
      state.modules.push(
        { fiscal: { id: "selected", certificate } },
        { fiscal: { id: "selected", certificate } },
      );
    if (mode === "no-seat") state.modules.push({ fiscal: { id: "selected" } });
    if (mode === "no-child") state.modules.push({ fiscal: { id: "selected", certificate: {} } });
    vi.resetModules();
    await import("./fiscal-certificate-diagnosis-entry.js");
    expect(() => state.select!("selected")).toThrow("Certificate diagnosis unavailable");
  },
);
