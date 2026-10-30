// =============================================================================
// registro.js
// Registro de incidencias día por día: una fila por persona, día y tipo de
// incidencia (qué días faltó, llegó tarde, no marcó…). Lo usan todas las
// descargas a Excel para que, además de los conteos, traigan las fechas.
// Funciones puras (corre en el worker).
// =============================================================================

import { filtrar, marcasFaltantes } from './kpis.js';
import { DEFAULT_CONFIG } from './config.js';

const esIncompleta = (f) => f.nMarcaciones > 0 && !(typeof f.tipoMarcacion === 'string' && f.tipoMarcacion.startsWith('Completa'));
const turnoDe = (f) => (f.inicioTurno ? `${f.inicioTurno}–${f.finTurno}` : '');
// " (a, b)" con las partes que existan, o "" si no hay ninguna.
const entreParentesis = (...partes) => { const p = partes.filter(Boolean); return p.length ? ` (${p.join(', ')})` : ''; };

/**
 * Tipos de incidencia, en el orden en que se listan. `pred` decide si el día
 * la tiene; `min` da sus minutos; `detalle` la explica en una frase.
 */
export const TIPOS_INCIDENCIA = [
  {
    id: 'falta', nombre: 'Falta injustificada',
    pred: (f) => f.estadoDia === 'Falta injustificada',
    detalle: (f) => `No asistió${turnoDe(f) ? ` a su turno ${turnoDe(f)}` : ''}${f.permiso && f.permiso !== 'Ninguno' ? ` (permiso: ${f.permiso})` : ''}`,
  },
  {
    id: 'sinMarcacion', nombre: 'Sin marcación',
    pred: (f) => f.estadoDia === 'Sin marcación',
    detalle: (f) => `Tenía turno${turnoDe(f) ? ` ${turnoDe(f)}` : ''} y no registró ninguna marca`,
  },
  {
    id: 'marcIncompleta', nombre: 'Marcación incompleta',
    pred: esIncompleta,
    detalle: (f) => {
      const falta = marcasFaltantes(f);
      return `${falta.length ? `Falta la marca de ${falta.join(' y ')}` : `Registró ${f.nMarcaciones} de 4 marcas`}${f.patronMarcacion ? ` (${f.patronMarcacion})` : ''}`;
    },
  },
  {
    id: 'tardanza', nombre: 'Tardanza (E1)',
    pred: (f) => f.tardanza === 1,
    min: (f) => f.atrasoE1,
    detalle: (f) => `Llegó ${f.atrasoE1} min tarde${entreParentesis(f.primeraEntrada && `entró ${f.primeraEntrada}`, f.inicioTurno && `turno desde ${f.inicioTurno}`)}`,
  },
  {
    id: 'salida', nombre: 'Salida anticipada (S2)',
    pred: (f) => f.adelantoS2 > 0,
    min: (f) => f.adelantoS2,
    detalle: (f) => `Salió ${f.adelantoS2} min antes${entreParentesis(f.ultimaSalida && `salió ${f.ultimaSalida}`, f.finTurno && `turno hasta ${f.finTurno}`)}`,
  },
  {
    id: 'sinTurno', nombre: 'Trabajó sin turno',
    pred: (f) => f.trabajoSinTurno === 1,
    detalle: (f) => `Marcó${f.primeraEntrada ? ` de ${f.primeraEntrada} a ${f.ultimaSalida || '?'}` : ''} sin turno en la malla`,
  },
  {
    id: 'descanso', nombre: 'Trabajó en descanso',
    pred: (f) => f.estadoDia === 'Trabajó en descanso',
    detalle: (f) => `Marcó en su día de descanso${f.primeraEntrada ? ` (${f.primeraEntrada}–${f.ultimaSalida || '?'})` : ''}`,
  },
  {
    id: 'exceso', nombre: 'Exceso de refrigerio',
    pred: (f, cfg) => f.excesoRefrigerioMin !== null && f.excesoRefrigerioMin > cfg.toleranciaRefrigerioMin,
    min: (f) => f.excesoRefrigerioMin,
    detalle: (f) => `Refrigerio ${f.excesoRefrigerioMin} min más largo que lo programado${f.refrigerioProgMin ? ` (${f.refrigerioProgMin} min)` : ''}`,
  },
];

