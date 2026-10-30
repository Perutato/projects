// =============================================================================
// Pruebas de los indicadores revisados (controles de cumplimiento).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { controlesDe, marcasFaltantes, construirDrill } from '../js/kpis.js';

function dia(over = {}) {
  return Object.assign(
    {
      keyId: '1', keyDia: '1|20260901', nombre: 'Ana', sucursal: 'S1', dashboard: 'Tienda', jefe: 'J', cargoOficial: 'C',
      yyyymmdd: '20260901', tipoTurno: 'Turno programado', inicioTurno: '09:00', finTurno: '18:00', refrigerioProgMin: 60,
      estadoDia: 'Asistió', categoriaPermiso: 'Sin permiso', nMarcaciones: 4, patronMarcacion: 'E1-S1-E2-S2',
      tipoMarcacion: 'Completa (4/4)', diaEsperado: 1, presente: 1, trabajo: 1, trabajoSinTurno: 0,
    },
    over
  );
}
function te(over = {}) {
  return Object.assign(
    { keyId: '1', keyDia: '1|20260901', nombre: 'Ana', sucursal: 'S1', dashboard: 'Tienda', jornada: 'Full Time', yyyymmdd: '20260901', feriado: 'No', teMin: 60, heaMin: 60, finalesMin: 60, noReconocidasMin: 0 },
    over
  );
}

test('marcasFaltantes distingue entrada, salida y refrigerio', () => {
  assert.deepEqual(marcasFaltantes(dia({ nMarcaciones: 2, patronMarcacion: 'E1-__-__-S2' })), ['refrigerio']);
  assert.deepEqual(marcasFaltantes(dia({ nMarcaciones: 2, patronMarcacion: 'E1-__-__-S2', refrigerioProgMin: 0 })), []);
  assert.deepEqual(marcasFaltantes(dia({ nMarcaciones: 3, patronMarcacion: '__-S1-E2-S2' })), ['entrada']);
  assert.deepEqual(marcasFaltantes(dia({ nMarcaciones: 1, patronMarcacion: 'E1-__-__-__' })), ['salida', 'refrigerio']);
  assert.deepEqual(marcasFaltantes(dia({ nMarcaciones: 0, patronMarcacion: '__-__-__-__' })), []);
});

test('controlesDe cuenta los cinco controles por sucursal', () => {
  const base = [
    dia(),
    // Falta sin licencia: registrada como inasistencia y otra sin nada.
    dia({ keyId: '2', estadoDia: 'Falta injustificada', categoriaPermiso: 'Inasistencia injustificada', nMarcaciones: 0, patronMarcacion: '__-__-__-__' }),
    dia({ keyId: '3', estadoDia: 'Sin marcación', nMarcaciones: 0, patronMarcacion: '__-__-__-__' }),
    // Con vacaciones no es falta.
    dia({ keyId: '4', estadoDia: 'Ausencia justificada', categoriaPermiso: 'Vacaciones', nMarcaciones: 0, patronMarcacion: '__-__-__-__' }),
    // Marca faltante (sin salida).
    dia({ keyId: '5', estadoDia: 'Marcación incompleta', nMarcaciones: 3, patronMarcacion: 'E1-S1-E2-__' }),
    // Marcó en descanso y sin turno.
    dia({ keyId: '6', sucursal: 'S2', tipoTurno: 'Descanso', estadoDia: 'Trabajó en descanso', refrigerioProgMin: 0, patronMarcacion: 'E1-__-__-S2', nMarcaciones: 2 }),
    dia({ keyId: '7', sucursal: 'S2', tipoTurno: 'Sin turno', estadoDia: 'Asistió', trabajoSinTurno: 1, refrigerioProgMin: 0, patronMarcacion: 'E1-__-__-S2', nMarcaciones: 2 }),
  ];
  const teRows = [
    te({ feriado: 'Sí', heaMin: 120, finalesMin: 0 }),
    te({ keyId: '2', feriado: 'Sí', heaMin: 0, finalesMin: 0 }), // feriado sin aprobar ni compensar: no cuenta
    te({ keyId: '8', jornada: 'Part Time', heaMin: 90 }),
    te({ keyId: '9', jornada: 'Part Time', heaMin: 0 }),
  ];
  const c = controlesDe(base, teRows);
  assert.equal(c.resumen.hheeFeriado.casos, 1);
  assert.equal(c.resumen.hheeFeriado.aprobH, 2);
  assert.equal(c.resumen.hheePartTime.casos, 1);
  assert.equal(c.resumen.hheePartTime.aprobH, 1.5);
  assert.deepEqual([c.resumen.faltaSinLicencia.casos, c.resumen.faltaSinLicencia.registrada, c.resumen.faltaSinLicencia.sinMarca], [2, 1, 1]);
  assert.deepEqual([c.resumen.marcaFaltante.casos, c.resumen.marcaFaltante.salida], [1, 1]);
  assert.deepEqual([c.resumen.marcaSinPlan.casos, c.resumen.marcaSinPlan.descanso, c.resumen.marcaSinPlan.sinTurno], [2, 1, 1]);
  assert.deepEqual(c.graficos.marcaSinPlan.map((x) => x.sucursal), ['S2']);
  // El drill lista a las personas con sus fechas.
  const d = construirDrill(base, teRows, { dashboard: 'Tienda' }, { metrica: 'faltaSinLicencia' });
  assert.deepEqual(d.personas.map((p) => p.keyId).sort(), ['2', '3']);
  const h = construirDrill(base, teRows, { dashboard: 'Tienda' }, { metrica: 'hheePartTime' });
  assert.deepEqual(h.personas.map((p) => p.keyId), ['8']);
  assert.equal(h.detalle[0].jornada, 'Part Time');
});
