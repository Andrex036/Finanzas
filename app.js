import {
  MONTHS,
  PAYMENT_METHODS,
  STORAGE_KEY,
  DATA_SCHEMA_VERSION,
  annulSavingsTransfer,
  archiveStorageValue,
  addCategoryIfMissing,
  backupCounts,
  buildDashboardData,
  createBackup,
  createInitialState,
  calculateFinancialSummary,
  calculateMonthlySummary,
  calculateSavingsDistribution,
  calculateSavingsPlanAmount,
  calculateSavingsSummary,
  buildMovementCopyPlan,
  correctSavingsTransfer,
  extractBackupData,
  formatCOP,
  getMovementStatus,
  getMonthlyMovements,
  mergeBackup,
  normalizeBudgetItem,
  normalizeFinancialDestination,
  normalizeSavingsDistribution,
  normalizeSavingsGoal,
  normalizeSavingsPlan,
  normalizeMovement,
  normalizeScheduledSavings,
  normalizeSavingsTransfer,
  normalizeSavingsWithdrawal,
  removeRecord,
  registerSavingsTransfer,
  registerSavingsWithdrawal,
  restoreStateFromBackup,
  shiftDateToPeriod,
  storageErrorMessage,
  savingsCommitmentStatus,
  simulateSavingsReturns,
  upsertRecord,
  validateBackup,
} from "./finance-core.js";

const views = [
  ["dashboard", "Inicio"],
  ["presupuesto", "Presupuesto"],
  ["movimientos", "Movimientos"],
  ["futuro", "Mi Futuro"],
];

const START_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, index) => START_YEAR + index);
const RESOURCE_TYPES = ["Nomina", "Arriendos", "Trabajos profesionales", "Proyectos", "Otros ingresos"];
const DEFAULT_EXPENSE_CATEGORIES = ["Mercado", "Comida", "Vivienda", "Servicios", "Transporte", "Educacion", "Salud", "Recreacion", "Otros gastos"];

const loadedState = loadState();
const state = {
  data: loadedState.data,
  persistenceMessage: loadedState.message || "",
  readOnly: Boolean(loadedState.readOnly),
  importPreview: null,
  importError: "",
  view: "dashboard",
  edit: null,
  movementModal: false,
  copyModal: null,
  savingsSimulation: null,
  savingsError: "",
};

const $ = (selector) => document.querySelector(selector);
const viewEl = $("#view");
const titleEl = $("#viewTitle");
const yearSelect = $("#yearSelect");
const monthSelect = $("#monthSelect");

function loadState() {
  let stored;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.error("No fue posible leer los datos financieros guardados.", error);
    return { data: ensureSimpleState(createInitialState()), message: "No fue posible acceder al almacenamiento local. No se reemplazaron datos existentes.", readOnly: true };
  }

  if (stored === null) {
    const initial = ensureSimpleState(createInitialState());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return { data: initial, message: "" };
    } catch (error) {
      console.error("No fue posible inicializar el almacenamiento local.", error);
      return { data: initial, message: storageErrorMessage(error) };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    console.error("El contenido financiero guardado no es JSON valido.", error);
    return { data: ensureSimpleState(createInitialState()), message: "Los datos guardados no se pudieron leer. Se conservaron intactos; importa un respaldo válido antes de continuar.", readOnly: true };
  }
  const validation = validateBackup(parsed);
  if (!validation.ok) {
    return { data: ensureSimpleState(createInitialState()), message: `Los datos locales no superaron la validacion: ${validation.message} No se modificaron.`, readOnly: true };
  }

  const sourceData = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const needsMigration = validation.schemaVersion < DATA_SCHEMA_VERSION
    || !sourceData.settings?.appMode
    || ["movimientos", "presupuestos", "categorias", "deudas", "metasAhorro", "planesAhorro", "distribucionesAhorro", "destinosFinancieros", "aportesProgramados", "transferenciasAhorro", "retirosAhorro"].some((name) => {
      const rows = sourceData[name] || [];
      return rows.some((row) => !row.id)
        || (["movimientos", "presupuestos"].includes(name) && rows.some((row) => !row.versionModeloFinanciero));
    });
  try {
    let archived = false;
    if (needsMigration) {
      archiveStorageValue(localStorage, stored);
      archived = true;
    }
    const migrated = ensureSimpleState(extractBackupData(parsed));
    const serialized = JSON.stringify(migrated);
    if (serialized !== stored) {
      if (!archived) archiveStorageValue(localStorage, stored);
      localStorage.setItem(STORAGE_KEY, serialized);
    }
    return { data: migrated, message: "" };
  } catch (error) {
    console.error("No fue posible archivar o migrar los datos financieros.", error);
    return {
      data: ensureSimpleState(extractBackupData(parsed)),
      message: "Los datos se abrieron sin reemplazar el original, pero no se pudo guardar una copia/migración local. Descarga un respaldo y revisa el espacio disponible antes de editar.",
      readOnly: true,
    };
  }
}

function ensureSimpleState(data) {
  const current = createInitialState();
  const customCategories = Array.isArray(data.settings?.categoriasGasto) ? data.settings.categoriasGasto : [];
  const isSimpleMode = data.settings?.appMode === "simple-v2";
  const movimientos = (data.movimientos || []).map((item) => normalizeMovement(item));
  let presupuestos = (data.presupuestos || []).map((item) => normalizeBudgetItem({
    ...item,
    tipo: item.tipo || (isSimpleMode ? "Ingreso" : "Gasto"),
  }));
  const idsIngreso = new Set(presupuestos.filter((item) => item.tipo === "Ingreso").map((item) => item.id));
  const ingresosHistoricos = movimientos
    .filter((item) => item.tipo === "Ingreso" && !idsIngreso.has(item.id))
    .map((item) => normalizeBudgetItem({
        ...item,
        tipo: "Ingreso",
        concepto: item.descripcion || item.categoria,
        fechaLimite: item.fechaLimite,
      }));
  presupuestos = [...ingresosHistoricos, ...presupuestos];
  const next = {
    ...data,
    schemaVersion: DATA_SCHEMA_VERSION,
    version: DATA_SCHEMA_VERSION,
    settings: { ...current.settings, ...data.settings, appMode: "simple-v2", categoriasGasto: [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...customCategories])] },
    movimientos,
    presupuestos,
    categorias: data.categorias || current.categorias,
    deudas: data.deudas || [],
    metasAhorro: (data.metasAhorro || []).map(normalizeSavingsGoal),
    planesAhorro: (data.planesAhorro || []).map(normalizeSavingsPlan),
    distribucionesAhorro: (data.distribucionesAhorro || []).map(normalizeSavingsDistribution),
    destinosFinancieros: (data.destinosFinancieros || []).map(normalizeFinancialDestination),
    aportesProgramados: (data.aportesProgramados || []).map(normalizeScheduledSavings),
    transferenciasAhorro: (data.transferenciasAhorro || []).map(normalizeSavingsTransfer),
    retirosAhorro: (data.retirosAhorro || []).map(normalizeSavingsWithdrawal),
  };
  return next;
}

function saveState(nextData = state.data) {
  if (state.readOnly) {
    state.persistenceMessage ||= "La aplicacion esta en modo de solo lectura para evitar sobrescribir datos que no se pudieron validar.";
    alert(state.persistenceMessage);
    return false;
  }
  const next = {
    ...nextData,
    schemaVersion: DATA_SCHEMA_VERSION,
    version: DATA_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    state.data = next;
    state.persistenceMessage = "";
    return true;
  } catch (error) {
    console.error("No fue posible guardar los datos financieros.", error);
    state.persistenceMessage = storageErrorMessage(error);
    alert(state.persistenceMessage);
    return false;
  }
}

function activeYear() {
  return Number(state.data.settings.anioActivo || new Date().getFullYear());
}

function activeMonth() {
  return state.data.settings.mesActivo || MONTHS[new Date().getMonth()];
}

function previousPeriod(year = activeYear(), month = activeMonth()) {
  const monthIndex = MONTHS.indexOf(month);
  return {
    year: monthIndex === 0 ? Number(year) - 1 : Number(year),
    month: monthIndex === 0 ? "diciembre" : MONTHS[monthIndex - 1],
  };
}

