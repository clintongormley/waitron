# Estado del equipo

**Estado del equipo** muestra en una sola página si cada parte del equipo funciona: las ventas,
Hacienda, la copia en el bucket, las impresoras, los lectores de tarjeta, el reloj y el espacio en
disco. También es donde se libera espacio cuando el disco del equipo se llena. Para leer el
registro del equipo, usa **Diagnóstico**.

## Abre la página {#open}

Abre **Ajustes → Estado del equipo**, justo encima de **Diagnóstico**. Solo la ven las personas
que pueden gestionar el sistema.

La página vuelve a leer el equipo más o menos cada 15 segundos, así que puedes dejarla abierta.
Estas lecturas automáticas no cuentan como actividad, así que tener la página abierta no mantiene
tu sesión iniciada.

En un equipo que solo guarda una copia de lectura de otro equipo, el botón **Liberar** no se puede
pulsar, y la página explica por qué bajo **Espacio en disco**.

## Lee las filas {#rows}

Cada parte tiene una fila con un punto de color:

- **Verde** significa que la parte está bien.
- **Ámbar** significa que necesita atención, pero todo sigue funcionando.
- **Rojo** significa que algo no se puede guardar: el disco está lleno, o la hora del equipo es
  tan incorrecta que no se puede registrar una venta. Cualquiera de los dos pone también en rojo
  **Ventas**.

Cada fila muestra los mismos avisos que la campana para esa parte, con las mismas palabras, salvo
los avisos del disco: la fila **Espacio en disco** ya dice lo mismo. Las
filas **Copia en el bucket**, **Impresoras** y **Lectores de tarjeta** tienen un botón **Ir a …**,
como **Ir a Copias de seguridad**, que abre su propia página cuando puedes abrirla, y un aviso que
tiene su propia página añade un botón para esa página. Los avisos que no corresponden a ninguna fila
se cuentan bajo las filas, junto a **Ver todos los avisos**.

Cuando no pasa nada, cada fila dice:

- **Ventas**: **Se registran con normalidad**, y cuándo fue la última venta.
- **Hacienda**: **Se envían con normalidad**. Un equipo que no envía registros a Hacienda lo dice.
- **Copia en el bucket**: **Al día**, y cuándo se confirmó el último envío. Dice **No
  configurada** cuando no hay ninguna copia configurada, y cuántos minutos de retraso lleva
  cuando se retrasa.
- **Impresoras**: **Sin problemas**, y los nombres de las impresoras configuradas.
- **Lectores de tarjeta**: **Sin problemas**, y los nombres de los lectores configurados. La
  página no comprueba si cada lector está encendido: solo muestra los problemas que el equipo ya
  conoce. Esta fila no aparece cuando los pagos con tarjeta están desactivados.
- **Reloj**: **Correcto**, y cuándo comparó el equipo su hora con la de Hacienda por última vez.
  Cuando no tiene una comparación reciente, por ejemplo justo después de arrancar el equipo, dice
  **Aún no se ha comparado con Hacienda**.
- **Espacio en disco**: cuánto espacio queda libre del total, y cuánto ocupan la base de datos,
  las copias guardadas en el equipo, los registros de actividad y el resto del disco.

Después de que falle un envío a Hacienda, la fila **Hacienda** dice cuántos registros esperan, y si
el equipo los reintenta solo o el encargado tiene que resolver alguno.

Si no se han podido leer los avisos, la página sigue mostrando todas las filas y avisa de que una
parte puede parecer bien aunque no lo esté. Si algunas comprobaciones no se han podido hacer, la
página avisa de que puede no mostrar todos los problemas.

## Libera espacio en el equipo {#free-space}

El botón **Liberar** de la fila **Espacio en disco** muestra cuánto puede liberar antes de que lo
pulses, por ejemplo **Liberar 120 MB**. Cuando no hay casi nada que liberar, dice **Nada que
liberar** y no se puede pulsar.

**Liberar** solo borra archivos que el equipo ya no necesita:

- informes de fallos de hace más de una semana
- registros de actividad anteriores a los dos más recientes
- lo que dejó una copia de seguridad que se interrumpió a medias

Nunca toca las ventas, los ajustes ni tus copias de seguridad. Cuando termina, la página dice
cuánto ha liberado.

Mientras se está haciendo una copia de seguridad, **Liberar** no toca la carpeta de trabajo de las
copias, ni siquiera lo que dejó en ella una copia interrumpida, y la página dice que esos archivos
no se cuentan.

Al final, la página siempre explica cómo ganar más espacio: guardar menos copias en el equipo, en la
página **Copias de seguridad**, o pedir a quien instaló el equipo que borre versiones anteriores
de Waitron o ponga un disco mayor. Los tamaños bajo **Espacio en disco** muestran qué está
llenando el disco.

## Cuando el equipo no tiene espacio {#out-of-space}

Cuando el disco está lleno, no se puede guardar nada: los terminales no pueden guardar pedidos,
pagos ni otros cambios, y muestran **No se puede guardar nada: el equipo no tiene espacio**. En
esta página, **Ventas** y **Espacio en disco** se ponen en rojo.

Pulsa **Liberar** para liberar espacio. En cuanto hay espacio suficiente, los terminales vuelven a
poder guardar por sí solos; no hace falta reiniciar nada.

Después de pulsar **Liberar**, esta página y la campana de avisos del mismo panel vuelven a leer
el equipo en ese momento. Una campana abierta en otro ordenador se pone al día en un minuto, más o
menos.

Si **Liberar** no libera bastante, sigue la línea del final de la página sobre cómo ganar más
espacio.
