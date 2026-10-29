// =============================================================================
// storage.js
// Persistencia local con IndexedDB (idb-keyval). Guarda:
//  - La Dotación (foto actual, con su fecha).
//  - Los lotes de asistencia y tiempo extra cargados (se acumulan).
//  - El inventario de archivos.
//  - Los parámetros editables.
//  - El histórico de cortes.
// Todo es 100% local. No se envía nada a internet.
// =============================================================================

import { get, set, del, keys } from './vendor/idb-keyval.js';
import { DEFAULT_CONFIG } from './config.js';

const K = {
  DOTACION: 'dotacion', // { personas, fechaFoto, fileInfo }
  ASISTENCIA: 'asistencia', // Array de registros (con _lote)
  TIEMPO_EXTRA: 'tiempoExtra', // Array de registros (con _lote)
  INVENTARIO: 'inventario', // Array de { id, nombre, tipo, rango, filas, fechaCarga, lote }
  CONFIG: 'config', // parámetros editables
  CORTES: 'cortes', // histórico de cortes
  LOTE_SEQ: 'loteSeq', // contador incremental de lotes
};

export async function getConfig() {
  const c = await get(K.CONFIG);
  return c ? { ...DEFAULT_CONFIG, ...c } : { ...DEFAULT_CONFIG };
}
export async function setConfig(cfg) {
  await set(K.CONFIG, cfg);
}

export async function getDotacion() {
  return (await get(K.DOTACION)) || null;
}
export async function setDotacion(payload) {
  await set(K.DOTACION, payload);
}

export async function getAsistencia() {
  return (await get(K.ASISTENCIA)) || [];
}
export async function getTiempoExtra() {
  return (await get(K.TIEMPO_EXTRA)) || [];
}

/** Acumula registros de asistencia (ya traen _lote). */
export async function appendAsistencia(registros) {
  const prev = await getAsistencia();
  await set(K.ASISTENCIA, prev.concat(registros));
}
export async function appendTiempoExtra(registros) {
  const prev = await getTiempoExtra();
  await set(K.TIEMPO_EXTRA, prev.concat(registros));
}

export async function getInventario() {
  return (await get(K.INVENTARIO)) || [];
}
export async function setInventario(inv) {
  await set(K.INVENTARIO, inv);
}

export async function getCortes() {
  return (await get(K.CORTES)) || [];
}
export async function setCortes(cortes) {
  await set(K.CORTES, cortes);
}

/** Devuelve el siguiente número de lote (incremental). */
export async function siguienteLote() {
  const n = ((await get(K.LOTE_SEQ)) || 0) + 1;
  await set(K.LOTE_SEQ, n);
  return n;
}

/** Elimina un archivo del inventario y sus registros asociados por lote. */
export async function eliminarArchivo(id) {
  const inv = await getInventario();
  const item = inv.find((x) => x.id === id);
  if (!item) return;
  const resto = inv.filter((x) => x.id !== id);
  await setInventario(resto);
  if (item.tipo === 'asistencia') {
    const regs = (await getAsistencia()).filter((r) => r._lote !== item.lote);
    await set(K.ASISTENCIA, regs);
  } else if (item.tipo === 'tiempoExtra') {
    const regs = (await getTiempoExtra()).filter((r) => r._lote !== item.lote);
    await set(K.TIEMPO_EXTRA, regs);
  } else if (item.tipo === 'dotacion') {
    await del(K.DOTACION);
  }
}

/** Limpia todos los datos (menos los parámetros, salvo que se indique). */
export async function limpiarTodo(incluirConfig = false) {
  const all = await keys();
  for (const k of all) {
    if (!incluirConfig && k === K.CONFIG) continue;
    await del(k);
  }
}

export { K };
