// =============================================================================
// worker.js  (Web Worker, módulo)
// Parsea los archivos y ejecuta los cálculos pesados fuera del hilo principal,
// para que la interfaz no se congele con >200,000 filas.
// =============================================================================

import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

import { esDotacion, parseDotacion } from './parsers/dotacion.js';
import { esAsistencia, parseAsistencia } from './parsers/asistencia.js';
import { esTiempoExtra, parseTiempoExtra } from './parsers/tiempoExtra.js';
import { construirModelo } from './model.js';
import { calcularCalidad } from './quality.js';
import { DEFAULT_CONFIG } from './config.js';

/** Lee un ArrayBuffer a array-de-arrays de la primera hoja. */
function leerAoA(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header:1 => array de arrays; raw:false => valores formateados como texto.
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

/** Detecta el tipo de archivo a partir de la fila de encabezados. */
function detectarTipo(aoa) {
  // Busca encabezados en las primeras filas.
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
  try {
    if (msg.type === 'parseFile') {
      const { buffer, fileName, lote, cfg } = msg;
      self.postMessage({ type: 'progress', fase: 'leyendo', fileName });
      const aoa = leerAoA(buffer);
      const tipo = detectarTipo(aoa);
      const conf = cfg || DEFAULT_CONFIG;

      let payload = { tipo, fileName, lote };
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
      self.postMessage({ type: 'parsed', payload });
      return;
    }

    if (msg.type === 'recalcular') {
      const { personas, asistencia, tiempoExtra, cfg, meta } = msg;
      self.postMessage({ type: 'progress', fase: 'modelo' });
      const modelo = construirModelo({
        personas: personas || [],
        asistencia: asistencia || [],
        tiempoExtra: tiempoExtra || [],
        cfg: cfg || DEFAULT_CONFIG,
      });
      self.postMessage({ type: 'progress', fase: 'calidad' });
      const calidad = calcularCalidad({
        filas: modelo.filas,
        personas: personas || [],
        teResumen: modelo.teResumen,
        teDedup: modelo.teDedup,
        meta: meta || {},
        cfg: cfg || DEFAULT_CONFIG,
      });

      // Resumen base ligero (para la pantalla de calidad y como verificación).
      const fd = modelo.filas.filter(
        (f) => f.dashboard === 'Tienda' || f.dashboard === 'Logística'
      );
      const resumen = resumenBase(fd, modelo.teResumen);

      self.postMessage({
        type: 'recalculado',
        controles: calidad.controles,
        listados: calidad.listados,
        resumen,
        totalFilas: modelo.filas.length,
      });
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack ? err.stack : err) });
  }
};

/** Rango de fechas yyyymmdd de un conjunto de registros. */
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

/** Conteos base por dashboard para la pantalla de calidad. */
function resumenBase(fd, teResumen) {
  const porDash = {};
  for (const dash of ['Tienda', 'Logística']) {
    const f = fd.filter((x) => x.dashboard === dash);
    const personas = new Set(f.map((x) => x.keyId)).size;
    const sumaCampo = (c) => f.reduce((a, x) => a + (x[c] || 0), 0);
    const diaEsp = sumaCampo('diaEsperado');
    const pres = sumaCampo('presente');
    const tard = sumaCampo('tardanza');
    porDash[dash] = {
      personas,
      diasEsperados: diaEsp,
      presentes: pres,
      tardanzas: tard,
      pctAsistencia: diaEsp ? (pres / diaEsp) * 100 : 0,
      pctTardanza: pres ? (tard / pres) * 100 : 0,
    };
  }
  return {
    porDash,
    te: teResumen,
    pctHHEEReconocidas: teResumen && teResumen.teMin ? (teResumen.finalesMin / teResumen.teMin) * 100 : 0,
  };
}
