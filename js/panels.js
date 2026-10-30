// =============================================================================
// panels.js
// Interfaz de las vistas Complementarios y Alertas. Usa el patrón pedido/
// respuesta del worker (callWorker) y las exportaciones a Excel/CSV.
// =============================================================================

import { fmtMiles, fmtPct, fmtDec1 } from './config.js';
import { exportarCSV, exportarExcelHojas, exportarExcelPorGrupo, hojaRegistro, hojaResumenIncidencias } from './exports.js';
import { icon, help } from './icons.js';

// Columnas de los cortes por segmento (las 12 métricas).
const COLS_SEG = [
  { key: 'clave', label: 'Segmento', tipo: 'txt' },
  { key: 'personas', label: 'Personas', tipo: 'int', tip: 'Personas únicas (keyID) en el segmento.' },
  { key: 'diasEsperados', label: 'Días esp.', tipo: 'int', tip: 'Σ días esperados (Asistió, Falta injustificada, Sin marcación o Marcación incompleta).' },
  { key: 'presentes', label: 'Presentes', tipo: 'int', tip: 'Σ días presentes (Asistió o Marcación incompleta).' },
  { key: 'pctAsistencia', label: '% Asist.', tipo: 'pct', tip: 'Σ presentes ÷ Σ días esperados.' },
  { key: 'tardanzas', label: 'Tardanzas', tipo: 'int', tip: 'Σ días con atraso en la primera entrada (E1).' },
  { key: 'pctTardanza', label: '% Tard.', tipo: 'pct', tip: 'Σ tardanzas ÷ Σ presentes.' },
  { key: 'faltas', label: 'Faltas', tipo: 'int', tip: 'Días con estado Falta injustificada.' },
  { key: 'sinMarcacion', label: 'Sin marc.', tipo: 'int', tip: 'Días con turno pero sin ninguna marca.' },
  { key: 'trabajoEnDescanso', label: 'Trab. desc.', tipo: 'int', tip: 'Días con turno Descanso y al menos una marca.' },
  { key: 'excesoRefrigerio', label: 'Exc. refr.', tipo: 'int', tip: 'Días con exceso de refrigerio sobre la tolerancia.' },
  { key: 'sinTurno', label: 'Sin turno', tipo: 'int', tip: 'Días trabajados sin turno planificado.' },
  { key: 'feriadoTrabajado', label: 'Feriado trab.', tipo: 'int', tip: 'Días feriados con trabajo.' },
];

const COLS_ALERTA = [
  { key: 'keyId', label: 'KeyID', tipo: 'txt' },
  { key: 'nombre', label: 'Nombre', tipo: 'txt' },
  { key: 'sucursal', label: 'Sucursal', tipo: 'txt' },
  { key: 'dashboard', label: 'Dashboard', tipo: 'txt' },
  { key: 'jefe', label: 'Jefe', tipo: 'txt' },
  { key: 'cargo', label: 'Cargo', tipo: 'txt' },
  { key: 'faltas', label: 'Faltas', tipo: 'int', tip: 'Días con Falta injustificada en el período.' },
  { key: 'sinMarcacion', label: 'Sin marc.', tipo: 'int', tip: 'Días con turno pero sin ninguna marca.' },
  { key: 'marcacionIncompleta', label: 'Marc. inc.', tipo: 'int', tip: 'Días con marcación iniciada pero incompleta.' },
  { key: 'tardanzas', label: 'Tardanzas', tipo: 'int', tip: 'Días con atraso en la primera entrada (E1).' },
  { key: 'trabajoEnDescanso', label: 'Trab. desc.', tipo: 'int', tip: 'Días trabajados en descanso.' },
  { key: 'trabajoSinTurno', label: 'Sin turno', tipo: 'int', tip: 'Días trabajados sin turno planificado.' },
  { key: 'excesoRefrigerio', label: 'Exc. refr.', tipo: 'int', tip: 'Días con exceso de refrigerio sobre la tolerancia.' },
  { key: 'reincidencia', label: 'Reincid.', tipo: 'int', tip: 'Máx. de semanas consecutivas con alerta.' },
  { key: 'nivel', label: 'Nivel', tipo: 'nivel', tip: 'Alta si ≥2 faltas, ≥5 sin marcación, ≥10 tardanzas o ≥1 sin turno; si no, Media.' },
  { key: 'motivos', label: 'Motivos', tipo: 'txt', tip: 'Umbrales superados por la persona.' },
];

