type Sentence = (title: string, number: string, total: string, name: string) => string;

const spanish: Sentence = (title, number, total, name) =>
  `Adjuntamos la ${title} ${number}, de ${total}. ${name}`;

const sentences: Readonly<Partial<Record<string, Sentence>>> = {
  "es-ES": spanish,
  "en-GB": (title, number, total, name) => `Attached is ${title} ${number} for ${total}. ${name}`,
  "ca-ES": (title, number, total, name) =>
    `Us adjuntem la ${title} ${number}, per un import de ${total}. ${name}`,
  "gl-ES": (title, number, total, name) =>
    `Achegamos a ${title} ${number}, por importe de ${total}. ${name}`,
  "eu-ES": (title, number, total, name) =>
    `Erantsita bidaltzen dizugu ${number} zenbakiko ${title} (${total}). ${name}`,
};

export function invoiceEmailSentence(
  locale: string,
  title: string,
  number: string,
  total: string,
  name: string,
): string {
  return (sentences[locale] ?? spanish)(title, number, total, name);
}
