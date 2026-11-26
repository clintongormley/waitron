# Crea un producto una vez y decide después dónde venderlo

Un producto describe lo que vendes. Una carta decide si ese producto se vende en un servicio concreto
y a qué precio. Al mantener separadas las dos tareas, puedes usar el mismo café en varias cartas sin
copiar su nombre de estación de preparación, sus declaraciones dietéticas ni sus opciones.

Puedes añadir productos antes de crear una carta. Abre **Productos** en el panel de gestión y elige **Añadir producto**. Ponle un nombre al producto e
introduce su precio.

Cuando abras el editor desde la lista de productos, usa el botón **Atrás** del navegador para
volver a la lista. Si has hecho cambios, elige **Seguir editando** o **Descartar cambios**. Cuando
abras una variante desde su producto, **Atrás** te devuelve a ese producto.

El editor tiene tres tarjetas. La primera reúne el nombre con su foto, **Categoría** y **Disponible**.
La tercera reúne el precio, las variantes y los modificadores. Entre las dos, **Detalles** reúne el
resto: la estación de preparación, cómo aparece el producto en la carta, los alérgenos y la dieta, el
IVA y los pedidos. Detalles está abierta cuando añades un producto y cerrada cuando editas uno. Mientras está cerrada, muestra una línea por
cada uno de sus grupos que tiene algo configurado, así ves lo que está configurado sin abrirla. Haz clic en su
encabezado para abrirla o cerrarla. Si contiene algo que tienes que corregir, se abre sola y sigue
abierta hasta que lo corriges.

En **Lista**, busca por nombre de producto o variante. Para encontrar platos de una categoría y
sus subcategorías, elige una **Categoría** en **Filtros**. En **Disponible**, elige **No** para encontrar platos o
variantes que no están a la venta. Un plato con una variante no disponible puede aparecer bajo
**Sí** y **No**. En un teléfono, busca la categoría debajo del nombre del producto. El interruptor
junto al precio controla la disponibilidad. En un teléfono, sal de **Seleccionar** para volver a
ver el precio y el interruptor.

Para cambiar varios productos a la vez, activa **Seleccionar**, marca los productos y elige
**Marcar como disponible** o **Marcar como no disponible**. El recuento de la selección indica
cuántos elementos marcados ocultan la búsqueda o los filtros. En **Árbol**, marca una categoría
para incluir todos sus productos y los de sus subcategorías, incluso si la búsqueda o los filtros
los ocultan. Después de marcar una categoría como disponible o no disponible, un aviso indica a
cuántos productos se aplicó la acción. En Árbol, la casilla de la cabecera marca las filas visibles que
coinciden. Si una categoría aparece porque coincide uno de sus productos, marca la categoría para incluirla.

Cambia a **Árbol** para recorrer u organizar las categorías. Las categorías siguen en orden
alfabético cuando ordenas los productos y se abren si tienen coincidencias al filtrar. Para añadir
un producto directamente en una categoría, elige **Añadir producto** en su menú ⋮. El botón junto al
título de la página añade un producto sin categoría.

Si no hay coincidencias o tus opciones ocultan un producto que acabas de guardar, elige **Borrar
búsqueda y filtros**. Si una categoría vacía nueva desaparece al filtrar en Árbol, elige **Borrar
todo** en **Filtros**.

## Cómo se cobra el IVA {#vat}

Todo lo que se come o se bebe en el local se cobra con un único tipo, que se muestra en el editor
del producto («Para comer aquí: 10 % (toda la comida y bebida)»). Waitron lo actualiza cuando
cambia la ley; no hay nada que configurar.

Si tu región grava de otra forma la comida para llevar, **IVA para llevar** guarda el tipo con el
que se cobra este producto cuando se lo llevan. Elígelo de la lista. Un producto nuevo empieza con
**Los productos nuevos empiezan con (IVA para llevar)**, en la tarjeta **Valores
predeterminados** de la pestaña **Datos del local**. Una variante puede conservar el tipo de su
producto. Un cambio se aplica a todos los tickets para llevar desde entonces, también a los pedidos
ya abiertos; no hace falta publicar la carta.

## Decide cómo se vende un producto {#selling}

**Disponible**, bajo Nombre, dice si el producto está a la venta. **Pedir por separado**, en
**Pedidos** dentro de **Detalles**, dice quién puede pedirlo solo: Cualquiera, Solo el personal o
Nadie. La explicación bajo la opción elegida te dice qué permite. Una variante no tiene Pedidos,
porque se pide como su producto. La lista de Productos
muestra **Solo el personal** o **No se vende por separado** junto al nombre cuando corresponde.
Usa **Pedir por separado** en **Filtros** para buscar productos según este ajuste.

Elige la miniatura marcada con un lápiz junto a Nombre para cambiar la imagen o el color. El cuadrado
muestra el cambio de color antes de guardar. Cierra el panel con Escape para volver a la miniatura.

## Elige una unidad de venta {#selling-unit}

Un producto se vende de uno en uno salvo que elijas una unidad. Elige una cuando lo vendas por peso o
por volumen, por ejemplo en gramos o litros. El campo del precio muestra **Unidad** hasta que lo
hagas: selecciónalo para abrir la ventana **Unidad de precio**, que muestra primero **Unidad** y
después tus unidades, ordenadas en el idioma de tu panel. **Añadir unidad** crea ahí una unidad nueva
sin salir del producto.

