// =============================================================================
// app.js
// Controlador principal: navegación, carga de archivos, calidad y dashboards.
// La comunicación con el Web Worker usa un patrón pedido/respuesta (reqId) que
// devuelve promesas; los eventos de progreso llegan aparte.
// =============================================================================

import {
  getConfig,
  getDotacion,
  setDotacion,
  getAsistencia,
  getTiempoExtra,
  appendAsistencia,
  appendTiempoExtra,
  getInventario,
  setInventario,
  siguienteLote,
  eliminarArchivo,
  limpiarTodo,
  setConfig,
  getCortes,
  guardarCorte,
  eliminarCorte,
} from './storage.js';
import { fmtMiles, fmtPct, fmtDec1, DEFAULT_CONFIG } from './config.js';
import { crearDashboards } from './dashboards.js';
import { crearPaneles } from './panels.js';
import { resizeTodos, evolucionCortes as chartEvolucion } from './charts.js';
import { compararCortes, evolucionCortes } from './historico.js';
import { icon } from './icons.js';

let cfg = null;
let worker = null;
let dashboards = null;
let paneles = null;
let ultimaCalidad = null;
const cola = [];
let procesando = false;
let loteConDatos = false; // hubo asistencia/TE en el lote actual => auto-corte

// Pedido/respuesta con el worker.
let reqSeq = 0;
const pendientes = new Map();
function callWorker(type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const reqId = ++reqSeq;
    pendientes.set(reqId, { resolve, reject });
    worker.postMessage({ ...payload, type, reqId }, transfer);
  });
}

init();

async function init() {
  cfg = await getConfig();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    mostrarProgreso(false);
    toast('Error en el procesamiento: ' + (e.message || e), 'error');
    console.error(e);
  };

  dashboards = crearDashboards({ callWorker, getCfg: () => cfg });
  paneles = crearPaneles({ callWorker, getCfg: () => cfg });

  configurarNavegacion();
  configurarCarga();
  window.addEventListener('resize', () => resizeTodos());
  await renderInventario();
  mostrarVista('carga');

  const inv = await getInventario();
  if (inv.length) await recalcular();
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'progress') {
    const txt = { leyendo: 'Leyendo archivo…', modelo: 'Cruzando datos…', calidad: 'Calculando calidad…' }[m.fase];
    if (txt) mostrarProgreso(true, txt);
    return;
  }
  if (m.type === 'error') {
    mostrarProgreso(false);
    toast('Error: ' + m.message, 'error');
    console.error(m.message);
    return;
  }
  if (m.reqId && pendientes.has(m.reqId)) {
    const { resolve, reject } = pendientes.get(m.reqId);
    pendientes.delete(m.reqId);
    if (m.ok) resolve(m.result);
    else reject(new Error(m.error));
  }
}

// ---- Navegación -------------------------------------------------------------
function configurarNavegacion() {
  document.querySelectorAll('[data-vista]').forEach((btn) => {
    btn.addEventListener('click', () => mostrarVista(btn.dataset.vista));
  });
}

function mostrarVista(vista) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.toggle('activa', v.id === 'vista-' + vista));
  document.querySelectorAll('[data-vista]').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  if (vista === 'calidad') renderCalidad();
  if (vista === 'tienda') dashboards.render('Tienda');
  if (vista === 'logistica') dashboards.render('Logística');
  if (vista === 'complementarios') paneles.renderComplementarios();
  if (vista === 'alertas') paneles.renderAlertas();
  if (vista === 'historico') renderHistorico();
  if (vista === 'parametros') renderParametros();
}

// ---- Carga ------------------------------------------------------------------
function configurarCarga() {
  const zona = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastrando'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('arrastrando'));
  zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastrando'); agregarArchivos(e.dataTransfer.files); });
  input.addEventListener('change', () => { agregarArchivos(input.files); input.value = ''; });
  document.getElementById('btnRecalcular').addEventListener('click', () => recalcular());
  document.getElementById('btnLimpiar').addEventListener('click', onLimpiarTodo);
}

function agregarArchivos(fileList) {
  const files = [...fileList].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
  if (!files.length) { toast('Solo se aceptan archivos .xlsx, .xls o .csv', 'error'); return; }
  for (const f of files) cola.push(f);
  procesarCola();
}

