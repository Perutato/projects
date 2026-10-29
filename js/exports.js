// =============================================================================
// exports.js
// Exportación de tablas a Excel y CSV con SheetJS (carga diferida desde CDN).
// =============================================================================

let _XLSX = null;
async function xlsx() {
  if (!_XLSX) _XLSX = await import('./vendor/xlsx.mjs');
  return _XLSX;
}

/**
 * Exporta filas (array de objetos) a un archivo .xlsx.
 * @param {string} nombreArchivo  sin extensión
 * @param {Array<string>} columnas claves de cada objeto a incluir (en orden)
 * @param {Array<object>} filas
 * @param {Array<string>} [titulos]  encabezados visibles (por defecto = columnas)
 */
export async function exportarExcel(nombreArchivo, columnas, filas, titulos) {
  const XLSX = await xlsx();
  const head = titulos || columnas;
  const aoa = [head, ...filas.map((f) => columnas.map((c) => f[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
}

/** Exporta a CSV (separador coma, con BOM para Excel es-PE). */
export function exportarCSV(nombreArchivo, columnas, filas, titulos) {
  const head = titulos || columnas;
  const escapar = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [head.map(escapar).join(',')];
  for (const f of filas) lineas.push(columnas.map((c) => escapar(f[c] ?? '')).join(','));
  const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  descargar(blob, `${nombreArchivo}.csv`);
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
