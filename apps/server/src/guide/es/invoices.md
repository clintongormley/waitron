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

Para entregar un mes entero, elige **Descargar** junto a las fechas: guarda un archivo con una
copia de cada factura emitida en el mes de **Emitidas desde** y una hoja de cálculo con esas
facturas.

## Dar a un inspector su propio acceso {#inspector-sign-in}

Un inspector puede tener su propio acceso cuando el correo del servidor está configurado
([Correo](email.md#set-up)), porque su primera contraseña le llega por correo.

- En **Roles de acceso**, crea un rol que tenga solo **Ver facturas para Hacienda**. Con solo
  ese rol, el inspector ve **Facturas** y su propia **Configuración de la cuenta**, y nada más.
- En **Usuarios**, añade al inspector con su correo y ese rol. Waitron le envía una invitación
  por correo; consulta [Acceso a la cuenta](staff.md#account-access).
- Puede entrar en el local o, con el [acceso remoto](servers.md#remote-access) activado, a través
  de Waitron Cloud.
- Cuando termine la visita, deshabilita su cuenta en **Usuarios**.

El inspector también puede elegir **Descargar** junto a las fechas para guardar las facturas de
un mes, cada una como su copia, con una hoja de cálculo de ellas.
