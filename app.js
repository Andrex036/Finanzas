import {
  MONTHS,
  PAYMENT_METHODS,
  STORAGE_KEY,
  createInitialState,
  formatCOP,
  getMonthlyMovements,
  normalizeBudgetItem,
  normalizeMovement,
  validateBackup,
} from "./finance-core.js";

const views = [
  ["dashboard", "Inicio"],
  ["presupuesto", "Presupuesto"],
  ["movimientos", "Movimientos"],
];

const START_YEAR = 2026;
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, index) => START_YEAR + index);
const RESOURCE_TYPES = ["Nomina", "Arriendos", "Trabajos profesionales", "Proyectos", "Otros ingresos"];
const DEFAULT_EXPENSE_CATEGORIES = ["Mercado", "Comida", "Vivienda", "Servicios", "Transporte", "Educacion", "Salud", "Recreacion", "Otros gastos"];

const state = {
  data: loadState(),
  view: "dashboard",
  edit: null,
  movementModal: false,
};

const $ = (selector) => document.querySelector(selector);
const viewEl = $("#view");
const titleEl = $("#viewTitle");
const yearSelect = $("#yearSelect");
const monthSelect = $("#monthSelect");

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const initial = createInitialState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return ensureSimpleState(initial);
    }
    const parsed = JSON.parse(stored);
    return validateBackup(parsed).ok ? ensureSimpleState(parsed) : ensureSimpleState(createInitialState());
  } catch {
    return ensureSimpleState(createInitialState());
  }
}

function ensureSimpleState(data) {
  const current = createInitialState();
  const customCategories = Array.isArray(data.settings?.categoriasGasto) ? data.settings.categoriasGasto : [];
  const next = {
    ...current,
    ...data,
    settings: { ...current.settings, ...data.settings, appMode: "simple-v2", categoriasGasto: [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...customCategories])] },
    movimientos: (data.movimientos || []).filter((item) => item.tipo !== "Ingreso").map((item) => normalizeMovement({ ...item, tipo: "Gasto variable" })),
    presupuestos: data.settings?.appMode === "simple-v2" ? data.presupuestos || [] : [
      normalizeBudgetItem({ id: "recurso_nomina", anio: 2026, mes: "junio", categoria: "Nomina", concepto: "Nomina mensual", valorPresupuestado: 3200000, valorPagado: 3200000, estado: "Pagado" }),
      normalizeBudgetItem({ id: "recurso_proyecto", anio: 2026, mes: "junio", categoria: "Proyectos", concepto: "Proyecto independiente", valorPresupuestado: 600000, valorPagado: 600000, estado: "Pagado" }),
    ],
  };
  return next;
}

