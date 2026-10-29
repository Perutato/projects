// =============================================================================
// worker.js  (Web Worker, módulo)
// Parsea los archivos y ejecuta los cálculos pesados fuera del hilo principal.
// Mantiene el modelo consolidado en memoria y responde pedidos de dashboard sin
// transferir las >200,000 filas al hilo de UI.
// =============================================================================

import * as XLSX from './vendor/xlsx.mjs';

import { esDotacion, parseDotacion } from './parsers/dotacion.js';
import { esAsistencia, parseAsistencia } from './parsers/asistencia.js';
import { esTiempoExtra, parseTiempoExtra } from './parsers/tiempoExtra.js';
import { construirModelo } from './model.js';
import { calcularCalidad } from './quality.js';
import { construirDashboard, filtrar } from './kpis.js';
import { construirComplementarios } from './complementarios.js';
import { construirAlertas } from './alerts.js';
import { DEFAULT_CONFIG } from './config.js';

// Modelo en memoria (persiste entre pedidos mientras viva el worker).
let MODELO = { filas: [], teResumen: null, personas: [] };

/**
 * Lee un ArrayBuffer a array-de-arrays de la primera hoja.
 * Para CSV decodifica el texto como UTF-8 (con respaldo Latin-1) para no
 * corromper los acentos ni la "Nº"; para .xlsx usa el binario directamente.
 */
