# Crea un producto una vez y decide después dónde venderlo

Un producto describe lo que vendes. Una carta decide si ese producto se vende en un servicio concreto
y a qué precio. Al mantener separadas las dos tareas, puedes usar el mismo café en varias cartas sin
copiar su nombre de cocina, sus declaraciones dietéticas ni sus opciones.

Abre **Productos** en el panel de gestión y elige **Añadir producto**. Ponle un nombre al producto e
introduce su precio. Su IVA empieza en la clase elegida en **Clase de IVA para productos nuevos**, en
la pestaña **Datos del local** de **Ajustes del local**; cámbiala aquí si este producto tributa de otra
forma. Para un producto sin IVA, elige **Sin impuestos (0%)**. Un cambio de clase de IVA llega a las
cajas cuando vuelves a publicar la carta; hasta entonces venden el producto con la clase con la que se
publicó la carta. Una línea que ya está en un pedido conserva la clase con la que se añadió.

El editor deja a la vista los campos que cambias a menudo y pliega el resto bajo un encabezado que
resume lo que contiene, así ves de un vistazo qué secciones has rellenado. Abre una haciendo clic en su
encabezado. Si una sección contiene algo que tienes que corregir, se abre sola y sigue abierta hasta
que lo corriges.

## Decide cómo se vende un producto {#selling}

Abre **Venta** para cambiar Disponible o **Pedir por separado**: Cualquiera, Solo el personal o Nadie.
La explicación bajo la opción elegida te dice qué permite. Una variante solo tiene aquí Disponible.
Venta empieza cerrada, con los ajustes actuales en su línea de resumen. La lista de Productos
muestra este ajuste en su columna **Por separado**, con un filtro.

Elige la miniatura marcada con un lápiz junto a Nombre para cambiar la imagen o el color. El cuadrado
muestra el cambio de color antes de guardar. Cierra el panel con Escape para volver a la miniatura.

## Elige una unidad de venta {#selling-unit}

Un producto se vende de uno en uno salvo que elijas una unidad. Elige una cuando lo vendas por peso o
por volumen, por ejemplo en gramos o litros. El campo del precio muestra **Unidad** hasta que lo
hagas: selecciónalo para abrir la ventana **Unidad de precio**, que muestra primero **Unidad** y
después tus unidades, ordenadas en el idioma de tu panel. **Añadir unidad** crea ahí una unidad nueva
sin salir del producto.

Cuando eliges una unidad, el precio es por una de esa unidad, y la etiqueta del campo lo indica, por
ejemplo **Precio por kg**. En la caja, un producto vendido en una de las unidades de peso que trae
Waitron (gramos, kilogramos o miligramos), o en una unidad cuya **Precisión** admite decimales, pide la
cantidad cada vez, con no más decimales de los que admite la unidad. Cualquier otro producto se vende
de uno en uno con cada toque. El ticket imprime la cantidad con la abreviatura de la unidad, por ejemplo
0,35 kg. Un producto cuya cantidad pide la caja no admite extras. Tampoco un producto en una unidad
con **Mide una cantidad (ml, g…) — sin extras** activado: cuando Waitron prepara un local, los mililitros, litros, gramos,
kilogramos y miligramos que trae empiezan con él activado, una unidad que añades empieza con él desactivado,
y un cambio llega a la caja cuando vuelves a publicar los menús que venden los productos de esa unidad.

Cuando cambias el nombre de una unidad que usa un extra, la vista previa de la carta muestra
el nombre anterior y el nuevo aunque la abreviatura siga igual. Si la etiqueta de la unidad y
los decimales que se muestran no cambian, indica que han cambiado los detalles de la unidad.
Publica la carta para usar los nuevos datos de la unidad en los próximos pedidos.

## Da a un producto hasta tres nombres {#names}

El nombre que acabas de escribir es el nombre del **personal**. Es texto sin formato, en ningún
idioma concreto, y es lo que ves tú y lo que ve tu personal: la lista de Productos, los botones de
la caja, la cesta, las líneas de una mesa abierta, un pedido recuperado y tus informes de ventas.
Usa el nombre con el que el local llama de verdad al plato.

