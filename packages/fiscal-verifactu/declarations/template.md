<!-- release-blocker: Item 1.d) is the draft sent to the asesor as Q53. Replace it with the answered wording, then delete this line. -->
<!-- release-blocker: A940 slice 4 has not landed: a v* tag would publish an image without this version or its declaration. Slice 4 deletes this line. -->
**DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN**

**1.a) Nombre del sistema informático a que se refiere esta declaración responsable:**
‹nombre del sistema›

**1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta
declaración responsable:** ‹código del sistema›

**1.c) Identificador completo de la versión concreta del sistema informático a que se refiere
esta declaración responsable:** ‹versión›

**1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
informático y de sus principales funcionalidades:**

Waitron es un software de punto de venta para restaurantes y bares. Se ejecuta en un servidor
—un equipo del propio establecimiento o un servidor en la nube— con Linux y Docker, y los
terminales del establecimiento (cajas, comanderos, pantallas de cocina y el panel de gestión) se
conectan a él por la red mediante un navegador. Opcionalmente, un segundo servidor de reserva en
el establecimiento mantiene una copia continua de los datos y puede sustituir al principal si este
falla.

Hardware: Waitron no incluye hardware propio; funciona en cualquier ordenador que cumpla lo
anterior.

Software: el servidor Waitron, que genera, encadena, conserva y remite los registros de
facturación; la biblioteca @waitron/verifactu (versión ‹versión de @waitron/verifactu›), que
construye cada registro, su huella y el contenido del código QR, y lo remite, y que cuenta con su propia declaración
responsable; las aplicaciones de los terminales, que no generan registros de facturación; el
agente de impresión; y los componentes de terceros de los que nos hacemos responsables: Node.js,
SQLite, Litestream, Linux y Docker (la lista completa se muestra en el propio sistema).

Cada instalación lleva la facturación de un único obligado tributario y aplica una única modalidad
de cumplimiento, determinada por el paquete de país instalado; esta versión solo funciona como
VERI*FACTU.

Principales funcionalidades: ‹funcionalidades›.

**1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se
ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda
funcionar exclusivamente como «VERI*FACTU»:** ‹solo VERI*FACTU›

**1.f) Indicación de si el sistema informático a que se refiere la declaración responsable
permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la
facturación de varios obligados tributarios:** ‹varios obligados›

**1.g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso
de que el sistema informático a que se refiere esta declaración responsable no sea utilizado
como «VERI*FACTU».** Dado que se trata de un producto de facturación que solo puede ser
utilizado exclusivamente en la modalidad de «VERI*FACTU», no se realiza una firma electrónica
expresa de los registros de facturación generados, ya que la normativa considera que quedan
firmados al ser remitidos correctamente a los servicios electrónicos de la Agencia Tributaria
con la debida autenticación mediante el adecuado certificado electrónico cualificado.

**1.h) Nombre y apellidos de la persona productora del sistema informático a que se refiere
esta declaración responsable:** ‹nombre y apellidos›

**1.i) Número de identificación fiscal (NIF) español de la persona productora del sistema
informático a que se refiere esta declaración responsable:** ‹NIF›

**1.j) Dirección postal completa de contacto de la persona productora del sistema informático a
que se refiere esta declaración responsable:** ‹dirección›

**1.k)** La persona productora del sistema informático a que se refiere esta declaración
responsable hace constar que dicho sistema informático, en la versión indicada en ella, cumple
con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General
Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y
programas informáticos o electrónicos que soporten los procesos de facturación de empresarios
y profesionales, y la estandarización de formatos de los registros de facturación, aprobado
por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 de octubre,
y en la sede electrónica de la Agencia Estatal de Administración Tributaria para todo aquello
que complete las especificaciones de dicha orden.

**1.l)**

- Fecha en que la persona productora de este sistema informático suscribe esta declaración
  responsable del mismo: ‹fecha›.
- Lugar en que la persona productora de este sistema informático suscribe esta declaración
  responsable del mismo: ‹lugar› – España.

**ANEXO**

**2.a) Otras formas de contacto con la persona productora del sistema informático a que se
refiere esta declaración responsable:** Correo electrónico: info@waitron.io

**2.b) Direcciones de internet de la persona productora del sistema informático a que se
refiere esta declaración responsable:**

- Histórico de declaraciones responsables de las versiones de este producto:
  https://github.com/clintongormley/waitron/releases
