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
keyLanguage|Key in English|Leyenda en español|Llegenda en català|Lenda en galego
key|Allergen key|Leyenda de alérgenos|Llegenda d’al·lèrgens|Lenda de alérxenos
diet|Dietary declarations|Declaraciones dietéticas|Declaracions dietètiques|Declaracións dietéticas
note|Icons show declared allergens. No icon does not mean allergen-free. Tell staff about allergies.|Los iconos muestran los alérgenos declarados. La ausencia de iconos no significa que no haya alérgenos. Informa al personal de tus alergias.|Les icones mostren els al·lèrgens declarats. L’absència d’icones no vol dir que no hi hagi al·lèrgens. Informa el personal de les teves al·lèrgies.|As iconas mostran os alérxenos declarados. A ausencia de iconas non significa que non haxa alérxenos. Informa o persoal das túas alerxias.
`
  .trim()
  .split("\n")
  .map((row) => row.split("|"));
export function guestMenuWords(
  requested: string,
  fallback: string,
): { language: string; text: Record<string, string> } {
  const base = (tag: string) => tag.split("-")[0]!;
  const language = [base(requested), base(fallback), "en"].find((value) =>
    languages.includes(value),
  )!;
  const index = languages.indexOf(language) + 1;
  return { language, text: Object.fromEntries(wording.map((row) => [row[0]!, row[index]!])) };
}
