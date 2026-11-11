// Weaker than its name: it checks the headings AEAT's model fixes, not the values beside them.
import { readFileSync } from "node:fs";
import { renderDeclaration } from "./render.js";
import { prepareDeclarationSource } from "./source.js";

// Typed by hand from the A940 design §4, which follows AEAT's worked example
// (EjemplosDeclaracionResponsable V0.5.1) with the person-producer wording.
const HEADINGS = [
  "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN",
  "1.a) Nombre del sistema informático a que se refiere esta declaración responsable:",
  "1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta declaración responsable:",
  "1.c) Identificador completo de la versión concreta del sistema informático a que se refiere esta declaración responsable:",
  "1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades:",
  "1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda funcionar exclusivamente como «VERI*FACTU»:",
  "1.f) Indicación de si el sistema informático a que se refiere la declaración responsable permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios:",
  "1.g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso de que el sistema informático a que se refiere esta declaración responsable no sea utilizado como «VERI*FACTU».",
  "1.h) Nombre y apellidos de la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "1.i) Número de identificación fiscal (NIF) español de la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "1.j) Dirección postal completa de contacto de la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "1.k)",
  "1.l)",
  "ANEXO",
  "2.a) Otras formas de contacto con la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "2.b) Direcciones de internet de la persona productora del sistema informático a que se refiere esta declaración responsable:",
];

it("bolds AEAT's headings, word for word and in order", () => {
  const template = readFileSync(new URL("../../declarations/template.md", import.meta.url), "utf8");
  const functions = readFileSync(
    new URL("../../declarations/functions.md", import.meta.url),
    "utf8",
  );
  const source = prepareDeclarationSource({
    template,
    functions,
    version: "1.2.3",
    libraryVersion: "0.2.1",
    date: "2026-10-22",
    place: "Elche",
  });
  const { html } = renderDeclaration(source, {
    name: "PRODUCER PERSON",
    taxId: "00000000T",
    address: "1 Example Street, 00000 Nowhere (Province), Spain",
  });

  const headings = [...html.matchAll(/<(h1|strong)>(.*?)<\/\1>/g)].map((match) => match[2]);
  expect(headings).toEqual(HEADINGS);
});
