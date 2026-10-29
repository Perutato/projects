// =============================================================================
// panels.js
// Interfaz de las vistas Complementarios y Alertas. Usa el patrón pedido/
// respuesta del worker (callWorker) y las exportaciones a Excel/CSV.
// =============================================================================

import { fmtMiles, fmtPct, fmtDec1 } from './config.js';
import { exportarExcel, exportarCSV, exportarExcelHojas, exportarExcelPorGrupo } from './exports.js';
import { icon } from './icons.js';

// Columnas de los cortes por segmento (las 12 métricas).
const COLS_SEG = [
  { key: 'clave', label: 'Segmento', tipo: 'txt' },
  { key: 'personas', label: 'Personas', tipo: 'int' },
  { key: 'diasEsperados', label: 'Días esp.', tipo: 'int' },
  { key: 'presentes', label: 'Presentes', tipo: 'int' },
  { key: 'pctAsistencia', label: '% Asist.', tipo: 'pct' },
  { key: 'tardanzas', label: 'Tardanzas', tipo: 'int' },
  { key: 'pctTardanza', label: '% Tard.', tipo: 'pct' },
  { key: 'faltas', label: 'Faltas', tipo: 'int' },
  { key: 'sinMarcacion', label: 'Sin marc.', tipo: 'int' },
  { key: 'trabajoEnDescanso', label: 'Trab. desc.', tipo: 'int' },
  { key: 'excesoRefrigerio', label: 'Exc. refr.', tipo: 'int' },
  { key: 'sinTurno', label: 'Sin turno', tipo: 'int' },
  { key: 'feriadoTrabajado', label: 'Feriado trab.', tipo: 'int' },
];

const COLS_ALERTA = [
  { key: 'keyId', label: 'KeyID', tipo: 'txt' },
  { key: 'nombre', label: 'Nombre', tipo: 'txt' },
  { key: 'sucursal', label: 'Sucursal', tipo: 'txt' },
  { key: 'dashboard', label: 'Dashboard', tipo: 'txt' },
  { key: 'jefe', label: 'Jefe', tipo: 'txt' },
  { key: 'cargo', label: 'Cargo', tipo: 'txt' },
  { key: 'faltas', label: 'Faltas', tipo: 'int' },
  { key: 'sinMarcacion', label: 'Sin marc.', tipo: 'int' },
  { key: 'marcacionIncompleta', label: 'Marc. inc.', tipo: 'int' },
  { key: 'tardanzas', label: 'Tardanzas', tipo: 'int' },
  { key: 'trabajoEnDescanso', label: 'Trab. desc.', tipo: 'int' },
  { key: 'trabajoSinTurno', label: 'Sin turno', tipo: 'int' },
  { key: 'excesoRefrigerio', label: 'Exc. refr.', tipo: 'int' },
  { key: 'reincidencia', label: 'Reincid.', tipo: 'int' },
  { key: 'nivel', label: 'Nivel', tipo: 'nivel' },
  { key: 'motivos', label: 'Motivos', tipo: 'txt' },
];

