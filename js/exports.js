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

/**
 * Exporta varias hojas en un mismo libro .xlsx.
 * @param {string} nombreArchivo
 * @param {Array<{nombre:string, columnas:string[], titulos?:string[], filas:object[]}>} hojas
 */
export async function exportarExcelHojas(nombreArchivo, hojas) {
  const XLSX = await xlsx();
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  for (const h of hojas) {
    const head = h.titulos || h.columnas;
    const aoa = [head, ...h.filas.map((f) => h.columnas.map((c) => f[c] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Ancho de columnas según el contenido (tope 60) y filtro en la cabecera.
    ws['!cols'] = head.map((_, c) => ({
      wch: Math.min(60, Math.max(8, ...aoa.slice(0, 500).map((r) => String(r[c] ?? '').length + 2))),
    }));
    if (aoa.length > 1 && head.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: head.length - 1 } }) };
    // Nombre de hoja válido (<=31 chars, sin caracteres prohibidos, único).
    let nom = String(h.nombre || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja';
    let i = 2;
    const baseNom = nom.slice(0, 28);
    while (usados.has(nom)) nom = `${baseNom} ${i++}`;
    usados.add(nom);
    XLSX.utils.book_append_sheet(wb, ws, nom);
  }
  XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
}

/**
 * Exporta filas agrupadas por una clave, con una hoja por grupo.
 * @param {string} nombreArchivo
 * @param {string} campoGrupo  clave de agrupación (p.ej. 'jefe')
 * @param {string[]} columnas
 * @param {object[]} filas
 * @param {string[]} [titulos]
 * @param {object[]} [hojasExtra] hojas que se agregan al final (mismo formato que exportarExcelHojas)
 */
export async function exportarExcelPorGrupo(nombreArchivo, campoGrupo, columnas, filas, titulos, hojasExtra = []) {
  const grupos = new Map();
  for (const f of filas) {
    const k = f[campoGrupo] || '(sin dato)';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  const hojas = [...grupos.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, arr]) => ({ nombre: k, columnas, titulos, filas: arr }));
  await exportarExcelHojas(nombreArchivo, [...hojas, ...hojasExtra]);
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

/**
 * Hoja "registro de incidencias" a partir de la respuesta del worker
 * ('registro'): una fila por persona, día e incidencia.
 */
export function hojaRegistro(reg, nombre = 'Registro de incidencias') {
  const filas = reg.truncado
    ? [...reg.filas, { fecha: `Se muestran ${reg.filas.length} de ${reg.total} filas; acota el filtro para ver el resto.` }]
    : reg.filas;
  return { nombre, columnas: reg.columnas.map((c) => c[0]), titulos: reg.columnas.map((c) => c[1]), filas };
}

/** Hoja con el conteo de días y personas por tipo de incidencia. */
export function hojaResumenIncidencias(reg, nombre = 'Incidencias por tipo') {
  return { nombre, columnas: ['incidencia', 'dias', 'personas'], titulos: ['Incidencia', 'Días', 'Personas'], filas: reg.porTipo };
}
