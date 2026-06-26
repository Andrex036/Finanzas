export const STORAGE_KEY = "finanzas_personales_v1";

export const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export const MOVEMENT_TYPES = [
  "Ingreso",
  "Gasto fijo",
  "Gasto variable",
  "Deuda",
  "Ahorro",
  "Gasto extraordinario",
  "Transferencia interna",
];

export const STATUS_OPTIONS = ["Pendiente", "Pagado", "Parcial", "Vencido"];

export const PAYMENT_METHODS = [
  "Efectivo",
  "Cuenta bancaria",
  "Tarjeta debito",
  "Tarjeta credito",
  "Nequi",
  "Daviplata",
  "Otro",
];

const DEFAULT_CATEGORY_ROWS = [
  ["Salario", "Ingreso"],
  ["Prima", "Ingreso"],
  ["Bonificacion", "Ingreso"],
  ["Ingreso adicional", "Ingreso"],
  ["Comida", "Gasto variable"],
  ["Mercado", "Gasto variable"],
  ["Gasolina", "Gasto variable"],
  ["Ropa", "Gasto variable"],
  ["Recreacion", "Gasto variable"],
  ["Salud", "Gasto variable"],
  ["Vivienda", "Gasto fijo"],
  ["Administracion y servicios", "Gasto fijo"],
  ["TV - Internet", "Gasto fijo"],
  ["Datos moviles", "Gasto fijo"],
  ["Colegio", "Gasto fijo"],
  ["Transporte", "Gasto fijo"],
  ["BBVA", "Deuda"],
  ["NU", "Deuda"],
  ["ADDI", "Deuda"],
  ["Tarjeta de credito", "Deuda"],
  ["Ahorro mensual", "Ahorro"],
  ["Fondo de emergencia", "Ahorro"],
  ["Vacaciones", "Ahorro"],
  ["Educacion", "Ahorro"],
];

function id(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function safePercent(numerator, denominator) {
  return denominator ? round2((numerator / denominator) * 100) : 0;
}

function monthFromDate(fecha) {
  const date = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(date.getTime())) return MONTHS[new Date().getMonth()];
  return MONTHS[date.getMonth()];
}

