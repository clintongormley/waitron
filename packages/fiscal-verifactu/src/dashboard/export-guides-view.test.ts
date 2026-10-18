import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "lit";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import { exportGuidesView } from "./export-guides-view.js";

const LINKS = [
  "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1501-como-puedo-exportar-un-certificado-digital-con-google-chrome-en-windows-",
  "https://www.sede.fnmt.gob.es/eu/preguntas-frecuentes/android-mac/-/asset_publisher/1RphW9IeUoAH/content/1379-como-puedo-exportar-mi-certificado-desde-el-llavero-de-mac-",
  "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1399-como-puedo-exportar-mi-certificado-con-mozilla-firefox-",
];

const host = document.createElement("div");
let locale = "";

beforeEach(() => {
  locale = currentLocale();
  document.body.append(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
  setLocale(locale);
});

function show(language: string) {
  setLocale(language);
  render(exportGuidesView(), host);
  const disclosure = host.querySelector("wt-disclosure")!;
  const guides = [...disclosure.querySelectorAll<HTMLElement>("[data-test='export-guide']")];
  return {
    disclosure,
    guides: guides.map((guide) => ({
      id: guide.dataset.guide,
      title: guide.querySelector("h3")?.textContent?.trim(),
      steps: [...guide.querySelectorAll("li")].map((li) => li.textContent?.trim()),
      link: guide.querySelector("a")!,
    })),
  };
}

describe("exportGuidesView", () => {
  it("shows the three guides, each with its FNMT link, inside a closed disclosure, in English", () => {
    const { disclosure, guides } = show("en");
    expect(disclosure.getAttribute("heading")).toBe("Get your certificate file");
    expect(disclosure.hasAttribute("open")).toBe(false);
    expect(disclosure.textContent).toContain(
      "Export the signing certificate on the computer where it is installed.",
    );
    expect(disclosure.textContent).toContain(
      "If your certificate is on another computer, export it there and transfer the file to this device.",
    );
    expect(guides.map((g) => [g.id, g.title])).toEqual([
      ["windows", "Windows (Chrome)"],
      ["mac", "macOS (Keychain Access)"],
      ["firefox", "Firefox"],
    ]);
    expect(guides.map((g) => g.steps.length)).toEqual([3, 3, 3]);
    expect(guides[1]!.steps[2]).toBe(
      "Set and confirm an export password. Choose the saved .p12 file above and enter that password.",
    );
    for (const [i, guide] of guides.entries()) {
      expect(guide.link.getAttribute("href")).toBe(LINKS[i]);
      expect(guide.link.textContent?.trim()).toBe("FNMT export instructions");
      expect(guide.link.target).toBe("_blank");
      expect(guide.link.rel).toBe("noopener noreferrer");
    }
  });

  it("shows the same guides and links in Spanish", () => {
    const { disclosure, guides } = show("es-ES");
    expect(disclosure.getAttribute("heading")).toBe("Consigue el archivo de tu certificado");
    expect(guides.map((g) => [g.id, g.title])).toEqual([
      ["windows", "Windows (Chrome)"],
      ["mac", "macOS (Acceso a Llaveros)"],
      ["firefox", "Firefox"],
    ]);
    expect(guides[0]!.steps[2]).toBe(
      "Escribe y confirma una contraseña de exportación, elige dónde guardar el archivo y termina el asistente. Elige arriba el archivo .pfx o .p12 resultante e introduce esa contraseña de exportación.",
    );
    expect(guides[2]!.steps[2]).toBe(
      "Introduce la contraseña principal de Firefox si te la pide y, después, escribe y confirma una contraseña para la copia exportada. Elige arriba ese archivo .p12 e introduce la contraseña de exportación.",
    );
    for (const [i, guide] of guides.entries()) {
      expect(guide.link.getAttribute("href")).toBe(LINKS[i]);
      expect(guide.link.textContent?.trim()).toBe("Instrucciones de exportación de la FNMT");
    }
  });

  it("names its section for assistive technology", () => {
    show("en");
    expect(host.querySelector("section")!.getAttribute("aria-label")).toBe(
      "Export your signing certificate",
    );
  });
});
