# Desarrollo

Node vive dentro del proyecto en `.node/` (ignorado por git), asi que no hace
falta instalarlo en el sistema.

```bash
export PATH="$PWD/.node/node-v22.14.0-win-x64:$PATH"
npm install
npm run test:unit          # parser, asertos, cadena, entornos, ejecucion HTTP
npm run test:integration   # VS Code real, cargando el codigo fuente
npm run test:instalada     # empaqueta, instala el .vsix y lo ejercita
npm test                   # los tres
```

## Probarla a mano

**F5**. Funciona tanto si abres la carpeta `extension/` como la raiz del
repositorio: hay un `.vscode/launch.json` en cada una.

Compila antes de arrancar y abre directamente `samples/` en la ventana nueva,
asi que el ejemplo esta a un clic. La tarea de compilado invoca
`.node/.../node.exe` con una ruta absoluta, sin depender de que Node este en
el PATH del sistema.

Si F5 abre el selector de depurador en vez de la extension, es que VS Code no
encuentra el `launch.json`: comprueba que tienes abierta una de esas dos
carpetas y no otra.

## Tres niveles de prueba, y por que hacen falta los tres

| | Que ve |
|---|---|
| `test/unit/` | Las piezas por separado, contra un servidor HTTP local. Sin red: un test que depende de httpbin deja de creerse cuando httpbin falla. |
| `test/integration/` | Un VS Code real con el **codigo fuente** cargado. Pulsa el CodeLens y comprueba que la respuesta aparece. |
| `test/instalada/` | Un VS Code limpio con el **.vsix instalado**. Es lo unico que ve lo mismo que un usuario. |

El tercero no es redundante: los dos primeros cargan `src/` por
`extensionDevelopmentPath`, asi que **no detectan que `.vscodeignore` haya
excluido un fichero necesario**. Un fallo asi funciona en desarrollo y revienta
en cuanto alguien instala la extension.

El guion tambien falla si se ejecutan **cero** tests. vscode-test sale con
codigo 0 cuando no encuentra ninguno, y un verde falso es peor que un fallo.

### Y un cuarto, fuera de `npm test`

```
npm run humo
```

`scripts/humo-real.mjs` ejercita el nucleo contra httpbin y postman-echo: TLS
de verdad, gzip, respuestas de 100 KB, redirecciones, latencia y cookies
reales. **No esta en `npm test` a proposito**, porque un test que depende de un
servicio ajeno falla cuando falla el servicio, y un test que falla por causas
ajenas se acaba ignorando.

Lo que descubre es distinto de lo que descubren los otros tres: los locales
comprueban que la logica es correcta, este comprueba que sobrevive a internet.

## Integridad del paquete

`test/unit/paquete.test.ts` comprueba la firma de los PNG, byte a byte,
incluido el `\r`. Existe por un fallo real: un `sed` de renombrado corrio sobre
todos los ficheros versionados y le quito ese byte al icono y a la captura. Los
167 tests siguieron en verde porque ninguno miraba binarios, y el `.vsix` se
genero con el icono roto.

La regla que sale de ahi: **cualquier cosa que se publique tiene que tener un
test que la mire**, incluidas las que no son codigo.

## Estructura

| | |
|---|---|
| `src/parser.ts` | formato `.http`, compatible con REST Client |
| `src/http.ts` | ejecucion y redaccion de secretos |
| `src/asserts.ts` | asertos declarativos sobre la respuesta |
| `src/rutas.ts` | rutas tipo `$.a.b[0]` sobre JSON |
| `src/cadena.ts` | encadenamiento, ciclos y limite de profundidad |
| `src/entornos.ts` | logica pura de entornos |
| `src/entornosEditor.ts` | capa de vscode: barra de estado, aviso de gitignore |
| `src/extension.ts` | integracion con el editor |

Los modulos de `src/` no importan `vscode` salvo `extension.ts` y
`entornosEditor.ts`. Por eso lo importante se prueba sin abrir un editor.

## La captura del Marketplace

`media/hero.png` **no es una maqueta**: es el producto funcionando, capturado
de una ventana real.

```bash
ASSAY_DEMO_PERFIL=/tmp/perfil npx vscode-test --config .vscode-test-demo.mjs
```

`test/demo/demo.test.ts` abre un `.http`, levanta un servidor local con datos
creibles, envia de verdad y deja la ventana quieta para fotografiarla. Si el
producto cambia, se vuelve a lanzar y la imagen se actualiza sola.

## Cuidado al invocar tsc

No canalices `tsc` por `head`: cierra la tuberia al cuarto renglon y puede
cortar al compilador mientras escribe `out/`. Los tests corren entonces contra
un build a medias y fallan de forma aparentemente aleatoria. Paso una vez.

## Idioma

Las cadenas que ve el usuario estan en **ingles**: el mercado son 7,5 millones
de desarrolladores anglofonos. Los comentarios y los nombres internos estan en
espanyol, y no los ve nadie de fuera.

