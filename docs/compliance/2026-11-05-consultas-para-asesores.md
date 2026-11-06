# Consultas sobre Waitron para los asesores

5 de noviembre de 2026

Estamos preparando Waitron, un programa de venta y facturación para restaurantes. Necesitamos su criterio por escrito sobre las situaciones siguientes. Cada apartado indica su destinatario; pueden responder conservando la referencia entre corchetes. Por favor, señalen la norma o criterio que fundamenta cada respuesta y cualquier dato del restaurante que necesiten para concretarla.

## Para el asesor fiscal y contable con experiencia en sistemas de facturación

### Propinas sugeridas y servicio añadido por defecto [Q13(d)]

Proponemos ofrecer porcentajes de propina que el cliente pueda rechazar, manteniendo la propina voluntaria separada del importe facturado. ¿Sigue fuera de la base imponible del IVA una cantidad sugerida así? ¿Cambia el tratamiento si se añade por defecto un importe de servicio que el cliente puede pedir que se retire?

### Contabilización de las propinas [Q49]

Las propinas cobradas por tarjeta entrarían en la cuenta del restaurante y se repartirían al personal. Proponemos tratarlas como dinero debido al personal. ¿Deben contabilizarse como deuda, o como ingreso y gasto? Si el restaurante retuviese una parte, ¿cómo tributaría esa parte en el Impuesto sobre Sociedades y en el IVA?

### Conservación y entrega de pruebas [Q48 fiscal]

Proponemos un calendario común de conservación de la documentación empresarial y probatoria, con seis años por conjunto anual como punto de partida para su revisión, sin presumir un plazo legal único desde cada venta. ¿Qué documentos deben conservarse, desde qué hecho empieza cada plazo y qué deducciones, regularizaciones, interrupciones o reclamaciones obligan a ampliarlo? Incluya facturas, registros de facturación, cobros, devoluciones, remisiones a Hacienda e incidencias pendientes o rechazadas.

Proponemos un archivo con los originales íntegros, sus relaciones y límites de cadena, información de versión y un lector independiente del servidor de venta, con acceso electrónico para la Administración. ¿Qué falta para que sea suficiente y accesible, también tras el cierre o fallecimiento del titular? Revisaremos con usted el destino real y los contratos de los proveedores de cobro antes de fijar la política.

### Una cadena cuya hora retrocede [Q51]

Si el reloj está más de un minuto por detrás del último registro, proponemos detener cobros y registros hasta confirmar la hora correcta. Tras confirmarla, permitiríamos un único retroceso, sin límite de duración, sin cambiar registros anteriores; los registros posteriores no podrían quedar más de un minuto por detrás de la hora confirmada ni de la última registrada desde entonces, y un nuevo retroceso exigiría otra confirmación. La comprobación puede proceder de Hacienda o de un dispositivo confirmado por una persona, como se describe en Q61; fuera de la parada detectada al arrancar también se admite la coincidencia de dos dispositivos registrados desde direcciones de red distintas.

¿Admiten la normativa y la AEAT que la fecha y hora de generación del siguiente registro sea anterior a la del precedente? ¿Debe indicarse de alguna forma? Si no se admite, ¿qué procedimiento debemos aplicar? ¿Es distinta la respuesta para ajustes de segundos o de un minuto?

### Una confirmación de hora que después resulta incorrecta [Q52]

Después de reanudar los cobros, una comprobación posterior puede demostrar que la hora aceptada era errónea. Proponemos conservar los registros y facturas tal como se generaron, identificar el intervalo afectado y avisar al titular, guardando la confirmación y sus pruebas.

¿Basta ese expediente o hacen falta subsanación, anulación, nueva expedición, rectificativa o comunicación a la AEAT? ¿Qué evidencia y plazo de conservación exige cada caso? Distinga registros no enviados, aceptados y aceptados con errores por la hora.

### Ventas fechadas con un reloj adelantado [Q60]

Un reloj adelantado puede fechar ventas en el día siguiente o en otro periodo de IVA. Proponemos entregar al titular la lista de facturas afectadas y la constancia del incidente, sin modificar originales. La lista puede ser incompleta si hubo un reinicio, y no siempre permite conocer la hora real de cada venta.

¿Qué remedio corresponde, especialmente si cambia el día o periodo de IVA? ¿Cambia si el reloj iba atrasado, o si los registros están sin enviar, aceptados, aceptados con errores o rechazados? ¿Debe comunicarse el incidente a Hacienda y por qué vía?