function saveState() {
  state.data.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
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

function dateForActiveMonth(sourceDate) {
  const original = new Date(`${sourceDate}T00:00:00`);
  const year = activeYear();
  const monthIndex = MONTHS.indexOf(activeMonth());
  const day = Number.isNaN(original.getTime()) ? 1 : original.getDate();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const safeDay = Math.min(day, lastDay);
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function setView(nextView) {
  state.view = nextView;
  state.edit = null;
  state.movementModal = false;
  render();
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function options(items, selected) {
  return items.map((item) => `<option value="${htmlEscape(item)}" ${item === selected ? "selected" : ""}>${htmlEscape(item)}</option>`).join("");
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
  const clean = String(category || "").trim();
  if (!clean || clean === "Otro") return "";
  const categories = expenseCategories();
  if (!categories.some((item) => item.toLowerCase() === clean.toLowerCase())) {
    state.data.settings.categoriasGasto = [...categories, clean];
  }
  return clean;
}

function removeExpenseCategory(category) {
  if (!isCustomCategory(category)) return;
  if (!confirm(`Eliminar la categoria "${category}"? Los movimientos existentes conservaran ese nombre.`)) return;
  state.data.settings.categoriasGasto = expenseCategories().filter((item) => item !== category);
  saveState();
  render();
}

function displayMovementStatus(row, today = new Date()) {
  if (row.estado === "Pagado") return "Pagado";
  if (row.fechaLimite) {
    const limit = new Date(`${row.fechaLimite}T23:59:59`);
    if (!Number.isNaN(limit.getTime()) && limit < today) return "Vencido";
  }
  return "Pendiente";
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
    state.data.settings.anioActivo = Number(yearSelect.value);
    saveState();
    render();
  };
  monthSelect.onchange = () => {
    state.data.settings.mesActivo = monthSelect.value;
    saveState();
    render();
  };
}

function metric(label, value, help = "", tone = "") {
  return `<article class="metric ${tone}"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`;
}

function statusMetric(label, value, tone = "") {
  return `<article class="metric metric-compact ${tone}"><span>${label}</span><strong>${value}</strong></article>`;
}

function movementSummaryCard(label, value, tone = "") {
  return `<article class="movement-total ${tone}"><span>${label}</span><strong>${value}</strong></article>`;
}

function getMonthlyResources() {
  return state.data.presupuestos.filter((item) => Number(item.anio) === activeYear() && item.mes === activeMonth());
}

function getMonthlyExpenses() {
  return getMonthlyMovements(state.data, activeYear(), activeMonth()).filter((item) => item.tipo !== "Ingreso");
}

function calculateMovementSummary(rows = getMonthlyExpenses()) {
  const totalRecursos = getMonthlyResources().reduce((sum, item) => sum + Number(item.valorPresupuestado || 0), 0);
  const totalPagado = rows
    .filter((item) => displayMovementStatus(item) === "Pagado")
    .reduce((sum, item) => sum + Number(item.valorPagado || 0), 0);
  const pendientePorPagar = rows
    .filter((item) => displayMovementStatus(item) !== "Pagado")
    .reduce((sum, item) => sum + Number(item.valorPagado || 0), 0);
  return {
    totalPagado,
    pendientePorPagar,
    disponible: totalRecursos - totalPagado,
  };
}

function calculateSimpleSummary() {
  const resources = getMonthlyResources();
  const expenses = getMonthlyExpenses();
  const totalRecursos = resources.reduce((sum, item) => sum + Number(item.valorPresupuestado || 0), 0);
  const totalGastos = expenses.reduce((sum, item) => sum + Number(item.valorPagado || 0), 0);
  const saldoDisponible = totalRecursos - totalGastos;
  const porcentajeUsado = totalRecursos ? Math.round((totalGastos / totalRecursos) * 10000) / 100 : 0;
  const porCategoria = Object.values(expenses.reduce((acc, item) => {
    const categoria = item.categoria || "Otros gastos";
    const status = displayMovementStatus(item);
    acc[categoria] ||= { categoria, valorPagado: 0, movimientos: 0, pagados: 0, pendientes: 0, vencidos: 0 };
    acc[categoria].valorPagado += Number(item.valorPagado || 0);
    acc[categoria].movimientos += 1;
    if (status === "Pagado") acc[categoria].pagados += 1;
    else if (status === "Vencido") acc[categoria].vencidos += 1;
    else acc[categoria].pendientes += 1;
    return acc;
  }, {})).sort((a, b) => b.valorPagado - a.valorPagado);
  return { resources, expenses, totalRecursos, totalGastos, saldoDisponible, porcentajeUsado, porCategoria };
}

function renderDashboard() {
  const summary = calculateSimpleSummary();
  const alerts = [];
  const totalPagados = summary.porCategoria.reduce((sum, item) => sum + item.pagados, 0);
  const totalPendientes = summary.porCategoria.reduce((sum, item) => sum + item.pendientes, 0);
  const totalVencidos = summary.porCategoria.reduce((sum, item) => sum + item.vencidos, 0);
  if (!summary.resources.length) alerts.push({ type: "warning", message: "No has ingresado recursos para este mes." });
  if (!summary.expenses.length) alerts.push({ type: "info", message: "No hay gastos registrados para este mes." });
  if (summary.saldoDisponible < 0) alerts.push({ type: "danger", message: "Los gastos superan los recursos del mes." });
  if (summary.porcentajeUsado >= 90 && summary.saldoDisponible >= 0) alerts.push({ type: "warning", message: "Ya usaste mas del 90% de los recursos del mes." });
  if (totalVencidos) alerts.push({ type: "danger", message: `${totalVencidos} movimiento(s) vencido(s).` });
  if (totalPendientes) alerts.push({ type: "warning", message: `${totalPendientes} movimiento(s) pendiente(s) de pago.` });
  if (totalPagados && !totalPendientes && !totalVencidos) alerts.push({ type: "success", message: `${totalPagados} movimiento(s) pagado(s) en el mes.` });
  const categorySummary = summary.porCategoria;

  return `
    <section class="metrics">
      ${metric("Recursos del mes", formatCOP(summary.totalRecursos), "Nomina, arriendos, trabajos y proyectos", "good")}
      ${metric("Gastos registrados", formatCOP(summary.totalGastos), `${summary.expenses.length} movimientos`)}
      ${metric("Disponible", formatCOP(summary.saldoDisponible), "Recursos menos gastos", summary.saldoDisponible < 0 ? "bad" : "good")}
      ${metric("Uso del mes", `${summary.porcentajeUsado}%`, "Gastos / recursos", summary.porcentajeUsado > 90 ? "warn" : "")}
    </section>
    <section class="metrics metrics-status">
      ${statusMetric("Pagados", totalPagados, "good")}
      ${statusMetric("Pendientes", totalPendientes, totalPendientes ? "warn" : "good")}
      ${statusMetric("Vencidos", totalVencidos, totalVencidos ? "bad" : "good")}
    </section>
    <section class="split">
      <div class="panel">
        <div class="panel-header"><div><h2>Resumen simple</h2><p>${monthLabel(activeMonth())} ${activeYear()}</p></div></div>
        <div class="alerts">${alerts.length ? alerts.map((alert) => `<div class="alert ${alert.type}">${htmlEscape(alert.message)}</div>`).join("") : `<div class="alert success">El mes esta dentro del presupuesto.</div>`}</div>
      </div>
      <div class="panel">
        <div class="panel-header"><div><h2>Gastos por categoria</h2><p>Resumen mensual con estado de pago</p></div></div>
        ${categorySummaryTable(categorySummary)}
      </div>
    </section>
  `;
}

function categorySummaryTable(rows) {
  if (!rows.length) return $("#emptyState").innerHTML;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Categoria</th><th>Total</th><th>Estado</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td data-label="Categoria">${htmlEscape(row.categoria)}</td>
          <td data-label="Total">${formatCOP(row.valorPagado)}</td>
          <td data-label="Estado"><span class="status ${categoryStatus(row)}">${categoryStatus(row)}</span></td>
        </tr>`).join("")}</tbody>
    </table></div>
  `;
}

function categoryStatus(row) {
  if (row.vencidos > 0) return "Vencido";
  if (row.pendientes > 0) return "Pendiente";
  return "Pagado";
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
      <input type="hidden" name="tipo" value="Gasto variable" />
      <label>Categoria<select id="movementCategory" name="categoria" required>${categoryOptions(row.categoria)}</select></label>
      <label id="customCategoryField" class="${categoryIsCustom ? "" : "hidden"}">Nueva categoria<input name="categoriaManual" value="${categoryIsCustom ? htmlEscape(row.categoria) : ""}" placeholder="Escribe la categoria" /></label>
      <label class="span-2">Descripcion<input name="descripcion" required value="${htmlEscape(row.descripcion || "")}" placeholder="Ej. mercado, gasolina, colegio" /></label>
      <label>Valor<input type="number" min="0" name="valorPagado" value="${row.valorPagado ?? row.valorPresupuestado ?? 0}" /></label>
      <label>Medio de pago<select name="medioPago">${options(PAYMENT_METHODS, row.medioPago || "Cuenta bancaria")}</select></label>
      <label>Responsable<input name="responsable" value="${htmlEscape(row.responsable || "")}" /></label>
      <label>Estado<select name="estado">${options(["Pendiente", "Pagado"], row.estado || "Pendiente")}</select></label>
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
        ${movementSummaryCard("Disponible", formatCOP(summary.disponible), summary.disponible < 0 ? "bad" : "good")}
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
  `;
}

function movementTable(rows) {
  if (!rows.length) return $("#emptyState").innerHTML;
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha registro</th><th>Fecha final</th><th>Categoria</th><th>Descripcion</th><th>Valor</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td data-label="Fecha registro">${row.fecha}</td><td data-label="Fecha final">${htmlEscape(row.fechaLimite || "")}</td><td data-label="Categoria">${htmlEscape(row.categoria)}</td><td data-label="Descripcion">${htmlEscape(row.descripcion)}</td>
          <td data-label="Valor">${formatCOP(row.valorPagado)}</td><td data-label="Estado"><span class="status ${displayMovementStatus(row)}">${displayMovementStatus(row)}</span></td>
          <td data-label="Acciones" class="row-actions">${row.estado === "Pagado" ? "" : `<button class="secondary icon" title="Pagado" data-pay-movement="${row.id}">Pagado</button>`}<button class="secondary icon" title="Editar" data-edit-movement="${row.id}">Editar</button><button class="danger icon" title="Eliminar" data-delete-movement="${row.id}">Eliminar</button></td>
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
      <label>Valor<input type="number" min="0" name="valorPresupuestado" value="${row.valorPresupuestado ?? 0}" /></label>
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
      ${simpleTable(rows, ["categoria", "concepto", "valorPresupuestado"], { money: ["valorPresupuestado"], editType: "budget" })}
    </section>
  `;
}

function simpleTable(rows, columns, config = {}) {
  if (!rows.length) return $("#emptyState").innerHTML;
  const labels = {
    categoria: "Categoria",
    concepto: "Detalle",
    valorPresupuestado: "Valor",
    valorPagado: "Valor",
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
  const extra = config.debtPay ? `<button class="secondary" data-pay-debt="${row.id}">Abonar</button>` : "";
  return `<td data-label="Acciones" class="row-actions">${extra}<button class="secondary" data-edit-${type}="${row.id}">Editar</button><button class="danger" data-delete-${type}="${row.id}">Eliminar</button></td>`;
}

function upsert(listName, item) {
  const list = state.data[listName];
  const index = list.findIndex((row) => row.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  saveState();
  state.edit = null;
  if (listName === "movimientos") state.movementModal = false;
  render();
}

function removeFrom(listName, idValue, label) {
  if (!confirm(`Eliminar ${label}? Esta accion no se puede deshacer.`)) return;
  state.data[listName] = state.data[listName].filter((item) => item.id !== idValue);
  saveState();
  render();
}

function copyPreviousMovements() {
  const previous = previousPeriod();
  const rows = (state.data.movimientos || []).filter((item) => Number(item.anio) === previous.year && item.mes === previous.month && item.tipo !== "Ingreso");
  if (!rows.length) {
    alert(`No hay movimientos en ${monthLabel(previous.month)} ${previous.year} para copiar.`);
    return;
  }
  const copied = rows.map((item) => normalizeMovement({
    ...item,
    id: undefined,
    fecha: dateForActiveMonth(item.fecha),
    fechaLimite: dateForActiveMonth(item.fechaLimite || item.fecha),
    anio: activeYear(),
    mes: activeMonth(),
    estado: "Pendiente",
  }));
  state.data.movimientos.unshift(...copied);
  saveState();
  render();
}

function bindEvents() {
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
    payload.valorPresupuestado = payload.valorPagado;
    payload.estado = payload.estado || "Pendiente";
    upsert("movimientos", normalizeMovement(payload));
  });

  $("#budgetForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = serializeForm(event.currentTarget);
    payload.valorPagado = payload.valorPresupuestado;
    payload.estado = "Pagado";
    upsert("presupuestos", normalizeBudgetItem(payload));
  });

  document.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", () => { state.edit = null; state.movementModal = false; render(); }));
  document.querySelector("[data-open-movement-modal]")?.addEventListener("click", () => { state.edit = null; state.movementModal = true; render(); });
  document.querySelectorAll("[data-close-movement-modal]").forEach((button) => button.addEventListener("click", () => { state.edit = null; state.movementModal = false; render(); }));
  document.querySelectorAll("[data-edit-movement]").forEach((button) => button.addEventListener("click", () => { state.edit = { type: "movimiento", id: button.dataset.editMovement }; state.movementModal = true; render(); }));
  document.querySelectorAll("[data-delete-movement]").forEach((button) => button.addEventListener("click", () => removeFrom("movimientos", button.dataset.deleteMovement, "movimiento")));
  document.querySelectorAll("[data-pay-movement]").forEach((button) => button.addEventListener("click", () => {
    const movement = state.data.movimientos.find((item) => item.id === button.dataset.payMovement);
    if (!movement) return;
    movement.estado = "Pagado";
    saveState();
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
  };
  viewEl.innerHTML = (renderers[state.view] || renderDashboard)();
  bindEvents();
}

render();
