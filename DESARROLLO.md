# Desarrollo

Node vive dentro del proyecto en `.node/` (ignorado por git), asi que no hace
falta instalarlo en el sistema.

```bash
export PATH="$PWD/.node/node-v22.14.0-win-x64:$PATH"
npm install
npm run test:unit          # parser, asertos, cadena, entornos, redaccion
npm run test:integration   # arranca un VS Code real con la extension cargada
npm test                   # los dos
```

Para probarla a mano: F5 abre una ventana de desarrollo con la extension
cargada. Abre `samples/ejemplo.http`.

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

## Idioma

Las cadenas que ve el usuario estan en **ingles**: el mercado son 7,5 millones
de desarrolladores anglofonos. Los comentarios y los nombres internos estan en
espanyol, y no los ve nadie de fuera.

## De donde salen las decisiones

Ninguna funcionalidad se eligio por intuicion. Ver
[`../research/HALLAZGOS.md`](../research/HALLAZGOS.md) para los datos y
[`../research/DISTRIBUCION.md`](../research/DISTRIBUCION.md) para el plan de
distribucion.
