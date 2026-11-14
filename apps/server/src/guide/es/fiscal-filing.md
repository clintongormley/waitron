# Remisión a la AEAT

**Remisión a la AEAT** muestra cómo se envían a la AEAT, la agencia tributaria, los registros de
facturación de este servidor, cuáles necesitan una decisión y cuáles tienen una advertencia. No
envía nada por sí sola; un administrador puede enviar una subsanación desde un caso que la ofrezca.

## Abre la página {#open}

Abre **Informes → Remisión a la AEAT**. La ven los encargados y los administradores.

La página lee el servidor al abrirla. No se actualiza sola: elige **Actualizar** para leer de nuevo.
**Leído** indica cuándo se leyeron las cifras.

## Un conflicto de identidad {#conflict}

Cuando este servidor ha dejado de emitir facturas por un conflicto de identidad, un recuadro rojo
arriba lo indica y muestra cada factura afectada con lo que la AEAT tiene de ella. Las palabras
de la AEAT, su huella y el nombre de la instalación están en **Detalles técnicos**. Elige **Abrir la
recuperación del conflicto** y sigue
[Recupera una identidad de facturación en conflicto](box-status.md#invoice-conflict). Necesitas la
clave del servidor.

## Estado de los envíos {#progress}

**Estado de los envíos** cuenta los registros del servidor según dónde están: pendientes,
enviándose, aceptados, aceptados con errores, rechazados, detenidos o apartados. **Pendiente más
antiguo** y **Última aceptación** muestran si los registros siguen saliendo. Para volver a intentar
los registros que esperan sin aguardar la pausa del servidor, usa **Reintentar ahora** en
[Estado del servidor](box-status.md#retry-now).

Si la página dice que no se puede enviar nada hasta que se instale el certificado de la AEAT,
instálalo en **Ajustes del local**.

## Casos de remisión {#cases}

Cada fila es un registro que aún necesita una decisión; **Motivo** dice por qué. **Detenidos
detrás** cuenta los registros que esperan detrás de él. Abre el menú de la fila y elige **Ver**
para ver qué es el registro, en qué punto está, la respuesta de la AEAT con sus propias palabras y
**Qué pasa ahora**. Los códigos y las huellas que puede pedirte tu asesor fiscal están en
**Detalles técnicos**.

Cuando la AEAT rechazó un registro por su descripción de la operación, el caso muestra el mensaje de
la AEAT junto a la descripción: corrígela ahí y elige **Enviar la subsanación**. Solo un
administrador puede enviarla; cualquier otra persona puede iniciar sesión como administrador desde
el caso.

La tabla muestra los 200 casos más recientes. Si hay más, indica cuántos; expórtalos para verlos
todos.

## Advertencias {#warnings}

**Advertencias** muestra los avisos abiertos sobre registros que conviene revisar. Nada aquí cambia
un registro.

- **Respuestas de la AEAT que no cuadran con lo enviado**: la AEAT respondió a un grupo de registros
  con otro número de líneas, así que Waitron no usó su respuesta: volvió a dejar cada registro
  pendiente de enviar, o lo dejó detenido. **Detalles técnicos** muestra cada registro enviado, en
  qué punto está ahora y las líneas de la AEAT.
- **Facturas con un aviso de la comprobación de Waitron**: la AEAT acepta la factura, pero la
  comprobación de Waitron encontró algo que la AEAT puede señalar, o totales que no cuadran con las
  líneas de impuestos. Si son los totales, revisa los precios de esa venta.

Un aviso sale de la lista cuando se marca como resuelto en la campana o en la página **Avisos**. La
exportación incluye todos los avisos abiertos, no solo los de la pantalla.

## Exporta los casos {#export}

**Exportar estos casos para tu asesor fiscal** vuelve a leer el servidor y descarga un archivo con
todos los casos abiertos, no solo los 200 de la pantalla, junto con el resto de la página.

## Historial que puede faltar {#missing-history}

**Historial que puede faltar** muestra dónde la AEAT puede tener facturas que este servidor no tiene.
Ninguna de las dos listas dice que falte una factura.

- **Facturas que la AEAT tiene y este servidor no emitió**: cada factura que una comprobación con la
  AEAT encontró bajo una serie que este servidor ya no usa y que este servidor no emitió.
- **Cambios de identidad sin traspaso**: cada vez que la identidad fiscal de este servidor cambió sin
  un traspaso, por ejemplo tras una restauración, con la última factura que el servidor tiene bajo la
  identidad anterior, si tiene alguna.

Si alguna de las dos listas tiene una línea, elige **Exportar estos casos para tu asesor fiscal**: el
archivo incluye las dos listas.