async function procesarCola() {
  if (procesando) return;
  const file = cola.shift();
  if (!file) {
    await recalcular();
    // Al terminar un lote con datos nuevos de asistencia/TE, guarda un corte.
    if (loteConDatos) {
      loteConDatos = false;
      await autoGuardarCorte();
    }
    return;
  }
  procesando = true;
  mostrarProgreso(true, `Leyendo ${file.name}…`);
  try {
    const buffer = await file.arrayBuffer();
    const lote = await siguienteLote();
    const payload = await callWorker('parseFile', { buffer, fileName: file.name, lote, cfg }, [buffer]);
    await guardarParseado(payload);
  } catch (err) {
    toast('Error al leer ' + file.name + ': ' + err.message, 'error');
    console.error(err);
  }
  procesando = false;
  procesarCola();
}

async function guardarParseado(p) {
  const inv = await getInventario();
  if (p.tipo === 'desconocido') {
    toast(`No se reconoció el tipo de "${p.fileName}". Verifica los encabezados.`, 'error');
    return;
  }
  if (p.tipo === 'dotacion') {
    await setDotacion({ personas: p.personas, aoa: p.aoa, fechaFoto: new Date().toISOString(), fileName: p.fileName });
    const resto = inv.filter((x) => x.tipo !== 'dotacion');
    resto.push(invItem(p, 'dotacion'));
    await setInventario(resto);
    toast(`Dotación cargada (${fmtMiles(p.filas)} personas).`, 'ok');
  } else if (p.tipo === 'asistencia') {
    await appendAsistencia(p.registros);
    inv.push(invItem(p, 'asistencia'));
    await setInventario(inv);
    loteConDatos = true;
    toast(`Asistencia acumulada (${fmtMiles(p.filas)} filas).`, 'ok');
  } else if (p.tipo === 'tiempoExtra') {
    await appendTiempoExtra(p.registros);
    inv.push(invItem(p, 'tiempoExtra'));
    await setInventario(inv);
    loteConDatos = true;
    toast(`Tiempo Extra acumulado (${fmtMiles(p.filas)} filas).`, 'ok');
  }
  await renderInventario();
}

function invItem(p, tipo) {
  return {
    id: `${tipo}-${p.lote}-${Date.now()}`,
    nombre: p.fileName, tipo, rango: p.rango || '—',
    filas: p.filas || 0, fechaCarga: new Date().toISOString(), lote: p.lote,
  };
}

async function recalcular() {
  const dot = await getDotacion();
  const asistencia = await getAsistencia();
  const tiempoExtra = await getTiempoExtra();
  if (!dot && !asistencia.length) { renderCalidad(); return; }
  mostrarProgreso(true, 'Recalculando…');
  try {
    const res = await callWorker('recalcular', {
      personas: dot && !dot.aoa ? dot.personas : [],
      dotacionAoa: dot && dot.aoa ? dot.aoa : null,
      asistencia, tiempoExtra, cfg, meta: {},
    });
    ultimaCalidad = { controles: res.controles, listados: res.listados, totalFilas: res.totalFilas };
    dashboards.setOpciones(res.filtros);
    paneles.setOpciones(res.filtros);
    mostrarProgreso(false);
    renderCalidad();
    toast('Datos recalculados.', 'ok');
  } catch (err) {
    mostrarProgreso(false);
    toast('Error al recalcular: ' + err.message, 'error');
    console.error(err);
  }
}

async function onLimpiarTodo() {
  if (!confirm('¿Eliminar todos los datos cargados? Los parámetros se conservan.')) return;
  await limpiarTodo(false);
  ultimaCalidad = null;
  await renderInventario();
  renderCalidad();
  toast('Datos eliminados.', 'ok');
}

