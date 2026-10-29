// =============================================================================
// alerts.js
// Alertas por persona: agrega los conteos de incidencias por keyId en el
// período filtrado, aplica los umbrales (escalables según granularidad),
// determina el nivel (Alta/Media), los motivos y la reincidencia (semanas
// consecutivas con alerta). Funciones puras (se ejecutan en el Web Worker).
// =============================================================================

import { DEFAULT_CONFIG } from './config.js';
import { filtrar } from './kpis.js';

function soloDashboards(filas, dashboard) {
  if (dashboard) return filas.filter((f) => f.dashboard === dashboard);
  return filas.filter((f) => f.dashboard === 'Tienda' || f.dashboard === 'Logística');
}

/** Ordinal de una semana ISO "yyyy-Www" para medir consecutividad. */
function semanaOrdinal(s) {
  const m = /^(\d{4})-W(\d{2})$/.exec(s || '');
  if (!m) return null;
  return parseInt(m[1], 10) * 53 + parseInt(m[2], 10);
}

/** Es día con marcación incompleta (iniciada pero no completa). */
function esIncompleta(f) {
  return f.nMarcaciones > 0 && !(typeof f.tipoMarcacion === 'string' && f.tipoMarcacion.startsWith('Completa'));
}

/**
 * Construye la lista de alertas por persona.
 * @param {Array} filas
 * @param {object} filtros  incluye opcional `escala` ('dia'|'semana'|'mes')
 * @param {object} cfg
 */