Dos nombres opcionales tienen su propia sección. **Descriptores** empieza plegada y **Cocina** empieza
abierta:

- Un **nombre para el cliente**, en **Descriptores**, con un campo por cada idioma de contenido. Es lo
  que lee el comensal: el ticket y la factura. Un ticket y una factura muestran el nombre para el cliente
  del idioma predeterminado sea cual sea el idioma en que se imprimen, o el nombre del personal si
  dejas todos los idiomas en blanco. En cuanto rellenas un idioma, rellena también el predeterminado,
  o el producto no se guardará.
- Un **nombre de cocina**, en **Cocina**. Es lo que imprime la comanda de cocina y lo que muestran las
  pantallas de cocina. Es útil cuando la etiqueta corta que necesita un cocinero no es el nombre con el
  que vendes. Déjalo en blanco y la cocina verá el nombre del personal.

Cada uno recurre a su alternativa por separado. Rellenar un nombre para el cliente no cambia lo que ve
la cocina, y rellenar un nombre de cocina no cambia lo que lee el comensal. Mientras uno de los dos
esté en blanco, su campo muestra el nombre que se usará en su lugar.

También puedes añadir una descripción para el cliente, en **Descriptores**, y una foto, que va junto al
nombre, bajo la ruta de la categoría.

## Da al producto una categoría principal {#category}

Cada producto tiene una categoría principal. Las categorías forman un árbol, así que el editor del
producto muestra la ruta completa de la categoría en la primera línea bajo el título de la ventana, por
ejemplo **Bebidas › Bebidas alcohólicas › Cócteles**, o **Sin categoría** cuando el producto no está en
ninguna. Elige **Cambiar**, después de la ruta, para elegir otra: la lista empieza con **Sin
categoría** y después muestra todas las categorías como un árbol sangrado, cada subcategoría bajo su
categoría superior. También puedes mover el producto a otra categoría en la pantalla Productos,
activando **Seleccionar** y arrastrándolo, o con **Mover a…**. La categoría principal también influye
en qué estación de cocina recibe un plato, como se explica más abajo.

Mientras añades una categoría o le cambias el nombre, el cuadrado junto al nombre muestra su propio
color, o el que hereda de la categoría superior más cercana que tenga color y, después, el
predeterminado del local. Un borde discontinuo marca un color heredado. Elige el cuadrado para darle
un color propio; **Sin color** mantiene la herencia, así que cambiar solo el nombre no cambia de
dónde viene el color.

Dónde se prepara el plato se decide en la cuadrícula de rutas, en la pestaña **Rutas** de **Estaciones
de preparación**. Decide primero la fila del propio producto, después la fila de su categoría y la de
cada categoría superior por orden (la fila **Sin categoría** para un producto sin categoría), y después
**Todas las categorías**. Dentro de una fila, una celda para la zona de servicio del pedido va antes que
la celda **Todas las zonas** de la fila. Cuando no se aplica ninguna celda, el plato va a la estación
predeterminada del local.

La lista de Productos no muestra dónde se prepara cada plato; eso lo muestra la pestaña **Rutas**. Un
asterisco rojo tras el nombre de una categoría en la lista indica que su ruta de **Todas las zonas** no
llega a ninguna estación activa, así que sus platos no van a ninguna parte salvo que la fila del propio
producto o la celda de una zona los envíe a otra. Cuando no se puede leer el envío a cocina y la lista
tiene categorías, una línea sobre la lista lo dice y no se marca ninguna categoría.

Puedes crear una unidad, una lista de extras o una lista de opciones sin abandonar el producto que estás
editando. Abre el formulario anidado y guarda el elemento nuevo: cuando vuelves, el producto ya lo usa.
Los campos del producto sin guardar siguen ahí si el guardado anidado falla o lo cancelas.

## Elige el curso {#course}