/** Columnas del registro (clave, título) para las hojas de Excel. */
export const COLS_REGISTRO = [
  ['fecha', 'Fecha'], ['dia', 'Día'], ['keyId', 'DNI / CE'], ['nombre', 'Nombre'], ['sucursal', 'Sucursal'],
  ['dashboard', 'Dashboard'], ['jefe', 'Jefe directo'], ['cargo', 'Cargo'],
  ['incidencia', 'Incidencia'], ['minutos', 'Minutos'], ['detalle', 'Qué pasó'],
  ['turno', 'Turno'], ['entrada', 'Primera entrada'], ['salida', 'Última salida'], ['marcas', 'Marcas (E1-S1-E2-S2)'],
  ['estadoDia', 'Estado del día'], ['permiso', 'Permiso'], ['justificacion', 'Justificación registrada'],
];

export const LIMITE_REGISTRO = 100000;

const fFecha = (s) => (s && s.length === 8 ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : '');

/** Una fila del registro para un día y un tipo de incidencia. */
export function filaRegistro(f, tipo, cfg = DEFAULT_CONFIG) {
  return {
    fecha: fFecha(f.yyyymmdd), dia: f.diaSemana || '', keyId: f.keyId, nombre: f.nombre, sucursal: f.sucursal,
    dashboard: f.dashboard, jefe: f.jefe, cargo: f.cargoOficial,
    incidencia: tipo.nombre, minutos: tipo.min ? tipo.min(f, cfg) || 0 : '', detalle: tipo.detalle(f, cfg),
    turno: turnoDe(f), entrada: f.primeraEntrada || '', salida: f.ultimaSalida || '', marcas: f.patronMarcacion || '',
    estadoDia: f.estadoDia || '', permiso: f.permiso || '', justificacion: f.justificacionRegistrada || '',
  };
}

/**
 * Registro de incidencias del filtro, ordenado por persona y fecha.
 * @param {object[]} filas  filas persona-día del modelo
 * @param {object} filtros  filtros del tablero (dashboard '' = Tienda + Logística)
 * @param {object} cfg
 * @param {object} [opc]    { keyIds?: string[] (solo estas personas), tipos?: string[] (ids de TIPOS_INCIDENCIA) }
 * @returns {{ filas: object[], total: number, truncado: boolean, porTipo: object[] }}
 */
export function registroIncidencias(filas, filtros = {}, cfg = DEFAULT_CONFIG, opc = {}) {
  const solo = opc.keyIds ? new Set(opc.keyIds) : null;
  const tipos = opc.tipos ? TIPOS_INCIDENCIA.filter((t) => opc.tipos.includes(t.id)) : TIPOS_INCIDENCIA;
  const base = filtrar(filas, filtros).filter((f) =>
    (filtros.dashboard || f.dashboard === 'Tienda' || f.dashboard === 'Logística') && (!solo || solo.has(f.keyId)));
  const eventos = [];
  const cuenta = new Map(tipos.map((t) => [t.nombre, { incidencia: t.nombre, dias: 0, personas: new Set() }]));
  for (const f of base) {
    for (const t of tipos) {
      if (!t.pred(f, cfg)) continue;
      eventos.push([f, t]);
      const c = cuenta.get(t.nombre);
      c.dias++;
      c.personas.add(f.keyId);
    }
  }
  eventos.sort(([a, ta], [b, tb]) =>
    a.nombre.localeCompare(b.nombre) || a.keyId.localeCompare(b.keyId) ||
    (a.yyyymmdd < b.yyyymmdd ? -1 : a.yyyymmdd > b.yyyymmdd ? 1 : 0) ||
    tipos.indexOf(ta) - tipos.indexOf(tb));
  return {
    filas: eventos.slice(0, LIMITE_REGISTRO).map(([f, t]) => filaRegistro(f, t, cfg)),
    total: eventos.length,
    truncado: eventos.length > LIMITE_REGISTRO,
    porTipo: [...cuenta.values()].map((c) => ({ incidencia: c.incidencia, dias: c.dias, personas: c.personas.size })),
  };
}

/**
 * Resumen de fechas por persona: "Falta injustificada: 02/09, 04/09 · Tardanza (E1): 01/09".
 * @returns {Map<string,string>} keyId -> texto
 */
export function fechasPorPersona(registro) {
  const per = new Map();
  for (const r of registro) {
    if (!per.has(r.keyId)) per.set(r.keyId, new Map());
    const m = per.get(r.keyId);
    if (!m.has(r.incidencia)) m.set(r.incidencia, []);
    m.get(r.incidencia).push(r.fecha.slice(0, 5));
  }
  const out = new Map();
  for (const [k, m] of per) out.set(k, [...m].map(([t, fs]) => `${t}: ${listaFechas(fs)}`).join(' · '));
  return out;
}

/** "01/09, 02/09, 05/09" (con tope, para que la celda siga siendo legible). */
export function listaFechas(fechas, max = 40) {
  return fechas.length > max ? `${fechas.slice(0, max).join(', ')} … y ${fechas.length - max} más` : fechas.join(', ');
}
