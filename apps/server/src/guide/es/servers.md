# Servidores

## Cuando el local ya no funciona con un equipo {#handed-over}

Si abres la dirección de un equipo en un navegador y ves una página titulada **El local ya no
funciona con este equipo**, ese equipo se ha retirado. No hace ventas ni envía nada a Hacienda. La
página indica, en negrita, el equipo que pasa a llevar el local.

Debajo, la página enumera cada paso del traspaso que este equipo ha registrado, en el orden en que
los registró, con la fecha y la hora de cada uno en la zona horaria del local.

La página no tiene botones, porque no hay nada que tengas que hacer: es normal que el equipo esté
en este estado.

La página aparece en español cuando tu navegador prefiere el español, y en inglés en los demás
casos.

## Cuando un equipo espera a otro equipo {#waiting}

Cuando un equipo se inicia y no consigue contactar con el otro equipo con el que ha funcionado el
local, espera en lugar de hacer ventas a la vez que un equipo que quizá ha pasado a llevar el local.
Si abres su dirección en un navegador, ves una página titulada **Este equipo está esperando a** y el
nombre del otro equipo. Mientras espera, no hace ventas ni envía nada a Hacienda, y vuelve a
preguntar al otro equipo cada 15 segundos. En cuanto el otro equipo responde, el equipo sigue por sí
solo.

## Seguir como equipo principal {#carry-on}

Si sabes que el otro equipo está apagado, puedes dejar que este equipo siga sin él. En la dirección
`https://` del equipo, la página muestra el formulario **Seguir como equipo principal**:

- Inicia sesión con tu correo electrónico y tu contraseña. Si tu cuenta usa una aplicación de
  autenticación, la página te pide después de nuevo la contraseña y el código de la aplicación, o en
  su lugar uno de tus códigos de recuperación. Solo un administrador puede seguir.
- Marca **{otro equipo} está apagado** y **No hay ninguna otra recuperación de este local en
  curso**. El botón no se puede pulsar hasta que todos los campos marcados con `*` estén rellenos y
  las dos casillas estén marcadas.

Si el otro equipo responde mientras inicias sesión, manda su respuesta: si dice que no ha pasado a
llevar el local, este equipo se inicia con normalidad; si dice que ha pasado a llevar el local,
este equipo no sigue.

El equipo vuelve entonces a hacer ventas y a enviar registros a Hacienda. Esto dura hasta que el
equipo se vuelva a iniciar: cuando se inicie de nuevo, volverá a preguntar al otro equipo, y volverá
a esperar si no recibe respuesta.

Si este equipo ya ha pasado el local a otro equipo, la página lo indica en lugar de mostrar el
formulario: un equipo no puede seguir después de haber pasado el local.