Cuando eliges una unidad, el precio es por una de esa unidad, y la etiqueta del campo lo indica, por
ejemplo **Precio por kg**. Elige **Mide una cantidad (ml, g…) — sin extras** para una unidad
que vendes por medida. La caja pide la cantidad cuando tocas el producto. También la pide para
las unidades de peso y las que admiten decimales en **Precisión**. Escribe la cantidad en el
campo del producto o usa el teclado de la caja. Si la unidad no admite decimales, escribe las
cifras sin separadores. El ticket imprime la cantidad y la abreviatura de la unidad, por ejemplo
250 ml. Un producto que se vende por medida no admite
extras.

Waitron trae mililitros, litros, gramos, kilogramos y miligramos con el ajuste de medida activado.
Las unidades que añades lo tienen desactivado al crearlas. Publica las cartas que venden los
productos de esa unidad para enviar tus cambios a la caja.

Cuando cambias el nombre de una unidad que usa un extra, la vista previa de la carta muestra
el nombre anterior y el nuevo aunque la abreviatura siga igual. Si la etiqueta de la unidad y
los decimales que se muestran no cambian, indica que han cambiado los detalles de la unidad.
Publica la carta para usar los nuevos datos de la unidad en los próximos pedidos.

## Da a un producto hasta tres nombres {#names}

El nombre que acabas de escribir es el nombre del **personal**. Es texto sin formato, en ningún
idioma concreto, y es lo que ves tú y lo que ve tu personal: la lista de Productos, los botones de
la caja, la cesta, las líneas de una mesa abierta, un pedido recuperado y tus informes de ventas.
Usa el nombre con el que el local llama de verdad al plato.

Dos nombres opcionales están en **Detalles**:

- Un **nombre para el cliente**, en **En la carta**, con un campo por cada idioma de contenido. Es lo
  que lee el comensal: el ticket y la factura. Un ticket y una factura muestran el nombre para el cliente
  del idioma predeterminado sea cual sea el idioma en que se imprimen, o el nombre del personal si
  dejas ese nombre predeterminado en blanco. Un campo regional como **Inglés (Estados Unidos)**
  es opcional. Déjalo vacío para usar el inglés o escribe solo las palabras que cambian. Revisa
  los nombres regionales en la pestaña **Vista previa** de la carta. Los nombres regionales no
  sustituyen al nombre predeterminado en el ticket.
- Un **nombre de estación de preparación**, en **Estación de preparación**. Es lo que imprime la comanda de estación y lo que muestran las
  pantallas de estación. Es útil cuando la etiqueta corta que necesita un cocinero no es el nombre con el
  que vendes. Déjalo en blanco y la estación verá el nombre del personal.

Cada uno recurre a su alternativa por separado. Rellenar un nombre para el cliente no cambia lo que ve
la estación, y rellenar un nombre de estación de preparación no cambia lo que lee el comensal. Mientras uno de los dos
esté en blanco, su campo muestra el nombre que se usará en su lugar.

También puedes añadir una descripción para el cliente, en **En la carta**, y una foto, que va junto al
nombre.

## Da al producto una categoría principal {#category}

El campo **Categoría** muestra la ruta completa, por ejemplo **Bebidas › Bebidas alcohólicas ›
Cócteles**. Ábrelo para recorrer el árbol o buscar en él. Elige **Sin categoría** para dejar el
producto sin clasificar. Para crear una categoría mientras editas, escribe su nombre y elige
**Añadir categoría** al principio de la lista. Elige dónde va en **Dentro de**, selecciona un color
si quieres y pulsa **Añadir categoría**. Si cancelas la edición del producto, la categoría queda
guardada.

En la pantalla Productos, activa **Seleccionar** y elige **Mover a…** para mover productos. Para
arrastrar un producto a una categoría, cambia primero a **Árbol**. La categoría principal también
influye en qué estación de preparación recibe un plato, como se explica más abajo.

Para soltar elementos en una subcategoría, abre las categorías superiores antes de empezar a arrastrar.
Al soltar productos o categorías, se abre la ventana de **Mover a…** con el destino seleccionado.
Revisa los cambios de estación de preparación, si los hay, y elige **Mover** para guardar.
También puedes soltar los elementos en **Todos los productos** para sacarlos de su categoría.
Revisa también los cambios de estación al abrir **Mover a…** desde la barra de herramientas.

Al eliminar una categoría, elige si quieres conservar su contenido o eliminarlo también.
Comprueba adónde se moverá el contenido si lo conservas. Los productos que hayas marcado se
eliminan con cualquiera de las dos opciones.

Mientras añades una categoría o le cambias el nombre, elige el cuadrado junto al nombre para fijar su
color. Elige **Heredar** para usar el color que aparece en esa opción. Elige una muestra para fijar
un color propio, aunque coincida con el heredado.

Dónde se prepara el plato se decide en la cuadrícula de rutas, en la pestaña **Rutas** de **Estaciones
de preparación**. Decide primero la fila del propio producto, después la fila de su categoría y la de
cada categoría superior por orden (la fila **Sin categoría** para un producto sin categoría), y después
**Todas las categorías**. Dentro de una fila, una celda para la zona de servicio del pedido va antes que
la celda **Todas las zonas** de la fila. Cuando no se aplica ninguna celda, el plato va a la estación
predeterminada del local.

La lista de Productos no muestra dónde se prepara cada plato; eso lo muestra la pestaña **Rutas**.
Un asterisco rojo tras el nombre de una categoría en la lista indica que su ruta de **Todas las
zonas** no llega a ninguna estación activa. Otras rutas de la pestaña **Rutas** aún pueden enviar
algunos de sus platos a una estación. Cuando falla la carga del envío a la estación y la lista tiene
categorías, una línea sobre la lista lo dice y no se marca ninguna categoría.

Puedes crear una unidad, una lista de extras o una lista de opciones sin abandonar el producto que estás
editando. Abre el formulario anidado y guarda el elemento nuevo: cuando vuelves, el producto ya lo usa.
Los campos del producto sin guardar siguen ahí si el guardado anidado falla o lo cancelas.

