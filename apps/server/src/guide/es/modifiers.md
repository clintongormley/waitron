# Reutiliza las mismas elecciones en todos tus productos

Cuando varios platos ofrecen los mismos añadidos, o la misma forma de prepararlos, crea la lista una
vez en **Modificadores** y asígnala a cada producto. Editas sus nombres, sus elementos y sus límites en
un solo sitio, y cada pedido conserva sus propias respuestas.

## Dos tipos de lista, uno por pestaña {#kinds}

**Modificadores** tiene dos pestañas, **Extras** y **Opciones**, cada una con su propia tabla y su
propio botón para añadir una lista. No hay un tercer tipo ni nada que elegir: la pestaña en la que
estás decide el tipo.

Usa **Extras** para lo que un comensal añade a un plato. Cada elemento de una lista de extras nombra
un producto que ya has creado y toma de él sus nombres, su IVA, sus alérgenos, sus etiquetas
dietéticas y su foto, así que nunca los vuelves a escribir aquí. Un producto con variantes activas
no puede ser un elemento, porque solo se vende como una de sus variantes. En el elemento fijas las
condiciones de la oferta: **Cantidad máxima**, cuántas veces puede elegirse para un plato (1
significa "una o ninguna"); **Preseleccionado**, si empieza elegido; y **Precio por porción**, lo
que cuesta cada selección. Pulsa − de 2 a 1 y después hasta dejar la casilla vacía para quitar el
límite del elemento. El marcador ∞ indica ese valor vacío. Las **Selecciones máximas** de la lista
siguen limitando el total de selecciones cuando fijas un valor. Para un producto que se vende en
cualquier unidad que no sea Unidad, introduce también la **Porción** que añade cada selección, en la
unidad del propio producto, en su propia columna entre **Preseleccionado** y el precio. Un producto
que se cuenta por unidades añade siempre una, así que su fila muestra ahí un 1 fijo. Un precio
introducido sustituye al precio del producto para esa porción: 1,50 significa 1,50 por selección. Si
dejas el precio en blanco, Waitron multiplica la porción por el precio unitario del producto y
redondea una vez al céntimo en cada selección; mientras está en blanco, el campo muestra ese precio
calculado. La unidad del producto aparece junto al precio (debajo, en un teléfono), o pone Unidad
cuando el producto no tiene ninguna. La propia lista fija, bajo el encabezado **Número de
selecciones**, las **Selecciones mínimas** (vacío, la lista es opcional; 1 o más, es obligatoria) y
las **Selecciones máximas**, como mínimo 1, o vacío para no tener límite. Cada uno de estos números
tiene botones − y +, y también puedes escribirlo. Pulsar − en 1 vacía la casilla, que entonces
muestra "Ninguna".

Usa **Opciones** cuando el comensal elige exactamente una opción, como una taza o un vaso. Una opción
solo lleva nombres: no tiene precio, ni IVA, ni alérgenos. Cada opción tiene su propio interruptor
**Disponible** y, mientras haya alguna opción disponible, una de ellas es siempre la
**Predeterminada** una vez guardada la lista (el editor elige la primera opción disponible cuando abres
una lista que no tiene ninguna).

Cada opción es una fila de texto en la lista: su nombre, una marca **No disponible** cuando está
desactivada, un botón de opción **Predeterminada** (una opción no disponible no puede tenerlo) y un menú
con **Editar** y **Eliminar**. Arrastra una fila por el asa de su inicio para moverla. **Editar** abre la
opción en su propia ventana sobre la lista, igual que un clic en el nombre de la opción (o pulsar Intro
o Espacio sobre él); **Añadir opción**, bajo las filas, abre una vacía. Al guardar esa ventana cambia la
lista que estás editando, no lo guardado: no se envía nada hasta que guardas la propia lista.

## Ponle nombre a una lista y decide si está activa {#names}

Da a la lista un nombre del personal en texto sin formato, el nombre con el que tú y tu personal la
llamáis. Un **Nombre de cocina**, justo debajo, y un **Nombre para el cliente**, con un campo por
cada idioma de contenido, son opcionales y recurren al nombre del personal cuando los dejas en
blanco. En un ticket, los nombres para el cliente de una lista de opciones y de una opción se
imprimen en el idioma predeterminado, o en otro idioma si el predeterminado está en blanco, y como
el nombre del personal solo cuando ningún idioma tiene uno. El nombre para el cliente de una lista
de extras no se imprime hoy en ningún sitio. Mientras un nombre está en blanco, su campo muestra en
su lugar el nombre al que recurre.

