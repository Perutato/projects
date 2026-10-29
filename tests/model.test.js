// =============================================================================
// Pruebas del modelo (cruces e indicadores) y de la calidad de datos.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construirModelo, dedupPorKeyDia } from '../js/model.js';
import { calcularCalidad } from '../js/quality.js';

// Dotación mínima: una persona de Tienda.
const personas = [
  {
    keyId: '12345678',
    tipoDoc: 'DNI',
    nombre: 'Juan Pérez',
    cargo: 'Vendedor',
    sucursal: 'Tienda Lima',
    grupoUbic: 'Sucursales y Tiendas',
    dashboard: 'Tienda',
    campanero: 'No',
    fiscalizacion: 'Fiscalizado',
    jornada: 'Full Time',
    calendario: 'PERU',
    estado: 'Activo',
    horario: 'FULL TIME TIENDA 48 HORAS 5X2',
    modeloDias: '5X2',
    diasLaborablesSemana: 5,
    ambito: 'Tienda',
    tipoContrato: 'Indefinido',
    sindicalizado: 'No',
    jefe: 'Jefe X',
    fechaCese: null,
    fechaPuesto: null,
    validacionHoras: 'OK',
  },
];

function reg(over) {
  // Registro de asistencia base (ya parseado).
  return Object.assign(
    {
      keyId: '12345678',
      keyDia: '12345678|20260901',
      nombre: 'Juan Pérez',
      fecha: new Date(2026, 8, 1),
      yyyymmdd: '20260901',
      diaSemana: 'Mar',
      feriado: 'No',
      categoriaPermiso: 'Sin permiso',
      tipoTurno: 'Turno programado',
      estadoDia: 'Asistió',
      tipoMarcacion: 'Completa (4/4)',
      nMarcaciones: 4,
      marcasManuales: 0,
      atrasoE1: 0,
      adelantoS1: 0,
      atrasoE2: 0,
      adelantoS2: 0,
      atrasoTotal: 0,
      salidaAnticipadaTotal: 0,
      rangoAtrasoE1: 'Sin atraso',
      justificacionRegistrada: 'No',
      justE1Texto: false,
      justS2Texto: false,
      refrigerioRealMin: 60,
      excesoRefrigerioMin: 0,
      incidenciaHorario: 'No',
      heaMin: 0,
      hecMin: 0,
      hntMin: 0,
      htMin: 0,
      cargoMarcacion: 'Vendedor',
      _lote: 1,
    },
    over
  );
}

test('dedupPorKeyDia conserva el lote más reciente', () => {
  const r1 = reg({ _lote: 1, atrasoE1: 10 });
  const r2 = reg({ _lote: 2, atrasoE1: 0 }); // regularizado
  const out = dedupPorKeyDia([r1, r2]);
  assert.equal(out.length, 1);
  assert.equal(out[0].atrasoE1, 0);
});

test('construirModelo calcula indicadores y cruza con dotación', () => {
  const tardon = reg({ keyDia: '12345678|20260902', yyyymmdd: '20260902', atrasoE1: 7, justE1Texto: true });
  const { filas } = construirModelo({ personas, asistencia: [reg({}), tardon], tiempoExtra: [] });
  assert.equal(filas.length, 2);
  const f0 = filas.find((f) => f.yyyymmdd === '20260901');
  assert.equal(f0.sucursal, 'Tienda Lima');
  assert.equal(f0.dashboard, 'Tienda');
  assert.equal(f0.presente, 1);
  assert.equal(f0.diaEsperado, 1);
  assert.equal(f0.tardanza, 0);

  const f1 = filas.find((f) => f.yyyymmdd === '20260902');
  assert.equal(f1.tardanza, 1);
  assert.equal(f1.fugaMin, 7); // atrasoE1 + adelantoS2 (E1S2)
  assert.equal(f1.minAtrasoJustificado, 7); // justificado
});

test('calcularCalidad da todos los controles OK con datos consistentes', () => {
  const asistencia = [reg({})];
  const tiempoExtra = [
    { keyId: '12345678', keyDia: '12345678|20260901', fecha: new Date(2026, 8, 1), yyyymmdd: '20260901', teMin: 120, heaMin: 60, finalesMin: 90, noReconocidasMin: 30, enDescanso: 0, _lote: 1 },
  ];
  const modelo = construirModelo({ personas, asistencia, tiempoExtra });
  const { controles } = calcularCalidad({
    filas: modelo.filas,
    personas,
    teResumen: modelo.teResumen,
    teDedup: modelo.teDedup,
    meta: { fechasInvalidas: 0 },
  });
  const errores = controles.filter((c) => !c.ok);
  assert.equal(errores.length, 0, 'Controles con error: ' + errores.map((e) => e.id).join(', '));
});

test('CT-13 detecta día sin cruce con Dotación', () => {
  const huerfano = reg({ keyId: '99999999', keyDia: '99999999|20260901' });
  const modelo = construirModelo({ personas, asistencia: [reg({}), huerfano], tiempoExtra: [] });
  const { controles } = calcularCalidad({
    filas: modelo.filas,
    personas,
    teResumen: modelo.teResumen,
    teDedup: modelo.teDedup,
  });
  const ct13 = controles.find((c) => c.id === 'CT-13');
  assert.equal(ct13.ok, false);
});