## Elige el orden de plato {#course}

Los locales nuevos en España empiezan con **Pica pica**, **Entradas**, **Platos principales** y
**Postres**. Los nombres siguen el idioma
del contenido inicial. Asigna estos órdenes de plato a tus productos o adapta la lista a tu servicio.

Usa el campo **Orden de plato**, en **Estación de preparación** dentro de **Detalles**, para
elegir el de los platos nuevos. Se guarda con el producto. En una mesa, organiza los platos en
**Nuevo pedido**. Pueden ir en **Marchar ya**, en un grupo nuevo en espera o en un grupo que ya está
en espera. Antes de enviar un plato, puedes cambiar su orden de plato. Usa los grupos para elegir
qué platos marchas juntos sin tratar cada orden de plato como una sección fija para toda la mesa.

En la pestaña **Mesas** del departamento, elige **Marchar ya** para colocar los platos nuevos directamente en ese grupo de
la mesa. Elige **Dejar para después** para agrupar el primer pedido por orden de plato. En pedidos
posteriores, comprueba el grupo propuesto antes de enviar. Puedes mover los platos entre grupos. En
**Orden de platos**, pulsa **Añadir orden de plato** y guarda el nombre con Intro o al salir del
campo. Abre el menú ⋮ de la fila para cambiar el nombre o eliminar ese orden de plato.
Elige **Nombres para el cliente** en el mismo menú para poner un nombre en cada idioma.
Para publicar cambios en esos nombres, revisa y publica la carta que ofrece el menú.

**Editar orden de platos…**, al final de la lista **Orden de plato**, abre una ventana que guarda
cada cambio al hacerlo. Al cerrarla, el último orden de plato que añadiste se aplica al producto.
Si eliminaste el que tenía, el producto se queda sin ninguno. Los demás campos del producto sin
guardar siguen como estaban.

En la lista de Productos, abre **Personalizar** para mostrar la columna **Orden de plato**. Si el
local tiene órdenes de plato, usa **Orden de plato** en **Filtros** para elegir uno o varios, o
**Sin orden de plato**.

En una mesa de la demostración española, envía un primer pedido con bebidas y platos
principales. Las bebidas van directamente a la barra y los platos principales esperan hasta
que pulses **Marchar**. Los postres enviados en ese primer pedido esperan en su propio grupo.

## Añade variantes cuando un producto se vende de varias formas {#variants}

Usa variantes para formas del mismo producto que necesitan nombres y precios distintos, como un café
solo y uno doble. Cada variante tiene su propia disponibilidad. Reordenar o editar las variantes
conserva su identidad, así que los ajustes de una carta para una variante siguen apuntando a ella.

Las variantes están bajo el precio, en su propio grupo, **Variantes**. Elige **Añadir variante** para
añadir una. Se abre una ventana pequeña donde das a la variante sus tres nombres (del personal, para el
cliente y de estación), su precio, su imagen y su disponibilidad; el nombre para el cliente y el de
la estación recurren al nombre del personal de la variante igual que los del producto. Guarda la ventana
para añadir esa variante, o cancélala para no añadir nada. En las líneas del pedido de la caja, en un
ticket y en una comanda de estación, una variante aparece tras el nombre de su producto, entre
paréntesis, por ejemplo Café (Grande), y el informe de ventas muestra cada variante bajo su producto.
Así que nombra una variante por lo que la distingue: Grande, no Café grande.

El producto conserva su propio campo de precio. En cuanto el producto tiene una
variante activa, la etiqueta del campo empieza por **Precio base**, porque una variante que dejas sin
precio propio se vende a ese precio. Si dejas el precio en blanco, verás el precio base con una
flecha en la ventana y en texto atenuado en la tabla. Escribe un precio para fijarlo. En la página
de la variante, elige **Heredar** en Orden de plato o IVA para llevar para seguir al producto, o elige
un valor para fijarlo. El enlace de la unidad en
el encabezado Precio de las variantes abre la misma ventana de unidades que el enlace de la unidad del
campo de precio.

Arrastra una fila por el asa de su inicio para reordenarla, o enfoca el asa y usa las flechas arriba y
abajo. El interruptor **Disponible** de cada fila marca la variante como agotada o de nuevo a la venta.
El menú de la fila ofrece **Abrir**, **Editar** y **Eliminar**. **Editar**, o un clic en la fila de la variante, vuelve a abrir la ventana pequeña. Los
cambios que haces en la tabla, incluido el interruptor Disponible, se guardan cuando guardas el
producto.

**Abrir** te lleva a la página propia de la variante, donde puede tener su propio IVA para llevar, sus alérgenos y
los demás datos del producto. Su categoría principal y su unidad son siempre las de su producto: la
página muestra como texto la ruta de categoría del producto y su unidad, que aparece junto al precio, por ejemplo "por kg", o "Unidad" cuando el producto no tiene ninguna. Si
una forma de un producto necesita otra unidad, conviértela en un producto propio. Salvo los nombres,
cada dato que dejas en blanco ahí muestra en gris el valor del producto como pista o, si el producto no
tiene ninguno, lo que se usará, por ejemplo "Sin revisar todavía" para unos alérgenos que nadie ha
revisado, y la variante usa el valor del producto. La descripción funciona como un único valor para
todos los idiomas: para usar la descripción del producto, deja en blanco todos los idiomas de la
descripción. En cuanto escribes la descripción en un idioma, la variante usa solo su propia
descripción, y los idiomas que dejaste en blanco siguen en blanco. La página no tiene
Variantes ni Modificadores, porque una variante siempre usa las listas de extras y de opciones de su
producto. **Abrir** aparece cuando la variante se ha guardado, y espera mientras el producto tiene
cambios sin guardar, porque salir del producto los perdería: guarda primero el producto.

