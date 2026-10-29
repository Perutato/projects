// =============================================================================
// parsers/tiempoExtra.js
// Parser de Tiempo Extra. El archivo trae filas intercaladas de "Totales"
// (Fecha vacía y "Totales" en la columna Entrada); se DESCARTAN.
// =============================================================================

import {
  normHeader,
  normText,
  normalizeKeyId,
  hhmmToMin,
  parseFechaTE,
  encontrarFilaEncabezado,
  indiceColumna,
} from './common.js';

/** ¿Estos encabezados corresponden a Tiempo Extra? */
export function esTiempoExtra(headers) {
  const set = headers.map(normHeader);
  const has = (h) => {
    const n = normHeader(h);
    return set.some((c) => c.includes(n) || n.includes(c));
  };
  return has('TE') && has('Finales');
}

/**
 * Parsea Tiempo Extra desde un array-de-arrays.
 * Columnas (posición relativa al ancla "Identificador" o "Fecha"):
 * Fecha | Apellidos | Nombre | Identificador | Grupo | Turno | Entrada |
 * TE | HEA | HEC | Salió | TE | HEA | HEC | TE Cubre HNT | Finales
 * @returns {{registros: Array, descartadasTotales: number, filaEncabezado: number}}
 */
export function parseTiempoExtra(aoa) {
  const fe = encontrarFilaEncabezado(aoa, ['Identificador', 'Finales']);
  const headerRow = fe >= 0 ? aoa[fe] : aoa[0] || [];

  // Ancla en "Fecha" (posición 0 del bloque). Si no, en "Identificador" (pos 3).
  let base = indiceColumna(headerRow, 'Fecha');
  if (base < 0) base = indiceColumna(headerRow, 'Identificador') - 3;
  if (base < 0) base = 0;
  const C = (off) => base + off;

  const registros = [];
  let descartadasTotales = 0;
  const start = fe >= 0 ? fe + 1 : 1;

  for (let r = start; r < aoa.length; r++) {
    const fila = aoa[r] || [];
    const g = (off) => {
      const i = C(off);
      return i >= 0 && i < fila.length ? fila[i] : '';
    };
    if (fila.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const fechaRaw = g(0); // Fecha
    const entradaRaw = g(6); // Entrada

    // Descartar filas "Totales": Fecha vacía y "Totales" en Entrada
    const f = parseFechaTE(fechaRaw);
    if (!f.ok) {
      if (normText(entradaRaw).includes('totales')) descartadasTotales++;
      else descartadasTotales++; // cualquier fila sin fecha válida se descarta
      continue;
    }

    const identificador = g(3);
    const keyId = normalizeKeyId(identificador, 'DNI');
    if (!keyId) continue;

    const apellidos = String(g(1) || '').trim();
    const nombre = String(g(2) || '').trim();
    const grupo = String(g(4) || '').trim();
    const turno = String(g(5) || '').trim();

    // Bloque entrada: TE(7) HEA(8) HEC(9)
    const teEntrada = hhmmToMin(g(7));
    const heaEntrada = hhmmToMin(g(8));
    const hecEntrada = hhmmToMin(g(9));
    // Bloque salida: TE(11) HEA(12) HEC(13)
    const teSalida = hhmmToMin(g(11));
    const heaSalida = hhmmToMin(g(12));
    const hecSalida = hhmmToMin(g(13));
    // TE Cubre HNT(14), Finales(15)
    const finalesMin = hhmmToMin(g(15));

    const teMin = teEntrada + teSalida; // ejecutado
    const heaMin = heaEntrada + heaSalida; // autorizado
    const finalesReal = finalesMin || hecEntrada + hecSalida; // reconocido/pagable
    const noReconocidasMin = Math.max(0, teMin - finalesReal);
    const enDescanso = normText(turno) === 'descanso' ? 1 : 0;

    const keyDia = keyId + '|' + f.yyyymmdd;

    registros.push({
      keyId,
      keyDia,
      nombre: (nombre + ' ' + apellidos).trim(),
      grupoArea: grupo,
      fecha: f.date,
      yyyymmdd: f.yyyymmdd,
      turno,
      teMin,
      heaMin,
      finalesMin: finalesReal,
      noReconocidasMin,
      enDescanso,
    });
  }

  return { registros, descartadasTotales, filaEncabezado: fe };
}