export function crearPaneles({ callWorker, getCfg }) {
  let opciones = null;
  const estComp = { dashboard: '', fechaDesde: null, fechaHasta: null };
  const estAlerta = { dashboard: '', fechaDesde: null, fechaHasta: null, escala: 'mes', escalaModo: 'auto' };
  let ultComp = null;
  let ultAlerta = null;
  let ordenAlerta = { campo: null, dir: -1 };

  function setOpciones(op) { opciones = op; }

  // ---- Complementarios -----------------------------------------------------
  async function renderComplementarios() {
    const cont = document.getElementById('vista-complementarios');
    if (!opciones) { cont.innerHTML = '<div class="proxima">Carga datos para ver los complementarios.</div>'; return; }
    cont.innerHTML = `
      <header class="vista-head"><h1>Complementarios</h1>
        <div class="acciones"><button class="btn" data-exp-comp>${icon('download')}<span>Exportar Excel</span></button></div>
      </header>
      <div class="filtros" data-filtros></div>
      <div data-cuerpo><p class="vacio">Calculando…</p></div>`;
    cablearFiltrosSimples(cont, estComp, () => actualizarComp(cont));
    cont.querySelector('[data-exp-comp]').addEventListener('click', exportarComplementarios);
    await actualizarComp(cont);
  }

  async function actualizarComp(cont) {
    const data = await callWorker('complementarios', { filtros: estComp, cfg: getCfg() });
    ultComp = data;
    const cuerpo = cont.querySelector('[data-cuerpo]');
    const seg = (titulo, filas, claveLbl) => tablaSeg(titulo, filas, claveLbl);
    cuerpo.innerHTML = `
      <p class="nota">Base: ${fmtMiles(data.nFilas)} días persona-día (Tienda + Logística).</p>
      ${seg('Por campañero', data.campanero, 'Campañero')}
      ${seg('Por sindicalizado', data.sindicalizado, 'Sindicalizado')}
      ${seg('Por jornada', data.jornada, 'Jornada')}
      ${seg('Por modelo de días', data.modeloDias, 'Modelo')}
      ${seg('Por calendario de festivos', data.calendario, 'Calendario')}
      ${seg('Top 15 jefes directos (por tardanzas)', data.jefes, 'Jefe')}
      <h2>Puntos de marcación</h2>
      ${tablaGenerica(
        ['Punto', 'Días', '% s/ presentes', 'Min totales', 'Promedio', 'Máximo'],
        data.puntosMarcacion.map((p) => [p.punto, fmtMiles(p.dias), fmtPct(p.pctPresentes), fmtMiles(p.minTotales), fmtDec1(p.promedio), fmtMiles(p.maximo)]),
        ['E1 ingreso, S1 salida a refrigerio, E2 retorno de refrigerio, S2 salida final.', 'Días con minutos > 0 en ese punto.', 'Días con el evento ÷ Σ días presentes.', 'Σ minutos del evento.', 'Min totales ÷ días con el evento.', 'Máximo de minutos en un día.']
      )}
      <h2>Distribución por rango de atraso</h2>
      ${tablaGenerica(['Rango', 'Días', 'Personas'], data.rangoAtraso.map((r) => [r.rango, fmtMiles(r.dias), fmtMiles(r.personas)]), ['Rango de minutos de atraso en E1.', 'Días en ese rango.', 'Personas únicas en ese rango.'])}
      <h2>Categorías de permiso</h2>
      ${tablaGenerica(['Categoría', 'Días', 'Personas'], data.permisos.map((r) => [r.categoria, fmtMiles(r.dias), fmtMiles(r.personas)]), ['Categoría del permiso del día.', 'Días con esa categoría.', 'Personas únicas.'])}
      <h2>Feriados trabajados por calendario</h2>
      ${tablaGenerica(['Calendario', 'Días feriado', 'Feriados trabajados', 'Personas'], data.feriados.map((r) => [r.calendario, fmtMiles(r.diasFeriado), fmtMiles(r.feriadosTrabajados), fmtMiles(r.personas)]), ['Calendario de festivos de la persona.', 'Días marcados como feriado (F) en la data.', 'Días feriados con trabajo (≥1 marca).', 'Personas que trabajaron en feriado.'])}`;
  }

  function tablaSeg(titulo, filas, claveLbl) {
    const cols = COLS_SEG.map((c) => (c.key === 'clave' ? { ...c, label: claveLbl } : c));
    const th = cols.map((c) => `<th class="${c.tipo !== 'txt' ? 'num' : ''}">${c.label}${help(c.tip)}</th>`).join('');
    const tr = filas.map((f) => `<tr>${cols.map((c) => `<td class="${c.tipo !== 'txt' ? 'num' : ''}">${fmtVal(f[c.key], c.tipo)}</td>`).join('')}</tr>`).join('');
    return `<section class="panel"><h3>${titulo}</h3><div class="tabla-scroll"><table class="tabla"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div></section>`;
  }

  async function exportarComplementarios() {
    if (!ultComp) return;
    const colSeg = COLS_SEG.map((c) => c.key);
    const titSeg = COLS_SEG.map((c) => c.label);
    const limpiar = (arr) => arr.map((f) => {
      const o = {};
      for (const c of COLS_SEG) o[c.key] = c.tipo === 'pct' ? +(+f[c.key]).toFixed(1) : c.tipo === 'txt' ? f[c.key] : f[c.key];
      return o;
    });
    const hojas = [
      { nombre: 'Campañero', columnas: colSeg, titulos: titSeg, filas: limpiar(ultComp.campanero) },
      { nombre: 'Sindicalizado', columnas: colSeg, titulos: titSeg, filas: limpiar(ultComp.sindicalizado) },
      { nombre: 'Jornada', columnas: colSeg, titulos: titSeg, filas: limpiar(ultComp.jornada) },
      { nombre: 'Modelo de dias', columnas: colSeg, titulos: titSeg, filas: limpiar(ultComp.modeloDias) },
      { nombre: 'Calendario', columnas: colSeg, titulos: titSeg, filas: limpiar(ultComp.calendario) },
      { nombre: 'Jefes', columnas: colSeg, titulos: titSeg, filas: limpiar(ultComp.jefes) },
      { nombre: 'Puntos marcacion', columnas: ['punto', 'dias', 'pctPresentes', 'minTotales', 'promedio', 'maximo'], titulos: ['Punto', 'Días', '% s/ presentes', 'Min totales', 'Promedio', 'Máximo'], filas: ultComp.puntosMarcacion.map((p) => ({ ...p, pctPresentes: +p.pctPresentes.toFixed(1), promedio: +p.promedio.toFixed(1) })) },
      { nombre: 'Rango atraso', columnas: ['rango', 'dias', 'personas'], titulos: ['Rango', 'Días', 'Personas'], filas: ultComp.rangoAtraso },
      { nombre: 'Permisos', columnas: ['categoria', 'dias', 'personas'], titulos: ['Categoría', 'Días', 'Personas'], filas: ultComp.permisos },
      { nombre: 'Feriados', columnas: ['calendario', 'diasFeriado', 'feriadosTrabajados', 'personas'], titulos: ['Calendario', 'Días feriado', 'Feriados trabajados', 'Personas'], filas: ultComp.feriados },
    ];
    // Registro día por día de las incidencias del mismo filtro.
    const reg = await callWorker('registro', { filtros: estComp, cfg: getCfg() });
    await exportarExcelHojas(`Complementarios_${hoy()}`, [...hojas, hojaResumenIncidencias(reg), hojaRegistro(reg)]);
  }

  // ---- Alertas -------------------------------------------------------------
  async function renderAlertas() {
    const cont = document.getElementById('vista-alertas');
    if (!opciones) { cont.innerHTML = '<div class="proxima">Carga datos para ver las alertas.</div>'; return; }
    cont.innerHTML = `
      <header class="vista-head"><h1>Alertas por persona</h1>
        <div class="acciones">
          <button class="btn btn-sec" data-exp-csv>${icon('download')}<span>CSV</span></button>
          <button class="btn btn-sec" data-exp-jefe>${icon('download')}<span>Excel por jefe</span></button>
          <button class="btn" data-exp-xls>${icon('download')}<span>Excel con registro</span></button>
        </div>
      </header>
      <div class="filtros" data-filtros></div>
      <div data-resumen></div>
      <div class="herramientas"><label class="busqueda">${icon('search')}<input type="search" class="input" placeholder="Buscar persona, sucursal o jefe" aria-label="Buscar persona" data-buscar /></label></div>
      <div data-tabla><p class="vacio">Calculando…</p></div>`;
    cablearFiltrosSimples(cont, estAlerta, () => actualizarAlertas(cont), true);
    cont.querySelector('[data-exp-csv]').addEventListener('click', exportarAlertasCSV);
    cont.querySelector('[data-exp-jefe]').addEventListener('click', exportarAlertasPorJefe);
    cont.querySelector('[data-exp-xls]').addEventListener('click', exportarAlertasExcel);
    const buscar = cont.querySelector('[data-buscar]');
    buscar.addEventListener('input', () => pintarTablaAlertas(cont, buscar.value));
    await actualizarAlertas(cont);
  }

  async function actualizarAlertas(cont) {
    if (estAlerta.escalaModo === 'auto') estAlerta.escala = escalaPorRango(estAlerta);
    const data = await callWorker('alertas', { filtros: estAlerta, cfg: getCfg() });
    ultAlerta = data;
    const res = cont.querySelector('[data-resumen]');
    const u = data.umbrales;
    res.innerHTML = `
      <div class="cifras">
        <div class="cifra-item"><span class="tile-lbl">Personas con alerta</span><span class="tile-val">${fmtMiles(data.resumen.total)}</span></div>
        <div class="cifra-item"><span class="tile-lbl">Nivel alto</span><span class="tile-val">${fmtMiles(data.resumen.altas)}</span><span class="estado estado-crit">${icon('warning', 'ico-xs')}Alta</span></div>
        <div class="cifra-item"><span class="tile-lbl">Nivel medio</span><span class="tile-val">${fmtMiles(data.resumen.medias)}</span><span class="estado estado-warn">${icon('warning', 'ico-xs')}Media</span></div>
      </div>
      <p class="nota">Umbrales aplicados (escala ${ESCALA_LBL[data.escala] || data.escala}${estAlerta.escalaModo === 'auto' ? ', elegida según el rango de fechas' : ''}): faltas ≥ ${u.faltasInjustificadas}, sin marcación ≥ ${u.sinMarcacion}, marcación incompleta ≥ ${u.marcacionIncompleta}, tardanzas ≥ ${u.tardanzasE1}, trabajó en descanso ≥ ${u.trabajoEnDescanso}, sin turno ≥ ${u.trabajoSinTurno}, exceso refrigerio ≥ ${u.diasExcesoRefrigerio}.</p>`;
    pintarTablaAlertas(cont, (cont.querySelector('[data-buscar]').value || ''));
  }

  function pintarTablaAlertas(cont, filtroTxt) {
    if (!ultAlerta) return;
    const q = (filtroTxt || '').toLowerCase();
    let filas = ultAlerta.alertas.slice();
    if (q) filas = filas.filter((a) => (a.nombre + ' ' + a.sucursal + ' ' + a.jefe + ' ' + a.keyId).toLowerCase().includes(q));
    if (ordenAlerta.campo) {
      const { campo, dir } = ordenAlerta;
      filas.sort((a, b) => (typeof a[campo] === 'string' ? a[campo].localeCompare(b[campo]) : a[campo] - b[campo]) * dir);
    }
    const host = cont.querySelector('[data-tabla]');
    if (!filas.length) { host.innerHTML = '<p class="vacio">No hay personas que superen los umbrales.</p>'; return; }
    const th = COLS_ALERTA.map((c) => `<th class="${c.tipo === 'int' ? 'num' : ''}"><button type="button" class="th-orden" data-ord="${c.key}">${c.label}${ordenAlerta.campo === c.key ? icon(dirIco(ordenAlerta.dir), 'ico-xs') : ''}</button>${help(c.tip)}</th>`).join('');
    const tr = filas.slice(0, 2000).map((a) => `<tr>${COLS_ALERTA.map((c) => celdaAlerta(a, c)).join('')}</tr>`).join('');
    host.innerHTML = `<div class="tabla-alertas-wrap"><table class="tabla tabla-alertas"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>${filas.length > 2000 ? `<p class="nota">Mostrando 2.000 de ${fmtMiles(filas.length)}.</p>` : ''}`;
    host.querySelectorAll('[data-ord]').forEach((h) => h.addEventListener('click', () => {
      const k = h.dataset.ord;
      ordenAlerta = { campo: k, dir: ordenAlerta.campo === k ? -ordenAlerta.dir : (COLS_ALERTA.find((c) => c.key === k).tipo === 'txt' ? 1 : -1) };
      pintarTablaAlertas(cont, filtroTxt);
      host.querySelector(`[data-ord="${k}"]`).focus();
    }));
  }
  function dirIco(dir) { return dir === -1 ? 'down' : 'up'; }

  function celdaAlerta(a, c) {
    if (c.tipo === 'nivel') {
      const clase = a.nivel === 'Alta' ? 'estado-crit' : 'estado-warn';
      return `<td><span class="estado ${clase}">${icon('warning', 'ico-xs')}${a.nivel}</span></td>`;
    }
    if (c.tipo === 'int') return `<td class="num">${fmtMiles(a[c.key])}</td>`;
    return `<td>${esc(a[c.key])}</td>`;
  }

  // Registro día por día de las incidencias que cuentan para las alertas,
  // solo de las personas con alerta.
  const TIPOS_ALERTA = ['falta', 'sinMarcacion', 'marcIncompleta', 'tardanza', 'descanso', 'sinTurno', 'exceso'];
  async function registroAlertas() {
    const { escala, escalaModo, ...filtros } = estAlerta;
    return callWorker('registro', { filtros, cfg: getCfg(), keyIds: ultAlerta.alertas.map((a) => a.keyId), tipos: TIPOS_ALERTA });
  }
  // Columnas de alertas + "Fechas de las incidencias" (qué días fue cada una).
  function alertasConFechas(reg, sinJefe = false) {
    const cols = COLS_ALERTA.filter((c) => !(sinJefe && c.key === 'jefe'));
    return {
      columnas: [...cols.map((c) => c.key), 'fechas'],
      titulos: [...cols.map((c) => c.label), 'Fechas de las incidencias'],
      filas: ultAlerta.alertas.map((a) => ({ ...a, fechas: reg.fechas[a.keyId] || '' })),
    };
  }

  async function exportarAlertasCSV() {
    if (!ultAlerta) return;
    const t = alertasConFechas(await registroAlertas());
    exportarCSV(`Alertas_${hoy()}`, t.columnas, t.filas, t.titulos);
  }
  async function exportarAlertasExcel() {
    if (!ultAlerta) return;
    const reg = await registroAlertas();
    const t = alertasConFechas(reg);
    await exportarExcelHojas(`Alertas_${hoy()}`, [
      { nombre: 'Alertas', ...t },
      hojaRegistro(reg),
      hojaResumenIncidencias(reg),
    ]);
  }
  async function exportarAlertasPorJefe() {
    if (!ultAlerta) return;
    const reg = await registroAlertas();
    const t = alertasConFechas(reg, true);
    await exportarExcelPorGrupo(`Alertas_por_jefe_${hoy()}`, 'jefe', t.columnas, t.filas, t.titulos, [hojaRegistro(reg)]);
  }

  // ---- Barra de filtros simple (compartida) --------------------------------
  function cablearFiltrosSimples(cont, est, onChange, conEscala = false) {
    const caja = cont.querySelector('[data-filtros]');
    const preset = presetDe(est);
    const seg = (v, lbl) => `<button type="button" data-rango="${v}" class="${preset === v ? 'activo' : ''}" aria-pressed="${preset === v}">${lbl}</button>`;
    caja.innerHTML = `
      <div class="filtros-fila">
        <label class="fgrupo"><span class="flbl">Dashboard</span><select data-dash>
          <option value="">Tienda + Logística</option>
          <option value="Tienda" ${est.dashboard === 'Tienda' ? 'selected' : ''}>Tienda</option>
          <option value="Logística" ${est.dashboard === 'Logística' ? 'selected' : ''}>Logística</option>
        </select></label>
        <div class="fgrupo"><span class="flbl">Período</span><div class="segment">
          ${seg('dia', 'Último día')}${seg('semana', 'Última semana')}${seg('mes', 'Mes')}${seg('todo', 'Todo')}
        </div></div>
        <label class="fgrupo"><span class="flbl">Desde</span><input type="date" data-desde value="${isoDate(est.fechaDesde)}" /></label>
        <label class="fgrupo"><span class="flbl">Hasta</span><input type="date" data-hasta value="${isoDate(est.fechaHasta)}" /></label>
        ${conEscala ? `<label class="fgrupo"><span class="flbl">Escala de umbrales${help('Los umbrales están pensados para un mes. Con un rango de un día o una semana se multiplican por el factor de Parámetros (Día 0,05 · Semana 0,25), con un mínimo de 1.')}</span><select data-escala>
          <option value="auto" ${est.escalaModo === 'auto' ? 'selected' : ''}>Según el rango</option>
          <option value="mes" ${est.escalaModo === 'mes' ? 'selected' : ''}>Mes</option>
          <option value="semana" ${est.escalaModo === 'semana' ? 'selected' : ''}>Semana</option>
          <option value="dia" ${est.escalaModo === 'dia' ? 'selected' : ''}>Día</option>
        </select></label>` : ''}
      </div>`;
    const repintar = () => { cablearFiltrosSimples(cont, est, onChange, conEscala); onChange(); };
    caja.querySelector('[data-dash]').addEventListener('change', (e) => { est.dashboard = e.target.value; onChange(); });
    const dDesde = caja.querySelector('[data-desde]');
    const dHasta = caja.querySelector('[data-hasta]');
    const onFecha = () => { est.fechaDesde = dDesde.value ? dDesde.value.replace(/-/g, '') : null; est.fechaHasta = dHasta.value ? dHasta.value.replace(/-/g, '') : null; repintar(); };
    dDesde.addEventListener('change', onFecha);
    dHasta.addEventListener('change', onFecha);
    caja.querySelectorAll('[data-rango]').forEach((b) => b.addEventListener('click', () => {
      aplicarPreseleccion(est, b.dataset.rango);
      repintar();
    }));
    if (conEscala) caja.querySelector('[data-escala]').addEventListener('change', (e) => {
      est.escalaModo = e.target.value;
      if (est.escalaModo !== 'auto') est.escala = est.escalaModo;
      onChange();
    });
  }

  function aplicarPreseleccion(est, tipo) {
    const max = opciones.fechaMax;
    const min = opciones.fechaMin;
    if (!max) return;
    if (tipo === 'todo') { est.fechaDesde = null; est.fechaHasta = null; return; }
    let desde = max;
    if (tipo === 'semana') desde = ymd(new Date(fecha(max).getTime() - 6 * 86400000));
    else if (tipo === 'mes') desde = max.slice(0, 6) + '01'; // mes calendario de la última fecha
    est.fechaDesde = desde < min ? min : desde;
    est.fechaHasta = max;
  }
  function presetDe(est) {
    const max = opciones.fechaMax;
    if (!est.fechaDesde && !est.fechaHasta) return 'todo';
    if (est.fechaHasta !== max) return '';
    const min = opciones.fechaMin;
    const piso = (x) => (x < min ? min : x);
    if (est.fechaDesde === max) return 'dia';
    if (est.fechaDesde === piso(ymd(new Date(fecha(max).getTime() - 6 * 86400000)))) return 'semana';
    if (est.fechaDesde === piso(max.slice(0, 6) + '01')) return 'mes';
    return '';
  }
  // Escala automática: 1 día → día; hasta 7 días → semana; más → mes.
  function escalaPorRango(est) {
    const a = est.fechaDesde || opciones.fechaMin;
    const b = est.fechaHasta || opciones.fechaMax;
    if (!a || !b) return 'mes';
    const dias = Math.round((fecha(b) - fecha(a)) / 86400000) + 1;
    return dias <= 1 ? 'dia' : dias <= 7 ? 'semana' : 'mes';
  }

  return { setOpciones, renderComplementarios, renderAlertas };
}

// --- Utilidades --------------------------------------------------------------
const ESCALA_LBL = { dia: 'día', semana: 'semana', mes: 'mes' };
function fecha(s) { return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }
function ymd(x) { return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`; }
function tablaGenerica(titulos, filas, tips) {
  const th = titulos.map((t, i) => `<th class="${i === 0 ? '' : 'num'}">${t}${tips && tips[i] ? help(tips[i]) : ''}</th>`).join('');
  const tr = filas.map((f) => `<tr>${f.map((v, i) => `<td class="${i === 0 ? '' : 'num'}">${esc(v)}</td>`).join('')}</tr>`).join('');
  return `<div class="tabla-scroll"><table class="tabla"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
function fmtVal(v, tipo) {
  if (tipo === 'pct') return fmtPct(v);
  if (tipo === 'int') return fmtMiles(v);
  return esc(v);
}
function isoDate(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
function hoy() { return new Date().toISOString().slice(0, 10); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
