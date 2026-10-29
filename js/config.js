// =============================================================================
// config.js
// Parámetros editables del Dashboard de Asistencia (Falabella Perú).
// Estos valores se pueden sobreescribir desde la pantalla "Parámetros" y se
// guardan en IndexedDB. Aquí viven únicamente los valores por defecto.
// =============================================================================

/**
 * Parámetros por defecto de la aplicación.
 * Toda la lógica de KPIs, alertas y calidad lee de aquí (o de la copia
 * sobreescrita por el usuario en IndexedDB), nunca de constantes "mágicas".
 */
export const DEFAULT_CONFIG = {
  // --- Semáforo de cumplimiento de malla (porcentajes 0-100) -----------------
  semaforoMalla: {
    cumpleMin: 95, // >= 95% => "Cumple" (verde)
    riesgoMin: 90, // 90% a 94.9% => "En riesgo" (ámbar); < 90% => "No cumple" (rojo)
  },

  // --- Tolerancia de exceso de refrigerio (minutos) --------------------------
  toleranciaRefrigerioMin: 10,

  // --- Sindicatos: si areaSindicato contiene alguno => sindicalizado = Sí ----
  sindicatos: ['SUTRASAF', 'SINTRASAF'],

  // --- Texto que identifica a los campañeros (en Tipo de contrato) -----------
  textoCampanero: 'Contrato de trabajo de temporada',

  // --- Mapeo de "Grupo de ubicación" a dashboard -----------------------------
  // Se evalúa por coincidencia (incluye, sin distinguir mayúsculas/acentos).
  mapeoDashboard: [
    { contiene: 'Sucursales y Tiendas', dashboard: 'Tienda' },
    { contiene: 'Centro de Distribución', dashboard: 'Logística' },
    { contiene: 'Bodega', dashboard: 'Logística' },
  ],
  dashboardPorDefecto: 'Otros', // el resto => "Otros" (excluido de dashboards)

  // --- Exclusión de días fuera del período de empleo -------------------------
  // Activado por defecto: sin esto la asistencia de campañeros cae a ~18%.
  excluirDiasAntesPuesto: true,
  excluirDiasPosterioresCese: true,

  // --- Definición de fuga ----------------------------------------------------
  // 'E1S2' = atrasoE1 + adelantoS2 ; '4marcas' = las 4 marcas.
  definicionFuga: 'E1S2',

  // --- Umbrales de alerta (valores por persona para el período analizado) ----
  umbralesAlerta: {
    faltasInjustificadas: 1,
    sinMarcacion: 3,
    marcacionIncompleta: 3,
    tardanzasE1: 5,
    trabajoEnDescanso: 1,
    trabajoSinTurno: 1,
    diasExcesoRefrigerio: 15,
  },

  // --- Criterios del nivel "Alta" -------------------------------------------
  nivelAlta: {
    faltas: 2, // >= 2 faltas
    sinMarcacion: 5, // o >= 5 días sin marcación
    tardanzas: 10, // o >= 10 tardanzas
    trabajoSinTurno: 1, // o >= 1 día trabajado sin turno
  },

  // --- Escalado de umbrales según granularidad -------------------------------
  // Factor multiplicador sobre los umbrales base. Permite ajustar cuando el
  // análisis es de un solo día o una semana (en vez de un mes completo).
  escalaUmbralPorGranularidad: {
    dia: 1,
    semana: 1,
    mes: 1,
  },

  // --- Horas contractuales -> jornada ----------------------------------------
  mapeoJornada: [
    { horas: 48, jornada: 'Full Time' },
    { horas: 19, jornada: 'Part Time' },
    { horas: 30, jornada: 'Practicante Pre Profesional' },
  ],
  jornadaPorDefecto: 'Revisar',
};

// =============================================================================
// Utilidades de formato es-PE
// =============================================================================

const _nfMiles = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
const _nfDec1 = new Intl.NumberFormat('es-PE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Formatea un entero con separador de miles es-PE (coma). */
export function fmtMiles(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return _nfMiles.format(Math.round(n));
}

/** Formatea un porcentaje (recibe 0-100) con 1 decimal. */
export function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return _nfDec1.format(n) + '%';
}

/** Formatea horas con 1 decimal. */
export function fmtHoras(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return _nfDec1.format(n);
}

/** Formatea un número con 1 decimal. */
export function fmtDec1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return _nfDec1.format(n);
}