### Corrección del reloj desde una caja [Q61]

Proponemos que, cuando no mantenga la hora mediante un servicio de sincronización por internet, el servidor corrija su reloj de sistema y el de batería desde la hora de Hacienda; sin respuesta de Hacienda durante una parada detectada al arrancar, desde una caja registrada cuya hora confirme un empleado con sesión iniciada; y, en cualquier momento, desde el dispositivo propio de un administrador. Se envía la hora del dispositivo, sin teclearla. Una petición manipulada podría aportar una hora falsa. Las confirmaciones de Q51 pueden levantar la parada aunque no se cambie el reloj; corregirlo por estas vías es una operación distinta.

Proponemos registrar quién confirmó, la caja, la hora anterior y posterior y el salto, y avisar en el panel y por correo. Si el disco está lleno, la anotación queda temporalmente en memoria: un reinicio puede perderla y dejar solo los registros técnicos. Una corrección no comprobada también genera aviso, pero no la misma anotación; un reinicio puede perder un correo aún pendiente.

¿Es admisible este procedimiento y qué pruebas adicionales exige? ¿Debe notificarse a la AEAT? ¿Requieren otro tratamiento las facturas anteriores al ajuste? ¿Cambiaría la respuesta si la comprobación se extendiese a cada arranque sin internet?

### Declaración responsable y cambio de productor [Q53]

Proponemos el siguiente texto para describir los componentes y funciones de la versión, completándolo con sus versiones y funcionalidades verificadas antes de publicarla:

> Waitron es un programa de punto de venta para restaurantes y bares. El servidor se ejecuta en un equipo compatible con Linux y Docker, en el establecimiento o en la nube. Las cajas, comanderos, pantallas de cocina y el panel de gestión se conectan mediante navegador. Se prevé un servidor de reserva que pueda sustituir al principal.
>
> Waitron no suministra hardware. El software comprende el servidor que genera, encadena, conserva y remite los registros de facturación; la biblioteca de facturación Veri\*Factu, con su versión y declaración responsable; las aplicaciones de los terminales, que no generan dichos registros; y el agente de impresión. Se identificarán también los componentes de terceros, entre ellos Node.js, SQLite, Litestream, Linux y Docker. Cada instalación factura para un solo obligado tributario; la versión española declarada funcionará exclusivamente como VERI\*FACTU.

¿Es suficiente y correcta esta descripción del apartado d) del artículo 15 de la [Orden HAC/1177/2024](https://www.boe.es/buscar/doc.php?id=BOE-A-2024-22138#a15), incluida la responsabilidad por los componentes de terceros y el alojamiento en la nube?

Proponemos e) = S para la versión exclusivamente VERI\*FACTU, sin apartado g) aplicable, y f) = N por mantener un único obligado. ¿Son correctas esas respuestas y cómo cambiarían si una futura versión incorporase una modalidad no VERI\*FACTU?

Si el productor pasa de persona física a sociedad, proponemos una nueva instalación y cadena, manteniendo lo ya enviado bajo la identidad original. ¿Puede conservarse el código de sistema de dos caracteres bajo el nuevo NIF? ¿Qué declaración o comunicación necesita cada restaurante? ¿Puede el nuevo sistema emitir anulaciones, rectificativas y subsanaciones de registros rechazados relativos a facturas del anterior productor? ¿Exige otro código o cambio documental pasar del servidor local a uno en la nube, o volver, con el mismo productor y obligado?

## Para la gestoría o el asesor laboral de hostelería

### Requisitos del registro de jornada [L1]

Proponemos registrar inicio, fin y pausas de cada jornada, conservar la prueba y facilitarla a trabajadores, representantes e Inspección. ¿Qué requisitos vigentes debe cumplir este restaurante, incluidos los de una eventual nueva norma de registro digital? Indique la referencia publicada, el calendario aplicable y cualquier dato, formato de exportación o acceso remoto adicional exigido. Necesitamos distinguir obligaciones vigentes y proyectos. Si un servidor sustituye a otro, proponemos entregar un registro conjunto con cadenas de integridad separadas por servidor y continuidad identificable de cada trabajador. ¿Es suficiente para acreditar la jornada?

### Convenio y horas extraordinarias [L2]