function yearFromDate(fecha) {
  const date = new Date(`${fecha}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
}

export function formatCOP(value) {
  const rounded = Math.round(toNumber(value));
  return `$ ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(rounded)} COP`;
}

export function normalizeMovement(input = {}) {
  const fecha = input.fecha || new Date().toISOString().slice(0, 10);
  const valorPresupuestado = toNumber(input.valorPresupuestado);
  const valorPagado = toNumber(input.valorPagado);
  const valorFaltante = valorPresupuestado - valorPagado;
  let estado = input.estado || "Pendiente";

  if (!input.estado) {
    if (valorPresupuestado > 0 && valorPagado >= valorPresupuestado) estado = "Pagado";
    else if (valorPagado > 0) estado = "Parcial";
  }

  return {
    id: input.id || id("mov"),
    fecha,
    fechaLimite: input.fechaLimite || "",
    anio: Number(input.anio) || yearFromDate(fecha),
    mes: input.mes || monthFromDate(fecha),
    tipo: input.tipo || "Gasto variable",
    categoria: input.categoria || "",
    subcategoria: input.subcategoria || "",
    descripcion: input.descripcion || "",
    valorPresupuestado,
    valorPagado,
    valorFaltante,
    estado,
    medioPago: input.medioPago || "Cuenta bancaria",
    responsable: input.responsable || "",
    observacion: input.observacion || "",
  };
}

export function normalizeBudgetItem(input = {}) {
  const valorPresupuestado = toNumber(input.valorPresupuestado);
  const valorPagado = toNumber(input.valorPagado);
  return {
    id: input.id || id("pre"),
    anio: Number(input.anio) || new Date().getFullYear(),
    mes: input.mes || MONTHS[new Date().getMonth()],
    categoria: input.categoria || "",
    concepto: input.concepto || input.descripcion || "",
    valorPresupuestado,
    valorPagado,
    faltante: valorPresupuestado - valorPagado,
    estado: input.estado || (valorPagado >= valorPresupuestado && valorPresupuestado > 0 ? "Pagado" : "Pendiente"),
    fechaLimite: input.fechaLimite || "",
  };
}

export function normalizeDebt(input = {}) {
  return {
    id: input.id || id("deu"),
    entidad: input.entidad || "",
    tipo: input.tipo || "Credito",
    saldoInicial: toNumber(input.saldoInicial),
    saldoActual: toNumber(input.saldoActual),
    cuotaMensual: toNumber(input.cuotaMensual),
    fechaPago: Number(input.fechaPago) || 1,
    tasaInteres: input.tasaInteres === "" || input.tasaInteres === undefined ? null : toNumber(input.tasaInteres),
    estado: input.estado || "Activa",
    observacion: input.observacion || "",
  };
}

export function applyDebtPayment(debt, amount) {
  return { ...debt, saldoActual: Math.max(0, toNumber(debt.saldoActual) - toNumber(amount)), estado: toNumber(debt.saldoActual) - toNumber(amount) <= 0 ? "Pagada" : debt.estado };
}

export function normalizeGoal(input = {}) {
  const valorObjetivo = toNumber(input.valorObjetivo);
  const valorAhorrado = toNumber(input.valorAhorrado);
  return {
    id: input.id || id("aho"),
    nombre: input.nombre || "",
    valorObjetivo,
    valorAhorrado,
    fechaObjetivo: input.fechaObjetivo || "",
    porcentajeAvance: safePercent(valorAhorrado, valorObjetivo),
    observacion: input.observacion || "",
  };
}

export function createInitialState() {
  const currentYear = 2026;
  const currentMonth = "junio";
  const categorias = DEFAULT_CATEGORY_ROWS.map(([nombre, tipo], index) => ({
    id: `cat_${index + 1}`,
    nombre,
    tipo,
    activa: true,
  }));

  const movimientos = [
    { fecha: "2026-06-01", tipo: "Ingreso", categoria: "Salario", descripcion: "Nomina mensual", valorPresupuestado: 3200000, valorPagado: 3200000, estado: "Pagado", responsable: "Felipe" },
    { fecha: "2026-06-02", tipo: "Gasto variable", categoria: "Comida", descripcion: "Comida del mes", valorPresupuestado: 600000, valorPagado: 600000, estado: "Pagado", responsable: "Familia" },
    { fecha: "2026-06-03", tipo: "Gasto variable", categoria: "Mercado", descripcion: "Mercado familiar", valorPresupuestado: 400000, valorPagado: 350000, responsable: "Familia" },
    { fecha: "2026-06-04", tipo: "Gasto fijo", categoria: "Colegio", descripcion: "Colegio", valorPresupuestado: 220000, valorPagado: 220000, estado: "Pagado", responsable: "Felipe" },
    { fecha: "2026-06-05", tipo: "Gasto variable", categoria: "Gasolina", descripcion: "Gasolina", valorPresupuestado: 100000, valorPagado: 100000, estado: "Pagado", responsable: "Felipe" },
    { fecha: "2026-06-06", tipo: "Gasto fijo", categoria: "TV - Internet", descripcion: "Internet hogar", valorPresupuestado: 180000, valorPagado: 180000, estado: "Pagado", responsable: "Felipe" },
    { fecha: "2026-06-07", tipo: "Gasto fijo", categoria: "Datos moviles", descripcion: "Planes celulares", valorPresupuestado: 50000, valorPagado: 0, estado: "Pendiente", responsable: "Felipe" },
    { fecha: "2026-06-08", tipo: "Gasto fijo", categoria: "Administracion y servicios", descripcion: "Administracion + servicios", valorPresupuestado: 467000, valorPagado: 467000, estado: "Pagado", responsable: "Familia" },
    { fecha: "2026-06-15", tipo: "Deuda", categoria: "BBVA", descripcion: "Cuota credito", valorPresupuestado: 240000, valorPagado: 240000, estado: "Pagado", responsable: "Felipe" },
    { fecha: "2026-06-20", tipo: "Ahorro", categoria: "Fondo de emergencia", descripcion: "Aporte ahorro", valorPresupuestado: 300000, valorPagado: 200000, responsable: "Familia" },
  ].map(normalizeMovement);

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: { moneda: "COP", anioActivo: currentYear, mesActivo: currentMonth },
    movimientos,
    presupuestos: movimientos.filter((item) => item.tipo !== "Ingreso").map((item) => normalizeBudgetItem({
      anio: item.anio,
      mes: item.mes,
      categoria: item.categoria,
      concepto: item.descripcion,
      valorPresupuestado: item.valorPresupuestado,
      valorPagado: item.valorPagado,
      estado: item.estado,
      fechaLimite: item.fecha,
    })),
    deudas: [
      normalizeDebt({ id: "deuda_bbva", entidad: "BBVA", tipo: "Credito", saldoInicial: 5000000, saldoActual: 3200000, cuotaMensual: 240000, fechaPago: 25, tasaInteres: 1.4, estado: "Activa", observacion: "Amortizacion de referencia en Excel." }),
      normalizeDebt({ id: "deuda_nu", entidad: "NU", tipo: "Tarjeta de credito", saldoInicial: 900000, saldoActual: 450000, cuotaMensual: 150000, fechaPago: 10, estado: "Activa", observacion: "" }),
    ],
    metasAhorro: [
      normalizeGoal({ id: "meta_emergencia", nombre: "Fondo de emergencia", valorObjetivo: 3000000, valorAhorrado: 1000000, fechaObjetivo: "2026-12-31", observacion: "Meta principal familiar." }),
      normalizeGoal({ id: "meta_vacaciones", nombre: "Vacaciones", valorObjetivo: 2000000, valorAhorrado: 250000, fechaObjetivo: "2026-11-30", observacion: "" }),
    ],
    categorias,
  };
}

export function getMonthlyMovements(state, year, month) {
  return (state.movimientos || []).filter((item) => Number(item.anio) === Number(year) && item.mes === month);
}

export function calculateMonthlySummary(state, year, month) {
  const rows = getMonthlyMovements(state, year, month);
  const sumPaid = (type) => rows.filter((item) => item.tipo === type).reduce((sum, item) => sum + toNumber(item.valorPagado), 0);
  const totalIngresos = sumPaid("Ingreso");
  const totalGastosFijos = sumPaid("Gasto fijo");
  const totalGastosVariables = sumPaid("Gasto variable") + sumPaid("Gasto extraordinario");
  const totalDeudas = sumPaid("Deuda");
  const totalAhorro = sumPaid("Ahorro");
  const totalPagado = rows.reduce((sum, item) => sum + toNumber(item.valorPagado), 0);
  const totalPresupuestado = rows.reduce((sum, item) => sum + toNumber(item.valorPresupuestado), 0);
  const totalFaltante = totalPresupuestado - totalPagado;
  const saldoDisponible = totalIngresos - totalGastosFijos - totalGastosVariables - totalDeudas - totalAhorro;

  return {
    totalIngresos,
    totalGastosFijos,
    totalGastosVariables,
    totalDeudas,
    totalAhorro,
    totalPresupuestado,
    totalPagado,
    totalFaltante,
    saldoDisponible,
    porcentajeEjecucion: safePercent(totalPagado, totalPresupuestado),
    nivelEndeudamiento: safePercent(totalDeudas, totalIngresos),
    porcentajeAhorro: safePercent(totalAhorro, totalIngresos),
    movimientos: rows.length,
  };
}

export function validateBackup(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, message: "El archivo no contiene un objeto JSON valido." };
  const required = ["movimientos", "presupuestos", "categorias", "deudas", "metasAhorro", "settings"];
  const missing = required.filter((key) => !(key in payload));
  if (missing.length) return { ok: false, message: `Faltan secciones requeridas: ${missing.join(", ")}.` };
  const invalidArrays = ["movimientos", "presupuestos", "categorias", "deudas", "metasAhorro"].filter((key) => !Array.isArray(payload[key]));
  if (invalidArrays.length) return { ok: false, message: `Estas secciones deben ser listas: ${invalidArrays.join(", ")}.` };
  return { ok: true, message: "Respaldo valido." };
}

function mergeList(current = [], incoming = []) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

export function mergeBackup(current, incoming) {
  const merged = {
    ...current,
    settings: { ...current.settings, ...incoming.settings },
    movimientos: mergeList(current.movimientos, incoming.movimientos),
    presupuestos: mergeList(current.presupuestos, incoming.presupuestos),
    categorias: mergeList(current.categorias, incoming.categorias),
    deudas: mergeList(current.deudas, incoming.deudas),
    metasAhorro: mergeList(current.metasAhorro, incoming.metasAhorro),
    updatedAt: new Date().toISOString(),
  };
  return merged;
}

export function generateCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\r\n");
}

export function buildReports(state, year, month) {
  const mensual = getMonthlyMovements(state, year, month);
  const categorias = Object.values(mensual.reduce((acc, item) => {
    const key = item.categoria || "Sin categoria";
    acc[key] ||= { categoria: key, valorPresupuestado: 0, valorPagado: 0, faltante: 0 };
    acc[key].valorPresupuestado += toNumber(item.valorPresupuestado);
    acc[key].valorPagado += toNumber(item.valorPagado);
    acc[key].faltante += toNumber(item.valorFaltante);
    return acc;
  }, {}));
  const pendientes = mensual.filter((item) => ["Pendiente", "Parcial", "Vencido"].includes(item.estado));
  const ahorro = (state.metasAhorro || []).map(normalizeGoal);

  return {
    mensual,
    anual: (state.movimientos || []).filter((item) => Number(item.anio) === Number(year)),
    categorias,
    deudas: state.deudas || [],
    ahorro,
    pendientes,
  };
}

export function getAlerts(state, year, month, now = new Date()) {
  const alerts = [];
  const mensual = getMonthlyMovements(state, year, month);
  const summary = calculateMonthlySummary(state, year, month);

  mensual.forEach((item) => {
    if (item.estado === "Pendiente" || item.estado === "Parcial") {
      alerts.push({ type: "warning", message: `Pago pendiente: ${item.descripcion || item.categoria}` });
    }
    if (item.estado === "Vencido") {
      alerts.push({ type: "danger", message: `Pago vencido: ${item.descripcion || item.categoria}` });
    }
    if (toNumber(item.valorPagado) > toNumber(item.valorPresupuestado) && toNumber(item.valorPresupuestado) > 0) {
      alerts.push({ type: "danger", message: `Gasto excedido frente al presupuesto: ${item.categoria}` });
    }
  });

  if (summary.saldoDisponible < summary.totalIngresos * 0.1 && summary.totalIngresos > 0) {
    alerts.push({ type: "warning", message: "Disponible bajo: revisa gastos, deudas y ahorro del mes." });
  }

  (state.deudas || []).filter((debt) => debt.estado === "Activa").forEach((debt) => {
    const daysToPayment = Number(debt.fechaPago) - now.getDate();
    if (daysToPayment >= 0 && daysToPayment <= 5) {
      alerts.push({ type: "warning", message: `Deuda proxima a vencer: ${debt.entidad}` });
    }
  });

  (state.metasAhorro || []).forEach((goal) => {
    const hasContribution = mensual.some((item) => item.tipo === "Ahorro" && (item.categoria === goal.nombre || item.descripcion.includes(goal.nombre)));
    if (!hasContribution) alerts.push({ type: "info", message: `Meta de ahorro sin aporte en el mes: ${goal.nombre}` });
  });

  if (!mensual.length) alerts.push({ type: "info", message: "Presupuesto mensual incompleto: registra movimientos para este mes." });
  return alerts;
}

export function downloadName(prefix = "respaldo_finanzas", date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${prefix}_${yyyy}_${mm}_${dd}.json`;
}