// ---- Inventario -------------------------------------------------------------
async function renderInventario() {
  const inv = await getInventario();
  const cont = document.getElementById('inventario');
  if (!inv.length) { cont.innerHTML = '<p class="vacio">No hay archivos cargados todavía.</p>'; return; }
  const tipoLabel = { dotacion: 'Dotación', asistencia: 'Asistencia', tiempoExtra: 'Tiempo Extra' };
  const rows = inv.map((x) => `
      <tr>
        <td>${escapeHtml(x.nombre)}</td>
        <td><span class="pill pill-${x.tipo}">${tipoLabel[x.tipo] || x.tipo}</span></td>
        <td>${escapeHtml(x.rango)}</td>
        <td class="num">${fmtMiles(x.filas)}</td>
        <td>${new Date(x.fechaCarga).toLocaleString('es-PE')}</td>
        <td><button class="btn-chico btn-del" data-id="${x.id}" title="Eliminar">${icon('trash', 'ico-xs')}<span>Eliminar</span></button></td>
      </tr>`).join('');
  cont.innerHTML = `
    <table class="tabla">
      <thead><tr><th>Archivo</th><th>Tipo</th><th>Rango de fechas</th><th class="num">Filas</th><th>Fecha de carga</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  cont.querySelectorAll('.btn-del').forEach((b) =>
    b.addEventListener('click', async () => {
      await eliminarArchivo(b.dataset.id);
      await renderInventario();
      await recalcular();
    })
  );
}

// ---- Calidad ----------------------------------------------------------------
function renderCalidad() {
  const cont = document.getElementById('vista-calidad');
  if (!ultimaCalidad) {
    cont.querySelector('.contenido').innerHTML = '<p class="vacio">Carga datos para ejecutar los controles de calidad.</p>';
    return;
  }
  const { controles, listados } = ultimaCalidad;
  const okCount = controles.filter((c) => c.ok).length;
  const filasCt = controles.map((c) => `
      <tr class="${c.ok ? 'ct-ok' : 'ct-error'}">
        <td>${c.id}</td><td>${escapeHtml(c.nombre)}</td>
        <td><span class="badge ${c.ok ? 'badge-ok' : 'badge-error'}">${c.ok ? 'OK' : 'ERROR'}</span></td>
        <td class="detalle">${escapeHtml(c.detalle || '')}</td>
      </tr>`).join('');
  const lst = (titulo, arr, render) => `
    <details class="listado">
      <summary>${titulo} <span class="cuenta">${fmtMiles(arr.length)}</span></summary>
      ${arr.length ? `<div class="listado-body">${arr.slice(0, 200).map(render).join('')}</div>${arr.length > 200 ? `<p class="nota">Mostrando 200 de ${fmtMiles(arr.length)}.</p>` : ''}` : '<p class="vacio">Sin observaciones.</p>'}
    </details>`;
  cont.querySelector('.contenido').innerHTML = `
    <div class="resumen-ct"><span class="badge ${okCount === controles.length ? 'badge-ok' : 'badge-error'}">${okCount}/${controles.length} controles OK</span></div>
    <table class="tabla tabla-ct"><thead><tr><th>Control</th><th>Descripción</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${filasCt}</tbody></table>
    <h3>Observaciones adicionales</h3>
    <div class="listados">
      ${lst('DNI con longitud ≠ 8', listados.dniLongitud, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} (${x.longitud} díg.)</div>`)}
      ${lst('DNI duplicados en Dotación', listados.dniDuplicados, (x) => `<div class="li">${x.keyId} · ${x.veces} veces</div>`)}
      ${lst('Personas sin "Exije huella"', listados.sinHuella, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)}</div>`)}
      ${lst('Horarios sin modelo', listados.horariosSinModelo, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} · ${escapeHtml(x.horario)}</div>`)}
      ${lst('Validación de horas = "Revisar"', listados.horasRevisar, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} · horario ${x.horasHorario ?? '?'}h vs contrato ${x.horasContrato ?? '?'}h</div>`)}
      ${lst('Cargos que no coinciden', listados.cargosNoCoinciden, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.cargoOficial)} ≠ ${escapeHtml(x.cargoMarcacion)}</div>`)}
      ${lst('Marcaciones después del cese', listados.marcacionesTrasCese, (x) => `<div class="li">${x.keyId} · ${escapeHtml(x.nombre)} · ${x.fecha}</div>`)}
    </div>`;
}

