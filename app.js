import {
  MONTHS,
  PAYMENT_METHODS,
  STORAGE_KEY,
  DATA_SCHEMA_VERSION,
  addSavingAssignment,
  addSavingWithdrawal,
  calculateSimpleSavings,
  normalizeSavingEntry,
  removeSavingEntry,
  toggleSavingTransferred,
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

const NAV_ICONS = {
  dashboard: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/>',
  presupuesto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>',
  movimientos: '<path d="M4 8h14"/><path d="m14.5 4.5 3.5 3.5-3.5 3.5"/><path d="M20 16H6"/><path d="m9.5 12.5L6 16l3.5 3.5"/>',
  futuro: '<path d="M12 3l2.4 5.6 6.1.6-4.6 4 1.4 6-5.3-3.2-5.3 3.2 1.4-6-4.6-4 6.1-.6z"/>',
};

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
    || ["movimientos", "presupuestos", "categorias", "deudas", "metasAhorro", "planesAhorro", "distribucionesAhorro", "destinosFinancieros", "aportesProgramados", "transferenciasAhorro", "retirosAhorro", "ahorros"].some((name) => {
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
    ahorros: (data.ahorros || []).map(normalizeSavingEntry),
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
  const markup = views.map(([id, label]) => `<button class="${state.view === id ? "active" : ""}" data-view="${id}" aria-label="${label}"${state.view === id ? ' aria-current="page"' : ""}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[id] || ""}</svg><span>${label}</span></button>`).join("");
  $("#desktopNav").innerHTML = markup;
  $("#mobileNav").innerHTML = markup;
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
  const surplus = calculateMonthlySummary(state.data, year, month).saldoProyectado;
  const sv = calculateSimpleSavings(state.data, year, month, surplus);
  const today = new Date().toISOString().slice(0, 10);
  const withBalance = sv.objetivos.filter((item) => item.saldo > 0);
  const assignmentRows = sv.asignaciones.length ? `<ul class="saving-list">${sv.asignaciones.map((item) => `
    <li class="${item.transferido ? "done" : ""}">
      <div class="saving-info"><strong>${htmlEscape(item.objetivo)}</strong><span>${formatCOP(item.importe)} · ${item.porcentaje}% del sobrante</span>
        <progress max="100" value="${Math.min(100, item.porcentaje)}" aria-label="${item.porcentaje}% del sobrante"></progress></div>
      <label class="saving-check"><input type="checkbox" data-toggle-saving="${htmlEscape(item.id)}" ${item.transferido ? "checked" : ""} /> Consignado</label>
      <button type="button" class="secondary" data-delete-saving="${htmlEscape(item.id)}" aria-label="Eliminar asignación">Quitar</button>
    </li>`).join("")}</ul>` : `<div class="empty"><strong>Aún no asignas el sobrante.</strong><span>Agrega un objetivo y el valor que quieres ahorrar.</span></div>`;
  const objectiveRows = sv.objetivos.length ? `<div class="table-wrap"><table><thead><tr><th>Objetivo</th><th>Consignado</th><th>Por consignar</th><th>Retirado</th><th>Ahorro actual</th></tr></thead><tbody>${sv.objetivos.map((item) => `<tr><td data-label="Objetivo">${htmlEscape(item.nombre)}</td><td data-label="Consignado">${formatCOP(item.consignado)}</td><td data-label="Por consignar">${formatCOP(item.pendiente)}</td><td data-label="Retirado">${formatCOP(item.retirado)}</td><td data-label="Ahorro actual"><strong>${formatCOP(item.saldo)}</strong></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><strong>Sin ahorros todavía.</strong><span>Tus objetivos aparecerán aquí.</span></div>`;
  const withdrawalRows = sv.retiros.length ? `<ul class="saving-list">${sv.retiros.map((item) => `<li><div class="saving-info"><strong>${htmlEscape(item.objetivo)} · ${formatCOP(item.importe)}</strong><span>${htmlEscape(item.fecha)}${item.motivo ? ` · ${htmlEscape(item.motivo)}` : ""}</span></div><button type="button" class="secondary" data-delete-saving="${htmlEscape(item.id)}">Deshacer</button></li>`).join("")}</ul>` : "";
  return `
    <section class="future-hero">
      <div class="future-hero-text"><span class="future-eyebrow">Mi Futuro</span><h2>Sobrante de ${monthLabel(month)} ${year}</h2><p>Lo que queda después de pagar tus obligaciones. Repártelo entre tus objetivos de ahorro.</p>
        <div class="future-hero-bar"><progress max="100" value="${Math.min(100, sv.porcentajeAsignado)}" aria-label="Sobrante asignado"></progress><small>${sv.porcentajeAsignado}% asignado · ${formatCOP(sv.asignadoMes)}</small></div></div>
      <div class="future-hero-badge"><span>Disponible para asignar</span><strong>${formatCOP(sv.disponibleParaAsignar)}</strong><small>de ${formatCOP(sv.sobrante)} de sobrante</small></div>
    </section>
    <section class="metrics future-metrics" aria-label="Resumen de ahorro">
      ${metric("Ahorro acumulado", formatCOP(sv.acumulado), "Consignado menos retiros, hasta este mes", "good")}
      ${metric("Por consignar", formatCOP(sv.pendienteConsignar), "Asignado sin transferir", sv.pendienteConsignar ? "warn" : "good")}
      ${metric("Total retirado", formatCOP(sv.totalRetirado), "Descontado del acumulado")}
    </section>
    ${state.savingsError ? `<div class="alert danger" role="alert">${htmlEscape(state.savingsError)}</div>` : ""}
    <div class="future-grid">
      <section class="panel future-card tone-goal">
        <div class="panel-header"><span class="future-icon" aria-hidden="true">🎯</span><div><h2>Asignar sobrante</h2><p>Cada valor se resta del disponible y calcula su porcentaje.</p></div></div>
        <form id="savingAssignForm" class="grid-form">
          <label>Objetivo<input name="objetivo" list="savingGoals" required placeholder="Ej. Fondo de emergencia" autocomplete="off" /></label>
          <datalist id="savingGoals">${sv.objetivos.map((item) => `<option value="${htmlEscape(item.nombre)}"></option>`).join("")}</datalist>
          <label>Valor<input type="number" name="importe" min="1" step="1" required max="${Math.max(0, sv.disponibleParaAsignar)}" /></label>
          <label class="future-check"><input type="checkbox" name="transferido" /> Ya fue consignado</label>
          <div class="actions span-4"><button type="submit" ${sv.disponibleParaAsignar > 0 ? "" : "disabled"}>Asignar</button></div>
        </form>
        ${assignmentRows}
      </section>
      <section class="panel future-card tone-wd">
        <div class="panel-header"><span class="future-icon" aria-hidden="true">💸</span><div><h2>Retirar ahorro</h2><p>El retiro se descuenta del acumulado del objetivo.</p></div></div>
        <form id="savingWithdrawForm" class="grid-form">
          <label>Objetivo<select name="objetivo" required>${withBalance.map((item) => `<option value="${htmlEscape(item.nombre)}">${htmlEscape(item.nombre)} (${formatCOP(item.saldo)})</option>`).join("")}</select></label>
          <label>Valor<input type="number" name="importe" min="1" step="1" required /></label>
          <label>Fecha<input type="date" name="fecha" required value="${today}" /></label>
          <label class="span-2">Motivo<input name="motivo" placeholder="¿Para qué lo retiras?" /></label>
          <div class="actions span-4"><button type="submit" ${withBalance.length ? "" : "disabled"}>Registrar retiro</button></div>
        </form>
        ${withdrawalRows}
      </section>
      <section class="panel future-card tone-hist future-span">
        <div class="panel-header"><span class="future-icon" aria-hidden="true">🏦</span><div><h2>Mis ahorros por objetivo</h2><p>Suma los meses anteriores hasta ${monthLabel(month)} ${year}.</p></div></div>
        ${objectiveRows}
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
  if (["ahorros"].includes(listName)) {
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

  const surplusNow = () => calculateMonthlySummary(state.data, activeYear(), activeMonth()).saldoProyectado;
  const commitSavings = (build) => {
    try {
      const next = build();
      state.savingsError = "";
      if (saveState(next)) render();
    } catch (error) {
      state.savingsError = error.message;
      render();
    }
  };
  $("#savingAssignForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = serializeForm(event.currentTarget);
    payload.transferido = payload.transferido === "on";
    commitSavings(() => addSavingAssignment(state.data, payload, surplusNow(), activeYear(), activeMonth()));
  });
  $("#savingWithdrawForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    commitSavings(() => addSavingWithdrawal(state.data, serializeForm(event.currentTarget)));
  });
  document.querySelectorAll("[data-toggle-saving]").forEach((input) => input.addEventListener("change", () => {
    commitSavings(() => toggleSavingTransferred(state.data, input.dataset.toggleSaving));
  }));
  document.querySelectorAll("[data-delete-saving]").forEach((button) => button.addEventListener("click", () => {
    if (!confirm("¿Eliminar este registro de ahorro?")) return;
    commitSavings(() => removeSavingEntry(state.data, button.dataset.deleteSaving));
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
