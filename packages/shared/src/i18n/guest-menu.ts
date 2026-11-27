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
filters|Allergies and diets|Alergias y dietas|Al·lèrgies i dietes|Alerxias e dietas
excludeAllergens|Exclude allergens|Excluir alérgenos|Exclou al·lèrgens|Excluír alérxenos
chooseDiet|Diet|Dieta|Dieta|Dieta
anyDiet|Any diet|Cualquier dieta|Qualsevol dieta|Calquera dieta
selectedCount|{count} selected|{count} seleccionados|{count} seleccionats|{count} seleccionados
clearFilters|Clear filters|Quitar filtros|Treure els filtres|Quitar os filtros
closeFilters|Close|Cerrar|Tanca|Pechar
noFilteredDishes|No dishes match these filters.|Ningún plato coincide con estos filtros.|Cap plat coincideix amb aquests filtres.|Ningún prato coincide con estes filtros.
noDishesSearchAndFilters|No dishes match your search and filters.|Ningún plato coincide con tu búsqueda y tus filtros.|Cap plat coincideix amb la teva cerca i els teus filtres.|Ningún prato coincide coa túa busca e os teus filtros.
hiddenDishes|Hidden dishes ({hidden}). Hidden because allergens need review ({unreviewed}).|Platos ocultos ({hidden}). Por alérgenos sin revisar ({unreviewed}).|Plats amagats ({hidden}). Per al·lèrgens sense revisar ({unreviewed}).|Pratos ocultos ({hidden}). Por alérxenos sen revisar ({unreviewed}).
askAboutAllergens|Ask staff about allergens, even when no icons appear.|Pregunta al personal por los alérgenos, aunque no veas iconos.|Pregunta al personal pels al·lèrgens, encara que no vegis icones.|Pregunta ao persoal polos alérxenos, aínda que non vexas iconas.
askAboutSetMenu|Ask staff about the choices in this set menu.|Pregunta al personal por las opciones de este menú.|Pregunta al personal per les opcions d’aquest menú.|Pregunta ao persoal polas opcións deste menú.
checkChoices|Check the choices for allergens.|Consulta los alérgenos de las opciones.|Consulta els al·lèrgens de les opcions.|Consulta os alérxenos das opcións.
selectedAllergen|Contains a selected allergen|Contiene un alérgeno seleccionado|Conté un al·lergen seleccionat|Contén un alérxeno seleccionado
unreviewedAllergens|Allergens not reviewed|Alérgenos sin revisar|Al·lèrgens sense revisar|Alérxenos sen revisar
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