Proponemos configurar las reglas desde el convenio aplicable al establecimiento. ¿Qué convenio y tablas vigentes corresponden al local y qué límites de jornada, descansos, nocturnidad y jornada partida debemos cargar? Para el cálculo diario de horas extraordinarias y su resumen por periodo de nómina, ¿qué regla de compensación, plazo de descanso y tratamiento del límite anual corresponde?

### Exportación a nómina [L4]

Waitron aportaría horas, turnos, horas extraordinarias y ausencias; la gestoría calcularía nóminas y cotizaciones y realizaría las presentaciones. ¿Qué programa utilizan, qué formato de importación admiten y qué campos y periodicidad necesitan para evitar introducir esos datos de nuevo?

### Datos para el finiquito [L5]

Al terminar una relación laboral, proponemos entregar las horas y ausencias registradas, las vacaciones pendientes y los datos disponibles para las partes proporcionales de pagas. ¿Qué información exacta necesita la gestoría para el finiquito y en qué formato?

### Reparto y nómina de las propinas [L6]

Proponemos llevar a nómina las propinas de tarjeta que el restaurante reparte al personal, con su retención. El [artículo 76.1.3.º RIRPF](https://www.boe.es/buscar/act.php?id=BOE-A-2007-6820#a76) contempla «Cuando satisfagan a su personal cantidades desembolsadas por terceros en concepto de propina».

¿Cómo debemos documentar e importar ese reparto? ¿Cotizan estas propinas y cómo se comunican a la TGSS? Distinga el efectivo entregado directamente al camarero y el efectivo que entra en caja y se reparte al cierre: ¿quién retiene y cómo se declara en cada caso? Sin acuerdo de los representantes ni regla específica del convenio, ¿qué criterio de reparto entre sala, cocina y demás personal corresponde?

### Conservación de documentos laborales [Q48 laboral]

Proponemos incluir la documentación laboral necesaria en el calendario común, con seis años por conjunto anual como base de discusión, respetando los plazos y hechos iniciales propios de cada documento. ¿Qué debe conservarse de jornada, resúmenes a tiempo parcial, nómina, cotización, ausencias y planificación? Indique identidad mínima de trabajadores y responsables, correcciones, accesos, reclamaciones que amplíen plazos y quién autoriza levantar cada retención. La baja de una cuenta no se trataría como permiso para borrar las pruebas.

### Particularidades de cotización [L7(b)]

La gestoría calcularía las cotizaciones. ¿Hay reglas, tramos o bonificaciones de hostelería aplicables a este restaurante que exijan que Waitron le entregue algún dato adicional? Indique cuáles y cómo exportarlos.

## Para un especialista en privacidad con el titular del restaurante

### Alergias y conservación de datos [Q48 privacidad]

Proponemos un calendario común para pruebas empresariales y laborales, con seis años por conjunto anual como base de discusión, retirando antes los datos identificativos innecesarios. Incluye alergias asociadas a un asiento, descripciones de comensales y asignaciones de platos, a veces vinculables a una reserva. ¿Qué base del artículo 6 y qué excepción del artículo 9 RGPD permiten cada uso y conservación? ¿Qué datos deben retirarse antes y qué identidad mínima necesita seguir unida a la prueba?

Para datos retirados o sustituidos proponemos suprimirlos cuando ya no quede obligación, reclamación ni dependencia que lo impida. Las copias de recuperación serían inaccesibles y caducarían en un máximo propuesto de 35 días; las supresiones se reaplicarían antes de abrir una restauración. ¿Es admisible ese retraso y qué bloqueo, acceso, custodia de claves, borrado de versiones y réplicas y actuación ante copias ya entregadas hacen falta? Si un dato está en un original inmutable y no puede retirarse sin alterarlo, ¿qué tratamiento y escalada corresponde? Ocultarlo en pantalla no eliminaría el original.

### Alergias y obligaciones del restaurante [Q54]

Se anotarían alergias por asiento, normalmente sin nombre, pero vinculables a una reserva. Proponemos tratarlas como información de salud potencialmente identificable y preparar un análisis de riesgos propio. ¿Es correcta esa clasificación y qué evaluación necesita este restaurante? La [AEPD excluye de Facilita](https://www.aepd.es/guias-y-herramientas/herramientas/facilita-rgpd) los tratamientos de alto riesgo, «como datos de salud»; ¿queda este uso fuera de la herramienta? ¿Exige la actividad concreta designar delegado de protección de datos?

### Datos de acceso de una extrabajadora [Q55]

Proponemos conservar su correo durante un año tras la baja para atender solicitudes y entregar registros de jornada; después, borrarlo manteniendo la identidad necesaria junto a la prueba laboral. ¿Es proporcionado ese plazo o debe ser otro? Se eliminan al desactivar la cuenta el PIN, contraseña, segundo factor, vínculo con Google, llaves de acceso, códigos de recuperación y desafíos pendientes, sin borrar la jornada. ¿Tiene alguna objeción a esa medida de seguridad?

### Bloqueo y prueba de envío [Q56]

Si se deniega una supresión por una obligación legal de conservar jornada o facturas, proponemos mantener solo el uso necesario. El [artículo 32.1 LOPDGDD](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673#a3-4) exige bloqueo «cuando proceda a su rectificación o supresión». ¿También corresponde en este caso, aunque se deniegue la supresión? ¿Qué consultas deben impedirse y cómo se preserva el acceso del trabajador y sus representantes? Tras entregar una factura, ¿puede borrarse a petición del cliente el correo de destino o debe conservarse como prueba de envío?

### Informes de errores y acceso remoto [Q57]

Proponemos que Waitron reciba informes técnicos para corregir su programa, con registros enmascarados y, si se permite, una descripción escrita por el personal. ¿Actúa como responsable para esa finalidad propia o como encargado del restaurante? Si se elimina el texto libre y se enmascaran los registros antes del envío, ¿qué condiciones hacen que el informe deje realmente de contener datos personales y qué debe explicar el aviso del restaurante?

En el acceso remoto propuesto, el tráfico cifrado del panel atraviesa un relé de Waitron sin que este pueda leerlo. ¿Constituye ese tránsito un encargo que exige contrato del artículo 28 RGPD, y con qué alcance?

### Registro de operaciones por empleado [Q58]

Proponemos registrar qué empleado anula, devuelve, abre el cajón o cambia un pedido, y desde qué dispositivo se ficha, sin seguimiento de ubicación, vídeo ni sonido. ¿Se considera vigilancia o sistema de organización y control del trabajo y exige informe previo de los representantes? ¿Se aplica el artículo 87.3 LOPDGDD al TPV compartido? ¿Basta el aviso de privacidad del personal o qué información específica y participación previa hacen falta?

### Información de privacidad al facturar [Q59]

El restaurante emitiría tiques sin datos del cliente y recogería nombre, NIF y domicilio para facturas completas o simplificadas nominativas. Proponemos información básica al recogerlos y acceso a la completa mediante un cartel junto a caja o un enlace. El [artículo 13.1 RGPD](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807) sitúa la información «en el momento en que estos se obtengan».

¿Basta ese procedimiento y en qué momento debe mostrarse cada información? ¿Es necesaria alguna leyenda en el tique sin datos del cliente? ¿Debe o conviene imprimir una línea en la factura nominativa y en el PDF enviado por correo, también si se factura a una sociedad? Proponga el texto breve.

### Copia continua de la base de datos [Q62]

El servidor del restaurante copia de forma continua toda su base de datos, con datos de clientes y de personal, al almacenamiento externo que elige el restaurante. No la cifra antes de enviarla: depende del cifrado del proveedor, que no protege frente a quien acceda con credenciales válidas. Hemos decidido mantenerlo así, porque la clave tendría que guardarse en el mismo servidor que esas credenciales.

¿Es adecuada esta medida según el artículo 32 del RGPD? Si esa copia se filtrara, ¿habría que informar a los afectados, al no aplicarse la excepción del artículo 34.3.a para datos ininteligibles?

### Fichaje sin biometría [L3]

Proponemos mantener el fichaje mediante PIN o tarjeta, sin biometría. ¿Hay alguna exigencia concreta de este restaurante que haga insuficiente ese sistema o justifique siquiera estudiar una alternativa biométrica? Si surgiera esa necesidad, ¿qué alcance y criterios tendría que cubrir la evaluación de impacto antes de activarla?

## Para un especialista en consumo y normativa autonómica de restauración

### Un cargo fijo por servicio [Q50]

La propuesta actual no añade un cargo por servicio. Si el restaurante quisiera incorporarlo, ¿lo permite la normativa aplicable en su comunidad autónoma, como importe fijo o porcentaje? Si se permite, ¿cómo debe anunciarse en carta y justificante y distinguirse de una propina voluntaria? Necesitamos la norma aplicable al local y la información y aceptación exigidas antes de cobrarlo.