function leerAoA(buffer, fileName = '') {
  if (/\.csv$/i.test(fileName)) {
    // CSV: leer en crudo (raw) para conservar el texto literal de cada celda.
    // Así SheetJS no "adivina" fechas y no invierte día/mes ni pierde el siglo
    // (ej. "1/09/2026" d/mm/yyyy no se convierte a "1/9/26").
    const wb = XLSX.read(decodificarTexto(buffer), { type: 'string', raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }
  // .xlsx/.xls: las fechas reales llegan como Date (cellDates) y los textos
  // se formatean (raw:false). Los parsers manejan ambos casos.
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

/** Decodifica bytes como UTF-8; si no es UTF-8 válido, usa Latin-1 (1252). */
function decodificarTexto(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Detecta el tipo de archivo a partir de la fila de encabezados. */
function detectarTipo(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const h = aoa[i] || [];
    if (!h.length) continue;
    if (esDotacion(h)) return 'dotacion';
    if (esAsistencia(h)) return 'asistencia';
    if (esTiempoExtra(h)) return 'tiempoExtra';
  }
  return 'desconocido';
}

self.onmessage = async (e) => {
  const msg = e.data;
  const reqId = msg.reqId;
  try {
    const result = await manejar(msg);
    if (reqId) self.postMessage({ reqId, ok: true, result });
  } catch (err) {
    const info = String(err && err.stack ? err.stack : err);
    if (reqId) self.postMessage({ reqId, ok: false, error: info });
    else self.postMessage({ type: 'error', message: info });
  }
};

async function manejar(msg) {
  switch (msg.type) {
    case 'parseFile':
      return parseFile(msg);
    case 'recalcular':
      return recalcular(msg);
    case 'dashboard':
      return construirDashboard(MODELO.filas, msg.filtros || {}, msg.cfg || DEFAULT_CONFIG);
    case 'complementarios':
      return construirComplementarios(MODELO.filas, msg.filtros || {}, msg.cfg || DEFAULT_CONFIG);
    case 'alertas':
      return construirAlertas(MODELO.filas, msg.filtros || {}, msg.cfg || DEFAULT_CONFIG);
    case 'detalleSucursal':
      return detalleSucursal(msg);
    default:
      throw new Error('Mensaje desconocido: ' + msg.type);
  }
}

function parseFile({ buffer, fileName, lote, cfg }) {
  self.postMessage({ type: 'progress', fase: 'leyendo', fileName });
  const aoa = leerAoA(buffer, fileName);
  const tipo = detectarTipo(aoa);
  const conf = cfg || DEFAULT_CONFIG;
  const payload = { tipo, fileName, lote };

  if (tipo === 'dotacion') {
    const { personas } = parseDotacion(aoa, conf);
    payload.personas = personas;
    payload.filas = personas.length;
    payload.rango = 'Foto actual';
  } else if (tipo === 'asistencia') {
    const { registros, fechasInvalidas } = parseAsistencia(aoa);
    for (const r of registros) r._lote = lote;
    payload.registros = registros;
    payload.filas = registros.length;
    payload.fechasInvalidas = fechasInvalidas;
    payload.rango = rangoFechas(registros);
  } else if (tipo === 'tiempoExtra') {
    const { registros, descartadasTotales } = parseTiempoExtra(aoa);
    for (const r of registros) r._lote = lote;
    payload.registros = registros;
    payload.filas = registros.length;
    payload.descartadasTotales = descartadasTotales;
    payload.rango = rangoFechas(registros);
  }
  return payload;
}

function recalcular({ personas, asistencia, tiempoExtra, cfg, meta }) {
  const conf = cfg || DEFAULT_CONFIG;
  self.postMessage({ type: 'progress', fase: 'modelo' });
  const modelo = construirModelo({
    personas: personas || [],
    asistencia: asistencia || [],
    tiempoExtra: tiempoExtra || [],
    cfg: conf,
  });
  MODELO = { filas: modelo.filas, teResumen: modelo.teResumen, personas: personas || [] };

  self.postMessage({ type: 'progress', fase: 'calidad' });
  const calidad = calcularCalidad({
    filas: modelo.filas,
    personas: personas || [],
    teResumen: modelo.teResumen,
    teDedup: modelo.teDedup,
    meta: meta || {},
    cfg: conf,
  });

  return {
    controles: calidad.controles,
    listados: calidad.listados,
    filtros: opcionesFiltro(modelo.filas),
    totalFilas: modelo.filas.length,
  };
}

function detalleSucursal({ sucursal, filtros, cfg }) {
  const base = filtrar(MODELO.filas, { ...(filtros || {}), sucursales: [sucursal] });
  // Agrega por persona para el detalle (resumen persona dentro de la sucursal).
  const porPersona = new Map();
  for (const f of base) {
    if (!porPersona.has(f.keyId)) {
      porPersona.set(f.keyId, {
        keyId: f.keyId,
        nombre: f.nombre,
        cargo: f.cargoOficial,
        jefe: f.jefe,
        dias: 0,
        presentes: 0,
        tardanzas: 0,
        faltas: 0,
        sinMarcacion: 0,
        minAtraso: 0,
      });
    }
    const p = porPersona.get(f.keyId);
    p.dias++;
    p.presentes += f.presente;
    p.tardanzas += f.tardanza;
    if (f.estadoDia === 'Falta injustificada') p.faltas++;
    if (f.estadoDia === 'Sin marcación') p.sinMarcacion++;
    p.minAtraso += f.atrasoE1;
  }
  const personas = [...porPersona.values()].sort((a, b) => b.tardanzas - a.tardanzas);
  return { sucursal, personas, nFilas: base.length };
}

/** Opciones distintas para los filtros (sólo dashboards Tienda/Logística). */
function opcionesFiltro(filas) {
  const fd = filas.filter((f) => f.dashboard === 'Tienda' || f.dashboard === 'Logística');
  const uniq = (campo) => [...new Set(fd.map((f) => f[campo]).filter((v) => v !== '' && v != null))].sort();
  let min = null,
    max = null;
  for (const f of fd) {
    if (!f.yyyymmdd) continue;
    if (min === null || f.yyyymmdd < min) min = f.yyyymmdd;
    if (max === null || f.yyyymmdd > max) max = f.yyyymmdd;
  }
  return {
    sucursales: uniq('sucursal'),
    jefes: uniq('jefe'),
    cargos: uniq('cargoOficial'),
    jornadas: uniq('jornada'),
    modelosDias: uniq('modeloDias'),
    calendarios: uniq('calendario'),
    fiscalizaciones: uniq('fiscalizacion'),
    fechaMin: min,
    fechaMax: max,
  };
}

function rangoFechas(registros) {
  let min = null;
  let max = null;
  for (const r of registros) {
    const d = r.yyyymmdd;
    if (!d) continue;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  const fmt = (s) => (s ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : '?');
  return min ? `${fmt(min)} – ${fmt(max)}` : 'Sin fechas';
}
