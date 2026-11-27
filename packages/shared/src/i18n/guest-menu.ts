import { matchLanguage } from "../language-match.js";

const languages = ["en", "es", "ca", "gl"];
// Columns are the complete EN, ES, CA and GL bundles; content names resolve separately.
const wording = `
gluten|Cereals containing gluten|Cereales con gluten|Cereals que continguin gluten|Cereais que conteñan glute
crustaceans|Crustaceans|Crustáceos|Crustacis|Crustáceos
eggs|Eggs|Huevos|Ous|Ovos
fish|Fish|Pescado|Peix|Peixe
peanuts|Peanuts|Cacahuetes|Cacauets|Cacahuetes
soybeans|Soybeans|Soja|Soja|Soia
milk|Milk|Leche|Llet|Leite
nuts|Nuts|Frutos de cáscara|Fruita seca de clofolla|Froitos de casca
celery|Celery|Apio|Api|Apio
mustard|Mustard|Mostaza|Mostassa|Mostaza
sesame|Sesame seeds|Granos de sésamo|Grans de sèsam|Grans de sésamo
sulphites|Sulphur dioxide and sulphites|Dióxido de azufre y sulfitos|Anhídrid sulfurós i sulfits|Dióxido de xofre e sulfitos
lupin|Lupin|Altramuces|Tramussos|Altramuces
molluscs|Molluscs|Moluscos|Mol·luscs|Moluscos
wheat|Wheat|Trigo|Blat|Trigo
rye|Rye|Centeno|Sègol|Centeo
barley|Barley|Cebada|Ordi|Cebada
oats|Oats|Avena|Civada|Avea
spelt|Spelt|Espelta|Espelta|Espelta
kamut|Khorasan wheat|Trigo khorasan|Blat khorasan|Trigo khorasan
almonds|Almonds|Almendras|Ametlles|Améndoas
hazelnuts|Hazelnuts|Avellanas|Avellanes|Abelás
walnuts|Walnuts|Nueces|Nous|Noces
cashews|Cashews|Anacardos|Anacards|Anacardios
pecans|Pecans|Pacanas|Pacanes|Pacanas
brazil_nuts|Brazil nuts|Nueces de Brasil|Nous del Brasil|Castañas de Pará
pistachios|Pistachios|Pistachos|Festucs|Pistachos
macadamia|Macadamia or Queensland nuts|Nueces macadamia o nueces de Australia|Nous de macadàmia|Noces de macadamia
vegan|Vegan|Vegano|Vegà|Vegano
vegetarian|Vegetarian|Vegetariano|Vegetarià|Vexetariano
halal|Halal|Halal|Halal|Halal
kosher|Kosher|Kosher|Kosher|Kosher
no_meat|No meat|Sin carne|Sense carn|Sen carne
no_fish|No fish|Sin pescado|Sense peix|Sen peixe
languages|Languages|Idiomas|Idiomes|Idiomas
searchDishes|Search dishes|Buscar platos|Cerca plats|Buscar pratos
noDishes|No dishes match your search.|Ningún plato coincide con tu búsqueda.|Cap plat coincideix amb la teva cerca.|Ningún prato coincide coa túa busca.
menuSections|Menu sections|Secciones de la carta|Seccions de la carta|Seccións da carta
unavailable|Menu unavailable|Carta no disponible|Carta no disponible|Carta non dispoñible
keyLanguage|Key in English|Leyenda en español|Llegenda en català|Lenda en galego
key|Allergen key|Leyenda de alérgenos|Llegenda d’al·lèrgens|Lenda de alérxenos
diet|Dietary declarations|Declaraciones dietéticas|Declaracions dietètiques|Declaracións dietéticas
backToMenu|Back to menu|Volver a la carta|Torna a la carta|Volver á carta
menu|Menu|Carta|Carta|Carta
allergens|Allergens|Alérgenos|Al·lèrgens|Alérxenos
variants|Variants|Variantes|Variants|Variantes
perPerson|{price} per person|{price} por persona|{price} per persona|{price} por persoa
`
  .trim()
  .split("\n")
  .map((row) => row.split("|"));
export function guestMenuWords(
  requested: string | readonly string[],
  fallback: string,
): { language: string; text: Record<string, string> } {
  const language =
    matchLanguage(typeof requested === "string" ? [requested] : requested, languages) ??
    matchLanguage([fallback], languages) ??
    "en";
  const index = languages.indexOf(language) + 1;
  return { language, text: Object.fromEntries(wording.map((row) => [row[0]!, row[index]!])) };
}
