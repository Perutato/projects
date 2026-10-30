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
import { construirDashboard, construirDrill, alcanceDrill, filtrar } from './kpis.js';
import { registroIncidencias, fechasPorPersona, COLS_REGISTRO } from './registro.js';
import { construirComplementarios } from './complementarios.js';
import { construirAlertas } from './alerts.js';
import { DEFAULT_CONFIG } from './config.js';

// Modelo en memoria (persiste entre pedidos mientras viva el worker).
let MODELO = { filas: [], teFilas: [], teResumen: null, personas: [] };

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
      return construirDashboard(MODELO.filas, msg.filtros || {}, msg.cfg || DEFAULT_CONFIG, MODELO.teFilas);
    case 'drill':
      return construirDrill(MODELO.filas, MODELO.teFilas, msg.filtros || {}, msg.sel || {}, msg.cfg || DEFAULT_CONFIG);
    case 'registro': {
      // Registro día por día de incidencias (para las descargas a Excel).
      const filtros = msg.filtros || {};
      const filas = msg.sel ? MODELO.filas.filter(alcanceDrill(msg.sel, filtros)) : MODELO.filas;
      const reg = registroIncidencias(filas, filtros, msg.cfg || DEFAULT_CONFIG, { keyIds: msg.keyIds, tipos: msg.tipos });
      // columnas: [clave, título]; fechas: keyId -> "Falta injustificada: 02/09, 04/09 · …"
      return { ...reg, columnas: COLS_REGISTRO, fechas: Object.fromEntries(fechasPorPersona(reg.filas)) };
    }
    case 'complementarios':
      return construirComplementarios(MODELO.filas, msg.filtros || {}, msg.cfg || DEFAULT_CONFIG);
    case 'alertas':
      return construirAlertas(MODELO.filas, msg.filtros || {}, msg.cfg || DEFAULT_CONFIG);
    case 'detalleSucursal':
      return detalleSucursal(msg);
    case 'incidencias':
      return { incidencias: calcularIncidencias() };
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
    payload.aoa = aoa; // se guarda el crudo para re-derivar con parámetros nuevos
    payload.filas = personas.length;
    payload.rango = 'Foto actual';
  } else if (tipo === 'asistencia') {
    const { registros, fechasInvalidas, ejemplosFechas } = parseAsistencia(aoa);
    for (const r of registros) r._lote = lote;
    payload.registros = registros;
    payload.filas = registros.length;
    payload.fechasInvalidas = fechasInvalidas;
    payload.ejemplosFechas = ejemplosFechas;
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

function recalcular({ personas, dotacionAoa, asistencia, tiempoExtra, cfg, meta }) {
  const conf = cfg || DEFAULT_CONFIG;
  // Si tenemos el crudo de la Dotación, la re-derivamos con los parámetros
  // actuales (así cambios en mapeo/ sindicatos/ campañero/ jornada toman efecto).
  let per = personas || [];
  if (dotacionAoa && dotacionAoa.length) per = parseDotacion(dotacionAoa, conf).personas;
  self.postMessage({ type: 'progress', fase: 'modelo' });
  const modelo = construirModelo({
    personas: per,
    asistencia: asistencia || [],
    tiempoExtra: tiempoExtra || [],
    cfg: conf,
  });
  MODELO = { filas: modelo.filas, teFilas: modelo.teFilas, teResumen: modelo.teResumen, personas: per };

  self.postMessage({ type: 'progress', fase: 'calidad' });
  const calidad = calcularCalidad({
    filas: modelo.filas,
    personas: per,
    teResumen: modelo.teResumen,
    teDedup: modelo.teDedup,
    meta: { ...(meta || {}), teSinAsistencia: modelo.teFilas.filter((t) => !t.conAsistencia).length },
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

/**
 * Calcula las incidencias del modelo actual (sólo Tienda/Logística).
 * Una incidencia = { k: keyDia|tipo, s: sucursal, j: jefe, d: dashboard, t: tipo }.
 */
function calcularIncidencias() {
  const out = [];
  for (const f of MODELO.filas) {
    if (f.dashboard !== 'Tienda' && f.dashboard !== 'Logística') continue;
    const tipos = [];
    if (f.estadoDia === 'Falta injustificada') tipos.push('Falta injustificada');
    if (f.estadoDia === 'Sin marcación') tipos.push('Sin marcación');
    if (f.estadoDia === 'Marcación incompleta') tipos.push('Marcación incompleta');
    if (f.trabajoSinTurno === 1) tipos.push('Trabajó sin turno');
    for (const t of tipos) out.push({ k: f.keyDia + '|' + t, s: f.sucursal, j: f.jefe, d: f.dashboard, t });
  }
  return out;
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
  const sucDe = (dash) => [...new Set(fd.filter((f) => f.dashboard === dash).map((f) => f.sucursal))].sort();
  return {
    sucursales: uniq('sucursal'),
    sucursalesPorDashboard: { Tienda: sucDe('Tienda'), 'Logística': sucDe('Logística') },
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