En una lista de opciones y en la ventana de cada opción ves **Nombre**, después **Nombre de cocina**
y después el encabezado **Nombres para el cliente**, con todos los campos de idioma ya visibles.
Puedes comparar y editar los nombres sin abrir una sección. Una lista de extras conserva sus
nombres para el cliente en una sección plegada: abre **Nombres para el cliente** para editarlos.
Su línea cerrada muestra el nombre de cada idioma, o el nombre al que recurre en cursiva; la sección
se abre cuando hay que corregir un nombre. Consulta [idiomas de
contenido](content-and-images.md).

Cada lista tiene un interruptor **Activa**, y la columna **Estado** de la lista pone **Activa** o
**Deshabilitada**. Una lista activa necesita algo con lo que responderla, así que el formulario no
guarda una lista de extras activa sin productos ni una lista de opciones activa sin ninguna opción
disponible. Te pide que añadas uno (o, para las opciones, que añadas o habilites una), o que
deshabilites la lista.

Una opción **Predeterminada** rellena una selección nueva una sola vez. Cambiarla no cambia un pedido
que ya has empezado. Desactivar la opción predeterminada, o eliminarla, convierte en predeterminada a
la primera opción disponible. Un elemento de extras está preseleccionado o no: no hay una cantidad
inicial que fijar.

## Asigna una lista a un producto {#attach}

Abre el producto en **Productos** y usa su sección **Modificadores**. Empieza abierta cuando el
producto ya tiene listas asignadas; mientras está plegada, muestra los nombres de las listas
asignadas, o "Ninguno". Un solo control añade los dos tipos, y la sección reúne los dos tipos en una
única lista ordenada; cada fila muestra el nombre del personal de la lista y su tipo. Arrastra una
fila por el asa de su inicio para moverla, o enfoca el asa y usa las flechas arriba y abajo. Ese
mismo control muestra las listas de extras bajo un encabezado **Extras** y las listas de opciones
bajo **Opciones**, y cada grupo termina con su propia entrada para crear una nueva, **Añadir lista
de extras…** o **Añadir lista de opciones…**, así puedes crear una lista sin abandonar el producto
que estás editando.

Cada oferta de una carta lleva las listas de extras y de opciones del producto en el orden que fijas
aquí. Un extra usa el precio por porción de su elemento de la lista cuando lo fijas. Con el precio en
blanco, su porción multiplicada por el precio unitario del producto fija el precio de cada selección,
redondeado una vez al céntimo. Para cualquier unidad que no sea Unidad, introduce la cantidad que añade
cada selección a un plato. Un extra que se cuenta por unidades añade una. Publica cada carta para que
estos cambios lleguen a la caja.

## Consulta qué usa una lista {#used-by}

La tabla de cada pestaña tiene una columna **Usado en** que cuenta los productos que llevan la lista,
por ejemplo "2 productos". Una lista que nada usa pone "Sin usar". Haz clic en el número para ver esos
productos.

## Eliminar una lista la quita de los productos, y nada impide eliminarla {#deleting}

Eliminar una lista la quita de todos los productos que la llevan. La ventana de confirmación muestra
esos productos antes de que confirmes. No se puede deshacer.

**Un pedido abierto no impide eliminarla, y nadie te pide que lo termines o lo anules.** Eliminarla
no cambia por sí sola nada de un pedido abierto: una selección de extras es su propia línea del
pedido, y una respuesta de opciones se guarda como el texto que se eligió. Cada carta publicada
conserva la lista hasta que vuelves a publicar esa carta. Para una lista de opciones esto importa,
porque sus opciones ya no existen: hasta que publiques, la caja no puede añadir un plato que llevaba
la lista, y se rechaza guardar cambios en un pedido aparcado que contiene ese plato. Vuelve a
publicar tus cartas justo después de eliminar una lista de opciones. A partir de entonces, el
siguiente cambio que se guarde en un pedido aparcado de caja quita cualquier extra elegido de una
lista eliminada, junto con su cargo, y descarta cualquier respuesta a una lista de opciones eliminada.

