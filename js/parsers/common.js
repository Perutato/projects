// =============================================================================
// parsers/common.js
// Funciones puras y compartidas por todos los parsers. No dependen del DOM ni
// de SheetJS, por lo que se pueden probar con pruebas unitarias en Node.
// =============================================================================

/**
 * Normaliza un encabezado para comparar: minúsculas, sin acentos, sin espacios
 * extra ni signos. Sirve para mapear columnas por nombre de forma tolerante.
 */
export function normHeader(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/\s+/g, ' ');
}

/**
 * Normaliza texto para comparaciones de contenido (sin acentos, minúsculas).
 */
export function normText(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza el Nº de documento según la regla de negocio:
 *  - Quita espacios.
 *  - Si es DNI y es numérico: rellena con ceros a la izquierda hasta 8 dígitos.
 *  - CE (u otro tipo): se deja tal cual.
 *  - Siempre se devuelve como TEXTO.
 * @param {string} doc      valor del documento
 * @param {string} tipoDoc  "DNI..." => DNI; cualquier otro => CE
 */
export function normalizeKeyId(doc, tipoDoc) {
  let raw = doc === null || doc === undefined ? '' : String(doc);
  raw = raw.replace(/\s+/g, '').trim();
  if (raw === '') return '';
  const esDni = normText(tipoDoc).includes('dni');
  if (esDni && /^\d+$/.test(raw)) {
    return raw.padStart(8, '0');
  }
  return raw;
}

/**
 * Convierte un texto "hh:mm" (o "hh:mm:ss") a minutos.
 * Acepta también valores numéricos (fracción de día de Excel o minutos).
 * Devuelve 0 para vacío.
 */
export function hhmmToMin(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 0;
    // Fracción de día de Excel (0..1) => minutos. Si es >= 1 se asume minutos.
    if (v > 0 && v < 1) return Math.round(v * 1440);
    return Math.round(v);
  }
  const s = String(v).trim();
  if (s === '' || s === '-' || s === '--') return 0;
  const m = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    return h * 60 + min;
  }
  // Puede venir como número en texto (ej. "90") => se asume minutos.
  const n = Number(s.replace(',', '.'));
  if (!Number.isNaN(n)) {
    if (n > 0 && n < 1) return Math.round(n * 1440);
    return Math.round(n);
  }
  return 0;
}

/** True si un valor de celda tiene texto no vacío. */
export function tieneTexto(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/** Convierte un valor numérico de celda de forma tolerante (coma/punto). */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parsea una fecha de Asistencia del tipo "Mar 01-09-2026".
 * (día de la semana abreviado + dd-mm-yyyy; puede traer "(F)" de feriado)
 * @returns {{date: Date|null, yyyymmdd: string, diaSemana: string,
 *            feriado: boolean, ok: boolean}}
 */
export function parseFechaAsistencia(v) {
  const res = { date: null, yyyymmdd: '', diaSemana: '', feriado: false, ok: false };
  if (!tieneTexto(v)) return res;
  // Si llega como objeto Date real (SheetJS con cellDates).
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    res.date = v;
    res.ok = true;
    res.yyyymmdd = toYyyymmdd(v);
    res.diaSemana = diaSemanaAbrev(v);
    return res;
  }
  const s = String(v).trim();
  res.feriado = s.includes('(F)');
  // Día de la semana: 3 primeras letras alfabéticas.
  const dm = s.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ]{2,})/);
  if (dm) res.diaSemana = dm[1].slice(0, 3);
  // dd-mm-yyyy (admite "/" como separador)
  const m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const yyyy = parseInt(m[3], 10);
    const d = new Date(yyyy, mm - 1, dd);
    if (!Number.isNaN(d.getTime())) {
      res.date = d;
      res.ok = true;
      res.yyyymmdd = `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`;
      if (!res.diaSemana) res.diaSemana = diaSemanaAbrev(d);
    }
  }
  return res;
}

/**
 * Parsea una fecha de Tiempo Extra. Puede venir como:
 *  - Date real (SheetJS cellDates)
 *  - texto "d/mm/yyyy" (día sin cero a la izquierda)
 *  - texto "dd-mm-yyyy"
 * @returns {{date: Date|null, yyyymmdd: string, ok: boolean}}
 */
export function parseFechaTE(v) {
  const res = { date: null, yyyymmdd: '', ok: false };
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    res.date = v;
    res.ok = true;
    res.yyyymmdd = toYyyymmdd(v);
    return res;
  }
  if (!tieneTexto(v)) return res;
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    let yyyy = parseInt(m[3], 10);
    if (yyyy < 100) yyyy += 2000; // año de 2 dígitos => 20xx
    const d = new Date(yyyy, mm - 1, dd);
    if (!Number.isNaN(d.getTime())) {
      res.date = d;
      res.ok = true;
      res.yyyymmdd = `${yyyy}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`;
    }
  }
  return res;
}

/**
 * Parsea una fecha genérica de Dotación (cese, puesto). Acepta Date o texto
 * dd-mm-yyyy / yyyy-mm-dd / d/m/yyyy.
 * @returns {Date|null}
 */
export function parseFechaGenerica(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (!tieneTexto(v)) return null;
  const s = String(v).trim();
  // yyyy-mm-dd
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // dd-mm-yyyy o d/m/yyyy
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Date => "yyyymmdd". */
export function toYyyymmdd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const DIAS_ABREV = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
/** Date => abreviatura de día de semana en español. */
export function diaSemanaAbrev(d) {
  return DIAS_ABREV[d.getDay()] || '';
}

/**
 * Semana ISO (lunes a domingo) a la que pertenece una fecha.
 * @returns {string} "yyyy-Www" (ej "2026-W36")
 */
export function semanaISO(d) {
  if (!(d instanceof Date)) return '';
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // lunes=1 ... domingo=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum); // jueves de esa semana
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Primer día del mes como "yyyy-mm". */
export function mesClave(d) {
  if (!(d instanceof Date)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Localiza la fila de encabezados dentro de un array-de-arrays, buscando la
 * primera fila que contenga TODOS los encabezados requeridos (normalizados).
 * @param {Array<Array>} aoa
 * @param {string[]} requeridos  encabezados (se normalizan internamente)
 * @returns {number} índice de fila, o -1 si no se encuentra
 */
export function encontrarFilaEncabezado(aoa, requeridos) {
  const req = requeridos.map(normHeader);
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const fila = (aoa[i] || []).map(normHeader);
    const setFila = new Set(fila);
    if (req.every((r) => setFila.has(r) || fila.some((c) => c.includes(r)))) {
      return i;
    }
  }
  return -1;
}

/**
 * Busca el índice de columna cuyo encabezado normalizado coincide (exacto o por
 * inclusión) con el buscado. Devuelve -1 si no existe.
 */
export function indiceColumna(filaEncabezado, buscado) {
  const b = normHeader(buscado);
  const norm = filaEncabezado.map(normHeader);
  let idx = norm.indexOf(b);
  if (idx >= 0) return idx;
  idx = norm.findIndex((c) => c.includes(b) || b.includes(c));
  return idx;
}
