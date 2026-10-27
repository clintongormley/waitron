# Servicio de cocina

Cuando una persona necesita atención especial, tienes que saber qué plato es suyo y qué debe
evitar. Registra a la persona y asígnale sus platos en la
[ventana de alergias](products.md#table-allergies) de la mesa. Cocina recibe esas instrucciones
junto con su trabajo.

## Reintenta un envío de mostrador si se pierde la respuesta {#counter-send-retry}

Si el terminal no puede confirmar un envío de mostrador, reinténtalo sin cambiar la cesta. Si el
primer envío ya llegó al servidor, el reintento devuelve su resultado original y el terminal
continúa con el pedido enviado. No añade otra comanda de cocina ni otro resguardo con el número
de recogida. Si el equipo no tiene espacio en disco, el reintento se rechaza y el terminal dice
que no se ha guardado, aunque el primer envío ya llegara al servidor.

Si cambias la cesta después del primer envío, el terminal debe guardar esos cambios antes de
enviarla. Si el pedido ya está enviado, conserva tus cambios en pantalla y muestra un error en
vez de dar a entender que la cocina los recibió. Revisa el pedido enviado antes de continuar.

## Lee la copia de alergias junto al plato {#allergy-copies}

Un plato asignado lleva el nombre de la persona, los alérgenos que evita y su nota para cocina.
Por ejemplo, Alex evita Leche y pide una sartén aparte. Su plato muestra ese bloque debajo, y el
ticket o la tarjeta de la pantalla lleva una marca de alergia. Un extra enviado a otra estación
lleva las mismas instrucciones de la persona a su propia estación.

Si el plato o un extra activo declara un alérgeno que la persona evita, el bloque también indica
ese conflicto y que se ha enviado igualmente. La falta de información nutricional no establece
que un plato sea apto. Consúltalo con quien atiende la mesa antes de prepararlo.

Cocina conserva las instrucciones que recibió primero. Los cambios posteriores de la persona o
del catálogo no sustituyen silenciosamente el bloque original en la tarjeta del plato, el pase o
una reimpresión.

## Lee y confirma una corrección {#corrections}

Si se cambian las instrucciones de un plato que tu estación aún tiene que preparar o entregar,
recibes un aviso de **Alergia cambiada** con el bloque nuevo. Quitar la asignación, eliminar a la
persona o elegir Sin alergias genera **Alergia eliminada**. Las impresoras de cocina configuradas
también reciben un ticket de corrección.

Añadir o quitar un extra también puede cambiar el aviso de conflicto de un plato. Si cambia para
un trabajo que tu estación aún tiene pendiente, recibes una corrección y la copia original sigue
acompañando al plato.

Lee la corrección junto al plato original antes de confirmar el aviso. Por ejemplo, cambiar la
nota de Alex a Utensilios limpios deja Sartén aparte en la tarjeta original y pone Utensilios
limpios en el aviso. Confirmar retira el aviso; no reescribe la tarjeta original. Un aviso de
alergia sin confirmar sigue disponible después de reiniciar el servidor o cambiar de día de
servicio.

Una corrección abarca solo la cantidad que queda por servir. El trabajo ya servido o anulado por
completo no recibe un aviso de alergia nuevo. Si un plato pasa a otra estación, conserva su copia
original y lleva una corrección cuando las instrucciones actuales son distintas.

## Conserva las instrucciones anticipadas del trabajo en espera {#held-work}

Un plato en espera puede llegar a una estación en un ticket anticipado de espera. Esa estación
conserva la copia de alergias enviada con ese ticket y recibe correcciones mientras quede trabajo
sin servir. Una estación que no ha recibido un ticket anticipado toma su primera copia cuando se
envía el plato a preparar.

Una estación con **Imprimir por adelantado los grupos en espera** activado al poner un grupo en
espera recibe su ticket anticipado de espera; otra estación con el ajuste activado puede empezar a
recibir más tarde lo que se imprime en espera del grupo: un ticket anticipado de espera cuando se le
mueve un plato en espera, o una comanda HOLD CHANGED cuando se añade al grupo un plato en espera en
ella. Una estación que tiene lo impreso en espera del grupo sigue recibiéndolo, junto con sus
correcciones y la comanda marcada FIRE, aunque se desactive su ajuste. Cualquier otra estación
imprime su parte sin marca cuando se envía el grupo a preparar, salvo si comparte impresora con una
estación que tiene lo impreso en espera del grupo: la comanda marcada FIRE de esa impresora lleva
las dos.

Enviar a preparar el trabajo en espera en la misma estación no duplica una corrección de alergia
existente. Recuperar un plato a un borrador termina su trabajo anterior en cocina. Volver a enviar
ese borrador crea una copia nueva con las instrucciones que confirmas para ese envío.

## Reimprime el original y comprueba sus avisos {#reprints}

Una reimpresión repite el bloque de alergias original. No genera otro aviso de corrección, así que
comprueba por separado los avisos pendientes de la estación. Dividir los platos entre cuentas
conserva las copias con el trabajo de cocina resultante; no sustituye las instrucciones de la
persona.

## Mantén la comida visible hasta terminar el servicio {#service-lifetime}

Una cuenta cobrada puede tener comida pendiente de servir. El pase y su monitor conservan esa
comida hasta que la marques como servida o termines el servicio de la mesa; la comida que una mesa
cerrada pasa al mostrador sigue hasta que se entrega el pedido (más abajo). El pase no tiene una
acción Hecho ni En camino aparte. Los platos listos conservan su estado Listo y los avisos de
demora mientras esperan a que los sirvas. Si las mesas se han
unido a otro grupo de comensales, sus cuentas cobradas siguen visibles hasta que termine el grupo
que las reúne.

En la mesa, un plato listo sigue como **Listo** en su ventana de detalle hasta que lo marques
como servido. La lista Enviado conserva el tiempo que lleva listo para que veas qué falta servir.

La tarjeta de la mesa en la sala también cuenta como listo cada plato listo que aún no has servido.
Si una etiqueta de estación muestra ese recuento, sustituye al de la tarjeta para que lo veas una
sola vez al decidir qué servir.

En los detalles de una mesa en el plano, cada plato listo pendiente de servir cuenta como listo.
Cuando las etiquetas de las estaciones muestran esas cantidades, la línea de progreso las omite
para que cada plato se cuente una sola vez.

Cuando sirves uno de los dos platos de una línea, el pase muestra el que queda por servir.
Deshacer restaura la cantidad servida sin reiniciar el tiempo de preparación ni el que lleva listo.
Una cantidad anulada deja de contar como comida pendiente, aunque se conserve su importe en la
cuenta.

Un pedido de mostrador sigue visible después del cobro hasta que lo entregues o cierres. Cuando
una mesa pagada se cierra con **Lo recogerán en el mostrador**, sus platos por llegar pasan a ser
un pedido así: cada estación con un plato por llegar en él recibe el aviso de que el pedido pasó al
mostrador, e imprime un ticket **MOVIDO** si su ajuste **Imprimir un aviso al cambiar de mesa los
platos enviados** es **Imprimir**; los platos siguen en el pase hasta que se entrega el pedido. Cada pase sigue mostrando solo las
estaciones y zonas de servicio que tiene asignadas.

Tú decides cuándo pedir la preparación desde el terminal; no hay un modo de marcha para todo el
local. Cada estación de preparación fija si su pantalla de cocina avanza la preparación un plato cada vez
o toda la comanda a la vez, en **Marcado en la pantalla** al editarla en **Estaciones de preparación**. En la
pantalla de cocina, una tarjeta de una estación que avanza toda la comanda muestra **Toda la
comanda** mientras un toque aún pueda avanzarla, y un toque en uno de sus platos avanza los platos de
la tarjeta que están en la misma fase.
Cada
estación de preparación fija sus propios avisos de demora, y un tiempo de **Listo sin recoger** de 3
minutos si no lo cambias, al crearla con **Añadir estación**, y en **Avisos de demora (minutos)** al
editarla en **Estaciones de preparación**. En un móvil o una tableta, la barra Listo se vuelve
ámbar cuando un plato listo ha esperado ese tiempo: consulta
[Ver qué mesas tienen comida lista](table-service.md#ready-bar). Cada estación de
preparación fija también cómo se imprimen los platos iguales en sus comandas, si imprime por
adelantado los grupos en espera y si un plato ya enviado a ella se puede retirar o cambiar, en
**Platos iguales en una comanda de cocina**, **Imprimir por adelantado los grupos en espera** y
**Cambios tras el envío**: **No permitidos**, **Solo en
espera** o **En espera o sin empezar**. Un plato que la cocina ha empezado nunca se retira. Un plato
que no fue a ninguna estación, sin ningún extra que fuera a una estación propia, se puede retirar
sea cual sea el ajuste de las estaciones.

## Trabaja con la pantalla de cocina {#kitchen-screen}

La pantalla de cocina muestra una tarjeta por cada grupo de platos que envió una mesa, y una por
cada pedido de mostrador. Una tarjeta nombra su mesa por su nombre corto; un pedido de mostrador sin
mesa dice **Mostrador #12**. Una tarjeta está en la columna de su plato menos avanzado,
**Esperando**, **Preparando** o **Listo**, y primero va la que lleva más tiempo esperando. Toca la
cabecera de una columna, que muestra cuántas tarjetas tiene, para plegarla en una franja estrecha
que conserva su nombre y su número (**Listo · 3**); tócala otra vez para abrirla. La pantalla
recuerda qué columnas están plegadas, en cada estación, incluso después de reiniciarse. Toca un
plato para avanzarlo un paso, o toca la cabecera de la tarjeta para avanzar la tarjeta: solo avanzan
los platos que la retienen, así que un plato que ya va más adelante se queda donde está. La franja
de la parte superior de una tarjeta pasa de verde a ámbar y a rojo mientras espera, según los avisos
de demora de la estación, y la franja de una tarjeta olvidada late; en un dispositivo configurado
para reducir el movimiento se queda quieta. Una tarjeta cuyos platos están todos en espera tiene el
borde discontinuo, no muestra minutos y espera en **Esperando** hasta que el camarero [pida la
preparación](kitchen-service.md#request-cooking).

Una fila encima de las columnas muestra cuántos platos quedan por hacer y cuántas tarjetas van con
retraso, y **Columnas** al final; encima de las columnas de una sola estación muestra también si la
estación está abierta hoy y, en una pantalla de cocina, el nombre de la estación. Toca **Columnas** para
ordenar las columnas: las flechas suben o bajan una columna en la lista, que es el orden en
que la pantalla las muestra, y **Mostrar** la oculta o la muestra. Cada cambio se ve al
momento y se guarda en este dispositivo; **Hecho** cierra la ventana. Las tarjetas de una columna
oculta siguen contando en la fila. Con todas las columnas ocultas, la fila y **Columnas** siguen
ahí, para que puedas mostrar una de nuevo.

Cada tarjeta lleva la nota para cocina de su pedido y cualquier problema de impresión. En un
terminal, una tarjeta ofrece además **Reimprimir**, y **Entregar** cuando su pedido está pagado y
pendiente de recoger; una pantalla de cocina en la que nadie inicia sesión no muestra ninguno de los
dos.

## Un plato enviado tras acabar su periodo {#after-period}

En el terminal, un plato sin enviar cuyo periodo acabó antes en el mismo día de servicio muestra un
signo de aviso y **Ha terminado Almuerzo**. Cuando lo envías desde una mesa, o cobras, envías o
aparcas el pedido en el mostrador, el terminal primero lista esos platos y te pide que lo consultes con
la cocina. **La cocina acepta — enviar** los envía y **Quitarlos** los quita del pedido. Al aparcar,
el botón dice **La cocina acepta — guardar**. La misma ventana se abre cuando el equipo encuentra un
plato así antes de que el terminal lo haya marcado.

Un plato que también vende el periodo en curso no se marca y se envía como siempre. Un plato que
quedó de un día de servicio anterior muestra **Ya no se admiten pedidos** y no se puede enviar: en
una mesa, **Quitar** lo quita y **Dejar** lo deja en el pedido sin enviar, y en el mostrador solo
puedes cobrar cuando lo has quitado.

Un plato enviado después de que su periodo acabara antes en el mismo día de servicio, una vez que la
cocina lo ha aceptado, lleva una marca con el nombre de su periodo. En su comanda de cocina, una
línea encima dice `** TRAS ALMUERZO — ACEPTADO **`. En la pantalla de cocina, la tarjeta muestra
**Tras Almuerzo — aceptado** encima del plato.

Cada departamento fija si enviar un plato así necesita un encargado, o el PIN de un encargado,
con **PIN de encargado para enviar tras acabar el periodo** en **Cursos y cocina**, en su pestaña
**Servicio** del panel. Desactivado, quien puede enviar lo confirma con la cocina. Si está activado y
quien envía no es encargado, el terminal pide el PIN de un encargado tras **La cocina acepta**.

## Pide la preparación desde el terminal {#request-cooking}

Pide los platos en espera desde el pedido de la mesa. Las colas de las estaciones y el pase muestran los pases
y grupos en espera sin botón Marchar. Esos platos se muestran atenuados y no avanzan al tocarlos.
Una vez enviados a preparar, puedes avanzar los platos hasta Listo en su estación.
Si el equipo no tiene espacio en disco, no se puede avanzar un plato. La estación dice
**No se ha guardado: el equipo no tiene espacio en disco. Avisa al encargado.** y el plato se
queda donde estaba.

Confirma las instrucciones de alergia en la ventana de alergias de la mesa antes de pedir la
preparación. En una estación o en el pase, lee la copia que acompaña a cada plato. Las pantallas de cocina
no abren el editor de alergias de la mesa. En la estación, confirma las correcciones.

Un grupo en espera vence unos minutos después de que se hayan servido los platos marchados antes
que él. Cada departamento fija esos minutos, o desactiva el aviso, en **Cursos y cocina**, en su
pestaña **Servicio** del panel.

## Eliminar una estación de preparación {#delete-prep-station}

Elige **Eliminar** en el menú de la estación. La ventana muestra **Comprobando qué cambia…**
mientras consulta las consecuencias. Revisa **Trabajo que finaliza** y **Configuración que se
elimina** cuando aparezcan esas secciones, y decide si quieres eliminar la estación.