Usa el campo **Curso**, en **Cocina**, para elegir el curso de los platos nuevos. Se
guarda con el producto. En una mesa, organiza los platos en **Nuevo pedido**: pueden ir en
**Marchar ya**, en un grupo nuevo en espera o en un grupo que ya está en espera. Puedes cambiar el
curso de un plato sin enviar antes de enviarlo. Usa los grupos para elegir qué platos marchas juntos,
en vez de tratar cada curso como una sección fija para toda la mesa.

**Editar cursos…**, al final de la lista **Curso**, abre la lista de cursos en una
ventana que guarda cada cambio al hacerlo. Al cerrarla, el último curso que añadiste pasa a ser el
curso del producto; si en cambio eliminaste el curso del producto, el producto se queda sin ninguno.
Los demás campos del producto sin guardar siguen como estaban.

La columna **Curso** de la lista de Productos muestra el curso de cada producto. Cuando el local tiene
cursos, el filtro **Curso** de **Filtros** elige uno o varios de ellos, o **Sin curso**.

## Añade variantes cuando un producto se vende de varias formas {#variants}

Usa variantes para formas del mismo producto que necesitan nombres y precios distintos, como un café
solo y uno doble. Cada variante tiene su propia disponibilidad. Reordenar o editar las variantes
conserva su identidad, así que los ajustes de una carta para una variante siguen apuntando a ella.

Las variantes tienen su propia sección, **Variantes**, bajo **Precios**. Elige **Añadir variante** para
añadir una. Se abre una ventana pequeña donde das a la variante sus tres nombres (del personal, para el
cliente y de cocina), su precio, su imagen y su disponibilidad; el nombre para el cliente y el de
cocina recurren al nombre del personal de la variante igual que los del producto. Guarda la ventana
para añadir esa variante, o cancélala para no añadir nada. En las líneas del pedido de la caja, en un
ticket y en una comanda de cocina, una variante aparece tras el nombre de su producto, entre
paréntesis, por ejemplo Café (Grande), y el informe de ventas muestra cada variante bajo su producto.
Así que nombra una variante por lo que la distingue: Grande, no Café grande.

El producto conserva su propio campo de precio, encima de su IVA. En cuanto el producto tiene una
variante activa, la etiqueta del campo empieza por **Precio base**, porque una variante que dejas sin
precio propio se vende a ese precio. El precio vacío de esa variante muestra el precio base en gris
como pista, en su ventana y en su fila de la tabla. La sección **Precios** se pliega entonces a una
línea, por ejemplo **Precio base:** 38,00 € por kg · **IVA:** Reducido (10%); elige la línea para
abrirla. Se abre sola cuando hay que corregir el precio base o el IVA. Al abrir un producto sin
variantes activas, Precios empieza abierta; con variantes activas, Precios empieza cerrada y Variantes
empieza abierta. Puedes cerrar cualquiera de las dos sin perder el borrador. El enlace de la unidad en
el encabezado Precio de las variantes abre la misma ventana de unidades que el botón de unidad del
campo de precio.

Arrastra una fila por el asa de su inicio para reordenarla, o enfoca el asa y usa las flechas arriba y
abajo. El interruptor **Disponible** de cada fila marca la variante como agotada o de nuevo a la venta.
El menú de la fila ofrece **Abrir**, **Editar** y **Archivar** (**Eliminar** para una variante aún sin
guardar). **Editar**, o un clic en la fila de la variante, vuelve a abrir la ventana pequeña. Los
cambios que haces en la tabla, incluido el interruptor Disponible, se guardan cuando guardas el
producto.

**Abrir** te lleva a la página propia de la variante, donde puede tener su propio IVA, sus alérgenos y
los demás datos del producto. Su categoría principal y su unidad son siempre las de su producto: la
página muestra la ruta de categoría del producto como texto, sin **Cambiar**, y la unidad del producto
como texto junto al precio, por ejemplo "por kg", o "Unidad" cuando el producto no tiene ninguna. Si
una forma de un producto necesita otra unidad, conviértela en un producto propio. Salvo los nombres,
cada dato que dejas en blanco ahí muestra en gris el valor del producto como pista o, si el producto no
tiene ninguno, lo que se usará, por ejemplo "Sin revisar todavía" para unos alérgenos que nadie ha
revisado, y la variante usa el valor del producto. La descripción funciona como un único valor para
todos los idiomas: para usar la descripción del producto, deja en blanco todos los idiomas de la
descripción. En cuanto escribes la descripción en un idioma, la variante usa solo su propia
descripción, y los idiomas que dejaste en blanco siguen en blanco. La página no tiene sección
Modificadores ni Variantes, porque una variante siempre usa las listas de extras y de opciones de su
producto. **Abrir** aparece cuando la variante se ha guardado, y espera mientras el producto tiene
cambios sin guardar, porque salir del producto los perdería: guarda primero el producto.

