# Facturas

Cuando Hacienda pida ver las facturas del local, muéstralas desde **Facturas** en **Informes**.

## Mostrar las facturas tú mismo {#show-invoices}

Abre **Facturas** con tu propio acceso. Necesitas un rol de acceso que incluya
**Ver facturas para Hacienda**. En el local funciona sin internet.

La lista se abre con el mes actual. Para encontrar una factura, cambia **Emitidas desde** y
**Emitidas hasta**, o acota la lista por:

- **Buscar**: el número de factura, el nombre del cliente o su NIF
- **Importe**: el total, la base o la cuota de IVA de una factura
- **Tipo de IVA (%)**
- **Tipo de factura**
- **Operación desde** y **Operación hasta**

Elige el número de una factura para verla en PDF y, desde ahí, imprimirla o guardarla. Una factura
anulada sigue en la lista, marcada con el día en que se anuló. Si la lista termina con
**Mostrar más facturas**, elígelo para ver el resto.

Para entregar un mes entero, elige **Descargar** junto a las fechas: el servidor prepara un
archivo con una copia de cada factura emitida en el mes en que cae **Emitidas desde** y una hoja
de cálculo con esas facturas. Puedes salir de la página mientras tanto; un aviso te indica cuándo
elegir **Guardar el archivo**, y un archivo sin guardar se queda en el servidor una hora.

## Dar a un inspector su propio acceso {#inspector-sign-in}

Un inspector puede tener su propio acceso cuando el correo del servidor está configurado
([Correo](email.md#set-up)), porque su primera contraseña le llega por correo.

- En **Roles de acceso**, crea un rol que tenga solo **Ver facturas para Hacienda**. Con solo
  ese rol, el inspector ve **Facturas** y su propia **Configuración de la cuenta**, y nada más.
- En **Usuarios**, añade al inspector con su correo y ese rol. Waitron le envía una invitación
  por correo; consulta [Acceso a la cuenta](staff.md#account-access).
- Puede entrar en el local o, con el [acceso remoto](servers.md#remote-access) activado, a través
  de Waitron Cloud.
- Puede elegir **Descargar** junto a las fechas para preparar las facturas de un mes, cada una
  como copia, con una hoja de cálculo de ellas, y después **Guardar el archivo** cuando el aviso
  diga que está listo.
- Cuando termine la visita, deshabilita su cuenta en **Usuarios**.

## Modelo 303 y correcciones {#vat-return}

**Modelo 303 (IVA)** en **Informes** prepara el fichero que subes a la AEAT para un mes o un
trimestre. Elige **Ejercicio**, **Periodo** y **Tipo de declaración** y después
**Descargar fichero**. Desde aquí no se envía nada a la AEAT.

La parte de ventas del fichero cuenta el IVA que corresponde al periodo y se registró hasta su
último día, así que una rectificación, una anulación o un ticket tardío registrados después de
terminar el periodo nunca cambian sus ventas. Aparecen en cambio en las correcciones del periodo en
que se registraron.

Antes de presentarlo, elige también **Descargar correcciones (XLSX)** para el mismo periodo y
entrega ambos a tu asesor. Sus dos primeras hojas recogen lo que se registró en el periodo para
periodos anteriores:

- **Resumen**: base imponible e IVA de cada periodo anterior, tipo de IVA y si es una reducción o
  un aumento.
- **Correcciones**: una línea por factura, tipo de corrección y tipo de IVA, con la fecha en que se hizo, su tipo
  (**Rectificativa**, **Anulación**, **Fecha trasladada (salida)**,
  **Fecha trasladada (entrada)** o **Emitida después del periodo de su venta**), su número de
  factura, la factura que corrige y el periodo al que corresponde.

Su hoja **Invitaciones** recoge cada invitación y cada descuento hasta cero en las cuentas abiertas
en el periodo, una fila por plato o por toda la cuenta, con su **Número de factura**,
**Precio de carta (EUR)** y **Coste estimado (EUR)**. Una fila cuenta solo lo que sigue en una
cuenta, así que un plato quitado de la cuenta no aparece. El coste estimado es el precio de carta
sin IVA menos el margen estimado del departamento, y queda en blanco si el departamento no tiene.

Pon el margen de un departamento en **Departamentos y zonas**: abre el departamento y rellena
**Margen estimado (%)** en su pestaña **Datos**. El libro usa los márgenes guardados cuando lo
descargas, así que cambiar uno también cambia las estimaciones de periodos anteriores.