Elige **Eliminar** en una variante guardada para marcarla como **Se elimina al guardar**.
Elige **Conservar** para deshacer la elección antes de guardar. En una variante sin guardar,
**Eliminar** la quita de la lista directamente.
Revisa las listas de extras que se indican antes de guardar. Al guardar, la variante se quita de esas listas.

Si una carta publicada o programada incluye la variante, el guardado se rechaza y nombra las cartas.
Quita la variante de esas cartas y publica antes de eliminarla. No puedes añadir una variante activa a
un producto que ofrece una lista de extras, porque un producto con variantes activas no puede ser un
extra. Ese rechazo nombra las listas de extras de las que debes quitar primero el producto.

La lista de productos mantiene las variantes de cada producto plegadas bajo él. Un producto con
variantes activas indica cuántas bajo su nombre, por ejemplo **2 variantes**, y la flecha pequeña
delante de su nombre las abre. En **Filtros**, elige **Con variantes** o **Sin variantes** en **Variantes**.
La lista muestra las variantes de un producto en el orden del propio
producto, el de la lista de variantes del editor, sea cual sea la columna por la que se ordena la
lista; arrástralas en el editor para cambiarlo. La fila de cada variante muestra su foto, su propio
nombre, el precio al que se vende, su disponibilidad y su menú de fila. Una variante sin foto propia
muestra la de su producto o, si ninguno tiene, el mismo cuadrado que la fila de su producto. Elige la
foto o el cuadrado para abrir la página propia de la variante en su foto. Si el IVA para llevar de una variante es distinto del de su producto, la lista lo indica bajo el precio de
la variante. Elige **Eliminar** en el menú de un producto o una variante para quitarlo de
Productos de forma permanente. Sus ventas pasadas se conservan.

Una variante sigue a su producto en todas las cartas en las que está el producto, también una variante
que añadas más tarde. Una carta pone precio a un producto con variantes solo a través de sus variantes,
así que añadir la primera variante de un producto quita el precio que cada carta le había fijado. Un
menú conserva su suplemento. En la carta puedes darle a una variante un precio propio o dejar que siga
a las cartas de las que viene. Gana el precio que pones para esta carta. Si no, los precios fijados
para esa variante en las cartas incluidas y en la propia variante contribuyen a su precio. Si no hay
ninguno, se vende al precio de su producto.

Deja vacío el precio de una carta para que lo decidan esas contribuciones. Por ejemplo, si Bebidas pone
la cerveza a 3,00 € y Noche incluye solo la cerveza de Bebidas, Noche cobra 3,00 €. Si Noche también
pone esa cerveza en una sección propia al precio del producto, 2,80 €, los precios no coinciden. Fija
el precio de la cerveza en Noche para resolver ese desacuerdo antes de publicar. En **Estructura**,
el conflicto muestra qué precios discrepan. Si el plato tiene variantes, despliégalo para fijar el
precio en la fila de la variante afectada.

## Declara los alérgenos y la aptitud dietética directamente {#allergens}

Elígelos en **Alérgenos y dieta**, dentro de **Detalles**. Hasta que alguien revisa los alérgenos de
un producto, la línea de Detalles cerrada muestra "Alérgenos: Sin revisar todavía" en el color de
aviso.

En **Alérgenos**, elige cada uno de los 14 alérgenos que contiene el plato, o **No contiene ninguno de
los 14** cuando hayas comprobado que no tiene ninguno. Al elegir **Cereales con gluten** o **Frutos de
cáscara** se abre debajo una fila de tipos, como **Trigo** o **Almendras**: elige al menos uno. Elegir
un alérgeno significa que el plato lo contiene; no hay una opción aparte de "puede contener". Quitar el
último alérgeno devuelve un producto a sin revisar, y una variante a los alérgenos de su producto.

En **Dietética**, elige cualquiera de **Vegano**, **Vegetariano**, **Halal**, **Kosher**, **Sin carne**
y **Sin pescado**. Vegano marca también Vegetariano, Sin carne y Sin pescado, y Vegetariano marca Sin
carne y Sin pescado; una marca que se deriva de otra de tus opciones no se puede cambiar por sí sola.

Cada producto indica sus propios alérgenos y etiquetas dietéticas. Una variante usa los de su producto
hasta que eliges los suyos en la página de la variante. Elige **Heredar** para usar los alérgenos del
producto. Quitar la última etiqueta dietética de la variante vuelve a las
etiquetas del producto. Un extra que puedes añadir a un plato es en sí un producto, así que trae
consigo sus propias declaraciones. Una opción de una lista de opciones no: una opción como _poco hecho_
o _muy hecho_ no lleva alérgenos ni aptitud dietética propios, porque es una forma de pedir el mismo
plato, no algo más que comer. La caja y la estación muestran la lista propia de cada elemento.

