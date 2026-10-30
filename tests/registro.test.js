// =============================================================================
// Pruebas del registro de incidencias día por día (registro.js) y de las
// fechas que acompañan a las descargas.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registroIncidencias, fechasPorPersona } from '../js/registro.js';
import { construirDrill } from '../js/kpis.js';
import { compararCortes } from '../js/historico.js';

function fila(over = {}) {
  return Object.assign(
    {
      keyId: '1', keyDia: '1|20260901', nombre: 'Ana', sucursal: 'Suc 1', dashboard: 'Tienda',
      fiscalizacion: 'Fiscalizado', jefe: 'J1', cargoOficial: 'C1', yyyymmdd: '20260901', diaSemana: 'Mar',
      estadoDia: 'Asistió', tipoMarcacion: 'Completa (4/4)', nMarcaciones: 4, tipoTurno: 'Turno programado',
      inicioTurno: '09:00', finTurno: '18:00', refrigerioProgMin: 60, primeraEntrada: '09:00', ultimaSalida: '18:00',
      presente: 1, diaEsperado: 1, trabajo: 1, trabajoSinTurno: 0, tardanza: 0, atrasoE1: 0, adelantoS1: 0,
      atrasoE2: 0, adelantoS2: 0, fugaMin: 0, excesoRefrigerioMin: 0, marcasManuales: 0,
      minAtrasoJustificado: 0, minSalidaJustificada: 0, trabajoFeriado: 0,
    },
    over
  );
}
const falta = (ymd, over = {}) => fila({ keyDia: `1|${ymd}`, yyyymmdd: ymd, estadoDia: 'Falta injustificada', presente: 0, nMarcaciones: 0, tipoMarcacion: 'Sin marcas', primeraEntrada: '', ultimaSalida: '', ...over });

test('registro: una fila por persona, día e incidencia, ordenado por persona y fecha', () => {
  const filas = [
    falta('20260904'),
    falta('20260902'),
    fila({ keyId: '2', nombre: 'Beto', keyDia: '2|20260901', tardanza: 1, atrasoE1: 12, primeraEntrada: '09:12' }),
    fila({ keyId: '3', nombre: 'Caro', keyDia: '3|20260901', dashboard: 'Otros', estadoDia: 'Falta injustificada' }),
  ];
  const r = registroIncidencias(filas, {});
  // La persona de otro dashboard no entra.
  assert.equal(r.total, 3);
  assert.deepEqual(r.filas.map((x) => [x.nombre, x.fecha, x.incidencia]), [
    ['Ana', '02/09/2026', 'Falta injustificada'],
    ['Ana', '04/09/2026', 'Falta injustificada'],
    ['Beto', '01/09/2026', 'Tardanza (E1)'],
  ]);
  assert.equal(r.filas[2].minutos, 12);
  assert.match(r.filas[2].detalle, /Llegó 12 min tarde \(entró 09:12, turno desde 09:00\)/);
  assert.match(r.filas[0].detalle, /turno 09:00–18:00/);
  assert.equal(r.porTipo.find((t) => t.incidencia === 'Falta injustificada').dias, 2);
  // Solo algunas personas y tipos.
  assert.equal(registroIncidencias(filas, {}, undefined, { keyIds: ['2'] }).total, 1);
  assert.equal(registroIncidencias(filas, {}, undefined, { tipos: ['tardanza'] }).total, 1);
  assert.equal(fechasPorPersona(r.filas).get('1'), 'Falta injustificada: 02/09, 04/09');
});

test('drill de faltas: fechas por persona y detalle por persona y fecha', () => {
  const filas = [falta('20260904'), falta('20260902'), fila({ keyId: '2', nombre: 'Beto', keyDia: '2|20260901' })];
  const r = construirDrill(filas, [], { dashboard: 'Tienda' }, { metrica: 'faltas' });
  assert.equal(r.personas.length, 1);
  assert.equal(r.personas[0].fechas, '02/09/2026, 04/09/2026');
  assert.deepEqual(r.detalle.map((d) => d.fecha), ['02/09/2026', '04/09/2026']);
  assert.equal(r.detalle[0].incidencia, 'Faltas injustificadas');
});

test('compararCortes devuelve el detalle por persona, día y estado', () => {
  const inc = (k, t) => ({ k: `${k}|${t}`, s: 'S', j: 'J', d: 'Tienda', t });
  const ant = { incidencias: [inc('1|20260901', 'Falta injustificada'), inc('2|20260901', 'Sin marcación')] };
  const act = { incidencias: [inc('1|20260901', 'Falta injustificada'), inc('1|20260903', 'Sin marcación')] };
  const d = compararCortes(act, ant).detalle;
  assert.deepEqual(d.map((x) => [x.keyId, x.fecha, x.estado]), [
    ['1', '01/09/2026', 'Pendiente'],
    ['1', '03/09/2026', 'Nueva'],
    ['2', '01/09/2026', 'Regularizada'],
  ]);
});
