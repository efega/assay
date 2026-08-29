# Roost

Cliente HTTP para VS Code que trabaja sobre ficheros `.http` en texto plano.

Donde vuelven tus peticiones. Ficheros de texto plano en tu repositorio.

## Por que existe

Sale de medir el nicho, no de intuirlo. Los datos estan en
[`../research/HALLAZGOS.md`](../research/HALLAZGOS.md). En resumen:

| Producto | Nota | Falla en | % de negativas |
|---|---:|---|---:|
| REST Client | 4,79 | abandonado 4 anyos, sin funciones profesionales | — |
| Thunder Client | 1,17 | muro de pago retroactivo | 48 % |
| Postman oficial | 1,25 (2026) | cuenta obligatoria | 51 % |
| Bruno | 3,84 | cuelgues | 90 % |

Dos bases de 7,5 millones de instalaciones cada una: una sobre una herramienta
querida y muerta, otra sobre una de pago y detestada. Y los usuarios dicen
literalmente que pagarian:

> *"I'll pay for a good tool, but don't string me along, then pull the rug out."*

## Las cinco reglas

Cada una responde a una queja medida. Las cuatro primeras evitan acabar con
1,17 de nota; la quinta es la unica que genera ingresos.

1. **Nunca cobrar por datos que el usuario ya creo.** Sus peticiones son suyas
   y siempre accesibles.
2. **Exportacion siempre libre, en formato abierto.**
3. **Sin cuenta obligatoria, sin nube forzada.** Todo local.
4. **El nivel gratuito tiene que ser util de verdad**, y funcionar en Remote,
   WSL y Web.
5. **Cobrar por lo que anyade, no por lo que quita:** tests, ejecucion
   encadenada, entornos y runner de CI.

## Estado

Funciona el nucleo gratuito:

- [x] Parser del formato `.http` compatible con REST Client
- [x] Variables de fichero `@nombre = valor` y `{{sustitucion}}`, encadenables
- [x] CodeLens "Enviar" sobre cada peticion, y `Ctrl+Alt+R`
- [x] Respuesta en panel lateral con tiempo y tamanyo
- [x] **Asertos sobre la respuesta**     <- 59 votos, 7,9 anyos pedido
- [x] **Ejecucion encadenada**           <- 54 votos, 5,7 anyos pedido
- [x] **Entornos** (`http-client.env.json`)
- [ ] Runner de linea de comandos        <- 44 votos, 6,9 anyos pedido
- [ ] `text/event-stream` (SSE)          <- 44 votos, 6,6 anyos pedido

## Asertos

La peticion mas votada de REST Client (59 votos, abierta desde hace casi ocho
anyos), y la funcion por la que cobran Postman e Insomnia. Se declaran en el
propio fichero:

```http
### Login
# @name login
# @assert status 200
# @assert time < 1000
# @assert header.content-type contains json
# @assert body.$.token exists
# @assert body.$.items.length > 0
POST {{base}}/login
```

Objetivos: `status`, `time`, `bytes`, `header.<nombre>`, `body.<ruta>`.
Operadores: `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `matches`, `exists`,
`empty`. Sin operador se asume igualdad.

Es declarativo a proposito, no un bloque de script: no hay sandbox que
asegurar, no arrastra dependencias, y el diff en git se lee de un vistazo.

## Encadenamiento

Una peticion puede usar la respuesta de otra. Si la dependencia no se ha
lanzado, se lanza sola:

```http
### Login
# @name login
POST {{base}}/login

### Perfil
GET {{base}}/me
Authorization: Bearer {{login.response.body.$.token}}
# @assert status 200
```

Referencias disponibles: `{{nombre.response.body.$.ruta}}`,
`{{nombre.response.headers.<cabecera>}}` y `{{nombre.response.status}}`.
Sintaxis de REST Client, para no romper la compatibilidad.

Las respuestas se guardan en memoria por fichero y **se descartan en cuanto
editas el documento**, para no arrastrar un token viejo sin darte cuenta.
Tambien hay un comando *Roost: reiniciar cadena*.

### Decisiones de seguridad

Son deliberadas y estan probadas:

- **Deteccion de ciclos.** A que depende de B que depende de A falla nombrando
  el ciclo, en lugar de colgarse.
- **Profundidad maxima de 5.** Un fichero mal escrito no puede disparar
  trafico en cascada sin limite.
- **Los valores resueltos no se registran nunca.** En el panel se ve la
  referencia (`login.response.body.$.token`), no su valor. Un token que
  aparece en un registro acaba en una captura o en un fichero commiteado.
- **Redaccion de secretos.** Los parametros de query y las cabeceras cuyo
  nombre parece credencial (`token`, `api_key`, `authorization`, ...) se
  muestran como `***`.

## Entornos

Formato `http-client.env.json`, el mismo de REST Client e IntelliJ, asi que un
fichero existente funciona sin tocarlo:

```json
{
  "dev":  { "base": "http://localhost:3000" },
  "prod": { "base": "https://api.example.com" }
}
```

Se elige desde la barra de estado. Las variables del propio `.http` siguen
mandando sobre las del entorno, como en REST Client.

**Los secretos van aparte**, en `http-client.private.env.json`, que pisa al
publico para las mismas claves. Asi el fichero de entornos se commitea sin
miedo y el de credenciales no sale de tu maquina.

Y si ese fichero tiene secretos y **no esta en `.gitignore`, Roost avisa y se
ofrece a anyadirlo**. Es el peor fallo posible en una herramienta que presume
de guardar tus credenciales en local, asi que se comprueba solo.

## Desarrollo

Node vive dentro del proyecto en `.node/` (ignorado por git), asi que no hace
falta instalarlo en el sistema.

```bash
export PATH="$PWD/.node/node-v22.14.0-win-x64:$PATH"
npm install
npm test          # compila y ejecuta los tests del parser
npm run compile
```

Para probarla en el editor: F5 abre una ventana de desarrollo con la extension
cargada. Abre `samples/ejemplo.http`.