**Archivar** en una variante guardada deja preparado un archivado permanente. La fila sigue visible
con **Se archivará al guardar** y **Conservar** hasta que guardas el producto. Elige Conservar para
cancelar ese cambio preparado. Una vez guardado, la caja deja de ofrecer la variante, se borran sus
precios en las cartas y se conservan sus ventas pasadas. No puedes recuperarla. Una variante ya
archivada no aparece en el editor. Para verla, activa **Mostrar archivados** en la lista de
Productos. **Eliminar** quita una variante que aún no has guardado.

Si una carta publicada o programada incluye la variante, el guardado se rechaza y nombra las cartas.
Quita la variante de esas cartas y publica antes de archivarla. No puedes añadir una variante activa a
un producto que ofrece una lista de extras, porque un producto con variantes activas no puede ser un
extra. Ese rechazo nombra las listas de extras de las que debes quitar primero el producto.

La lista de productos mantiene las variantes de cada producto plegadas bajo él. Un producto con
variantes activas indica cuántas bajo su nombre, por ejemplo **2 variantes**, y la flecha pequeña
delante de su nombre las abre. La lista muestra las variantes de un producto en el orden del propio
producto, el de la lista de variantes del editor, sea cual sea la columna por la que se ordena la
lista; arrástralas en el editor para cambiarlo. La fila de cada variante muestra su foto, su propio
nombre, el precio al que se vende, su disponibilidad y su menú de fila. Una variante sin foto propia
muestra la de su producto o, si ninguno tiene, el mismo cuadrado que la fila de su producto. Elige la
foto o el cuadrado para abrir la página propia de la variante en su foto. En un teléfono la foto no se
muestra. Si el IVA de una variante es distinto del de su producto, la lista lo indica bajo el precio de
la variante. El menú de fila de una variante también ofrece ahí **Archivar**, como la fila del propio
producto. Activa **Mostrar archivados** para ver los productos y las variantes archivados, y después
elige **Ver** en uno para ver sus datos como texto. Ver no tiene Guardar ni interruptor de
disponibilidad; mantiene disponible el registro conservado sin permitir cambios.

Una variante sigue a su producto en todas las cartas en las que está el producto, también una variante
que añadas más tarde. En la carta puedes darle un precio propio o dejar que siga a las cartas de las
que viene. Gana el precio que pones para esta carta. Si no, los precios fijados para ese tamaño en las
cartas incluidas y en el producto contribuyen a su precio. Si no hay un precio para el tamaño, sigue el
precio combinado del producto.

Deja vacío el precio de una carta para que lo decidan esas contribuciones. Por ejemplo, si Bebidas pone
la cerveza a 3,00 € y Noche incluye solo la cerveza de Bebidas, Noche cobra 3,00 €. Si Noche también
pone esa cerveza en una sección propia al precio del producto, 2,80 €, los precios no coinciden. Fija
el precio de la cerveza en Noche para resolver ese desacuerdo antes de publicar. La pestaña **Precios
propios** de la carta muestra de dónde viene cada precio y qué ajustes aún necesitan tu decisión.

## Declara los alérgenos y la aptitud dietética directamente {#allergens}

**Información nutricional** empieza plegada, con una línea de resumen como "Alérgenos: Sin revisar
todavía · Dietética: Ninguna". Ábrela para elegir.