export function construirAlertas(filas, filtros = {}, cfg = DEFAULT_CONFIG) {
  const base = soloDashboards(filtrar(filas, { ...filtros, dashboard: '' }), filtros.dashboard);

  // Umbrales escalados según la granularidad elegida.
  const factor = (cfg.escalaUmbralPorGranularidad || {})[filtros.escala || 'mes'] ?? 1;
  const U = cfg.umbralesAlerta;
  const esc = (k) => Math.max(1, Math.round(U[k] * factor));
  const umbrales = {
    faltasInjustificadas: esc('faltasInjustificadas'),
    sinMarcacion: esc('sinMarcacion'),
    marcacionIncompleta: esc('marcacionIncompleta'),
    tardanzasE1: esc('tardanzasE1'),
    trabajoEnDescanso: esc('trabajoEnDescanso'),
    trabajoSinTurno: esc('trabajoSinTurno'),
    diasExcesoRefrigerio: esc('diasExcesoRefrigerio'),
  };
  const tol = cfg.toleranciaRefrigerioMin;

  // Agregación por persona.
  const porPersona = new Map();
  for (const f of base) {
    let p = porPersona.get(f.keyId);
    if (!p) {
      p = {
        keyId: f.keyId, nombre: f.nombre, sucursal: f.sucursal, dashboard: f.dashboard,
        jefe: f.jefe, cargo: f.cargoOficial,
        faltas: 0, sinMarcacion: 0, marcacionIncompleta: 0, tardanzas: 0,
        trabajoEnDescanso: 0, trabajoSinTurno: 0, excesoRefrigerio: 0,
        semanas: new Map(),
      };
      porPersona.set(f.keyId, p);
    }
    if (f.estadoDia === 'Falta injustificada') p.faltas++;
    if (f.estadoDia === 'Sin marcación') p.sinMarcacion++;
    if (esIncompleta(f)) p.marcacionIncompleta++;
    p.tardanzas += f.tardanza;
    if (f.estadoDia === 'Trabajó en descanso') p.trabajoEnDescanso++;
    p.trabajoSinTurno += f.trabajoSinTurno;
    if (f.excesoRefrigerioMin !== null && f.excesoRefrigerioMin > tol) p.excesoRefrigerio++;

    // Conteos por semana (para reincidencia).
    const wk = f.semana || '';
    let w = p.semanas.get(wk);
    if (!w) { w = { faltas: 0, sinMarcacion: 0, tardanzas: 0, trabajoSinTurno: 0 }; p.semanas.set(wk, w); }
    if (f.estadoDia === 'Falta injustificada') w.faltas++;
    if (f.estadoDia === 'Sin marcación') w.sinMarcacion++;
    w.tardanzas += f.tardanza;
    w.trabajoSinTurno += f.trabajoSinTurno;
  }

  const alertas = [];
  for (const p of porPersona.values()) {
    const motivos = [];
    if (p.faltas >= umbrales.faltasInjustificadas) motivos.push(`${p.faltas} falta(s) injustificada(s)`);
    if (p.sinMarcacion >= umbrales.sinMarcacion) motivos.push(`${p.sinMarcacion} día(s) sin marcación`);
    if (p.marcacionIncompleta >= umbrales.marcacionIncompleta) motivos.push(`${p.marcacionIncompleta} marcación(es) incompleta(s)`);
    if (p.tardanzas >= umbrales.tardanzasE1) motivos.push(`${p.tardanzas} tardanza(s)`);
    if (p.trabajoEnDescanso >= umbrales.trabajoEnDescanso) motivos.push(`${p.trabajoEnDescanso} día(s) trabajado(s) en descanso`);
    if (p.trabajoSinTurno >= umbrales.trabajoSinTurno) motivos.push(`${p.trabajoSinTurno} día(s) sin turno`);
    if (p.excesoRefrigerio >= umbrales.diasExcesoRefrigerio) motivos.push(`${p.excesoRefrigerio} día(s) con exceso de refrigerio`);
    if (!motivos.length) continue;

    const alta =
      p.faltas >= cfg.nivelAlta.faltas ||
      p.sinMarcacion >= cfg.nivelAlta.sinMarcacion ||
      p.tardanzas >= cfg.nivelAlta.tardanzas ||
      p.trabajoSinTurno >= cfg.nivelAlta.trabajoSinTurno;

    alertas.push({
      keyId: p.keyId, nombre: p.nombre, sucursal: p.sucursal, dashboard: p.dashboard,
      jefe: p.jefe, cargo: p.cargo,
      faltas: p.faltas, sinMarcacion: p.sinMarcacion, marcacionIncompleta: p.marcacionIncompleta,
      tardanzas: p.tardanzas, trabajoEnDescanso: p.trabajoEnDescanso,
      trabajoSinTurno: p.trabajoSinTurno, excesoRefrigerio: p.excesoRefrigerio,
      reincidencia: reincidencia(p.semanas),
      nivel: alta ? 'Alta' : 'Media',
      motivos: motivos.join('; '),
    });
  }

  // Orden: nivel (Alta primero), luego faltas*100 + sin marcación, luego tardanzas.
  alertas.sort((a, b) => {
    const nv = (a.nivel === 'Alta' ? 0 : 1) - (b.nivel === 'Alta' ? 0 : 1);
    if (nv) return nv;
    const g = (b.faltas * 100 + b.sinMarcacion) - (a.faltas * 100 + a.sinMarcacion);
    if (g) return g;
    return b.tardanzas - a.tardanzas;
  });

  const altas = alertas.filter((a) => a.nivel === 'Alta').length;
  return {
    alertas,
    resumen: { total: alertas.length, altas, medias: alertas.length - altas },
    umbrales,
    escala: filtros.escala || 'mes',
  };
}

/**
 * Reincidencia: máximo de semanas consecutivas "con alerta".
 * Una semana cuenta como "con alerta" si tiene ≥1 falta, ≥1 día sin marcación,
 * ≥2 tardanzas o ≥1 día sin turno (regla semanal, documentada).
 */
export function reincidencia(semanas) {
  const flagged = [];
  for (const [wk, w] of semanas) {
    const alerta = w.faltas >= 1 || w.sinMarcacion >= 1 || w.tardanzas >= 2 || w.trabajoSinTurno >= 1;
    if (alerta) {
      const ord = semanaOrdinal(wk);
      if (ord !== null) flagged.push(ord);
    }
  }
  if (!flagged.length) return 0;
  flagged.sort((a, b) => a - b);
  let mejor = 1;
  let actual = 1;
  for (let i = 1; i < flagged.length; i++) {
    if (flagged[i] === flagged[i - 1] + 1) actual++;
    else if (flagged[i] !== flagged[i - 1]) actual = 1;
    if (actual > mejor) mejor = actual;
  }
  return mejor;
}
