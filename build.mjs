// =============================================================================
// build.mjs
// Genera `dashboard.html`: una versión autónoma de la app en UN SOLO archivo,
// que se abre con DOBLE CLIC (sin levantar un localhost). Incrusta el CSS, las
// librerías (ECharts, SheetJS, idb-keyval), todo el código, y crea el Web
// Worker desde un Blob (lo único que `file://` permite). Sigue siendo HTML +
// CSS + JS puro (sin framework). El código fuente modular de `js/` se conserva
// para el desarrollo; este script solo lo empaqueta.
//
// Uso:  node build.mjs
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Módulos que corren en el hilo principal y en el worker (ids relativos a js/).
const MAIN = ['config', 'icons', 'storage', 'charts', 'exports', 'historico', 'dashboards', 'panels', 'app'];
const WORKER = [
  'config', 'parsers/common', 'parsers/dotacion', 'parsers/asistencia',
  'parsers/tiempoExtra', 'model', 'kpis', 'quality', 'complementarios', 'alerts', 'worker',
];

// Módulos "vendor" que se resuelven a un global (no se transforman).
const VENDOR = new Set(['vendor/xlsx', 'vendor/idb-keyval']);

// ---- Transformación de un módulo ES a una función registrable ---------------
function idDesdeRuta(importId, desdeId) {
  let spec = importId.replace(/\.(m?js)$/, '');
  if (spec.startsWith('.')) {
    const dir = path.posix.dirname(desdeId);
    spec = path.posix.normalize(path.posix.join(dir, spec));
  }
  return spec.replace(/^\.\//, '');
}

function transformar(id, src) {
  // Recolecta nombres exportados (sobre el fuente original).
  const exportados = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) exportados.add(m[1]);
  for (const m of src.matchAll(/export\s+const\s+(\w+)/g)) exportados.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const n of m[1].split(',')) {
      const nombre = n.trim().split(/\s+as\s+/)[0].trim();
      if (nombre) exportados.add(nombre);
    }
  }

  let out = src;
  // import * as NS from '...'
  out = out.replace(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_, ns, imp) => `const ${ns} = __require(${JSON.stringify(idDesdeRuta(imp, id))});`);
  // import { a, b, x as y } from '...'  (admite multilínea; "as" => ":")
  out = out.replace(/import\s*\{([\s\S]*?)\}\s*from\s+['"]([^'"]+)['"];?/g,
    (_, names, imp) => `const {${names.replace(/\s+as\s+/g, ': ')}} = __require(${JSON.stringify(idDesdeRuta(imp, id))});`);
  // import dinámico (exports.js): await import('./vendor/xlsx.mjs')
  out = out.replace(/import\(\s*['"]([^'"]+)['"]\s*\)/g,
    (_, imp) => `Promise.resolve(__require(${JSON.stringify(idDesdeRuta(imp, id))}))`);
  // export ... -> quita la palabra export
  out = out.replace(/^export\s+async\s+function\s+/gm, 'async function ');
  out = out.replace(/^export\s+function\s+/gm, 'function ');
  out = out.replace(/^export\s+const\s+/gm, 'const ');
  out = out.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

  const ret = `return { ${[...exportados].join(', ')} };`;
  return `__def(${JSON.stringify(id)}, function(__require){\n${out}\n${ret}\n});`;
}

// ---- Runtime de módulos (mini sistema require) ------------------------------
const RUNTIME = `
var __mods = {}, __cache = {};
function __def(id, fn){ __mods[id] = fn; }
function __require(id){
  if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id];
  var fn = __mods[id];
  if (!fn) throw new Error('Módulo no encontrado: ' + id);
  var ex = fn(__require) || {};
  __cache[id] = ex;
  return ex;
}`;

function vendorDefs(scope) {
  // scope: 'self' (worker) o 'window' (main)
  return `
__def('vendor/xlsx', function(){ return ${scope}.XLSX; });
__def('vendor/idb-keyval', function(){ return ${scope}.idbKeyval; });`;
}

function construirBundle(modulos, scope) {
  const partes = [RUNTIME, vendorDefs(scope)];
  for (const id of modulos) {
    if (VENDOR.has(id)) continue;
    partes.push(transformar(id, read(`js/${id}.js`)));
  }
  return partes.join('\n');
}

// ---- Ensamblado -------------------------------------------------------------
const css = read('css/styles.css');
const echarts = read('js/vendor/echarts.min.js');
const xlsx = read('node_modules/xlsx/dist/xlsx.full.min.js');
const idb = read('node_modules/idb-keyval/dist/umd.js');

// Worker: xlsx (global) + bundle + arranque.
const workerSrc = `${xlsx}\n${construirBundle(WORKER, 'self')}\n__require('worker');`;
// Se incrusta como texto legible (sin base64) en un <script> de tipo inerte.
// El contenido de un elemento <script> solo termina en la secuencia "</script",
// así que verificamos que no aparezca en el código.
if (/<\/script/i.test(workerSrc)) {
  throw new Error('El código del worker contiene "</script"; habría que escaparlo.');
}

// Main: bundle, con la creación del worker reemplazada por un Blob.
let mainSrc = construirBundle(MAIN, 'window');
mainSrc = mainSrc.replace(
  /worker\s*=\s*new Worker\(new URL\([^)]*\),\s*\{[^}]*\}\);/,
  'worker = __crearWorker();'
);

// index.html como base: tomamos solo el <body> interno para no duplicar <head>.
const indexHtml = read('index.html');
const bodyMatch = indexHtml.match(/<body>([\s\S]*?)<script[\s\S]*$/);
let bodyInner = bodyMatch ? bodyMatch[1] : '';
// Quita el cierre </body></html> si quedó.
bodyInner = bodyInner.replace(/<\/body>[\s\S]*$/, '');

const html = `<!DOCTYPE html>
<html lang="es-PE">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Dashboard de Asistencia y Alertas — Falabella Perú</title>
<style>
${css}
</style>
<script>${echarts}</script>
<script>${xlsx}</script>
<script>${idb}</script>
</head>
<body>
${bodyInner}
<!-- Código del Web Worker en texto legible (tipo inerte: el navegador no lo
     ejecuta aquí; se lee con textContent y se crea el worker desde un Blob). -->
<script type="text/js-worker" id="worker-src">
${workerSrc}
</script>
<script>
function __crearWorker(){
  var src = document.getElementById('worker-src').textContent;
  var blob = new Blob([src], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}
${mainSrc}
// Arranca la app.
__require('app');
</script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'dashboard.html'), html);
const kb = (html.length / 1024).toFixed(0);
console.log(`dashboard.html generado (${kb} KB).`);