Cuando guardas un cambio en los alérgenos o las etiquetas dietéticas de un producto, Waitron te
pregunta si quieres corregir las cartas publicadas o programadas que aún muestran los valores
anteriores. Pulsa **Actualizar ahora** para corregir las cartas publicadas y las versiones programadas
que marques. Para consultar los cambios pendientes de una carta publicada, abre **Revisar y publicar**.
Publica la carta o usa [Corregir la carta publicada](products.md#patch-live-menu) para que esos
cambios entren en vigor.

En la lista de Productos, **Sin revisar**, **Ninguno** y **Declarado** distinguen un plato que no has
comprobado de uno que sí. Una variante muestra el estado de los alérgenos que usa.
El color gris indica que sigue a su producto. El filtro de Alérgenos usa el mismo estado. Las columnas
**Alérgenos** e **Info dietética** empiezan ocultas. Para mostrarlas, pulsa el botón de columnas al
final de la búsqueda de la lista; en **Personalizar**, pulsa el ojo junto a cada columna y luego
**Listo**. Sus filtros funcionan aunque las columnas estén ocultas.

Antes de publicar ahora o de programar una carta, la confirmación muestra los platos ofrecidos y las
variantes activas cuyos alérgenos están sin revisar. Selecciona un nombre para abrir la página propia
de ese producto. Aun así puedes publicar o programar: el aviso te pide que compruebes las
declaraciones, no rechaza la publicación. Si cancelas la confirmación de programación, se conservan la
fecha y la hora que introdujiste.

Mientras alguien en la caja usa **Filtros** para ocultar un alérgeno, también se ocultan los platos
y tamaños sin revisar. Revisa los alérgenos de cada tamaño que vendes, o elige **No contiene
ninguno de los 14**, guarda y publica la carta.

Con una dieta elegida en **Filtros** de la caja, solo se muestran los platos con esa marca en
**Dietética**, así que marca **Sin carne** o **Sin pescado** en los platos que correspondan.

Los datos de compras existentes y los datos registrados de los pedidos siguen disponibles, pero los
alérgenos y la aptitud dietética de los productos los gestionas en **Productos**.

## Pon un producto nuevo en tus cartas {#menus}

Para eliminar una carta o un menú definitivamente, búscalo en **Cartas** o **Menús**. Elige
**Eliminar…** en el menú de su fila, revisa cuántos productos contiene y elige las sustituciones
que te pida la ventana.

En **Filtros**, **Estado** empieza en **Todas**. Elige **Publicadas** o **Requieren atención** para acotar la lista.

Usa **Buscar cartas** en la lista de Cartas para encontrar una carta por su nombre.

Consulta **Carta principal** para ver qué periodos empiezan con esa carta y **Cartas del personal** para ver en cuáles puede seleccionarla el personal. Pulsa el nombre de un periodo para abrir sus ajustes si tienes permiso para editarlo.

**Cambios sin publicar** bajo el estado de una carta significa que las cajas aún no tienen tus
últimos cambios: elígelo para revisarlos y publicar. Los **conflictos de precio** que aparecen ahí
deben resolverse antes de publicar la carta. Pulsa el enlace para verlos en **Estructura**.

Cuando guardas un producto nuevo, el editor se cierra y una ventana como **Añadir Flat white a las
cartas** pregunta dónde va. Muestra el **Nivel principal** de cada carta y sus secciones: marca los
sitios que quieras y elige **Añadir a las cartas**, o elige **Omitir** y colócalo más tarde. Para
entonces el producto ya está guardado, así que un sitio que lo rechaza no deshace el guardado. La
ventana nombra los sitios que fallaron y los deja marcados para que puedas volver a intentarlo. Las
secciones de una carta se crean en **Productos y cartas → Cartas**.

En **Estructura**, abre las acciones de un producto y elige **Editar producto**. Si ves su foto, púlsala para ir directamente al control de imagen. **Guardar** actualiza el producto y te devuelve a su fila en la carta.

En **Estructura**, abre las acciones de la carta o de una sección para añadir platos o secciones.
Arrastra una fila por su control para moverla. Para mover o quitar varias filas a la vez, elige
**Seleccionar** y márcalas. Selecciona una sección y copia la dirección para volver a abrirla.

Escribe un precio junto a un plato para fijarlo en esta carta. Despliega un plato con variantes
para fijar el precio de cada una. Borra el precio que has escrito para usar el habitual. Si cambias
un precio, se aplica en todos los sitios de esta carta donde aparezca el plato o la variante.
Pulsa el enlace de conflictos en la lista de Cartas o en el encabezado de la carta, o elige
**Elegir un precio** en Vista previa, para abrir Estructura con el filtro **Con conflictos**.

Elige **Guardar** al pie de Estructura para guardar la organización y los precios juntos. Elige
**Cancelar** y confirma para volver a la carta guardada.

## Menús {#set-menus}

Para ofrecer varios platos por un precio único, abre **Menús** en **Productos y cartas**
y elige **Añadir menú**. Ponle un nombre y un precio, añade los nombres para clientes en los
idiomas que uses y guarda.

En **Platos**, añade los platos que quieras ofrecer. Deja los platos que se venden al peso en la
carta completa, donde puedes venderlos por separado. En **Variantes**, elige qué versiones
incluyes. Indica el suplemento junto a cada plato que cueste más y pulsa **Guardar** en
**Platos**. Deja el importe en blanco si el plato está incluido en el precio del menú.
Ajusta los suplementos de las variantes en **Variantes**.

En **Qué incluye cada menú**, indica cuántos platos ofreces de cada orden de plato.
Por ejemplo, usa una línea para un entrante y otra para un principal. Pon dos órdenes de plato en
la misma línea para que el cliente elija entre ambos.

Si tu menú incluye bebidas, pan o café, [crea los órdenes de plato que necesites y asígnalos a los
productos](products.md#course). En cada departamento, elige **Marchar ya** para Bebidas y Pan,
así puedes enviarlos con el primer pedido.

Consulta **Se ofrece en** para ver qué cartas ofrecen un menú. Elige el nombre de una carta
para abrirla.

Abre la carta completa que ofrecerá el menú. En **Estructura**, abre las acciones
de la carta o sección donde quieras incluirlo, elige **Menú…** y selecciónalo.
En **Vista previa**, revisa dónde lo has puesto, los cambios y cualquier problema que debas
corregir. Publica la carta completa para enviar la versión actual a las cajas. Cada cambio
posterior llega a las cajas cuando vuelves a publicar la carta completa.

## Configura el inicio del dispositivo {#menu-home}

Abre **Inicio del dispositivo** en la carta que quieres cambiar. Elige **Añadir accesos directos**
y selecciona los productos y las secciones que el personal necesita tener a mano. Arrastra un acceso
por su tirador para moverlo o pulsa su papelera para quitarlo. En **Se muestra primero**, elige
**Accesos directos** o **Carta completa**.

Pulsa **Guardar** para conservar todos los cambios. Después publica la carta para enviarlos a todas
las cajas y dispositivos de mano que la usan.

## Copia una carta {#copy-menu}

Si tu próxima carta se parece a una que ya tienes, empieza con una copia. En **Productos y
cartas**, abre **Cartas** o **Menús**. Abre su ⋮ y elige **Copiar…**. Introduce un nombre nuevo y pulsa
**Copiar**. Usa un nombre que ninguna carta activa tenga. Las mayúsculas y las minúsculas cuentan
como el mismo nombre. **Cancelar** descarta el nombre sin preguntar y no crea nada. Si ya has
escrito un nombre, Escape te pregunta si quieres seguir editándolo o descartarlo.

La misma regla se aplica al crear una carta o cambiarle el nombre. Los espacios al principio y al
final no distinguen nombres. Si una carta activa ya tiene ese nombre, el mensaje aparece debajo de
Nombre.
Las cartas que ya comparten nombre lo conservan hasta que renombres una.

La copia empieza sin publicar, con las secciones de trabajo, los precios y los ajustes de la
inicio del dispositivo de la carta original. Las versiones publicadas y las publicaciones programadas
se quedan en la original. Editar las secciones propias de la copia deja la original como estaba;
las cartas incluidas siguen apuntando a las mismas cartas compartidas.

## Revisa los cambios de la carta antes de publicar {#preview-undo}

Elige **Revisar y publicar** en el encabezado de la carta. Si tienes cambios sin guardar en
Estructura, elige **Guardar y revisar**. En **Corrige antes de publicar**, elige un precio o abre
el menú que debas corregir. Después, abre los avisos que quieras revisar.
Pulsa el nombre de un elemento en la lista de cambios para encontrarlo en la carta propuesta.
En el móvil, cambia entre **Cambios** y **Carta**. Usa el selector de idioma sobre la carta para revisar las
traducciones o ver los **Nombres internos**.
Consulta **Detalles** para ver los cambios en los nombres de la carta para clientes y en los
nombres de los órdenes de plato de los menús.

Cuando tengas todo listo, elige **Publicar ahora** o **Publicar más tarde** en el encabezado. Para
consultar o cambiar una publicación pendiente, búscala en **Versiones programadas**, debajo de
la vista previa. Tras publicar, comprueba la versión y la hora en el encabezado de la carta.

## Corrige la carta publicada en una emergencia {#patch-live-menu}

Usa una corrección cuando encuentres un error en la carta publicada, como un precio equivocado,
mientras los productos ya tienen cambios para la próxima carta que todavía no quieres llevar a la
caja. Publicar llevaría también esos cambios. Una corrección cambia solo los valores que corriges,
en una sola carta: en su versión publicada y, para alérgenos y dietas, en las versiones programadas
que queden marcadas.

Busca la carta publicada en **Productos y cartas → Cartas**. Abre el menú de su fila y elige
**Corregir la carta publicada…**. La ventana muestra los elementos
de la carta publicada, con un buscador, y sus listas de extras y de opciones bajo **Extras y
opciones**. Elige un elemento para ver lo que puedes cambiar:

- Un plato: su nombre, nombre para el cliente, nombre de estación de preparación, descripción,
  imagen, precio, y alérgenos y dietas.
- Una variante o un extra: lo mismo, sin descripción.
- Una opción de una lista de opciones, y el nombre de una lista de extras o de opciones: sus tres
  nombres.
- Una sección: su nombre interno, su nombre para el cliente y su imagen.

Los nombres para el cliente y las descripciones muestran un campo por cada idioma del contenido.
Elige o quita una imagen igual que en el editor de productos. Un plato con variantes se cobra al
precio de cada variante, así que corrige el precio en sus variantes, que su formulario muestra con su precio; corregir el
plato nunca las cambia, salvo sus alérgenos y dietas. Un cambio en un extra, en una opción o en el nombre de una lista se hace en
todos los sitios de esta carta donde aparece esa lista. Un producto que se vende como plato y como
extra, o en dos listas de extras, se corrige en cada sitio por separado. Una sección que aparece
dentro de la carpeta de una carta incluida conserva el nombre o la imagen que le fija esa carpeta, y el nombre en un
idioma que las carpetas fijan en todos los sitios donde aparece la sección se muestra desactivado,
con **La carpeta incluida fija este nombre.** debajo, y no se puede cambiar aquí.

Para corregir alérgenos o etiquetas dietéticas, [cámbialos primero en el
producto](products.md#allergens) y luego marca **Usar los alérgenos y dietas actuales del producto**
en su elemento de la corrección. **Revisar** muestra lo que cambia y las versiones programadas que
difieren del producto. Las que aún tienen el valor anterior ya están marcadas: desmarca las que
quieras dejar como están y marca cualquier otra que quieras corregir. Un plato que solo se vende
dentro de un menú no aparece en la lista de elementos: publica la carta para corregirlo.

Una corrección no puede cambiar nada más: ni la unidad, la disponibilidad, el orden de plato ni
la categoría, el orden de los elementos, los colores ni qué elementos y secciones tiene la carta.

Cada elemento que cambias se marca con un punto. Un valor que la corrección no admite se señala al
elegir **Revisar**: su campo dice qué corregir, su elemento se marca con **!** y **Revisar** no
está disponible hasta que lo corrijas. Si se rechaza **Publicar la corrección** por un valor, la
ventana vuelve al campo de ese valor y explica allí el motivo; tu cambio se conserva en la ventana.
Una imagen que se ha borrado de la biblioteca de imágenes después de elegirla se rechaza así: elige
otra o quítala.
**Revisar 1 corrección**, o **Revisar** seguido del número de correcciones, muestra cada una
como el valor anterior → el nuevo. Elige **Seguir editando** para volver, o **Publicar la corrección**. Esto es lo que hace publicar una corrección:

- Se publica al momento como una versión nueva de esta carta, con el número siguiente. Las líneas
  que se añaden a los pedidos desde entonces usan los valores corregidos. Las líneas que ya están
  en pedidos abiertos mantienen su precio anterior, pero las pantallas de cocina muestran sus
  alérgenos y dietas corregidos.
- En un pedido aparcado de caja, cambiar el nombre de una lista de opciones o de una de sus opciones
  hace lo mismo que después de publicar, como explica
  [Qué hace la caja con una lista](modifiers.md#till): con un nombre del personal nuevo, el pedido
  conserva la respuesta que tiene, y un nombre para el cliente o de estación nuevo se guarda en
  las líneas aún no enviadas con el siguiente cambio del pedido. Esas líneas conservan sus precios.
- No cambia nada más: ni los productos, ni los elementos y secciones de la propia carta, ni tus
  otras cartas. Un producto que está en dos cartas se corrige en cada una.
- Una versión programada para más tarde conserva su fecha y su contenido, y entra en vigor entonces
  sin la corrección, salvo los alérgenos y dietas de las versiones que queden marcadas. Recibe un número nuevo,
  posterior al de la corrección, en **Versiones programadas**, en la pestaña **Vista previa**.
- La próxima publicación normal vuelve a crear la carta a partir de los productos, así que vuelve a
  poner los valores anteriores, menos los alérgenos y dietas, salvo que corrijas también los
  productos.

Un campo que vuelve a su valor publicado no cuenta como corrección. Si otra versión se publica
mientras tienes correcciones o un campo que corregir en la ventana, la ventana sigue mostrando la
versión que corregías y lo indica, y **Publicar la corrección** se rechaza: **Volver a cargar** abre
la versión publicada ahora y conserva las correcciones que todavía encajan en ella. Si se publica
sin ninguna de las dos cosas, la ventana pasa sola a la versión nueva.

## Reutiliza las elecciones {#reusable-choices}

Crea listas de extras y listas de opciones reutilizables en las dos pestañas de **Modificadores**, y
después asígnalas en el propio grupo **Modificadores** del producto, en el orden que quieras.
Consulta [Reutiliza las mismas elecciones en todos tus productos](modifiers.md) para saber qué
contiene cada tipo, sus valores predeterminados y límites, y los precios de los extras.

Cuando aparcas o completas un pedido, Waitron guarda los nombres del producto y la variante elegidos,
el nombre de estación de preparación, los precios y las respuestas de los modificadores. Los cambios posteriores en la
carta se aplican a las selecciones nuevas. El pedido aparcado, la comanda de estación, el ticket y la
reimpresión siguen mostrando los datos guardados con ese pedido. Una línea aún no enviada toma el
nombre nuevo para el cliente o de estación de una lista de opciones o de una opción con el siguiente
cambio del pedido.

Cuando preparas una demostración de Madrid en español, los nombres del personal y de estación
están en español. En una mesa a la hora de comer, abre **Menús de mediodía** para elegir el **Menú del día**
(14 €) o el **Menú especial** (20 €). Prueba el **Solomillo** con 5 € de suplemento en el Menú del día.
**Ensalada** usa el nombre de estación de preparación **ENSALADA · MENÚ** y una unidad propia,
**Ración**, abreviada **rac**. **Café de la casa** tiene dos variantes y el nombre de estación de preparación
**CAFÉ · BAR DE ABAJO**. Los nombres para el cliente conservan los idiomas de contenido del
local, por lo que cambiar los nombres internos no sustituye las palabras del ticket.

Una demostración en Cataluña o las Islas Baleares empieza como **Can Delgado**, con
platos regionales y cava. En la Comunitat Valenciana empieza como **Casa Delgado de
l'Horta**, con all i pebre, paella y vino de Requena. En Galicia empieza como
**A Casa Delgado**, con empanada, lacón con grelos, filloas y Albariño.

Los nombres internos y de estación, las cartas, los departamentos y las estaciones siguen
el inglés o español usado para preparar la demostración.
Cambiar después el idioma de las pantallas no cambia esos nombres. Los textos para
el cliente conservan el catalán, valenciano o gallego de la región, además del español
y el inglés. En Cataluña los tickets salen en catalán; en las demostraciones de Baleares,
Valencia y Galicia salen en español por defecto.

Durante la preparación, el nombre sugerido sigue el código postal o la provincia hasta que lo editas.
Después de escribir un nombre, Waitron lo conserva al cambiar de región, también al revisar y volver.

Casa Delgado y Menús de mediodía incluyen una carta **Bebidas** como carpeta. Bebidas pone la
**Caña** a 3,00 en lugar de su precio de producto de 2,80; las dos cartas que la incluyen
heredan ese precio. Menús de mediodía fija su propio precio del **Negroni de la casa** en 9,00.
Las variantes del café conservan sus propios precios. El **Solomillo** lleva la lista de
opciones **Punto**. En **Pollo asado** puedes elegir hasta tres **Guarniciones** opcionales:
pimientos (2,00), ensalada (1,50) y pan (0,50). Estos precios se aplican a una ración añadida al
pollo, así que puedes probar un extra con un precio distinto del mismo producto vendido por
separado.

## Consulta la información nutricional de un plato en la caja {#nutrition-at-the-till}

Pulsa el icono **Filtros** junto a **Buscar** para limitar los platos por dieta o alérgeno. El número
indica cuántos filtros están activos.

Mantén pulsado el botón de un producto para abrir su ventana de información. Ves los alérgenos del
plato, incluidos sus cereales o frutos de cáscara, y sus etiquetas dietéticas. Un plato sin revisar lo
indica en la ventana. Elige **Añadir al pedido** para seleccionar el plato, o **Cerrar** para volver
sin añadirlo.

Las líneas del pedido muestran iconos nutricionales tras el nombre del plato. Un plato sin revisar no
muestra iconos; consulta su ventana de información en lugar de tomar la falta de iconos como una
declaración. Los extras mantienen su propia información nutricional separada de la del plato. Al
elegir los extras de un plato, cada extra muestra sus propios alérgenos antes de
añadirlo. Un extra sin revisar no muestra ninguno, lo que no establece que sea apto. La caja no
tiene una pantalla de Alérgenos aparte ni una hoja de alérgenos impresa.

Abre los detalles de un plato enviado para consultar **Registrado al enviar**. Esas declaraciones
describen el plato cuando lo enviaste, aunque después se publique una corrección. Los platos en espera
muestran lo que está publicado ahora hasta que los liberas. Usa la información actual de
la estación para preparar la comida.
Para revisar una cuenta anterior, abre sus detalles en **Pedidos**. Las declaraciones guardadas
aparecen debajo de cada plato y extra.

Al añadir un plato con un filtro de alérgenos activo, solo puedes elegir tamaños y extras
compatibles cuya declaración esté revisada. Los extras opcionales no ocultan el plato. Si un
extra preseleccionado es incompatible o está sin revisar, comprueba los extras indicados y elige
**Quitar extras y continuar**, o **Cancelar**. Elige sustitutos cuando el grupo de extras los
requiera. El filtro también se aplica al añadir un plato al peso o desde su ventana de información;
no cambia los platos que ya tienes en el pedido. Las respuestas de opciones, como el punto de
cocción, no tienen declaraciones de alérgenos y no se filtran: compruébalas tú.

Mayús+F10 o la tecla de menú contextual abre la misma ventana de información para un producto
enfocado. Intro selecciona un plato disponible; toca o pulsa Intro sobre uno agotado para abrir su información.

## Guarda la respuesta sobre alergias con los platos de la mesa {#table-allergies}

Antes de enviar por primera vez los platos de una mesa, responde **¿Hay alergias en esta mesa?**
Elige **Sin alergias**, o elige **Alergias** e indica quién necesita atención especial, los alérgenos
que debe evitar y, si hace falta, una nota para la estación. Puedes añadir varias personas. La respuesta
pertenece a los comensales de la mesa y se comparte entre sus cuentas.

Marca los platos que comerá cada persona con alergias. La marca abarca toda la línea del pedido:
una línea con dos raciones se asigna entera, y un plato solo puede corresponder a una persona. Si
hay un conflicto, verás cada alérgeno que la persona evita y que declaran el plato o alguno de sus
extras, y podrás elegir **Enviar de todos modos**. Comprueba por tu cuenta un plato o un extra sin
revisar; la falta de información nutricional no establece que sea apto.

Los siguientes envíos ofrecen los platos nuevos para asignarlos. Un plato que ya has enviado en
espera no vuelve a ofrecerse solo porque lo envíes a preparar más tarde. **Cambiar** junto a la
respuesta de la mesa, o **Alergias** en **Toda la mesa** del menú **⋮**, abre el editor completo,
incluidos los platos ya enviados. Ahí puedes editar o eliminar una persona; al eliminar la última,
la respuesta sigue siendo Alergias hasta que la cambies.

Al pasar una cuenta del mostrador a una mesa, también se comprueba la respuesta de esa mesa y se
ofrecen los platos que llegan. Cancelar deja la cuenta donde está. Si la mesa cambia mientras
respondes, revisa la información actualizada y vuelve a confirmar antes de completar el traslado.

Si el traslado marca un dato de una persona, corrígelo y continúa con la asignación de platos. La
corrección se mantiene durante las actualizaciones en segundo plano; un nuevo rechazo puede
volver a marcarla.

Estaciones conserva su primera copia de alergias con cada plato. Un cambio posterior llega en un
aviso aparte que debe confirmarse. Consulta cómo las
[copias de alergias y sus correcciones](kitchen-service.md#allergy-copies) acompañan al trabajo.

## Marca un plato como agotado durante el servicio {#sold-out}

En el panel, abre **Productos** y desactiva **Disponible** en la fila del plato o del tamaño. La fila
muestra **No disponible**. El cambio afecta a todas las cartas que lo venden. Activa el interruptor
cuando vuelva a estar listo.

Cuando se agote un plato, mantén pulsado su botón en Mostrador o en el pedido de una mesa.
Puedes enviar o marchar las raciones que ya estén en una cuenta.
Elige **Marcar como agotado** para el plato, un tamaño, un extra o una opción. Debes haber iniciado sesión en un
dispositivo que tome pedidos. El cambio afecta a todas las cartas del local. El plato sigue visible en gris.

Elige **Volver a poner a la venta** cuando esté listo; el interruptor no se restablece al día siguiente.
Al recuperar el plato, los tamaños marcados individualmente como agotados siguen sin estar a la venta.
En una lista de opciones, vuelve a poner otra a la venta antes de marcar su última opción disponible como agotada.
Esto también se aplica a una lista deshabilitada en el panel que siga en tu carta.