function setView(nextView) {
  state.view = nextView;
  state.edit = null;
  state.movementModal = false;
  state.copyModal = null;
  render();
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function options(items, selected) {
  return items.map((item) => `<option value="${htmlEscape(item)}" ${item === selected ? "selected" : ""}>${htmlEscape(item)}</option>`).join("");
}

function recordOptions(rows, selected = "") {
  return rows.map((item) => `<option value="${htmlEscape(item.id)}" ${item.id === selected ? "selected" : ""}>${htmlEscape(item.nombre)}</option>`).join("");
}

function monthLabel(month) {
  const text = String(month || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function monthOptions(selected) {
  return MONTHS.map((month) => `<option value="${htmlEscape(month)}" ${month === selected ? "selected" : ""}>${monthLabel(month)}</option>`).join("");
}

function expenseCategories() {
  return state.data.settings.categoriasGasto || DEFAULT_EXPENSE_CATEGORIES;
}

function categoryOptions(selected) {
  const categories = expenseCategories();
  const selectedValue = categories.includes(selected) ? selected : selected ? "Otro" : categories[0];
  return `${options(categories, selectedValue)}<option value="Otro" ${selectedValue === "Otro" ? "selected" : ""}>Otro</option>`;
}

function isCustomCategory(category) {
  return category && !DEFAULT_EXPENSE_CATEGORIES.includes(category);
}

function addExpenseCategory(category) {
  const categories = expenseCategories();
  const result = addCategoryIfMissing(categories, category);
  if (!result.category) return "";
  if (result.added) {
    const next = { ...state.data, settings: { ...state.data.settings, categoriasGasto: result.categories } };
    if (!saveState(next)) return "";
  }
  return result.category;
}

function removeExpenseCategory(category) {
  if (!isCustomCategory(category)) return;
  if (!confirm(`Eliminar la categoria "${category}"? Los movimientos existentes conservaran ese nombre.`)) return;
  const next = {
    ...state.data,
    settings: { ...state.data.settings, categoriasGasto: expenseCategories().filter((item) => item !== category) },
  };
  if (!saveState(next)) return;
  render();
}

function displayMovementStatus(row, today = new Date()) {
  return getMovementStatus(row, today);
}

function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function renderNavigation() {
  const markup = views.map(([id, label]) => `<button class="${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("");
  $("#desktopNav").innerHTML = markup;
  $("#mobileNav").innerHTML = views.map(([id, label]) => `<button class="${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("");
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
}

function renderPeriodControls() {
  yearSelect.innerHTML = YEAR_OPTIONS.map((year) => `<option value="${year}" ${year === activeYear() ? "selected" : ""}>${year}</option>`).join("");
  monthSelect.innerHTML = monthOptions(activeMonth());
  yearSelect.onchange = () => {
    if (!saveState({ ...state.data, settings: { ...state.data.settings, anioActivo: Number(yearSelect.value) } })) return;
    render();
  };
  monthSelect.onchange = () => {
    if (!saveState({ ...state.data, settings: { ...state.data.settings, mesActivo: monthSelect.value } })) return;
    render();
  };
}

function metric(label, value, help = "", tone = "") {
  return `<article class="metric ${tone}"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`;
}

function movementSummaryCard(label, value, tone = "") {
  return `<article class="movement-total ${tone}"><span>${label}</span><strong>${value}</strong></article>`;
}

function backupPanel() {
  const preview = state.importPreview;
  const previewMarkup = preview ? `
    <div class="backup-preview">
      <h3>Revisa el respaldo antes de continuar</h3>
      <p>Version ${preview.counts.schemaVersion}${preview.counts.generatedAt ? ` · generado ${htmlEscape(preview.counts.generatedAt)}` : ""}</p>
      <ul>
        <li>${preview.counts.ingresos} ingresos · ${preview.counts.gastos} gastos</li>
        <li>${preview.counts.presupuestos} presupuestos · ${preview.counts.categorias} categorias</li>
        <li>${preview.counts.deudas} deudas · ${preview.counts.metasAhorro} metas de ahorro</li>
        <li>${preview.counts.planesAhorro} planes · ${preview.counts.distribucionesAhorro} distribuciones · ${preview.counts.destinosFinancieros} destinos</li>
        <li>${preview.counts.aportesProgramados} aportes programados · ${preview.counts.transferenciasAhorro} transferencias · ${preview.counts.retirosAhorro} retiros</li>
      </ul>
      ${preview.merge ? `
        <p>Al combinar se agregaran ${Object.values(preview.merge.added).reduce((sum, count) => sum + count, 0)} registros nuevos; ${preview.merge.duplicates.length} ya existen iguales.</p>
        ${preview.merge.conflicts.length ? `<p class="backup-warning">Hay ${preview.merge.conflicts.length} identificador(es) con contenido diferente. Esos registros actuales se conservaran, sin reemplazo.</p>` : ""}
        ${preview.merge.settingsConflict ? `<p>La configuracion actual se conservara.</p>` : ""}
      ` : ""}
      <div class="backup-actions">
        <button type="button" data-restore-backup>Restaurar respaldo</button>
        <button type="button" class="secondary" data-merge-backup>Combinar registros</button>
        <button type="button" class="secondary" data-cancel-backup>Cancelar</button>
      </div>
    </div>
  ` : "";
  return `
    <section class="panel backup-panel">
      <div class="panel-header">
        <div><h2>Respaldo y recuperación</h2><p>Descarga una copia o recupera tus datos desde un archivo JSON.</p></div>
      </div>
      <p class="backup-notice">Tus datos permanecen en este navegador; no se envian a internet. Guarda una copia del respaldo en otro lugar seguro para evitar perderla si borras los datos del navegador o cambias de dispositivo.</p>
      ${state.persistenceMessage ? `<div class="alert danger" role="alert">${htmlEscape(state.persistenceMessage)}</div>` : ""}
      <div class="backup-actions">
        <button type="button" data-download-backup>Descargar copia de seguridad</button>
        <label class="backup-file">Seleccionar archivo JSON<input type="file" accept="application/json,.json" data-import-backup /></label>
      </div>
      ${state.importError ? `<div class="alert danger" role="alert">${htmlEscape(state.importError)}</div>` : ""}
      ${previewMarkup}
    </section>
  `;
}

function getMonthlyResources() {
  return state.data.presupuestos.filter((item) => item.tipo === "Ingreso" && Number(item.anio) === activeYear() && item.mes === activeMonth());
}

function getMonthlyExpenses() {
  return getMonthlyMovements(state.data, activeYear(), activeMonth()).filter((item) => !["Ingreso", "Transferencia interna"].includes(item.tipo));
}

function calculateMovementSummary(rows = getMonthlyExpenses()) {
  const summary = calculateFinancialSummary(getMonthlyResources(), rows);
  return {
    totalPagado: summary.gastosEfectivamentePagados,
    pendientePorPagar: summary.obligacionesPendientes,
    disponible: summary.saldoDisponible,
    saldoProyectado: summary.saldoProyectado,
  };
}

function renderDashboard() {
  const dashboard = buildDashboardData(state.data, activeYear(), activeMonth());
  const summary = dashboard.summary;
  const categorySummary = dashboard.categories;
  const obligationCounts = Object.fromEntries(dashboard.obligationStates.map((item) => [item.status, item.count]));
  const totalObligations = dashboard.obligationStates.reduce((sum, item) => sum + item.count, 0);

  return `
    <section class="balance-cards" aria-label="Saldos del periodo">
      <article class="balance-card ${summary.saldoDisponible < 0 ? "negative" : ""}">
        <div class="balance-card-heading"><span class="balance-icon" aria-hidden="true">↗</span><span>Disponible actualmente</span></div>
        <strong>${formatCOP(summary.saldoDisponible)}</strong>
        <p>Dinero disponible después de los pagos realizados.</p>
        ${summary.saldoDisponible < 0 ? `<span class="balance-status">Saldo negativo</span>` : ""}
      </article>
      <article class="balance-card projected ${summary.saldoProyectado < 0 ? "negative" : ""}">
        <div class="balance-card-heading"><span class="balance-icon" aria-hidden="true">◎</span><span>Disponible después de pagar</span></div>
        <strong>${formatCOP(summary.saldoProyectado)}</strong>
        <p>Dinero estimado después de cumplir las obligaciones pendientes.</p>
        ${summary.saldoProyectado < 0 ? `<span class="balance-status">Saldo proyectado negativo</span>` : ""}
      </article>
    </section>
    <section class="metrics dashboard-metrics" aria-label="Indicadores del periodo">
      ${metric("Ingresos recibidos", formatCOP(summary.totalIngresos), "Dinero recibido", "good")}
      ${metric("Gastos pagados", formatCOP(summary.gastosEfectivamentePagados), "Pagos realizados")}
      ${metric("Obligaciones pendientes", formatCOP(summary.obligacionesPendientes), "Saldo por pagar", summary.obligacionesPendientes ? "warn" : "good")}
      ${metric("Recursos comprometidos", summary.totalIngresos ? `${dashboard.committedPercentage}%` : "—", summary.totalIngresos ? `${formatCOP(dashboard.committedAmount)} frente a ingresos recibidos` : "Sin ingresos recibidos en el periodo", dashboard.committedPercentage > 100 ? "bad" : "")}
      ${metric("Obligaciones vencidas", dashboard.overdueCount, dashboard.overdueCount ? "Con saldo pendiente" : "Ninguna vencida", dashboard.overdueCount ? "bad" : "good")}
    </section>
    <section class="panel dashboard-alerts">
      <div class="panel-header"><div><h2>Panorama del periodo</h2><p>${monthLabel(activeMonth())} ${activeYear()}</p></div></div>
      <div class="alerts" aria-live="polite">${dashboard.alerts.length ? dashboard.alerts.map((alert) => `<div class="alert ${alert.type}" role="status">${htmlEscape(alert.message)}</div>`).join("") : `<div class="alert success" role="status">No hay alertas: el saldo proyectado cubre los pagos y obligaciones del periodo.</div>`}</div>
    </section>
    <section class="dashboard-charts" aria-label="Visualizaciones financieras">
      <article class="panel chart-panel">
        <div class="panel-header"><div><h2>Gastos por categoría</h2><p>Valor total de las obligaciones registradas</p></div></div>
        ${categoryChart(categorySummary)}
      </article>
      <article class="panel chart-panel">
        <div class="panel-header"><div><h2>Evolución mensual</h2><p>Últimos seis periodos hasta ${monthLabel(activeMonth())} ${activeYear()}</p></div></div>
        ${historyChart(dashboard.history)}
      </article>
      <article class="panel chart-panel obligation-chart-panel">
        <div class="panel-header"><div><h2>Estado de obligaciones</h2><p>${totalObligations} obligación(es) en este periodo</p></div></div>
        ${obligationChart(dashboard.obligationStates, totalObligations)}
      </article>
    </section>
    ${backupPanel()}
  `;
}

function categoryChart(rows) {
  if (!rows.length) return `<div class="empty">No hay gastos registrados en este periodo.</div>`;
  return `
    <ul class="bar-chart category-chart">${rows.map((row) => `
      <li class="bar-chart-row">
        <div class="bar-row-heading"><strong>${htmlEscape(row.categoria)}</strong><span>${formatCOP(row.total)}</span></div>
        <div class="bar-track" aria-hidden="true"><span style="width:${Math.min(100, row.share)}%"></span></div>
        <small>Pagado ${formatCOP(row.pagado)} · Pendiente ${formatCOP(row.pendiente)}</small>
      </li>`).join("")}</ul>
  `;
}

function historyChart(rows) {
  const series = [
    ["Ingresos recibidos", "ingresos", "income"],
    ["Pagos realizados", "pagos", "payments"],
    ["Saldo actual", "disponible", "available"],
    ["Saldo proyectado", "proyectado", "projected"],
  ];
  return `
    <div class="history-chart">
      <div class="chart-legend">${series.map(([label, , tone]) => `<span><i class="legend-dot ${tone}" aria-hidden="true"></i>${label}</span>`).join("")}</div>
      <ol class="history-periods">${rows.map((period) => `
        <li class="history-period">
          <strong>${htmlEscape(period.label)}</strong>
          <div class="history-bars">${series.map(([label, key, tone]) => `
            <div class="history-series">
              <span>${label}</span>
              <div class="history-track" aria-hidden="true"><i class="${tone} ${period[key] < 0 ? "negative" : ""}" style="width:${Math.min(100, period.widths[key])}%"></i></div>
              <b>${formatCOP(period[key])}</b>
            </div>`).join("")}
          </div>
        </li>`).join("")}</ol>
    </div>
  `;
}

function obligationChart(rows, totalCount) {
  if (!totalCount) return `<div class="empty">No hay obligaciones registradas en este periodo.</div>`;
  const labels = { pagadas: "Pagadas", pendientes: "Pendientes", parciales: "Parcialmente pagadas" };
  return `
    <ul class="bar-chart obligation-chart">${rows.map((row) => `
      <li class="bar-chart-row">
        <div class="bar-row-heading"><strong>${labels[row.status]}</strong><span>${row.count} · ${formatCOP(row.amount)}</span></div>
        <div class="bar-track ${row.status}" aria-hidden="true"><span style="width:${Math.min(100, row.share)}%"></span></div>
      </li>`).join("")}
    </ul>
  `;
}

function formButtons(label) {
  return `<div class="actions span-4"><button type="submit">${label}</button><button type="button" class="secondary" data-cancel>Cancelar</button></div>`;
}

function movementForm(row = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const categoryIsCustom = isCustomCategory(row.categoria);
  return `
    <form id="movementForm" class="grid-form">
      <input type="hidden" name="id" value="${htmlEscape(row.id || "")}" />
      <label>Fecha registro<input type="date" name="fecha" required value="${htmlEscape(row.fecha || today)}" /></label>
      <label>Fecha final de pago<input type="date" name="fechaLimite" required value="${htmlEscape(row.fechaLimite || row.fecha || today)}" /></label>
      <input type="hidden" name="tipo" value="${htmlEscape(row.tipo || "Gasto variable")}" />
      <label>Categoria<select id="movementCategory" name="categoria" required>${categoryOptions(row.categoria)}</select></label>
      <label id="customCategoryField" class="${categoryIsCustom ? "" : "hidden"}">Nueva categoria<input name="categoriaManual" value="${categoryIsCustom ? htmlEscape(row.categoria) : ""}" placeholder="Escribe la categoria" /></label>
      <label class="span-2">Descripcion<input name="descripcion" required value="${htmlEscape(row.descripcion || "")}" placeholder="Ej. mercado, gasolina, colegio" /></label>
      <label>Valor total de la obligacion<input type="number" min="0" name="valorPresupuestado" required value="${row.valorPresupuestado ?? 0}" /></label>
      <label>Importe efectivamente pagado<input type="number" min="0" name="valorPagado" value="${row.valorPagado ?? 0}" /></label>
      <label>Medio de pago<select name="medioPago">${options(PAYMENT_METHODS, row.medioPago || "Cuenta bancaria")}</select></label>
      <label>Responsable<input name="responsable" value="${htmlEscape(row.responsable || "")}" /></label>
      <small class="span-2">El estado (Pendiente, Parcial, Pagado o Vencido) se calcula con los importes y la fecha limite.</small>
      ${formButtons(row.id ? "Guardar cambios" : "Registrar movimiento")}
    </form>
  `;
}

function renderMovimientos() {
  const rows = getMonthlyExpenses();
  const editRow = state.edit?.type === "movimiento" ? state.data.movimientos.find((item) => item.id === state.edit.id) : null;
  const previous = previousPeriod();
  const modalOpen = state.movementModal || Boolean(editRow);
  const summary = calculateMovementSummary(rows);
  const copyModal = state.copyModal ? renderCopyMovementsModal() : "";
  return `
    <section class="panel">
      <div class="panel-header">
        <div><h2>Movimientos</h2><p>Registra gastos, copia el mes anterior y marca pagos.</p></div>
        <button data-open-movement-modal>Registrar gasto</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><div><h2>Categorias personalizadas</h2><p>Las categorias creadas desde Otro apareceran aqui.</p></div></div>
      <div class="category-list">
        ${expenseCategories().filter(isCustomCategory).length ? expenseCategories().filter(isCustomCategory).map((category) => `<span class="category-chip">${htmlEscape(category)} <button class="secondary icon" data-delete-category="${htmlEscape(category)}">Eliminar</button></span>`).join("") : `<div class="empty"><strong>No hay categorias personalizadas.</strong><span>Selecciona Otro al registrar un gasto para crear una.</span></div>`}
      </div>
    </section>
    <section class="table-card">
      <div class="panel-header">
        <div><h2>Movimientos de ${monthLabel(activeMonth())} ${activeYear()}</h2><p>${rows.length} registros</p></div>
        <button class="secondary" data-copy-movements>Copiar ${monthLabel(previous.month)} ${previous.year}</button>
      </div>
      <div class="movement-summary" aria-label="Resumen de movimientos del mes">
        ${movementSummaryCard("Pagado", formatCOP(summary.totalPagado), "good")}
        ${movementSummaryCard("Pendiente por pagar", formatCOP(summary.pendientePorPagar), summary.pendientePorPagar ? "warn" : "good")}
        ${movementSummaryCard("Saldo disponible actual", formatCOP(summary.disponible), summary.disponible < 0 ? "bad" : "good")}
        ${movementSummaryCard("Saldo proyectado", formatCOP(summary.saldoProyectado), summary.saldoProyectado < 0 ? "bad" : "good")}
      </div>
      ${movementTable(rows)}
    </section>
    ${modalOpen ? `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="movementModalTitle">
        <div class="modal">
          <div class="modal-header">
            <div>
              <h2 id="movementModalTitle">${editRow ? "Editar gasto" : "Registrar gasto"}</h2>
              <p>Completa los datos del movimiento.</p>
            </div>
            <button type="button" class="secondary icon" data-close-movement-modal aria-label="Cerrar">Cerrar</button>
          </div>
          ${movementForm(editRow || {})}
        </div>
      </div>
    ` : ""}
    ${copyModal}
  `;
}

function getPreviousPeriodExpenses() {
  const previous = previousPeriod();
  return (state.data.movimientos || []).filter((item) =>
    Number(item.anio) === previous.year
    && item.mes === previous.month
    && !["Ingreso", "Transferencia interna"].includes(item.tipo),
  );
}

function renderCopyMovementsModal() {
  const previous = previousPeriod();
  const selectedIds = state.copyModal.selectedIds;
  const includePossibleIds = state.copyModal.includePossibleIds;
  const plan = buildMovementCopyPlan(
    state.copyModal.sourceRows,
    state.data.movimientos,
    activeYear(),
    activeMonth(),
    selectedIds,
    includePossibleIds,
  );
  const rowPlan = buildMovementCopyPlan(
    state.copyModal.sourceRows,
    state.data.movimientos,
    activeYear(),
    activeMonth(),
    state.copyModal.sourceRows.map((row) => row.id),
    includePossibleIds,
  );
  const allSelected = state.copyModal.sourceRows.length > 0 && selectedIds.length === state.copyModal.sourceRows.length;
  const statusLabel = { new: "Nuevo", duplicate: "Ya copiado", possible: "Posible coincidencia" };
  return `
    <div class="modal-backdrop copy-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="copyModalTitle">
      <section class="modal copy-modal">
        <div class="modal-header">
          <div>
            <h2 id="copyModalTitle">Copiar gastos de ${monthLabel(previous.month)} ${previous.year}</h2>
            <p>Destino: ${monthLabel(activeMonth())} ${activeYear()}. Revisa y selecciona las obligaciones que quieres copiar.</p>
          </div>
          <button type="button" class="secondary icon" data-cancel-copy aria-label="Cerrar">Cerrar</button>
        </div>
        <div class="copy-select-all">
          <label><input type="checkbox" data-copy-select-all ${allSelected ? "checked" : ""} /> Seleccionar todos</label>
        </div>
        <div class="table-wrap copy-table-wrap">
          <table class="copy-table">
            <thead><tr><th>Seleccionar</th><th>Categoria</th><th>Descripcion</th><th>Valor total</th><th>Fecha limite</th><th>Estado anterior</th><th>Destino</th></tr></thead>
            <tbody>
              ${state.copyModal.sourceRows.map((source) => {
                const entry = rowPlan.entries.find((item) => item.source.id === source.id);
                const included = includePossibleIds.includes(source.id);
                return `
                  <tr>
                    <td data-label="Seleccionar"><input type="checkbox" data-copy-item="${htmlEscape(source.id)}" ${selectedIds.includes(source.id) ? "checked" : ""} aria-label="Seleccionar ${htmlEscape(source.descripcion || source.categoria)}" /></td>
                    <td data-label="Categoria">${htmlEscape(source.categoria || "")}</td>
                    <td data-label="Descripcion">${htmlEscape(source.descripcion || "")}</td>
                    <td data-label="Valor total">${formatCOP(source.valorPresupuestado)}</td>
                    <td data-label="Fecha limite">${htmlEscape(source.fechaLimite || "Sin fecha")}</td>
                    <td data-label="Estado anterior">${htmlEscape(displayMovementStatus(source))}</td>
                    <td data-label="Destino">
                      <span class="copy-match ${entry.type}">${statusLabel[entry.type]}</span>
                      ${entry.type === "possible" ? `<label class="copy-include"><input type="checkbox" data-copy-possible="${htmlEscape(source.id)}" ${included ? "checked" : ""} /> Copiar de todos modos</label>` : ""}
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        <div class="copy-summary" aria-live="polite">
          <strong>Resumen de seleccion</strong>
          <span>Seleccionados: ${plan.selectedCount}</span>
          <span>Movimientos nuevos: ${plan.newCount}</span>
          <span>Ya copiados: ${plan.duplicateCount}</span>
          <span>Posibles duplicados: ${plan.possibleCount}</span>
          <span>Valor de nuevas obligaciones: ${formatCOP(plan.totalNewValue)}</span>
          ${plan.duplicateCount ? `<small>Ya existen: ${plan.entries.filter((entry) => entry.type === "duplicate").map((entry) => htmlEscape(entry.source.descripcion || entry.source.categoria || entry.source.id)).join(", ")}</small>` : ""}
        </div>
        <div class="copy-modal-actions">
          <button type="button" data-confirm-copy ${plan.newCount ? "" : "disabled"}>Copiar seleccionados</button>
          <button type="button" class="secondary" data-cancel-copy>Cancelar</button>
        </div>
      </section>
    </div>
  `;
}

function movementTable(rows) {
  if (!rows.length) return $("#emptyState").innerHTML;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha registro</th><th>Fecha final</th><th>Categoria</th><th>Descripcion</th><th>Obligacion total</th><th>Pagado</th><th>Saldo pendiente</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td data-label="Fecha registro">${htmlEscape(row.fecha)}</td><td data-label="Fecha final">${htmlEscape(row.fechaLimite || "")}</td><td data-label="Categoria">${htmlEscape(row.categoria)}</td><td data-label="Descripcion">${htmlEscape(row.descripcion)}</td>
          <td data-label="Obligacion total">${formatCOP(row.valorPresupuestado)}</td><td data-label="Pagado">${formatCOP(row.valorPagado)}</td><td data-label="Saldo pendiente">${formatCOP(row.valorFaltante)}</td><td data-label="Estado"><span class="status ${displayMovementStatus(row)}">${displayMovementStatus(row)}</span></td>
          <td data-label="Acciones" class="row-actions">${row.estado === "Pagado" ? "" : `<button class="secondary icon" title="Pagado" data-pay-movement="${htmlEscape(row.id)}">Pagado</button>`}<button class="secondary icon" title="Editar" data-edit-movement="${htmlEscape(row.id)}">Editar</button><button class="danger icon" title="Eliminar" data-delete-movement="${htmlEscape(row.id)}">Eliminar</button></td>
        </tr>`).join("")}</tbody>
    </table></div>
  `;
}

function budgetForm(row = {}) {
  return `
    <form id="budgetForm" class="grid-form">
      <input type="hidden" name="id" value="${htmlEscape(row.id || "")}" />
      <input type="hidden" name="anio" value="${activeYear()}" />
      <input type="hidden" name="mes" value="${activeMonth()}" />
      <label>Recurso<select name="categoria" required>${options(RESOURCE_TYPES, row.categoria || RESOURCE_TYPES[0])}</select></label>
      <label class="span-2">Detalle<input name="concepto" required value="${htmlEscape(row.concepto || "")}" placeholder="Ej. nomina junio, arriendo local, proyecto" /></label>
      <label>Ingreso presupuestado<input type="number" min="0" name="valorPresupuestado" value="${row.valorPresupuestado ?? 0}" /></label>
      <label>Ingreso efectivamente recibido<input type="number" min="0" name="valorPagado" value="${row.valorPagado ?? 0}" /></label>
      ${formButtons(row.id ? "Guardar recurso" : "Agregar recurso")}
    </form>
  `;
}

function renderPresupuesto() {
  const rows = getMonthlyResources();
  const editRow = state.edit?.type === "presupuesto" ? state.data.presupuestos.find((item) => item.id === state.edit.id) : null;
  return `
    <section class="panel">
      <div class="panel-header">
        <div><h2>Recursos del mes</h2><p>Ingresa nomina, arriendos, trabajos profesionales y proyectos.</p></div>
      </div>
      ${budgetForm(editRow || {})}
    </section>
    <section class="table-card">
      ${simpleTable(rows, ["categoria", "concepto", "valorPresupuestado", "valorPagado", "valorFaltante"], { money: ["valorPresupuestado", "valorPagado", "valorFaltante"], editType: "budget" })}
    </section>
  `;
}

function renderFutureFinance() {
  const year = activeYear();
  const month = activeMonth();
  const savings = calculateSavingsSummary(state.data, year, month);
  const activeGoals = state.data.metasAhorro.filter((goal) => goal.estado === "Activa");
  const distribution = state.data.distribucionesAhorro.find((item) => item.anio === year && item.mes === month);
  const distributionResult = distribution
    ? calculateSavingsDistribution(distribution, state.data.metasAhorro)
    : null;
  const plans = state.data.planesAhorro.filter((plan) => plan.estado !== "Pausado");
  const commitments = state.data.aportesProgramados
    .filter((item) => String(item.fechaProgramada || "").startsWith(`${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}`))
    .sort((a, b) => a.fechaProgramada.localeCompare(b.fechaProgramada));
  const transferables = state.data.aportesProgramados.filter((item) =>
    item.estado !== "Cancelado"
    && savingsCommitmentStatus(item, state.data.transferenciasAhorro) !== "Transferido",
  );
  const simulation = state.savingsSimulation;
  const destinations = state.data.destinosFinancieros;
  const goalsMarkup = savings.progresoMetas.length ? savings.progresoMetas.map((goal) => `
    <article class="future-goal">
      <div class="future-goal-heading"><div><strong>${htmlEscape(goal.nombre)}</strong><span>${htmlEscape(goal.estado)}</span></div><b>${formatCOP(goal.acumulado)} / ${formatCOP(goal.objetivo)}</b></div>
      <progress max="100" value="${Math.min(100, goal.porcentaje)}" aria-label="Avance de ${htmlEscape(goal.nombre)}: ${goal.porcentaje}%">${goal.porcentaje}%</progress>
      <small>${goal.porcentaje}% de avance${goal.destinosFinancieros.length ? ` · ${goal.destinosFinancieros.map((idValue) => htmlEscape(destinations.find((item) => item.id === idValue)?.nombre || "Destino sin nombre")).join(", ")}` : ""}</small>
      <div class="future-actions">
        <button type="button" class="secondary" data-edit-goal="${htmlEscape(goal.id)}">Editar meta</button>
        ${goal.estado !== "Completada" ? `<button type="button" class="secondary" data-goal-state="${htmlEscape(goal.id)}" data-state="Completada">Completar</button>` : ""}
        ${goal.estado === "Activa" ? `<button type="button" class="secondary" data-goal-state="${htmlEscape(goal.id)}" data-state="Pausada">Pausar</button>` : ""}
        ${goal.estado === "Pausada" ? `<button type="button" class="secondary" data-goal-state="${htmlEscape(goal.id)}" data-state="Activa">Reanudar</button>` : ""}
        ${goal.estado !== "Cancelada" ? `<button type="button" class="secondary" data-goal-state="${htmlEscape(goal.id)}" data-state="Cancelada">Cancelar meta</button>` : ""}
      </div>
    </article>`).join("") : `<div class="empty"><strong>Aún no hay metas de ahorro.</strong><span>Crea una meta para seguir un objetivo concreto.</span></div>`;
  const destinationRows = destinations.length ? `
    <div class="table-wrap"><table><thead><tr><th>Destino</th><th>Producto</th><th>Entidad</th><th>Capital registrado</th><th>Saldo de referencia</th><th>Liquidez</th><th>Acciones</th></tr></thead>
    <tbody>${savings.destinos.map((item) => `<tr><td data-label="Destino">${htmlEscape(item.nombre)}</td><td data-label="Producto">${htmlEscape(item.tipoProducto)}</td><td data-label="Entidad">${htmlEscape(destinations.find((destination) => destination.id === item.id)?.entidad || "—")}</td><td data-label="Capital registrado">${formatCOP(item.capitalAportado)}</td><td data-label="Saldo de referencia">${formatCOP(item.saldoContabilizadoUnaVez)}</td><td data-label="Liquidez">${htmlEscape(destinations.find((destination) => destination.id === item.id)?.liquidez || "No especificada")}</td><td data-label="Acciones"><button type="button" class="secondary" data-edit-destination="${htmlEscape(item.id)}">Editar</button></td></tr>`).join("")}</tbody></table></div>
  ` : `<div class="empty"><strong>No hay destinos registrados.</strong><span>Agrega una cuenta, fondo o producto para organizar tus aportes.</span></div>`;
  const transferRows = savings.transferencias.length ? `
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Destino</th><th>Meta</th><th>Importe</th><th>Referencia</th><th>Acciones</th></tr></thead><tbody>
      ${savings.transferencias.slice().sort((a, b) => b.fechaEfectiva.localeCompare(a.fechaEfectiva)).map((item) => `<tr><td data-label="Fecha">${htmlEscape(item.fechaEfectiva)}</td><td data-label="Destino">${htmlEscape(destinations.find((row) => row.id === item.destinoId)?.nombre || "—")}</td><td data-label="Meta">${htmlEscape(state.data.metasAhorro.find((row) => row.id === item.metaId)?.nombre || "—")}</td><td data-label="Importe">${formatCOP(item.importe)}</td><td data-label="Referencia">${htmlEscape(item.referencia || "—")}</td><td data-label="Acciones" class="row-actions"><button type="button" class="secondary" data-correct-transfer="${htmlEscape(item.id)}">Corregir</button><button type="button" class="danger" data-annul-transfer="${htmlEscape(item.id)}">Anular</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><strong>Sin transferencias confirmadas.</strong><span>Los aportes solo se contabilizan cuando registras la transferencia.</span></div>`;
  const withdrawalRows = savings.retiros.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Meta</th><th>Destino</th><th>Importe</th><th>Motivo</th></tr></thead><tbody>${savings.retiros.map((item) => `<tr><td data-label="Fecha">${htmlEscape(item.fechaEfectiva)}</td><td data-label="Meta">${htmlEscape(state.data.metasAhorro.find((goal) => goal.id === item.metaId)?.nombre || "—")}</td><td data-label="Destino">${htmlEscape(destinations.find((destination) => destination.id === item.destinoId)?.nombre || "—")}</td><td data-label="Importe">${formatCOP(item.importe)}</td><td data-label="Motivo">${htmlEscape(item.motivo || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No hay retiros registrados.</p>`;
  return `
    <section class="panel future-intro">
      <div class="panel-header"><div><h2>Mi Futuro Financiero</h2><p>Organiza metas y ahorros sin modificar los indicadores de tus gastos y saldos actuales.</p></div></div>
      <div class="future-balance-row">
        <article><span>Programado este mes</span><strong>${formatCOP(savings.ahorroProgramadoMes)}</strong></article>
        <article><span>Transferido este mes</span><strong>${formatCOP(savings.ahorroTransferidoMes)}</strong></article>
        <article><span>Pendiente de transferir</span><strong>${formatCOP(savings.ahorroPendienteTransferir)}</strong></article>
        <article><span>Dinero libre para gastar*</span><strong>${formatCOP(savings.dineroLibreParaGastar)}</strong></article>
      </div>
      <small>*Saldo proyectado menos transferencias de ahorro confirmadas del periodo. No altera el saldo disponible ni el proyectado de Inicio.</small>
      ${state.savingsError ? `<div class="alert danger" role="alert">${htmlEscape(state.savingsError)}</div>` : ""}
    </section>

    <div class="future-grid">
      <section class="panel future-card">
        <div class="panel-header"><div><h2>Planes de ahorro</h2><p>Define aportes fijos, un porcentaje de ingresos o una capacidad inteligente.</p></div></div>
        <form id="savingsPlanForm" class="grid-form">
          <label>Nombre<input name="nombre" required placeholder="Ej. Ahorro mensual" /></label>
          <label>Modalidad<select name="modalidad"><option value="fijo">Importe fijo</option><option value="porcentual">Porcentaje de ingresos</option><option value="inteligente">Ahorro inteligente</option></select></label>
          <label>Importe mensual<input type="number" min="0" step="1" name="importeMensual" value="0" /></label>
          <label>Porcentaje<input type="number" min="0" max="100" step="0.01" name="porcentaje" value="0" /></label>
          <label>Base del porcentaje<select name="basePorcentual"><option value="recibido">Ingresos recibidos</option><option value="presupuestado">Ingresos presupuestados</option></select></label>
          <label>Reserva de seguridad<input type="number" min="0" step="1" name="reservaSeguridad" value="0" /></label>
          <label>Escenario inteligente<select name="escenario"><option value="conservador">Conservador</option><option value="equilibrado" selected>Equilibrado</option><option value="ambicioso">Ambicioso</option></select></label>
          <div class="actions span-4"><button type="submit">Crear plan</button></div>
        </form>
        ${plans.length ? `<ul class="future-list">${plans.map((plan) => {
          const result = calculateSavingsPlanAmount(state.data, year, month, plan);
          return `<li><div><strong>${htmlEscape(plan.nombre)}</strong><span>${htmlEscape(plan.modalidad)} · ${formatCOP(result.amount)} estimados · capacidad ${formatCOP(result.capacity)}</span></div><span class="status ${result.affordable ? "Pagado" : "Pendiente"}">${result.affordable ? "Dentro de la capacidad" : "Supera la capacidad"}</span><button type="button" class="secondary" data-pause-plan="${htmlEscape(plan.id)}">Pausar</button></li>`;
        }).join("")}</ul>` : `<div class="empty">No hay planes activos.</div>`}
        ${state.data.planesAhorro.some((plan) => plan.estado === "Pausado") ? `<div class="future-actions">${state.data.planesAhorro.filter((plan) => plan.estado === "Pausado").map((plan) => `<button type="button" class="secondary" data-resume-plan="${htmlEscape(plan.id)}">Reanudar ${htmlEscape(plan.nombre)}</button>`).join("")}</div>` : ""}
      </section>

      <section class="panel future-card">
        <div class="panel-header"><div><h2>Metas de ahorro</h2><p>Sigue el avance con aportes confirmados y conserva el saldo inicial que registres.</p></div></div>
        <form id="savingsGoalForm" class="grid-form">
          <label>Nombre de la meta<input name="nombre" required placeholder="Ej. Fondo de emergencia" /></label>
          <label>Valor objetivo<input type="number" min="1" step="1" name="valorObjetivo" required /></label>
          <label>Saldo inicial reconocido<input type="number" min="0" step="1" name="saldoInicialReconocido" value="0" /></label>
          <label>Fecha objetivo<input type="date" name="fechaObjetivo" /></label>
          <label>Aporte mensual planeado<input type="number" min="0" step="1" name="aporteMensualPlanificado" value="0" /></label>
          <label class="span-2">Descripción<input name="descripcion" placeholder="¿Para qué estás ahorrando?" /></label>
          <div class="actions span-4"><button type="submit">Crear meta</button></div>
        </form>
        <div class="future-goals">${goalsMarkup}</div>
      </section>

      <section class="panel future-card">
        <div class="panel-header"><div><h2>Distribución mensual</h2><p>Asigna un presupuesto de ahorro entre metas activas. La suma no puede superar 100 %.</p></div></div>
        <form id="savingsDistributionForm" class="grid-form">
          <label>Presupuesto de ahorro del mes<input name="presupuestoMensual" type="number" min="0" step="1" required value="${distribution?.presupuestoMensual ?? savings.ahorroProgramadoMes}" /></label>
          ${activeGoals.map((goal) => `<label>${htmlEscape(goal.nombre)} (%)<input name="allocation_${htmlEscape(goal.id)}" type="number" min="0" max="100" step="0.01" value="${distribution?.asignaciones.find((item) => item.metaId === goal.id)?.porcentaje ?? 0}" /></label>`).join("")}
          <div class="actions span-4"><button type="submit">Guardar distribución</button></div>
        </form>
        ${distributionResult ? `<div class="allocation-summary"><strong>${distributionResult.porcentajeDistribuido}% asignado · ${formatCOP(distributionResult.importeDistribuido)}</strong><span>${distributionResult.porcentajeSinDistribuir}% sin asignar · ${formatCOP(distributionResult.importeSinDistribuir)}</span>${distributionResult.allocations.map((item) => `<small>${htmlEscape(item.nombre)}: ${formatCOP(item.importe)}</small>`).join("")}</div>` : `<p class="muted">Aún no hay distribución para este periodo.</p>`}
      </section>

      <section class="panel future-card">
        <div class="panel-header"><div><h2>Destinos financieros</h2><p>Registra cuentas, fondos, CDT y otras alternativas. Las tasas solo alimentan simulaciones.</p></div></div>
        <form id="savingsDestinationForm" class="grid-form">
          <label>Nombre<input name="nombre" required placeholder="Ej. Cuenta de ahorro" /></label>
          <label>Entidad<input name="entidad" placeholder="Banco o entidad" /></label>
          <label>Tipo de producto<select name="tipoProducto">${options(["Cuenta de ahorros", "Cuenta remunerada", "Fondo de inversión colectiva", "CDT", "Otro"], "Cuenta de ahorros")}</select></label>
          <label>Saldo de referencia<input name="saldoDeclarado" type="number" min="0" step="1" value="0" /></label>
          <label>Capital aportado conocido<input name="capitalAportado" type="number" min="0" step="1" value="0" /></label>
          <label>Tasa anual (%)<input name="tasaAnual" type="number" min="-100" step="0.01" value="0" /></label>
          <label>Tipo de tasa<select name="tipoTasa"><option value="efectiva">Efectiva anual</option><option value="nominal">Nominal anual</option></select></label>
          <label>Liquidez<input name="liquidez" placeholder="Ej. inmediata, 90 días" /></label>
          <div class="actions span-4"><button type="submit">Agregar destino</button></div>
        </form>
        ${destinationRows}
      </section>

      <section class="panel future-card">
        <div class="panel-header"><div><h2>Calendario de aportes</h2><p>Compromisos del periodo ${monthLabel(month)} ${year}, con estados por fecha y pagos parciales.</p></div></div>
        <form id="scheduledSavingsForm" class="grid-form">
          <label>Fecha programada<input name="fechaProgramada" type="date" required value="${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, "0")}-15" /></label>
          <label>Importe previsto<input name="importePrevisto" type="number" min="1" step="1" required /></label>
          <label>Meta<select name="metaId"><option value="">Sin meta</option>${recordOptions(activeGoals)}</select></label>
          <label>Destino<select name="destinoId"><option value="">Sin destino</option>${recordOptions(destinations)}</select></label>
          <label>Plan<select name="planId"><option value="">Sin plan</option>${recordOptions(plans)}</select></label>
          <label class="span-2">Observaciones<input name="observaciones" /></label>
          <div class="actions span-4"><button type="submit">Programar aporte</button></div>
        </form>
        ${commitments.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Importe previsto</th><th>Transferido</th><th>Pendiente</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${commitments.map((item) => {
          const transferred = state.data.transferenciasAhorro.filter((transfer) => transfer.aporteProgramadoId === item.id && transfer.estado !== "Cancelada").reduce((sum, transfer) => sum + Number(transfer.importe || 0), 0);
          return `<tr><td data-label="Fecha">${htmlEscape(item.fechaProgramada)}</td><td data-label="Importe previsto">${formatCOP(item.importePrevisto)}</td><td data-label="Transferido">${formatCOP(transferred)}</td><td data-label="Pendiente">${formatCOP(Math.max(0, item.importePrevisto - transferred))}</td><td data-label="Estado"><span class="status ${savingsCommitmentStatus(item, state.data.transferenciasAhorro)}">${savingsCommitmentStatus(item, state.data.transferenciasAhorro)}</span></td><td data-label="Acción"><button type="button" class="secondary" data-cancel-scheduled="${htmlEscape(item.id)}">Cancelar</button></td></tr>`;
        }).join("")}</tbody></table></div>` : `<div class="empty">No hay aportes programados para este mes.</div>`}
        <form id="savingsTransferForm" class="grid-form future-transfer-form">
          <h3 class="span-4">Registrar transferencia confirmada</h3>
          <label>Aporte programado<select name="aporteProgramadoId" required>${transferables.map((item) => `<option value="${htmlEscape(item.id)}">${htmlEscape(item.fechaProgramada)} · ${formatCOP(Math.max(0, item.importePrevisto - state.data.transferenciasAhorro.filter((transfer) => transfer.aporteProgramadoId === item.id && transfer.estado !== "Cancelada").reduce((sum, transfer) => sum + Number(transfer.importe || 0), 0)))} pendiente</option>`).join("")}</select></label>
          <label>Importe transferido<input name="importe" type="number" min="1" step="1" required /></label>
          <label>Fecha efectiva<input name="fechaEfectiva" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label>Referencia<input name="referencia" /></label>
          <div class="actions span-4"><button type="submit" ${transferables.length ? "" : "disabled"}>Confirmar transferencia</button></div>
        </form>
      </section>

      <section class="panel future-card">
        <div class="panel-header"><div><h2>Retiros de ahorro</h2><p>Los retiros confirmados reducen el ahorro acumulado sin reescribir transferencias anteriores.</p></div></div>
        <form id="savingsWithdrawalForm" class="grid-form">
          <label>Meta<select name="metaId" required>${recordOptions(activeGoals, activeGoals[0]?.id || "")}</select></label>
          <label>Destino<select name="destinoId"><option value="">Sin destino</option>${recordOptions(destinations)}</select></label>
          <label>Importe retirado<input name="importe" type="number" min="1" step="1" required /></label>
          <label>Fecha efectiva<input name="fechaEfectiva" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label class="span-2">Motivo<input name="motivo" /></label>
          <div class="actions span-4"><button type="submit" ${activeGoals.length ? "" : "disabled"}>Registrar retiro</button></div>
        </form>
      </section>

      <section class="panel future-card">
        <div class="panel-header"><div><h2>Simulador de rendimientos</h2><p>Proyección hipotética; no representa rentabilidad garantizada ni saldo real.</p></div></div>
        <form id="savingsSimulationForm" class="grid-form">
          <label>Producto<select name="tipoProducto">${options(["Cuenta de ahorros", "Cuenta remunerada", "Fondo de inversión colectiva", "CDT", "Otro"], "Cuenta remunerada")}</select></label>
          <label>Capital inicial<input name="capitalInicial" type="number" min="0" value="0" /></label>
          <label>Aporte periódico<input name="aportePeriodico" type="number" min="0" value="0" /></label>
          <label>Periodicidad<select name="periodicidad"><option value="mensual">Mensual</option><option value="quincenal">Quincenal</option><option value="semanal">Semanal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option></select></label>
          <label>Tasa anual (%)<input name="tasaAnual" type="number" min="-100" step="0.01" value="0" /></label>
          <label>Tipo de tasa<select name="tipoTasa"><option value="efectiva">Efectiva anual</option><option value="nominal">Nominal anual</option></select></label>
          <label>Capitalizaciones por año<input name="capitalizacionPorAnio" type="number" min="1" value="12" /></label>
          <label>Plazo (meses)<input name="plazoMeses" type="number" min="1" value="12" /></label>
          <label>Costos mensuales<input name="costosMensuales" type="number" min="0" value="0" /></label>
          <label>Costo inicial<input name="costoApertura" type="number" min="0" value="0" /></label>
          <label>Retención sobre intereses (%)<input name="retencionPorcentaje" type="number" min="0" max="100" value="0" /></label>
          <label class="future-check"><input name="permiteAportesDuranteVigencia" type="checkbox" /> Permite aportes durante la vigencia</label>
          <div class="actions span-4"><button type="submit">Simular</button></div>
        </form>
        ${simulation ? `<div class="simulation-result" role="status"><strong>Valor futuro estimado: ${formatCOP(simulation.valorFuturoEstimado)}</strong><span>Capital aportado ${formatCOP(simulation.capitalAportado)} · Rendimiento bruto ${formatCOP(simulation.rendimientoBrutoEstimado)}</span><span>Costos ${formatCOP(simulation.costosEstimados)} · Retenciones ${formatCOP(simulation.retencionesEstimadas)}</span><small>${htmlEscape(simulation.advertencia)}${simulation.aportesAdicionalesHabilitados ? "" : " El CDT no admite aportes adicionales durante el plazo."}</small></div>` : ""}
      </section>

      <section class="panel future-card future-span">
        <div class="panel-header"><div><h2>Progreso e historial</h2><p>Los movimientos se registran como transferencias internas; no son gastos de consumo.</p></div></div>
        <h3>Transferencias confirmadas</h3>
        ${transferRows}
        <h3>Retiros registrados</h3>
        ${withdrawalRows}
      </section>
    </div>
  `;
}

function simpleTable(rows, columns, config = {}) {
  if (!rows.length) return $("#emptyState").innerHTML;
  const labels = {
    categoria: "Categoria",
    concepto: "Detalle",
    valorPresupuestado: "Presupuestado",
    valorPagado: "Recibido",
    valorFaltante: "Pendiente",
  };
  return `
    <div class="table-wrap"><table>
      <thead><tr>${columns.map((col) => `<th>${labels[col] || col}</th>`).join("")}${config.editType ? "<th>Acciones</th>" : ""}</tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          ${columns.map((col) => {
            const raw = row[col];
            const label = labels[col] || col;
            if (config.money?.includes(col)) return `<td data-label="${htmlEscape(label)}">${formatCOP(raw)}</td>`;
            if (col === "estado") return `<td data-label="${htmlEscape(label)}"><span class="status ${htmlEscape(raw)}">${htmlEscape(raw)}</span></td>`;
            return `<td data-label="${htmlEscape(label)}">${htmlEscape(raw)}</td>`;
          }).join("")}
          ${config.editType ? actionCell(row, config) : ""}
        </tr>`).join("")}</tbody>
    </table></div>
  `;
}

function actionCell(row, config) {
  const type = config.editType;
  const idValue = htmlEscape(row.id);
  const extra = config.debtPay ? `<button class="secondary" data-pay-debt="${idValue}">Abonar</button>` : "";
  return `<td data-label="Acciones" class="row-actions">${extra}<button class="secondary" data-edit-${type}="${idValue}">Editar</button><button class="danger" data-delete-${type}="${idValue}">Eliminar</button></td>`;
}

function upsert(listName, item) {
  const updated = upsertRecord(state.data[listName], item);
  if (!saveState({ ...state.data, [listName]: updated })) return;
  if (["planesAhorro", "metasAhorro", "distribucionesAhorro", "destinosFinancieros", "aportesProgramados"].includes(listName)) {
    state.savingsError = "";
  }
  state.edit = null;
  if (listName === "movimientos") state.movementModal = false;
  render();
}

function removeFrom(listName, idValue, label) {
  if (!confirm(`Eliminar ${label}? Esta accion no se puede deshacer.`)) return;
  const next = { ...state.data, [listName]: removeRecord(state.data[listName], idValue) };
  if (!saveState(next)) return;
  render();
}

function backupFileName(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `App_Finanzas_Respaldo_${yyyy}-${mm}-${dd}.json`;
}

function downloadFile(contents, fileName) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBackup() {
  try {
    const original = localStorage.getItem(STORAGE_KEY);
    const parsed = original === null ? null : JSON.parse(original);
    if (original !== null && !validateBackup(parsed).ok && state.readOnly) {
      downloadFile(original, backupFileName());
      return true;
    }
    downloadFile(JSON.stringify(createBackup(state.data), null, 2), backupFileName());
    return true;
  } catch (error) {
    console.error("No fue posible crear el archivo de respaldo.", error);
    state.importError = "No fue posible preparar el respaldo. Revisa el almacenamiento local e intenta de nuevo.";
    render();
    return false;
  }
}

async function previewBackupFile(file) {
  state.importError = "";
  state.importPreview = null;
  if (file.size > 10 * 1024 * 1024) {
    state.importError = "El archivo supera el limite de 10 MB.";
    render();
    return;
  }
  try {
    const raw = await file.text();
    const payload = JSON.parse(raw);
    const validation = validateBackup(payload);
    if (!validation.ok) throw new Error(validation.message);
    const counts = backupCounts(payload);
    const extracted = extractBackupData(payload);
    const merge = mergeBackup(state.data, payload);
    state.importPreview = { raw, payload, extracted, counts, merge };
  } catch (error) {
    state.importError = `No se pudo validar el respaldo: ${error.message}`;
  }
  render();
}

function confirmRestoreBackup() {
  const preview = state.importPreview;
  if (!preview) return;
  if (!confirm("Restaurar sustituira los datos actuales. Se descargara y archivara una copia de los datos actuales antes de continuar. ¿Deseas seguir?")) return;
  if (!downloadBackup()) return;
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    if (currentRaw !== null) archiveStorageValue(localStorage, currentRaw);
    if (preview.counts.schemaVersion < DATA_SCHEMA_VERSION) archiveStorageValue(localStorage, preview.raw);
    const restored = ensureSimpleState(restoreStateFromBackup(state.data, preview.payload));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    state.data = restored;
    state.readOnly = false;
    state.persistenceMessage = "";
    state.importPreview = null;
    state.importError = "";
    alert("El respaldo fue restaurado correctamente.");
    render();
  } catch (error) {
    console.error("No fue posible restaurar el respaldo.", error);
    state.importError = `No se completo la restauracion: ${storageErrorMessage(error)} Los datos anteriores se conservaron.`;
    render();
  }
}

function confirmMergeBackup() {
  const preview = state.importPreview;
  if (!preview) return;
  if (!confirm("Se agregaran solo los registros nuevos. Los identificadores en conflicto conservaran el contenido actual. ¿Deseas continuar?")) return;
  const next = ensureSimpleState(preview.merge.state);
  if (!saveState(next)) return;
  const conflictCount = preview.merge.conflicts.length;
  const addedCount = Object.values(preview.merge.added).reduce((sum, count) => sum + count, 0);
  state.importPreview = null;
  state.importError = "";
  alert(`Combinacion completada: ${addedCount} registro(s) nuevos agregados. ${conflictCount} conflicto(s) no se sobrescribieron.`);
  render();
}

function copyPreviousMovements() {
  const previous = previousPeriod();
  const rows = getPreviousPeriodExpenses();
  if (!rows.length) {
    alert(`No hay movimientos en ${monthLabel(previous.month)} ${previous.year} para copiar.`);
    return;
  }
  state.copyModal = { sourceRows: rows, selectedIds: rows.map((item) => item.id), includePossibleIds: [] };
  render();
}

function confirmCopySelected() {
  const copyModal = state.copyModal;
  if (!copyModal) return;
  const plan = buildMovementCopyPlan(
    copyModal.sourceRows,
    state.data.movimientos,
    activeYear(),
    activeMonth(),
    copyModal.selectedIds,
    copyModal.includePossibleIds,
  );
  if (!plan.copies.length) {
    const duplicateNames = plan.entries
      .filter((entry) => entry.type === "duplicate")
      .map((entry) => entry.source.descripcion || entry.source.categoria || entry.source.id);
    alert(duplicateNames.length
      ? `No se agregaron movimientos. Ya existian copias para: ${duplicateNames.join(", ")}.`
      : "No hay movimientos nuevos para copiar. Revisa la seleccion o confirma las posibles coincidencias.");
    return;
  }
  const includedPossible = plan.entries.filter((entry) => entry.type === "possible" && entry.included);
  const summary = [
    `Seleccionados: ${plan.selectedCount}`,
    `Nuevos: ${plan.newCount}`,
    `Ya copiados: ${plan.duplicateCount}`,
    `Posibles duplicados: ${plan.possibleCount}`,
    `Valor nuevo: ${formatCOP(plan.totalNewValue)}`,
  ];
  if (includedPossible.length) summary.push(`Se incluiran posibles coincidencias: ${includedPossible.map((entry) => entry.source.descripcion || entry.source.categoria).join(", ")}`);
  if (!confirm(`Confirma la copia al periodo ${plan.targetPeriod}:\n\n${summary.join("\n")}\n\nLas copias nuevas comenzaran con $0 pagado.`)) return;
  if (!saveState({ ...state.data, movimientos: [...plan.copies, ...state.data.movimientos] })) return;
  state.copyModal = null;
  render();
}

function bindEvents() {
  document.querySelector("[data-download-backup]")?.addEventListener("click", downloadBackup);
  document.querySelector("[data-import-backup]")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    if (file) previewBackupFile(file);
  });
  document.querySelector("[data-restore-backup]")?.addEventListener("click", confirmRestoreBackup);
  document.querySelector("[data-merge-backup]")?.addEventListener("click", confirmMergeBackup);
  document.querySelector("[data-cancel-backup]")?.addEventListener("click", () => {
    state.importPreview = null;
    state.importError = "";
    render();
  });
  document.querySelectorAll("[data-cancel-copy]").forEach((button) => button.addEventListener("click", () => {
    state.copyModal = null;
    render();
  }));
  document.querySelector("[data-copy-select-all]")?.addEventListener("change", (event) => {
    state.copyModal.selectedIds = event.currentTarget.checked ? state.copyModal.sourceRows.map((item) => item.id) : [];
    render();
  });
  document.querySelectorAll("[data-copy-item]").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const idValue = event.currentTarget.dataset.copyItem;
    const selected = new Set(state.copyModal.selectedIds);
    if (event.currentTarget.checked) selected.add(idValue);
    else selected.delete(idValue);
    state.copyModal.selectedIds = [...selected];
    if (!event.currentTarget.checked) state.copyModal.includePossibleIds = state.copyModal.includePossibleIds.filter((id) => id !== idValue);
    render();
  }));
  document.querySelectorAll("[data-copy-possible]").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const idValue = event.currentTarget.dataset.copyPossible;
    const included = new Set(state.copyModal.includePossibleIds);
    if (event.currentTarget.checked) included.add(idValue);
    else included.delete(idValue);
    state.copyModal.includePossibleIds = [...included];
    render();
  }));
  document.querySelector("[data-confirm-copy]")?.addEventListener("click", confirmCopySelected);
  $("#movementForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = serializeForm(event.currentTarget);
    if (payload.categoria === "Otro") {
      const customCategory = addExpenseCategory(payload.categoriaManual);
      if (!customCategory) {
        alert("Escribe el nombre de la nueva categoria.");
        return;
      }
      payload.categoria = customCategory;
    }
    const original = state.data.movimientos.find((item) => item.id === payload.id);
    if (original?.migracionFinanciera) payload.migracionFinanciera = original.migracionFinanciera;
    if (original?.origenCopiaId) payload.origenCopiaId = original.origenCopiaId;
    if (original?.periodoCopia) payload.periodoCopia = original.periodoCopia;
    payload.versionModeloFinanciero = 2;
    upsert("movimientos", normalizeMovement(payload));
  });

  $("#budgetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = serializeForm(event.currentTarget);
    const original = state.data.presupuestos.find((item) => item.id === payload.id);
    if (original?.migracionFinanciera) payload.migracionFinanciera = original.migracionFinanciera;
    payload.tipo = "Ingreso";
    payload.versionModeloFinanciero = 2;
    upsert("presupuestos", normalizeBudgetItem(payload));
  });

  $("#savingsPlanForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = serializeForm(event.currentTarget);
    const plan = normalizeSavingsPlan(payload);
    if (!plan.nombre.trim()) return alert("Escribe un nombre para el plan.");
    upsert("planesAhorro", plan);
  });

  $("#savingsGoalForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = serializeForm(event.currentTarget);
    const goal = normalizeSavingsGoal(payload);
    if (!goal.nombre.trim() || goal.valorObjetivo <= 0) return alert("La meta requiere un nombre y un valor objetivo mayor que cero.");
    upsert("metasAhorro", goal);
  });

  $("#savingsDistributionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(event.currentTarget);
      const assignments = Object.entries(payload)
        .filter(([key, value]) => key.startsWith("allocation_") && Number(value) > 0)
        .map(([key, value]) => ({ metaId: key.slice("allocation_".length), porcentaje: Number(value) }));
      const current = state.data.distribucionesAhorro.find((item) => item.anio === activeYear() && item.mes === activeMonth());
      const item = normalizeSavingsDistribution({
        ...current,
        anio: activeYear(),
        mes: activeMonth(),
        presupuestoMensual: payload.presupuestoMensual,
        asignaciones: assignments,
      });
      calculateSavingsDistribution(item, state.data.metasAhorro);
      upsert("distribucionesAhorro", item);
    } catch (error) {
      state.savingsError = error.message;
      render();
    }
  });

  $("#savingsDestinationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const destination = normalizeFinancialDestination(serializeForm(event.currentTarget));
    if (!destination.nombre.trim()) return alert("Escribe un nombre para el destino financiero.");
    upsert("destinosFinancieros", destination);
  });

  $("#scheduledSavingsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const item = normalizeScheduledSavings(serializeForm(event.currentTarget));
    if (!item.fechaProgramada || item.importePrevisto <= 0) return alert("Indica una fecha y un importe previsto mayor que cero.");
    upsert("aportesProgramados", item);
  });

  $("#savingsTransferForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(event.currentTarget);
      const next = registerSavingsTransfer(state.data, payload);
      if (!saveState(next)) return;
      state.savingsError = "";
      render();
    } catch (error) {
      state.savingsError = error.message;
      render();
    }
  });

  $("#savingsWithdrawalForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const next = registerSavingsWithdrawal(state.data, serializeForm(event.currentTarget));
      if (!saveState(next)) return;
      state.savingsError = "";
      render();
    } catch (error) {
      state.savingsError = error.message;
      render();
    }
  });

  $("#savingsSimulationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(event.currentTarget);
      payload.permiteAportesDuranteVigencia = event.currentTarget.elements.permiteAportesDuranteVigencia.checked;
      state.savingsSimulation = simulateSavingsReturns(payload);
      state.savingsError = "";
    } catch (error) {
      state.savingsError = error.message;
    }
    render();
  });

  document.querySelectorAll("[data-goal-state]").forEach((button) => button.addEventListener("click", () => {
    const goal = state.data.metasAhorro.find((item) => item.id === button.dataset.goalState);
    if (!goal) return;
    const updated = normalizeSavingsGoal({ ...goal, estado: button.dataset.state });
    upsert("metasAhorro", updated);
  }));
  document.querySelectorAll("[data-edit-goal]").forEach((button) => button.addEventListener("click", () => {
    const goal = state.data.metasAhorro.find((item) => item.id === button.dataset.editGoal);
    if (!goal) return;
    const nombre = prompt("Nombre de la meta:", goal.nombre);
    if (nombre === null) return;
    const valorObjetivo = prompt("Valor objetivo (COP):", String(goal.valorObjetivo));
    if (valorObjetivo === null) return;
    const fechaObjetivo = prompt("Fecha objetivo (AAAA-MM-DD, opcional):", goal.fechaObjetivo || "");
    if (fechaObjetivo === null) return;
    if (!nombre.trim() || !Number.isFinite(Number(valorObjetivo)) || Number(valorObjetivo) <= 0) {
      state.savingsError = "La meta requiere un nombre y un valor objetivo mayor que cero.";
      render();
      return;
    }
    upsert("metasAhorro", normalizeSavingsGoal({ ...goal, nombre, valorObjetivo, fechaObjetivo }));
  }));
  document.querySelectorAll("[data-edit-destination]").forEach((button) => button.addEventListener("click", () => {
    const destination = state.data.destinosFinancieros.find((item) => item.id === button.dataset.editDestination);
    if (!destination) return;
    const nombre = prompt("Nombre del destino:", destination.nombre);
    if (nombre === null) return;
    const tasaAnual = prompt("Tasa anual porcentual (solo para simulaciones):", String(destination.tasaAnual));
    if (tasaAnual === null) return;
    if (!nombre.trim() || !Number.isFinite(Number(tasaAnual)) || Number(tasaAnual) < -100) {
      state.savingsError = "Revisa el nombre y la tasa anual del destino.";
      render();
      return;
    }
    upsert("destinosFinancieros", normalizeFinancialDestination({ ...destination, nombre, tasaAnual }));
  }));
  document.querySelectorAll("[data-pause-plan], [data-resume-plan]").forEach((button) => button.addEventListener("click", () => {
    const idValue = button.dataset.pausePlan || button.dataset.resumePlan;
    const plan = state.data.planesAhorro.find((item) => item.id === idValue);
    if (!plan) return;
    upsert("planesAhorro", normalizeSavingsPlan({ ...plan, estado: plan.estado === "Pausado" ? "Activo" : "Pausado" }));
  }));
  document.querySelectorAll("[data-cancel-scheduled]").forEach((button) => button.addEventListener("click", () => {
    const item = state.data.aportesProgramados.find((row) => row.id === button.dataset.cancelScheduled);
    if (!item || !confirm("¿Cancelar este aporte programado? Las transferencias ya confirmadas se conservarán en el historial.")) return;
    upsert("aportesProgramados", normalizeScheduledSavings({ ...item, estado: "Cancelado" }));
  }));
  document.querySelectorAll("[data-annul-transfer]").forEach((button) => button.addEventListener("click", () => {
    if (!confirm("¿Anular esta transferencia? Se conservará en el historial como anulada y dejará de contar como ahorro confirmado.")) return;
    try {
      const next = annulSavingsTransfer(state.data, button.dataset.annulTransfer);
      if (saveState(next)) render();
    } catch (error) {
      state.savingsError = error.message;
      render();
    }
  }));
  document.querySelectorAll("[data-correct-transfer]").forEach((button) => button.addEventListener("click", () => {
    const transfer = state.data.transferenciasAhorro.find((item) => item.id === button.dataset.correctTransfer);
    if (!transfer) return;
    const amount = prompt("Importe correcto de la transferencia (COP):", String(transfer.importe));
    if (amount === null) return;
    const date = prompt("Fecha efectiva correcta (AAAA-MM-DD):", transfer.fechaEfectiva);
    if (date === null) return;
    try {
      const next = correctSavingsTransfer(state.data, transfer.id, { importe: amount, fechaEfectiva: date });
      if (saveState(next)) render();
    } catch (error) {
      state.savingsError = error.message;
      render();
    }
  }));

  document.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", () => { state.edit = null; state.movementModal = false; render(); }));
  document.querySelector("[data-open-movement-modal]")?.addEventListener("click", () => { state.edit = null; state.movementModal = true; render(); });
  document.querySelectorAll("[data-close-movement-modal]").forEach((button) => button.addEventListener("click", () => { state.edit = null; state.movementModal = false; render(); }));
  document.querySelectorAll("[data-edit-movement]").forEach((button) => button.addEventListener("click", () => { state.edit = { type: "movimiento", id: button.dataset.editMovement }; state.movementModal = true; render(); }));
  document.querySelectorAll("[data-delete-movement]").forEach((button) => button.addEventListener("click", () => removeFrom("movimientos", button.dataset.deleteMovement, "movimiento")));
  document.querySelectorAll("[data-pay-movement]").forEach((button) => button.addEventListener("click", () => {
    const movement = state.data.movimientos.find((item) => item.id === button.dataset.payMovement);
    if (!movement) return;
    const updatedMovement = {
      ...movement,
      valorPagado: movement.valorPresupuestado,
      valorFaltante: 0,
      estado: "Pagado",
      versionModeloFinanciero: 2,
    };
    if (!saveState({ ...state.data, movimientos: state.data.movimientos.map((item) => item.id === movement.id ? updatedMovement : item) })) return;
    render();
  }));
  document.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", () => removeExpenseCategory(button.dataset.deleteCategory)));
  document.querySelector("[data-copy-movements]")?.addEventListener("click", copyPreviousMovements);
  document.querySelectorAll("[data-edit-budget]").forEach((button) => button.addEventListener("click", () => { state.edit = { type: "presupuesto", id: button.dataset.editBudget }; render(); }));
  document.querySelectorAll("[data-delete-budget]").forEach((button) => button.addEventListener("click", () => removeFrom("presupuestos", button.dataset.deleteBudget, "presupuesto")));
  $("#movementCategory")?.addEventListener("change", (event) => {
    const field = $("#customCategoryField");
    if (!field) return;
    field.classList.toggle("hidden", event.target.value !== "Otro");
  });
}

function render() {
  renderNavigation();
  renderPeriodControls();
  const title = views.find(([id]) => id === state.view)?.[1] || "Dashboard";
  titleEl.textContent = title;
  const renderers = {
    dashboard: renderDashboard,
    movimientos: renderMovimientos,
    presupuesto: renderPresupuesto,
    futuro: renderFutureFinance,
  };
  viewEl.innerHTML = `${state.persistenceMessage ? `<div class="alert danger" role="alert">${htmlEscape(state.persistenceMessage)}</div>` : ""}${(renderers[state.view] || renderDashboard)()}`;
  bindEvents();
}

render();