// ---- Histórico de cortes ----------------------------------------------------
async function autoGuardarCorte() {
  try {
    const { incidencias } = await callWorker('incidencias', {});
    await guardarCorte({ id: 'corte-' + Date.now(), fecha: new Date().toISOString(), incidencias, auto: true });
  } catch (err) {
    console.error('No se pudo guardar el corte:', err);
  }
}

async function renderHistorico() {
  const cont = document.getElementById('vista-historico');
  const cortes = await getCortes();
  cont.innerHTML = `
    <header class="vista-head"><h1>Histórico de cortes</h1>
      <div class="acciones">
        <button class="btn" data-guardar>${icon('save')}<span>Guardar corte actual</span></button>
      </div>
    </header>
    <p class="nota">Cada carga de datos nuevos guarda un corte (foto de las incidencias: faltas, sin marcación, marcación incompleta y trabajó sin turno, en Tienda y Logística). ${fmtMiles(cortes.length)} corte(s) guardado(s).</p>
    <div class="grafico g-ancho" id="grHistorico" ${cortes.length < 2 ? 'hidden' : ''}></div>
    <div data-cuerpo></div>`;
  cont.querySelector('[data-guardar]').addEventListener('click', async () => {
    await autoGuardarCorte();
    toast('Corte guardado.', 'ok');
    renderHistorico();
  });

  const cuerpo = cont.querySelector('[data-cuerpo]');
  if (!cortes.length) { cuerpo.innerHTML = '<p class="vacio">Aún no hay cortes. Carga datos o pulsa "Guardar corte actual".</p>'; return; }

  const serie = evolucionCortes(cortes);
  if (cortes.length >= 2) chartEvolucion('grHistorico', 'Evolución de incidencias por corte', serie, '#1f4e78');
  setTimeout(() => resizeTodos(), 30);

  // Tabla de cortes (con su resumen vs. el anterior).
  const filasCortes = cortes.map((c, i) => {
    const s = serie[i];
    return `<tr>
      <td>${new Date(c.fecha).toLocaleString('es-PE')}${c.auto ? ' <span class="nota">(auto)</span>' : ''}</td>
      <td class="num">${fmtMiles(s.actuales)}</td>
      <td class="num">${fmtMiles(s.nuevas)}</td>
      <td class="num">${fmtMiles(s.actuales - s.nuevas)}</td>
      <td class="num">${fmtMiles(s.regularizadas)}</td>
      <td class="num">${i === 0 ? '—' : fmtPct(s.pctRegularizacion)}</td>
      <td><button class="btn-chico btn-del" data-corte="${c.id}" title="Eliminar">${icon('trash', 'ico-xs')}<span>Eliminar</span></button></td>
    </tr>`;
  }).reverse().join('');

  // Comparación del último corte vs. el anterior.
  const actual = cortes[cortes.length - 1];
  const anterior = cortes.length >= 2 ? cortes[cortes.length - 2] : null;
  const cmp = compararCortes(actual, anterior);
  const tablaDiff = (titulo, filas, lbl) => `
    <h2>${titulo}</h2>
    <div class="tabla-scroll"><table class="tabla"><thead><tr><th>${lbl}</th><th class="num">Nuevas</th><th class="num">Pendientes</th><th class="num">Regularizadas</th></tr></thead>
    <tbody>${filas.slice(0, 100).map((r) => `<tr><td>${escapeHtml(r.clave)}</td><td class="num">${fmtMiles(r.nuevas)}</td><td class="num">${fmtMiles(r.pendientes)}</td><td class="num">${fmtMiles(r.regularizadas)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin datos</td></tr>'}</tbody></table></div>`;

  cuerpo.innerHTML = `
    <h2>Cortes guardados</h2>
    <div class="tabla-scroll"><table class="tabla"><thead><tr><th>Fecha de carga</th><th class="num">Actuales</th><th class="num">Nuevas</th><th class="num">Pendientes</th><th class="num">Regularizadas</th><th class="num">% Regular.</th><th></th></tr></thead><tbody>${filasCortes}</tbody></table></div>
    <h2>Último corte vs. anterior</h2>
    <div class="chips">
      <span class="chip chip-total">${fmtMiles(cmp.resumen.actuales)} actuales</span>
      <span class="chip chip-alta">${fmtMiles(cmp.resumen.nuevas)} nuevas</span>
      <span class="chip chip-media">${fmtMiles(cmp.resumen.pendientes)} pendientes</span>
      <span class="chip chip-ok">${fmtMiles(cmp.resumen.regularizadas)} regularizadas</span>
      <span class="chip chip-total">${fmtPct(cmp.resumen.pctRegularizacion)} regularización</span>
    </div>
    ${tablaDiff('Por sucursal', cmp.porSucursal, 'Sucursal')}
    ${tablaDiff('Por jefe directo', cmp.porJefe, 'Jefe')}`;

  cuerpo.querySelectorAll('.btn-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este corte?')) return;
    await eliminarCorte(b.dataset.corte);
    renderHistorico();
  }));
}