En **Alérgenos**, elige cada uno de los 14 alérgenos que contiene el plato, o **No contiene ninguno de
los 14** cuando hayas comprobado que no tiene ninguno. Al elegir **Cereales con gluten** o **Frutos de
cáscara** se abre debajo una fila de tipos, como **Trigo** o **Almendras**: elige al menos uno. Elegir
un alérgeno significa que el plato lo contiene; no hay una opción aparte de "puede contener". Quitar el
último alérgeno devuelve un producto a sin revisar, y una variante a los alérgenos de su producto.

En **Dietética**, elige cualquiera de **Vegano**, **Vegetariano**, **Halal**, **Kosher**, **Sin carne**
y **Sin pescado**. Vegano marca también Vegetariano, Sin carne y Sin pescado, y Vegetariano marca Sin
carne y Sin pescado; una marca que se deriva de otra de tus opciones no se puede cambiar por sí sola.

Cada producto indica sus propios alérgenos y etiquetas dietéticas. Una variante usa los de su producto
hasta que eliges los suyos en la página de la variante. **Igual que** seguido del nombre del producto
vuelve a los alérgenos del producto, y quitar la última etiqueta dietética de la variante vuelve a las
etiquetas del producto. Un extra que puedes añadir a un plato es en sí un producto, así que trae
consigo sus propias declaraciones. Una opción de una lista de opciones no: una opción como _poco hecho_
o _muy hecho_ no lleva alérgenos ni aptitud dietética propios, porque es una forma de pedir el mismo
plato, no algo más que comer. La caja y la cocina muestran la lista propia de cada elemento.

En la lista de Productos, **Sin revisar**, **Ninguno** y **Declarado** distinguen un plato que no has
comprobado de uno que sí. Una variante muestra su estado efectivo; la cursiva indica que sigue a su
producto. El filtro de Alérgenos usa ese mismo estado para cada variante. Las columnas
**Alérgenos** e **Info dietética** empiezan ocultas: muéstralas con el botón **Personalizar columnas**,
junto a la búsqueda de la lista. Sus filtros funcionan aunque las columnas estén ocultas.

Antes de publicar ahora o de programar una carta, la confirmación muestra los platos ofrecidos y las
variantes activas cuyos alérgenos están sin revisar. Selecciona un nombre para abrir la página propia
de ese producto. Aun así puedes publicar o programar: el aviso te pide que compruebes las
declaraciones, no rechaza la publicación. Si cancelas la confirmación de programación, se conservan la
fecha y la hora que introdujiste.

Los datos de compras existentes y los datos registrados de los pedidos siguen disponibles, pero los
alérgenos y la aptitud dietética vigentes de los productos los gestionas en **Productos**.

## Pon un producto nuevo en tus cartas {#menus}

Cuando guardas un producto nuevo, el editor se cierra y una ventana como **Añadir Flat white a las
cartas** pregunta dónde va. Muestra el **Nivel principal** de cada carta y sus secciones: marca los
sitios que quieras y elige **Añadir a las cartas**, o elige **Omitir** y colócalo más tarde. Para
entonces el producto ya está guardado, así que un sitio que lo rechaza no deshace el guardado. La
ventana nombra los sitios que fallaron y los deja marcados para que puedas volver a intentarlo. Las
secciones de una carta se crean en **Productos y cartas → Cartas**.

## Reutiliza las elecciones {#reusable-choices}

Crea listas de extras y listas de opciones reutilizables en las dos pestañas de **Modificadores**, y
después asígnalas en la propia sección **Modificadores** del producto, en el orden que quieras.
Consulta [Reutiliza las mismas elecciones en todos tus productos](modifiers.md) para saber qué
contiene cada tipo, sus valores predeterminados y límites, y los precios de los extras.

Cuando aparcas o completas un pedido, Waitron guarda los nombres del producto y la variante elegidos,
el nombre de cocina, los precios y las respuestas de los modificadores. Los cambios posteriores en el
catálogo se aplican a las selecciones nuevas. El pedido aparcado, la comanda de cocina, el ticket y la
reimpresión siguen mostrando los datos guardados con ese pedido.

