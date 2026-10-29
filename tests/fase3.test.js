// =============================================================================
// Pruebas de Complementarios y Alertas (Fase 3).
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construirComplementarios, puntosMarcacion, metricas12 } from '../js/complementarios.js';
import { construirAlertas, reincidencia } from '../js/alerts.js';

function fila(over = {}) {
  return Object.assign(
    {
      keyId: '1', keyDia: '1|20260901', nombre: 'A', sucursal: 'Suc 1', dashboard: 'Tienda',
      fiscalizacion: 'Fiscalizado', jefe: 'J1', cargoOficial: 'C1', campanero: 'No',
      sindicalizado: 'No', jornada: 'Full Time', modeloDias: '5X2', calendario: 'PERU',
      yyyymmdd: '20260901', semana: '2026-W36', mes: '2026-09',
      estadoDia: 'Asistió', tipoMarcacion: 'Completa (4/4)', nMarcaciones: 4,
      categoriaPermiso: 'Sin permiso', feriado: 'No', rangoAtrasoE1: 'Sin atraso',
      presente: 1, diaEsperado: 1, trabajo: 1, trabajoSinTurno: 0, tardanza: 0,
      atrasoE1: 0, adelantoS1: 0, atrasoE2: 0, adelantoS2: 0, fugaMin: 0,
      minAtrasoJustificado: 0, minSalidaJustificada: 0, marcasManuales: 0,
      justificacionRegistrada: 'No', excesoRefrigerioMin: 0, trabajoFeriado: 0,
      teMin: 0, teHeaMin: 0, teFinalesMin: 0, teNoReconocidasMin: 0,
    },
    over
  );
}

test('metricas12 devuelve las 12 métricas', () => {
  const m = metricas12([fila({}), fila({ keyDia: '1|20260902', tardanza: 1, atrasoE1: 5, rangoAtrasoE1: '1-5' })]);
  assert.equal(m.personas, 1);
  assert.equal(m.diasEsperados, 2);
  assert.equal(m.presentes, 2);
  assert.equal(m.tardanzas, 1);
  assert.ok('feriadoTrabajado' in m && 'sinTurno' in m && 'excesoRefrigerio' in m);
});

test('puntosMarcacion calcula días, total, promedio y máximo', () => {
  const filas = [
    fila({ atrasoE1: 10 }),
    fila({ keyDia: '1|2', atrasoE1: 20 }),
    fila({ keyDia: '1|3', atrasoE1: 0 }),
  ];
  const pts = puntosMarcacion(filas);
  const e1 = pts.find((p) => p.punto.startsWith('E1'));
  assert.equal(e1.dias, 2);
  assert.equal(e1.minTotales, 30);
  assert.equal(e1.promedio, 15);
  assert.equal(e1.maximo, 20);
});

test('construirComplementarios arma todos los cortes', () => {
  const filas = [
    fila({ campanero: 'Sí', categoriaPermiso: 'Vacaciones' }),
    fila({ keyId: '2', keyDia: '2|20260901', sindicalizado: 'Sí', feriado: 'Sí', trabajoFeriado: 1 }),
  ];
  const c = construirComplementarios(filas, {});
  assert.ok(c.campanero.length >= 1);
  assert.ok(c.permisos.find((p) => p.categoria === 'Vacaciones'));
  assert.ok(c.feriados.find((f) => f.feriadosTrabajados === 1));
  assert.equal(c.puntosMarcacion.length, 4);
});

test('construirAlertas detecta faltas y nivel Alta', () => {
  // Persona con 2 faltas injustificadas => Alta (>=2 faltas).
  const filas = [
    fila({ estadoDia: 'Falta injustificada', presente: 0, diaEsperado: 1, keyDia: '1|20260901' }),
    fila({ estadoDia: 'Falta injustificada', presente: 0, diaEsperado: 1, keyDia: '1|20260902', semana: '2026-W37' }),
  ];
  const r = construirAlertas(filas, {});
  assert.equal(r.resumen.total, 1);
  assert.equal(r.alertas[0].nivel, 'Alta');
  assert.equal(r.alertas[0].faltas, 2);
  assert.match(r.alertas[0].motivos, /falta/);
});

test('alertas: umbrales se escalan por granularidad', () => {
  const filas = [fila({ tardanza: 1, atrasoE1: 5, keyDia: '1|20260901' })];
  // Con escala 'mes' (umbral tardanzas=5) una sola tardanza NO alerta.
  assert.equal(construirAlertas(filas, { escala: 'mes' }).resumen.total, 0);
});

test('reincidencia cuenta semanas consecutivas con alerta', () => {
  const semanas = new Map([
    ['2026-W36', { faltas: 1, sinMarcacion: 0, tardanzas: 0, trabajoSinTurno: 0 }],
    ['2026-W37', { faltas: 0, sinMarcacion: 2, tardanzas: 0, trabajoSinTurno: 0 }],
    ['2026-W39', { faltas: 1, sinMarcacion: 0, tardanzas: 0, trabajoSinTurno: 0 }], // hueco en W38
  ]);
  assert.equal(reincidencia(semanas), 2); // W36-W37 consecutivas
});