// ---- Parámetros -------------------------------------------------------------
function renderParametros() {
  const cont = document.getElementById('vista-parametros');
  const c = cfg;
  const num = (path, val, step = '1') => `<input type="number" step="${step}" data-p="${path}" value="${val}" />`;
  cont.innerHTML = `
    <header class="vista-head"><h1>Parámetros</h1>
      <div class="acciones">
        <button class="btn btn-sec" data-restaurar>${icon('reset')}<span>Restaurar valores por defecto</span></button>
        <button class="btn" data-guardar>${icon('save')}<span>Guardar y recalcular</span></button>
      </div>
    </header>
    <p class="nota">Los parámetros se guardan en tu navegador (IndexedDB) y afectan a todos los cálculos.</p>
    <div class="params-grid">
      <section class="param-card"><h3>Semáforo de malla (%)</h3>
        <label>Cumple ≥ ${num('semaforoMalla.cumpleMin', c.semaforoMalla.cumpleMin)}</label>
        <label>En riesgo ≥ ${num('semaforoMalla.riesgoMin', c.semaforoMalla.riesgoMin)}</label>
      </section>
      <section class="param-card"><h3>Refrigerio y fuga</h3>
        <label>Tolerancia de refrigerio (min) ${num('toleranciaRefrigerioMin', c.toleranciaRefrigerioMin)}</label>
        <label>Definición de fuga
          <select data-p="definicionFuga">
            <option value="E1S2" ${c.definicionFuga === 'E1S2' ? 'selected' : ''}>E1 + S2</option>
            <option value="4marcas" ${c.definicionFuga === '4marcas' ? 'selected' : ''}>Las 4 marcas</option>
          </select>
        </label>
      </section>
      <section class="param-card"><h3>Período de empleo</h3>
        <label class="chk"><input type="checkbox" data-p="excluirDiasAntesPuesto" ${c.excluirDiasAntesPuesto ? 'checked' : ''}/> Excluir días anteriores a la entrada al puesto</label>
        <label class="chk"><input type="checkbox" data-p="excluirDiasPosterioresCese" ${c.excluirDiasPosterioresCese ? 'checked' : ''}/> Excluir días posteriores al cese</label>
      </section>
      <section class="param-card"><h3>Clasificación</h3>
        <label>Sindicatos (separados por coma) <input type="text" data-p="sindicatos" value="${escapeAttr(c.sindicatos.join(', '))}" /></label>
        <label>Texto de campañero <input type="text" data-p="textoCampanero" value="${escapeAttr(c.textoCampanero)}" /></label>
        <label>Mapeo de grupo → dashboard (una línea por regla: <code>texto | Dashboard</code>)
          <textarea data-p="mapeoDashboard" rows="3">${escapeAttr(c.mapeoDashboard.map((m) => `${m.contiene} | ${m.dashboard}`).join('\n'))}</textarea>
        </label>
        <label>Mapeo de horas → jornada (<code>horas | jornada</code>)
          <textarea data-p="mapeoJornada" rows="3">${escapeAttr(c.mapeoJornada.map((m) => `${m.horas} | ${m.jornada}`).join('\n'))}</textarea>
        </label>
      </section>
      <section class="param-card"><h3>Umbrales de alerta</h3>
        <label>Faltas injustificadas ≥ ${num('umbralesAlerta.faltasInjustificadas', c.umbralesAlerta.faltasInjustificadas)}</label>
        <label>Sin marcación ≥ ${num('umbralesAlerta.sinMarcacion', c.umbralesAlerta.sinMarcacion)}</label>
        <label>Marcación incompleta ≥ ${num('umbralesAlerta.marcacionIncompleta', c.umbralesAlerta.marcacionIncompleta)}</label>
        <label>Tardanzas E1 ≥ ${num('umbralesAlerta.tardanzasE1', c.umbralesAlerta.tardanzasE1)}</label>
        <label>Trabajó en descanso ≥ ${num('umbralesAlerta.trabajoEnDescanso', c.umbralesAlerta.trabajoEnDescanso)}</label>
        <label>Trabajó sin turno ≥ ${num('umbralesAlerta.trabajoSinTurno', c.umbralesAlerta.trabajoSinTurno)}</label>
        <label>Exceso de refrigerio (días) ≥ ${num('umbralesAlerta.diasExcesoRefrigerio', c.umbralesAlerta.diasExcesoRefrigerio)}</label>
      </section>
      <section class="param-card"><h3>Nivel "Alta" (criterios)</h3>
        <label>Faltas ≥ ${num('nivelAlta.faltas', c.nivelAlta.faltas)}</label>
        <label>Sin marcación ≥ ${num('nivelAlta.sinMarcacion', c.nivelAlta.sinMarcacion)}</label>
        <label>Tardanzas ≥ ${num('nivelAlta.tardanzas', c.nivelAlta.tardanzas)}</label>
        <label>Trabajó sin turno ≥ ${num('nivelAlta.trabajoSinTurno', c.nivelAlta.trabajoSinTurno)}</label>
      </section>
      <section class="param-card"><h3>Escala de umbrales por granularidad</h3>
        <label>Factor Día ${num('escalaUmbralPorGranularidad.dia', c.escalaUmbralPorGranularidad.dia, '0.1')}</label>
        <label>Factor Semana ${num('escalaUmbralPorGranularidad.semana', c.escalaUmbralPorGranularidad.semana, '0.1')}</label>
        <label>Factor Mes ${num('escalaUmbralPorGranularidad.mes', c.escalaUmbralPorGranularidad.mes, '0.1')}</label>
      </section>
    </div>`;

  cont.querySelector('[data-guardar]').addEventListener('click', () => guardarParametros(cont));
  cont.querySelector('[data-restaurar]').addEventListener('click', async () => {
    if (!confirm('¿Restaurar todos los parámetros a los valores por defecto?')) return;
    cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    await setConfig(cfg);
    renderParametros();
    await recalcular();
    toast('Parámetros restaurados.', 'ok');
  });
}

