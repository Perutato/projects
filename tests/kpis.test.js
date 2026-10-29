// =============================================================================
// Pruebas del motor de KPIs (kpis.js).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calcKpis, filtrar, periodoAnterior, clasificarMalla, construirDashboard } from '../js/kpis.js';

function fila(over = {}) {
  return Object.assign(
    {
      keyId: '1', keyDia: '1|20260901', nombre: 'A', sucursal: 'Suc 1', dashboard: 'Tienda',
      fiscalizacion: 'Fiscalizado', jefe: 'J1', cargoOficial: 'C1', campanero: 'No',
      sindicalizado: 'No', jornada: 'Full Time', modeloDias: '5X2', calendario: 'PERU',
      yyyymmdd: '20260901', semana: '2026-W36', mes: '2026-09',
      estadoDia: 'Asistió', tipoMarcacion: 'Completa (4/4)', nMarcaciones: 4,
      presente: 1, diaEsperado: 1, trabajo: 1, trabajoSinTurno: 0, tardanza: 0,
      atrasoE1: 0, adelantoS2: 0, fugaMin: 0, minAtrasoJustificado: 0, minSalidaJustificada: 0,
      marcasManuales: 0, justificacionRegistrada: 'No', excesoRefrigerioMin: 0, trabajoFeriado: 0,
      teMin: 0, teHeaMin: 0, teFinalesMin: 0, teNoReconocidasMin: 0,
    },
    over
  );
}

test('calcKpis básico: asistencia y tardanza', () => {
  const filas = [
    fila({}),
    fila({ keyDia: '1|20260902', yyyymmdd: '20260902', tardanza: 1, atrasoE1: 10, fugaMin: 10 }),
    fila({ keyId: '2', keyDia: '2|20260901', nombre: 'B', fiscalizacion: 'No fiscalizado', estadoDia: 'Falta injustificada', presente: 0, trabajo: 0, nMarcaciones: 0, tipoMarcacion: 'Sin marcas' }),
  ];
  const k = calcKpis(filas);
  assert.equal(k.personas, 2);
  assert.equal(k.fiscalizables, 1);
  assert.equal(k.noFiscalizables, 1);
  assert.equal(k.sumPresente, 2); // dos días presentes de la persona 1
  assert.equal(k.sumDiaEsperado, 3);
  assert.equal(+k.pctAsistencia.toFixed(1), 66.7);
  assert.equal(k.tardanzasDias, 1);
  assert.equal(k.minTardanza, 10);
  assert.equal(k.personasTardanza, 1);
  assert.equal(k.faltasInjust, 1);
  assert.equal(k.fugaH, 10 / 60);
});

test('fugaHporFisc divide solo entre fiscalizables', () => {
  const filas = [
    fila({ fugaMin: 120 }), // fiscalizable, 2 h
    fila({ keyId: '2', keyDia: '2|20260901', fiscalizacion: 'No fiscalizado', fugaMin: 60 }),
  ];
  const k = calcKpis(filas);
  assert.equal(k.fugaH, 3); // (120+60)/60
  assert.equal(k.fiscalizables, 1);
  assert.equal(k.fugaHporFisc, 3); // 3h / 1 fiscalizable
});

test('exceso de refrigerio NULL no cuenta', () => {
  const filas = [
    fila({ excesoRefrigerioMin: null }),
    fila({ keyDia: '1|20260902', excesoRefrigerioMin: 5 }), // <= tolerancia 10
    fila({ keyDia: '1|20260903', excesoRefrigerioMin: 20 }), // > 10
  ];
  const k = calcKpis(filas);
  assert.equal(k.excesoRefrigerioDias, 1);
});

test('semáforo de malla', () => {
  assert.equal(clasificarMalla(96), 'Cumple');
  assert.equal(clasificarMalla(92), 'En riesgo');
  assert.equal(clasificarMalla(88), 'No cumple');
});

test('filtrar por dashboard, fecha y selects', () => {
  const filas = [
    fila({}),
    fila({ keyId: '2', dashboard: 'Logística' }),
    fila({ keyId: '3', yyyymmdd: '20261001', keyDia: '3|20261001' }),
    fila({ keyId: '4', campanero: 'Sí' }),
  ];
  assert.equal(filtrar(filas, { dashboard: 'Tienda' }).length, 3);
  assert.equal(filtrar(filas, { fechaDesde: '20260901', fechaHasta: '20260930' }).length, 3);
  assert.equal(filtrar(filas, { campanero: 'Sí' }).length, 1);
  assert.equal(filtrar(filas, { sucursales: ['Suc 1'] }).length, 4);
});

test('periodoAnterior calcula la ventana equivalente', () => {
  const p = periodoAnterior('20260908', '20260914'); // semana de 7 días
  assert.equal(p.fechaHasta, '20260907');
  assert.equal(p.fechaDesde, '20260901');
});

test('construirDashboard arma KPIs, top5 y gráficos', () => {
  const filas = [
    fila({ sucursal: 'A' }),
    fila({ keyId: '2', keyDia: '2|20260901', sucursal: 'A', tardanza: 1, atrasoE1: 5, fugaMin: 5 }),
    fila({ keyId: '3', keyDia: '3|20260901', sucursal: 'B', estadoDia: 'Falta injustificada', presente: 0, diaEsperado: 1, trabajo: 0 }),
  ];
  const d = construirDashboard(filas, { dashboard: 'Tienda', granularidad: 'dia' });
  assert.equal(d.kpis.personas, 3);
  assert.equal(d.porSucursal.length, 2);
  assert.ok(d.graficos.gr01.length >= 1);
  assert.ok(Array.isArray(d.graficos.gr05));
  // La sucursal B tiene peor asistencia (0%).
  assert.equal(d.top5.peorAsistencia[0].sucursal, 'B');
});