El local de demostración incluye un café con nombre en cada idioma de contenido del local, con dos
variantes, un nombre de cocina aparte y declaraciones dietéticas directas; la Ensalada mixta tiene una
unidad propia. Casa Delgado y Menú del Día incluyen una carta **Bebidas** como carpeta. Bebidas pone la
Caña a 3,00 en lugar de su precio de producto de 2,80; las dos cartas que la incluyen heredan ese
precio. Menú del Día fija su propio precio del Negroni en 9,00. Las variantes del café conservan sus
propios precios. El solomillo de demostración lleva una lista de opciones de ejemplo, **Punto**, que
pregunta cómo se hace la carne. En **Pollo asado** puedes elegir hasta tres guarniciones opcionales de
**Guarniciones**: pimientos de Padrón (2,00), ensalada mixta (1,50) y pan de la casa (0,50). Estos
precios se aplican a una ración añadida al pollo, así que puedes probar un extra con un precio distinto
del mismo producto vendido por separado.

## Consulta la información nutricional de un plato en la caja {#nutrition-at-the-till}

Mantén pulsado el botón de un producto para abrir su ventana de información. Ves los alérgenos del
plato, incluidos sus cereales o frutos de cáscara, y sus etiquetas dietéticas. Un plato sin revisar lo
indica en la ventana. Elige **Añadir al pedido** para seleccionar el plato, o **Cerrar** para volver
sin añadirlo.

La pequeña marca nutricional solo aparece cuando el plato tiene alérgenos o etiquetas dietéticas
declarados. Aun así puedes mantener pulsado un botón sin marca para comprobar su estado de revisión. Un
toque corto en cualquier parte del botón, incluida la marca, añade el plato como siempre.

Las líneas del pedido muestran iconos nutricionales tras el nombre del plato. Un plato sin revisar no
muestra iconos; consulta su ventana de información en lugar de tomar la falta de iconos como una
declaración. Los extras mantienen su propia información nutricional separada de la del plato. La caja
no tiene una pantalla de Alérgenos aparte ni una hoja de alérgenos impresa.

Mayús+F10 o la tecla de menú contextual abre la misma ventana de información para un producto
enfocado. Intro sigue seleccionando el plato.

## Guarda la respuesta sobre alergias con los platos de la mesa {#table-allergies}

Antes de enviar por primera vez los platos de una mesa, responde **¿Hay alergias en esta mesa?**
Elige **Sin alergias**, o elige **Alergias** e indica quién necesita atención especial, los alérgenos
que debe evitar y, si hace falta, una nota para cocina. Puedes añadir varias personas. La respuesta
pertenece a los comensales de la mesa y se comparte entre sus cuentas.

Marca los platos que comerá cada persona con alergias. La marca abarca toda la línea del pedido:
una línea con dos raciones se asigna entera, y un plato solo puede corresponder a una persona. Si
hay un conflicto, verás cada alérgeno que la persona evita y que declaran el plato o alguno de sus
extras, y podrás elegir **Enviar de todos modos**. Comprueba por tu cuenta un plato o un extra sin
revisar; la falta de información nutricional no establece que sea apto.

Los siguientes envíos ofrecen los platos nuevos para asignarlos. Un plato que ya has enviado en
espera no vuelve a ofrecerse solo porque lo envíes a preparar más tarde. **Cambiar** junto a la
respuesta de la mesa, o **Acciones → Alergias**, abre el editor completo, incluidos los platos ya
enviados. Ahí puedes editar o eliminar una persona; al eliminar la última, la respuesta sigue
siendo Alergias hasta que la cambies.

Al pasar una cuenta del mostrador a una mesa, también se comprueba la respuesta de esa mesa y se
ofrecen los platos que llegan. Cancelar deja la cuenta donde está. Si la mesa cambia mientras
respondes, revisa la información actualizada y vuelve a confirmar antes de completar el traslado.

Cocina conserva su primera copia de alergias con cada plato. Un cambio posterior llega en un
aviso aparte que debe confirmarse. Consulta cómo las
[copias de alergias y sus correcciones](kitchen-service.md#allergy-copies) acompañan al trabajo.