async function guardarParametros(cont) {
  const nuevo = JSON.parse(JSON.stringify(cfg));
  const setPath = (obj, path, val) => {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  };
  cont.querySelectorAll('[data-p]').forEach((el) => {
    const path = el.dataset.p;
    if (el.type === 'number') setPath(nuevo, path, Number(el.value));
    else if (el.type === 'checkbox') setPath(nuevo, path, el.checked);
    else if (path === 'sindicatos') nuevo.sindicatos = el.value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (path === 'mapeoDashboard') {
      nuevo.mapeoDashboard = el.value.split('\n').map((l) => l.split('|')).filter((p) => p.length === 2)
        .map(([contiene, dashboard]) => ({ contiene: contiene.trim(), dashboard: dashboard.trim() }));
    } else if (path === 'mapeoJornada') {
      nuevo.mapeoJornada = el.value.split('\n').map((l) => l.split('|')).filter((p) => p.length === 2)
        .map(([horas, jornada]) => ({ horas: Number(horas.trim()), jornada: jornada.trim() }));
    } else setPath(nuevo, path, el.value);
  });
  cfg = nuevo;
  await setConfig(cfg);
  await recalcular();
  toast('Parámetros guardados. Datos recalculados.', 'ok');
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- UI ---------------------------------------------------------------------
function mostrarProgreso(visible, texto = '') {
  const el = document.getElementById('progreso');
  el.classList.toggle('visible', visible);
  if (texto) el.querySelector('.texto').textContent = texto;
}
let toastTimer = null;
function toast(msg, tipo = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast visible ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 4000);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