Un plato ya enviado en una mesa conserva sus extras y respuestas de opciones registrados. Para
cambiarlos, usa **Retirar** en la ventana del plato y edítalo en **Nuevo pedido**. Puedes retirarlo
solo en una cuenta sin pagar, mientras se permiten cambios en platos enviados y la cocina no ha
empezado el plato. El plato retirado conserva sus precios y descuentos registrados. Puedes mantener
una respuesta o un extra sin cambios aunque ya no se ofrezca; un extra nuevo usa su precio actual
en la carta. Vuelve a enviar el plato cuando sus cambios estén listos.

Para que la caja deje de pedir una lista sin eliminarla, desactiva su interruptor **Activa**, o
quítala de la sección Modificadores de ese producto concreto.

## Alérgenos e información dietética {#allergens}

Un elemento de extras declara sus alérgenos y su aptitud dietética a través del producto que nombra, así
que los mantienes en ese producto, en **Productos**, no aquí. Una opción no declara ninguno de los dos,
porque es texto, no algo que se come.

## Qué hace la caja con una lista {#till}

Al tocar un plato que lleva una lista se abre una sola ventana que pregunta todas sus listas, en el
orden en que las colocaste. Un plato que se vende por peso, o en una unidad que admite decimales,
pregunta primero la cantidad y después muestra solo sus listas de opciones: no se le pueden añadir
extras. Un plato en una unidad con **Mide una cantidad (ml, g…) — sin extras** activado también muestra
solo sus listas de opciones. Una lista de extras muestra el precio por porción de cada elemento, con una casilla para cada
uno, o un selector de cantidad donde permitiste más de uno; una lista que hiciste obligatoria mantiene
**Añadir** desactivado hasta que se elige algo. Una lista de opciones muestra sus opciones disponibles
como botones de opción, para elegir exactamente una, con tu opción predeterminada ya elegida. Mientras la
opción predeterminada está desactivada, se elige en su lugar la primera opción disponible. Si no hay
ninguna opción disponible, la ventana dice que no se puede añadir el plato.

El operador lee siempre el nombre del personal. La caja es una pantalla para el personal: el texto del
comensal es lo que imprime el ticket, y el de la cocina es lo que imprime la comanda de cocina.

Cada extra elegido se convierte en su propia línea sangrada bajo el plato en la cesta, con su propio
precio y sus propios alérgenos y etiquetas dietéticas, nunca sumados a los del plato. Una respuesta de
opciones no cuesta nada y acompaña como texto a la línea del plato.

Un pedido guarda las respuestas que recibió. Un pedido aparcado tiene que volver a emparejarse con las
listas actuales del plato antes de poder cambiarlo. Una respuesta de opciones se guarda como texto, los
tres nombres de la lista y los tres de la opción elegida, y la caja empareja por el nombre del personal
de cada una. Un extra conserva el producto y la lista de la que se eligió, así que otra lista que ofrece
el mismo producto no puede ocupar su lugar sin avisar.

En un pedido aparcado de caja, si cambias el nombre del personal de una lista o de una opción, o
desactivas una opción, una respuesta de opciones deja de emparejarse. La caja no adivina: pide al operador que abra esa línea y vuelva a
elegir antes de poder enviar el pedido.

Cambiar solo un nombre para el cliente o un nombre de cocina sigue emparejando, así que nadie se
queda parado en la caja, pero tiene un coste. El pedido recuerda los tres nombres, y Waitron no
puede distinguir una respuesta renombrada de una distinta. Así que, una vez vuelta a publicar la
carta, el siguiente cambio que se haga en ese pedido aparcado, aunque sea en otra línea, guarda el
texto nuevo en todas las líneas que llevan la respuesta renombrada. Esas líneas conservan los
precios a los que se vendieron. Una línea que la cocina ya tiene se retira y se le vuelve a enviar
como una comanda nueva. La caja rechaza el cambio si la cocina ya ha empezado esa línea, o si
**Permitir cambios en los artículos ya enviados a cocina** está desactivado. Cambia los nombres
entre servicios y no mientras haya pedidos aparcados. Una lista de extras es la excepción, porque un
extra se empareja por su producto: renombrar una lista de extras, o el producto que contiene, no
afecta a un pedido aparcado.