export function crearPaneles({ callWorker, getCfg }) {
  let opciones = null;
  const estComp = { dashboard: '', fechaDesde: null, fechaHasta: null };
  const estAlerta = { dashboard: '', fechaDesde: null, fechaHasta: null, escala: 'mes' };
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
        data.puntosMarcacion.map((p) => [p.punto, fmtMiles(p.dias), fmtPct(p.pctPresentes), fmtMiles(p.minTotales), fmtDec1(p.promedio), fmtMiles(p.maximo)])
      )}
      <h2>Distribución por rango de atraso</h2>
      ${tablaGenerica(['Rango', 'Días', 'Personas'], data.rangoAtraso.map((r) => [r.rango, fmtMiles(r.dias), fmtMiles(r.personas)]))}
      <h2>Categorías de permiso</h2>
      ${tablaGenerica(['Categoría', 'Días', 'Personas'], data.permisos.map((r) => [r.categoria, fmtMiles(r.dias), fmtMiles(r.personas)]))}
      <h2>Feriados trabajados por calendario</h2>
      ${tablaGenerica(['Calendario', 'Días feriado', 'Feriados trabajados', 'Personas'], data.feriados.map((r) => [r.calendario, fmtMiles(r.diasFeriado), fmtMiles(r.feriadosTrabajados), fmtMiles(r.personas)]))}`;
  }

  function tablaSeg(titulo, filas, claveLbl) {
    const cols = COLS_SEG.map((c) => (c.key === 'clave' ? { ...c, label: claveLbl } : c));
    const th = cols.map((c) => `<th class="${c.tipo !== 'txt' ? 'num' : ''}">${c.label}</th>`).join('');
    const tr = filas.map((f) => `<tr>${cols.map((c) => `<td class="${c.tipo !== 'txt' ? 'num' : ''}">${fmtVal(f[c.key], c.tipo)}</td>`).join('')}</tr>`).join('');
    return `<h2>${titulo}</h2><div class="tabla-scroll"><table class="tabla">${`<thead><tr>${th}</tr></thead>`}<tbody>${tr}</tbody></table></div>`;
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
    await exportarExcelHojas(`Complementarios_${hoy()}`, hojas);
  }

  // ---- Alertas -------------------------------------------------------------
  async function renderAlertas() {
    const cont = document.getElementById('vista-alertas');
    if (!opciones) { cont.innerHTML = '<div class="proxima">Carga datos para ver las alertas.</div>'; return; }
    cont.innerHTML = `
      <header class="vista-head"><h1>Alertas por persona</h1>
        <div class="acciones">
          <button class="btn btn-sec" data-exp-csv>${icon('download')}<span>Exportar CSV</span></button>
          <button class="btn" data-exp-jefe>${icon('download')}<span>Por jefe (Excel)</span></button>
        </div>
      </header>
      <div class="filtros" data-filtros></div>
      <div data-resumen></div>
      <div class="tabla-herramientas"><span class="busqueda-wrap">${icon('search')}<input type="search" placeholder="Buscar persona / sucursal / jefe…" data-buscar class="input-busqueda" /></span></div>
      <div data-tabla><p class="vacio">Calculando…</p></div>`;
    cablearFiltrosSimples(cont, estAlerta, () => actualizarAlertas(cont), true);
    cont.querySelector('[data-exp-csv]').addEventListener('click', exportarAlertasCSV);
    cont.querySelector('[data-exp-jefe]').addEventListener('click', exportarAlertasPorJefe);
    const buscar = cont.querySelector('[data-buscar]');
    buscar.addEventListener('input', () => pintarTablaAlertas(cont, buscar.value));
    await actualizarAlertas(cont);
  }

  async function actualizarAlertas(cont) {
    const data = await callWorker('alertas', { filtros: estAlerta, cfg: getCfg() });
    ultAlerta = data;
    const res = cont.querySelector('[data-resumen]');
    const u = data.umbrales;
    res.innerHTML = `
      <div class="chips">
        <span class="chip chip-total">${fmtMiles(data.resumen.total)} con alerta</span>
        <span class="chip chip-alta">${fmtMiles(data.resumen.altas)} Alta</span>
        <span class="chip chip-media">${fmtMiles(data.resumen.medias)} Media</span>
      </div>
      <p class="nota">Umbrales aplicados (escala ${data.escala}): faltas ≥ ${u.faltasInjustificadas}, sin marcación ≥ ${u.sinMarcacion}, marcación incompleta ≥ ${u.marcacionIncompleta}, tardanzas ≥ ${u.tardanzasE1}, trabajó en descanso ≥ ${u.trabajoEnDescanso}, sin turno ≥ ${u.trabajoSinTurno}, exceso refrigerio ≥ ${u.diasExcesoRefrigerio}.</p>`;
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
    const th = COLS_ALERTA.map((c) => `<th data-ord="${c.key}" class="orden ${c.tipo === 'int' ? 'num' : ''} ${ordenAlerta.campo === c.key ? 'ordenado' : ''}">${c.label}${ordenAlerta.campo === c.key ? icon(dirIco(ordenAlerta.dir), 'ico-xs') : ''}</th>`).join('');
    const tr = filas.slice(0, 2000).map((a) => `<tr>${COLS_ALERTA.map((c) => celdaAlerta(a, c)).join('')}</tr>`).join('');
    host.innerHTML = `<div class="tabla-alertas-wrap"><table class="tabla tabla-alertas"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>${filas.length > 2000 ? `<p class="nota">Mostrando 2.000 de ${fmtMiles(filas.length)}.</p>` : ''}`;
    host.querySelectorAll('th[data-ord]').forEach((h) => h.addEventListener('click', () => {
      const k = h.dataset.ord;
      ordenAlerta = { campo: k, dir: ordenAlerta.campo === k ? -ordenAlerta.dir : (COLS_ALERTA.find((c) => c.key === k).tipo === 'txt' ? 1 : -1) };
      pintarTablaAlertas(cont, filtroTxt);
    }));
  }
  function dirIco(dir) { return dir === -1 ? 'down' : 'up'; }

  function celdaAlerta(a, c) {
    if (c.tipo === 'nivel') {
      const clase = a.nivel === 'Alta' ? 'sem-rojo' : 'sem-amber';
      return `<td><span class="sem ${clase}">${a.nivel}</span></td>`;
    }
    if (c.tipo === 'int') return `<td class="num">${fmtMiles(a[c.key])}</td>`;
    return `<td>${esc(a[c.key])}</td>`;
  }

  function exportarAlertasCSV() {
    if (!ultAlerta) return;
    const cols = COLS_ALERTA.map((c) => c.key);
    const tit = COLS_ALERTA.map((c) => c.label);
    exportarCSV(`Alertas_${hoy()}`, cols, ultAlerta.alertas, tit);
  }
  async function exportarAlertasPorJefe() {
    if (!ultAlerta) return;
    const cols = COLS_ALERTA.filter((c) => c.key !== 'jefe').map((c) => c.key);
    const tit = COLS_ALERTA.filter((c) => c.key !== 'jefe').map((c) => c.label);
    await exportarExcelPorGrupo(`Alertas_por_jefe_${hoy()}`, 'jefe', cols, ultAlerta.alertas, tit);
  }

  // ---- Barra de filtros simple (compartida) --------------------------------
  function cablearFiltrosSimples(cont, est, onChange, conEscala = false) {
    const caja = cont.querySelector('[data-filtros]');
    caja.innerHTML = `
      <div class="fila-filtros">
        <div class="fgrupo"><label>Dashboard</label><select data-dash>
          <option value="">Tienda + Logística</option>
          <option value="Tienda" ${est.dashboard === 'Tienda' ? 'selected' : ''}>Tienda</option>
          <option value="Logística" ${est.dashboard === 'Logística' ? 'selected' : ''}>Logística</option>
        </select></div>
        <div class="fgrupo"><label>Rango</label><div class="segment">
          <button data-rango="dia">Último día</button>
          <button data-rango="semana">Última semana</button>
          <button data-rango="mes">Último mes</button>
          <button data-rango="todo">Todo</button>
        </div></div>
        <div class="fgrupo"><label>Desde</label><input type="date" data-desde value="${isoDate(est.fechaDesde)}" /></div>
        <div class="fgrupo"><label>Hasta</label><input type="date" data-hasta value="${isoDate(est.fechaHasta)}" /></div>
        ${conEscala ? `<div class="fgrupo"><label>Escala de umbrales</label><select data-escala>
          <option value="mes" ${est.escala === 'mes' ? 'selected' : ''}>Mes</option>
          <option value="semana" ${est.escala === 'semana' ? 'selected' : ''}>Semana</option>
          <option value="dia" ${est.escala === 'dia' ? 'selected' : ''}>Día</option>
        </select></div>` : ''}
      </div>`;
    caja.querySelector('[data-dash]').addEventListener('change', (e) => { est.dashboard = e.target.value; onChange(); });
    const dDesde = caja.querySelector('[data-desde]');
    const dHasta = caja.querySelector('[data-hasta]');
    const onFecha = () => { est.fechaDesde = dDesde.value ? dDesde.value.replace(/-/g, '') : null; est.fechaHasta = dHasta.value ? dHasta.value.replace(/-/g, '') : null; onChange(); };
    dDesde.addEventListener('change', onFecha);
    dHasta.addEventListener('change', onFecha);
    caja.querySelectorAll('[data-rango]').forEach((b) => b.addEventListener('click', () => {
      aplicarPreseleccion(est, b.dataset.rango);
      dDesde.value = isoDate(est.fechaDesde);
      dHasta.value = isoDate(est.fechaHasta);
      onChange();
    }));
    if (conEscala) caja.querySelector('[data-escala]').addEventListener('change', (e) => { est.escala = e.target.value; onChange(); });
  }

  function aplicarPreseleccion(est, tipo) {
    const max = opciones.fechaMax;
    const min = opciones.fechaMin;
    if (!max) return;
    if (tipo === 'todo') { est.fechaDesde = null; est.fechaHasta = null; return; }
    const d = new Date(+max.slice(0, 4), +max.slice(4, 6) - 1, +max.slice(6, 8));
    let desde = d;
    if (tipo === 'semana') desde = new Date(d.getTime() - 6 * 86400000);
    else if (tipo === 'mes') desde = new Date(d.getTime() - 29 * 86400000);
    const y = (x) => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
    est.fechaDesde = y(desde) < min ? min : y(desde);
    est.fechaHasta = max;
  }

  return { setOpciones, renderComplementarios, renderAlertas };
}

// --- Utilidades --------------------------------------------------------------
function tablaGenerica(titulos, filas) {
  const th = titulos.map((t, i) => `<th class="${i === 0 ? '' : 'num'}">${t}</th>`).join('');
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
