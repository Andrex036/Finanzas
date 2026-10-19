export const STORAGE_KEY = "finanzas_personales_v1";
export const DATA_SCHEMA_VERSION = 3;
export const MIGRATION_ARCHIVE_PREFIX = `${STORAGE_KEY}_migration_backup_`;

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
export const FINANCIAL_MODEL_VERSION = 2;
export const SAVINGS_SCENARIOS = {
  conservador: 0.25,
  equilibrado: 0.5,
  ambicioso: 0.75,
};
export const SAVINGS_DESTINATION_TYPES = [
  "Cuenta de ahorros",
  "Cuenta remunerada",
  "CDT",
  "Fondo de inversión colectiva",
  "Fondo de ahorro programado",
  "Fondo de empleados",
  "Cuenta AFC",
  "Billetera digital",
  "Efectivo",
  "Otro",
];

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

function toMoney(value) {
  return Math.max(0, Math.round(toNumber(value)));
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
  const formatted = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.abs(rounded));
  return `${rounded < 0 ? "-$" : "$"} ${formatted} COP`;
}

function getStatus(total, paid, dueDate, now = new Date()) {
  const remaining = Math.max(0, total - paid);
  if (remaining === 0 && (total > 0 || paid > 0)) return "Pagado";
  if (remaining > 0 && dueDate && dueDate < now.toISOString().slice(0, 10)) return "Vencido";
  return paid > 0 ? "Parcial" : "Pendiente";
}

function financialAmounts(record = {}) {
  const total = toMoney(record.valorPresupuestado ?? record.valorPagado);
  let paid = toMoney(record.valorPagado);
  if ((Number(record.versionModeloFinanciero) || 0) < FINANCIAL_MODEL_VERSION && record.estado === "Pendiente") paid = 0;
  return { total, paid, remaining: Math.max(0, total - paid) };
}

export function getMovementStatus(movement, now = new Date()) {
  const { total, paid } = financialAmounts(movement);
  return getStatus(total, paid, movement.fechaLimite, now);
}

export function periodKey(year, month) {
  const monthIndex = MONTHS.indexOf(String(month).toLowerCase());
  if (monthIndex < 0) throw new Error(`Mes invalido: ${month}`);
  return `${Number(year)}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function shiftDateToPeriod(sourceDate, year, month) {
  const targetPeriod = periodKey(year, month);
  const [targetYear, targetMonth] = targetPeriod.split("-").map(Number);
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sourceDate || ""));
  const sourceDay = parsed ? Number(parsed[3]) : 1;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  return `${targetPeriod}-${String(Math.min(sourceDay, lastDay)).padStart(2, "0")}`;
}

function normalizeDuplicateText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-CO");
}

export function buildMovementCopyPlan(sourceRows, targetRows, targetYear, targetMonth, selectedIds = sourceRows.map((row) => row.id), includePossibleIds = []) {
  const targetKey = periodKey(targetYear, targetMonth);
  const selected = new Set(selectedIds);
  const includePossible = new Set(includePossibleIds);
  const destinationRows = targetRows.filter((row) => Number(row.anio) === Number(targetYear) && String(row.mes).toLowerCase() === String(targetMonth).toLowerCase());
  const entries = sourceRows.filter((row) => selected.has(row.id)).map((source) => {
    const existingCopy = destinationRows.find((row) => row.origenCopiaId === source.id && row.periodoCopia === targetKey);
    if (existingCopy) return { source, type: "duplicate", existing: existingCopy, copy: null };

    const matchingLegacy = destinationRows.filter((row) =>
      !row.origenCopiaId
      && normalizeDuplicateText(row.categoria) === normalizeDuplicateText(source.categoria)
      && normalizeDuplicateText(row.descripcion) === normalizeDuplicateText(source.descripcion)
      && toMoney(row.valorPresupuestado) === toMoney(source.valorPresupuestado)
      && String(row.fecha) === shiftDateToPeriod(source.fecha, targetYear, targetMonth)
      && String(row.fechaLimite || "") === (source.fechaLimite ? shiftDateToPeriod(source.fechaLimite, targetYear, targetMonth) : ""),
    );
    const copy = createCopiedMovement(source, targetYear, targetMonth);
    if (matchingLegacy.length) {
      return {
        source,
        type: "possible",
        matches: matchingLegacy,
        included: includePossible.has(source.id),
        copy: includePossible.has(source.id) ? copy : null,
      };
    }
    return { source, type: "new", copy };
  });
  const newEntries = entries.filter((entry) => entry.copy);
  return {
    targetPeriod: targetKey,
    entries,
    selectedCount: entries.length,
    newCount: newEntries.length,
    duplicateCount: entries.filter((entry) => entry.type === "duplicate").length,
    possibleCount: entries.filter((entry) => entry.type === "possible").length,
    totalNewValue: newEntries.reduce((sum, entry) => sum + toMoney(entry.copy.valorPresupuestado), 0),
    copies: newEntries.map((entry) => entry.copy),
  };
}

export function createCopiedMovement(source, targetYear, targetMonth, makeId = () => id("mov")) {
  const fecha = shiftDateToPeriod(source.fecha, targetYear, targetMonth);
  const fechaLimite = source.fechaLimite ? shiftDateToPeriod(source.fechaLimite, targetYear, targetMonth) : "";
  const copied = normalizeMovement({
    ...source,
    id: makeId(),
    fecha,
    fechaLimite,
    anio: Number(targetYear),
    mes: String(targetMonth).toLowerCase(),
    valorPagado: 0,
    valorFaltante: toMoney(source.valorPresupuestado),
    estado: "Pendiente",
    versionModeloFinanciero: FINANCIAL_MODEL_VERSION,
    origenCopiaId: source.id,
    periodoCopia: periodKey(targetYear, targetMonth),
    migracionFinanciera: undefined,
  });
  return {
    ...copied,
    estado: "Pendiente",
    valorPagado: 0,
    valorFaltante: toMoney(source.valorPresupuestado),
  };
}

export function normalizeMovement(input = {}, now = new Date()) {
  const fecha = input.fecha || new Date().toISOString().slice(0, 10);
  const version = Number(input.versionModeloFinanciero) || 0;
  const estadoOriginal = input.estado || "";
  const valorPresupuestadoOriginal = input.valorPresupuestado;
  const valorPagadoOriginal = input.valorPagado;
  const valorFaltanteOriginal = input.valorFaltante ?? input.faltante;
  let valorPresupuestado = toMoney(input.valorPresupuestado ?? input.valorPagado);
  let valorPagado = toMoney(input.valorPagado);
  let migracionFinanciera = input.migracionFinanciera;

  if (version < FINANCIAL_MODEL_VERSION) {
    if (estadoOriginal === "Pendiente" && valorPagado > 0) {
      migracionFinanciera ||= {
        version: FINANCIAL_MODEL_VERSION,
        fecha: now.toISOString(),
        regla: "El importe de un registro historico Pendiente no se considera pagado.",
        original: {
          valorPresupuestado: valorPresupuestadoOriginal ?? null,
          valorPagado: valorPagadoOriginal ?? null,
          valorFaltante: valorFaltanteOriginal ?? null,
          estado: estadoOriginal,
        },
      };
      valorPagado = 0;
    } else if (estadoOriginal === "Pagado" && valorPagado === 0 && valorPresupuestado > 0) {
      valorPagado = valorPresupuestado;
    }
  }

  const valorFaltante = Math.max(0, valorPresupuestado - valorPagado);
  const estado = getStatus(valorPresupuestado, valorPagado, input.fechaLimite || "", now);

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
    versionModeloFinanciero: FINANCIAL_MODEL_VERSION,
    ...(input.origenCopiaId ? { origenCopiaId: input.origenCopiaId } : {}),
    ...(input.periodoCopia ? { periodoCopia: input.periodoCopia } : {}),
    ...(migracionFinanciera ? { migracionFinanciera } : {}),
    medioPago: input.medioPago || "Cuenta bancaria",
    responsable: input.responsable || "",
    observacion: input.observacion || "",
  };
}

export function normalizeBudgetItem(input = {}) {
  const version = Number(input.versionModeloFinanciero) || 0;
  const estadoOriginal = input.estado || "";
  const valorPresupuestadoOriginal = input.valorPresupuestado;
  const valorPagadoOriginal = input.valorPagado;
  const valorFaltanteOriginal = input.valorFaltante ?? input.faltante;
  let valorPresupuestado = toMoney(input.valorPresupuestado ?? input.valorPagado);
  let valorPagado = toMoney(input.valorPagado);
  let migracionFinanciera = input.migracionFinanciera;
  if (version < FINANCIAL_MODEL_VERSION && estadoOriginal === "Pendiente" && valorPagado > 0) {
    migracionFinanciera ||= {
      version: FINANCIAL_MODEL_VERSION,
      fecha: new Date().toISOString(),
      regla: "El importe de un registro historico Pendiente no se considera recibido.",
      original: {
        valorPresupuestado: valorPresupuestadoOriginal ?? null,
        valorPagado: valorPagadoOriginal ?? null,
        valorFaltante: valorFaltanteOriginal ?? null,
        estado: estadoOriginal,
      },
    };
    valorPagado = 0;
  } else if (version < FINANCIAL_MODEL_VERSION && estadoOriginal === "Pagado" && valorPagado === 0 && valorPresupuestado > 0) {
    valorPagado = valorPresupuestado;
  }
  const estado = getStatus(valorPresupuestado, valorPagado, input.fechaLimite || "");
  return {
    id: input.id || id("pre"),
    anio: Number(input.anio) || new Date().getFullYear(),
    mes: input.mes || MONTHS[new Date().getMonth()],
    categoria: input.categoria || "",
    concepto: input.concepto || input.descripcion || "",
    valorPresupuestado,
    valorPagado,
    valorFaltante: Math.max(0, valorPresupuestado - valorPagado),
    faltante: Math.max(0, valorPresupuestado - valorPagado),
    estado,
    fechaLimite: input.fechaLimite || "",
    tipo: input.tipo || "Ingreso",
    versionModeloFinanciero: FINANCIAL_MODEL_VERSION,
    ...(migracionFinanciera ? { migracionFinanciera } : {}),
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
    ...input,
    id: input.id || id("aho"),
    nombre: input.nombre || "",
    descripcion: input.descripcion || "",
    categoria: input.categoria || "General",
    icono: input.icono || "🎯",
    valorObjetivo,
    valorAhorrado,
    fechaCreacion: input.fechaCreacion || "",
    fechaObjetivo: input.fechaObjetivo || "",
    aporteMensualPlanificado: toMoney(input.aporteMensualPlanificado),
    estado: input.estado || "Activa",
    destinosFinancieros: Array.isArray(input.destinosFinancieros) ? [...input.destinosFinancieros] : [],
    porcentajeAvance: safePercent(valorAhorrado, valorObjetivo),
    observacion: input.observacion || "",
  };
}

export function normalizeSavingsPlan(input = {}) {
  const mode = ["fijo", "porcentual", "inteligente"].includes(input.modalidad) ? input.modalidad : "fijo";
  const percentageBasis = input.basePorcentual === "presupuestado" ? "presupuestado" : "recibido";
  const monthlyAmount = toMoney(input.importeMensual);
  const percentage = Math.min(100, Math.max(0, toNumber(input.porcentaje)));
  const scenario = Object.hasOwn(SAVINGS_SCENARIOS, input.escenario) ? input.escenario : "equilibrado";
  const status = ["Activo", "Pausado"].includes(input.estado) ? input.estado : "Activo";
  return {
    ...input,
    id: input.id || id("plan"),
    nombre: String(input.nombre || "Plan de ahorro"),
    modalidad: mode,
    importeMensual: monthlyAmount,
    porcentaje: percentage,
    basePorcentual: percentageBasis,
    escenario: scenario,
    reservaSeguridad: toMoney(input.reservaSeguridad),
    estado: status,
    fechaCreacion: input.fechaCreacion || new Date().toISOString().slice(0, 10),
  };
}

export function normalizeSavingsGoal(input = {}) {
  const legacy = normalizeGoal(input);
  const goalStatus = ["Activa", "Pausada", "Completada", "Cancelada"].includes(input.estado) ? input.estado : "Activa";
  const openingBalance = input.saldoInicialReconocido === undefined
    ? toMoney(input.valorAhorrado)
    : toMoney(input.saldoInicialReconocido);
  return {
    ...legacy,
    descripcion: String(input.descripcion || ""),
    categoria: String(input.categoria || "General"),
    icono: String(input.icono || "🎯"),
    valorObjetivo: toMoney(input.valorObjetivo),
    valorAhorrado: openingBalance,
    saldoInicialReconocido: openingBalance,
    fechaCreacion: input.fechaCreacion || new Date().toISOString().slice(0, 10),
    fechaObjetivo: String(input.fechaObjetivo || ""),
    aporteMensualPlanificado: toMoney(input.aporteMensualPlanificado),
    estado: goalStatus,
    destinosFinancieros: Array.isArray(input.destinosFinancieros) ? [...input.destinosFinancieros] : [],
  };
}

export function normalizeSavingsDistribution(input = {}) {
  return {
    ...input,
    id: input.id || id("dist"),
    anio: Number(input.anio) || new Date().getFullYear(),
    mes: MONTHS.includes(String(input.mes).toLowerCase()) ? String(input.mes).toLowerCase() : MONTHS[new Date().getMonth()],
    presupuestoMensual: toMoney(input.presupuestoMensual),
    asignaciones: Array.isArray(input.asignaciones) ? input.asignaciones.map((entry) => ({
      metaId: String(entry.metaId || ""),
      porcentaje: Math.max(0, toNumber(entry.porcentaje)),
    })) : [],
  };
}

export function normalizeFinancialDestination(input = {}) {
  const type = SAVINGS_DESTINATION_TYPES.includes(input.tipoProducto) ? input.tipoProducto : "Otro";
  const capitalization = Math.max(1, Math.floor(toNumber(input.capitalizacionPorAnio) || 12));
  return {
    ...input,
    id: input.id || id("dest"),
    nombre: String(input.nombre || ""),
    entidad: String(input.entidad || ""),
    tipoProducto: type,
    moneda: String(input.moneda || "COP"),
    tasaAnual: Math.max(-100, toNumber(input.tasaAnual)),
    tipoTasa: input.tipoTasa === "nominal" ? "nominal" : "efectiva",
    capitalizacionPorAnio: capitalization,
    liquidez: String(input.liquidez || "No especificada"),
    plazoMeses: Math.max(0, Math.floor(toNumber(input.plazoMeses))),
    fechaApertura: String(input.fechaApertura || ""),
    fechaVencimiento: String(input.fechaVencimiento || ""),
    costosMensuales: toMoney(input.costosMensuales),
    costoApertura: toMoney(input.costoApertura),
    saldoDeclarado: toMoney(input.saldoDeclarado),
    capitalAportado: toMoney(input.capitalAportado),
    permiteAportesDuranteVigencia: type === "CDT" ? Boolean(input.permiteAportesDuranteVigencia) : true,
    observaciones: String(input.observaciones || ""),
  };
}

export function normalizeScheduledSavings(input = {}) {
  return {
    ...input,
    id: input.id || id("prog"),
    importePrevisto: toMoney(input.importePrevisto),
    fechaProgramada: String(input.fechaProgramada || ""),
    planId: String(input.planId || ""),
    metaId: String(input.metaId || ""),
    destinoId: String(input.destinoId || ""),
    importeTransferido: toMoney(input.importeTransferido),
    estado: ["Programado", "Pendiente", "Parcial", "Transferido", "Vencido", "Cancelado"].includes(input.estado)
      ? input.estado
      : "Programado",
    observaciones: String(input.observaciones || ""),
  };
}

export function normalizeSavingsTransfer(input = {}) {
  return {
    ...input,
    id: input.id || id("tran"),
    aporteProgramadoId: String(input.aporteProgramadoId || ""),
    planId: String(input.planId || ""),
    metaId: String(input.metaId || ""),
    destinoId: String(input.destinoId || ""),
    importe: toMoney(input.importe),
    fechaEfectiva: String(input.fechaEfectiva || ""),
    referencia: String(input.referencia || ""),
    observaciones: String(input.observaciones || ""),
    estado: input.estado === "Cancelada" ? "Cancelada" : "Confirmada",
  };
}

export function normalizeSavingsWithdrawal(input = {}) {
  return {
    ...input,
    id: input.id || id("retiro"),
    metaId: String(input.metaId || ""),
    destinoId: String(input.destinoId || ""),
    importe: toMoney(input.importe),
    fechaEfectiva: String(input.fechaEfectiva || ""),
    motivo: String(input.motivo || ""),
    estado: input.estado === "Cancelado" ? "Cancelado" : "Confirmado",
  };
}

export function calculateSavingsPlanAmount(state, year, month, plan) {
  const normalized = normalizeSavingsPlan(plan);
  const financial = calculateMonthlySummary(state, year, month);
  const budgetRows = (state.presupuestos || []).filter((item) =>
    Number(item.anio) === Number(year)
    && item.mes === month
    && (item.tipo === "Ingreso" || (!item.tipo && state.settings?.appMode === "simple-v2")),
  );
  const incomeRows = [
    ...budgetRows,
    ...getMonthlyMovements(state, year, month).filter((item) => item.tipo === "Ingreso"),
  ];
  const receivedIncome = financial.totalIngresos;
  const budgetedIncome = incomeRows.reduce((sum, item) => sum + financialAmounts(item).total, 0);
  if (normalized.modalidad === "fijo") {
    return {
      amount: normalized.importeMensual,
      capacity: Math.max(0, financial.saldoProyectado),
      affordable: normalized.importeMensual <= financial.saldoProyectado,
    };
  }
  if (normalized.modalidad === "porcentual") {
    const base = normalized.basePorcentual === "presupuestado" ? budgetedIncome : receivedIncome;
    const amount = toMoney(base * normalized.porcentaje / 100);
    return { amount, capacity: Math.max(0, financial.saldoProyectado), affordable: amount <= financial.saldoProyectado, base };
  }

  const otherPlanCommitments = (state.planesAhorro || [])
    .filter((other) => other.id !== normalized.id && other.estado !== "Pausado")
    .reduce((sum, other) => {
      if (other.modalidad === "fijo") return sum + toMoney(other.importeMensual);
      if (other.modalidad === "porcentual") {
        const base = other.basePorcentual === "presupuestado" ? budgetedIncome : receivedIncome;
        return sum + toMoney(base * toNumber(other.porcentaje) / 100);
      }
      return sum + toMoney(other.importeMensual);
    }, 0);
  const scheduledCommitments = (state.aportesProgramados || [])
    .filter((item) => item.estado !== "Cancelado"
      && !item.planId
      && String(item.fechaProgramada || "").startsWith(periodKey(year, month)))
    .reduce((sum, item) => sum + Math.max(0, toMoney(item.importePrevisto) - toMoney(item.importeTransferido)), 0);
  const capacity = Math.max(
    0,
    financial.saldoProyectado - normalized.reservaSeguridad - otherPlanCommitments - scheduledCommitments,
  );
  return {
    amount: toMoney(capacity * SAVINGS_SCENARIOS[normalized.escenario]),
    capacity,
    affordable: true,
  };
}

export function calculateSavingsDistribution(distribution, goals) {
  const normalized = normalizeSavingsDistribution(distribution);
  const goalIds = new Set();
  let percentageTotal = 0;
  const allocations = normalized.asignaciones.map((assignment) => {
    if (goalIds.has(assignment.metaId)) throw new Error(`La meta ${assignment.metaId} aparece mas de una vez en la distribucion.`);
    goalIds.add(assignment.metaId);
    percentageTotal += assignment.porcentaje;
    const goal = goals.find((item) => item.id === assignment.metaId);
    return {
      metaId: assignment.metaId,
      nombre: goal?.nombre || "Meta no disponible",
      porcentaje: assignment.porcentaje,
      importe: toMoney(normalized.presupuestoMensual * assignment.porcentaje / 100),
      encontrada: Boolean(goal),
    };
  });
  if (percentageTotal > 100) throw new Error("La distribucion del ahorro no puede superar el 100 %.");
  const allocated = allocations.reduce((sum, item) => sum + item.importe, 0);
  return {
    ...normalized,
    porcentajeDistribuido: round2(percentageTotal),
    porcentajeSinDistribuir: round2(100 - percentageTotal),
    importeDistribuido: allocated,
    importeSinDistribuir: Math.max(0, normalized.presupuestoMensual - allocated),
    allocations,
  };
}

function confirmedTransfers(state) {
  return (state.transferenciasAhorro || []).filter((transfer) => transfer.estado !== "Cancelada");
}

function confirmedWithdrawals(state) {
  return (state.retirosAhorro || []).filter((withdrawal) => withdrawal.estado !== "Cancelado");
}

export function savingsCommitmentStatus(commitment, transfers = [], today = new Date()) {
  if (commitment.estado === "Cancelado") return "Cancelado";
  const paid = transfers
    .filter((transfer) => transfer.aporteProgramadoId === commitment.id && transfer.estado !== "Cancelada")
    .reduce((sum, transfer) => sum + toMoney(transfer.importe), 0);
  const remaining = Math.max(0, toMoney(commitment.importePrevisto) - paid);
  if (toMoney(commitment.importePrevisto) > 0 && remaining === 0) return "Transferido";
  if (paid > 0) return "Parcial";
  const dueDate = String(commitment.fechaProgramada || "");
  if (dueDate && dueDate < today.toISOString().slice(0, 10)) return "Vencido";
  if (dueDate && dueDate <= today.toISOString().slice(0, 10)) return "Pendiente";
  return "Programado";
}

export function registerSavingsTransfer(state, input, makeId = () => id("tran")) {
  const commitment = (state.aportesProgramados || []).find((item) => item.id === input.aporteProgramadoId);
  if (!commitment) throw new Error("No se encontro el aporte programado.");
  if (commitment.estado === "Cancelado") throw new Error("No se pueden registrar transferencias en un aporte cancelado.");
  if (input.destinoId && !(state.destinosFinancieros || []).some((destination) => destination.id === input.destinoId)) {
    throw new Error("El destino financiero seleccionado no existe.");
  }
  const amount = toMoney(input.importe);
  if (!amount) throw new Error("El importe transferido debe ser mayor que cero.");
  const transfers = confirmedTransfers(state);
  if (input.id && (state.transferenciasAhorro || []).some((transfer) => transfer.id === input.id)) {
    throw new Error("El identificador de transferencia ya existe.");
  }
  const reference = String(input.referencia || "").trim();
  if (reference && transfers.some((transfer) =>
    transfer.destinoId === commitment.destinoId
    && transfer.referencia === reference
    && toMoney(transfer.importe) === amount
  )) {
    throw new Error("Ya existe una transferencia con esa referencia, destino e importe.");
  }
  const currentAmount = transfers
    .filter((transfer) => transfer.aporteProgramadoId === commitment.id)
    .reduce((sum, transfer) => sum + toMoney(transfer.importe), 0);
  if (currentAmount + amount > toMoney(commitment.importePrevisto)) {
    throw new Error("El importe supera el saldo pendiente del aporte programado.");
  }
  const transfer = normalizeSavingsTransfer({
    ...input,
    id: input.id || makeId(),
    aporteProgramadoId: commitment.id,
    planId: input.planId || commitment.planId,
    metaId: input.metaId || commitment.metaId,
    destinoId: input.destinoId || commitment.destinoId,
    importe: amount,
    estado: "Confirmada",
  });
  return { ...state, transferenciasAhorro: [...(state.transferenciasAhorro || []), transfer] };
}

export function correctSavingsTransfer(state, transferId, correction, makeId = () => id("tran")) {
  const transfer = (state.transferenciasAhorro || []).find((item) => item.id === transferId);
  if (!transfer || transfer.estado === "Cancelada") throw new Error("No se encontro una transferencia activa para corregir.");
  const archivedState = {
    ...state,
    transferenciasAhorro: (state.transferenciasAhorro || []).map((item) =>
      item.id === transferId ? { ...item, estado: "Cancelada", correccionReemplazadaPor: "pendiente" } : item),
  };
  const corrected = registerSavingsTransfer(archivedState, {
    ...transfer,
    ...correction,
    id: makeId(),
    referencia: correction.referencia ?? transfer.referencia,
    aporteProgramadoId: transfer.aporteProgramadoId,
    metaId: transfer.metaId,
    destinoId: transfer.destinoId,
    planId: transfer.planId,
    estado: "Confirmada",
  }, makeId);
  const replacementId = corrected.transferenciasAhorro.at(-1).id;
  return {
    ...corrected,
    transferenciasAhorro: corrected.transferenciasAhorro.map((item) =>
      item.id === transferId ? { ...item, correccionReemplazadaPor: replacementId } : item),
  };
}

export function annulSavingsTransfer(state, transferId, reason = "") {
  const found = (state.transferenciasAhorro || []).some((item) => item.id === transferId && item.estado !== "Cancelada");
  if (!found) throw new Error("No se encontro una transferencia activa para anular.");
  return {
    ...state,
    transferenciasAhorro: state.transferenciasAhorro.map((item) =>
      item.id === transferId ? { ...item, estado: "Cancelada", observaciones: reason || item.observaciones || "" } : item),
  };
}

export function registerSavingsWithdrawal(state, input, makeId = () => id("retiro")) {
  const goal = (state.metasAhorro || []).find((item) => item.id === input.metaId);
  if (!goal) throw new Error("No se encontro la meta asociada al retiro.");
  const amount = toMoney(input.importe);
  if (!amount) throw new Error("El importe del retiro debe ser mayor que cero.");
  const goalTransfers = confirmedTransfers(state)
    .filter((transfer) => transfer.metaId === goal.id)
    .reduce((sum, transfer) => sum + toMoney(transfer.importe), 0);
  const goalWithdrawals = confirmedWithdrawals(state)
    .filter((withdrawal) => withdrawal.metaId === goal.id)
    .reduce((sum, withdrawal) => sum + toMoney(withdrawal.importe), 0);
  const openingBalance = goal.saldoInicialReconocido ?? goal.valorAhorrado;
  const available = toMoney(openingBalance) + goalTransfers - goalWithdrawals;
  if (amount > available) throw new Error("El retiro supera el ahorro registrado para esta meta.");
  const withdrawal = normalizeSavingsWithdrawal({ ...input, id: input.id || makeId(), importe: amount });
  return { ...state, retirosAhorro: [...(state.retirosAhorro || []), withdrawal] };
}

export function normalizeSavingEntry(input = {}) {
  const tipo = input.tipo === "Retiro" ? "Retiro" : "Asignacion";
  return {
    ...input,
    id: input.id || id("aho"),
    tipo,
    periodo: String(input.periodo || input.fecha || "").slice(0, 7),
    objetivo: String(input.objetivo || "").trim(),
    importe: toMoney(input.importe),
    transferido: tipo === "Asignacion" && [true, "true", "on"].includes(input.transferido),
    fecha: String(input.fecha || ""),
    motivo: String(input.motivo || "").trim(),
  };
}

function objectiveBalance(entries, objetivo) {
  return entries
    .filter((item) => item.objetivo === objetivo)
    .reduce((sum, item) => sum + (item.tipo === "Retiro" ? -item.importe : item.transferido ? item.importe : 0), 0);
}

export function calculateSimpleSavings(state, year, month, surplus) {
  const period = periodKey(year, month);
  const entries = (state.ahorros || []).map(normalizeSavingEntry);
  const upTo = entries.filter((item) => item.periodo <= period);
  const monthAssignments = entries.filter((item) => item.tipo === "Asignacion" && item.periodo === period);
  const base = Math.max(0, surplus);
  const percent = (value) => (base > 0 ? Math.round((value / base) * 1000) / 10 : 0);
  const assigned = monthAssignments.reduce((sum, item) => sum + item.importe, 0);
  const names = [...new Set(upTo.map((item) => item.objetivo))].sort((a, b) => a.localeCompare(b));
  const objetivos = names.map((nombre) => {
    const rows = upTo.filter((item) => item.objetivo === nombre);
    const consignado = rows.filter((item) => item.tipo === "Asignacion" && item.transferido).reduce((sum, item) => sum + item.importe, 0);
    const pendiente = rows.filter((item) => item.tipo === "Asignacion" && !item.transferido).reduce((sum, item) => sum + item.importe, 0);
    const retirado = rows.filter((item) => item.tipo === "Retiro").reduce((sum, item) => sum + item.importe, 0);
    return { nombre, consignado, pendiente, retirado, saldo: consignado - retirado };
  });
  return {
    sobrante: surplus,
    asignadoMes: assigned,
    disponibleParaAsignar: surplus - assigned,
    porcentajeAsignado: percent(assigned),
    asignaciones: monthAssignments.map((item) => ({ ...item, porcentaje: percent(item.importe) })),
    objetivos,
    acumulado: objetivos.reduce((sum, item) => sum + item.saldo, 0),
    pendienteConsignar: objetivos.reduce((sum, item) => sum + item.pendiente, 0),
    totalRetirado: objetivos.reduce((sum, item) => sum + item.retirado, 0),
    retiros: upTo.filter((item) => item.tipo === "Retiro").sort((a, b) => b.fecha.localeCompare(a.fecha)),
  };
}

export function addSavingAssignment(state, input, surplus, year, month, makeId = () => id("aho")) {
  const entry = normalizeSavingEntry({ ...input, tipo: "Asignacion", periodo: periodKey(year, month), id: makeId() });
  if (!entry.objetivo) throw new Error("Escribe el objetivo de ahorro.");
  if (!entry.importe) throw new Error("El valor a asignar debe ser mayor que cero.");
  const { disponibleParaAsignar } = calculateSimpleSavings(state, year, month, surplus);
  if (entry.importe > disponibleParaAsignar) throw new Error("El valor supera el sobrante disponible para asignar.");
  return { ...state, ahorros: [...(state.ahorros || []), entry] };
}

export function addSavingWithdrawal(state, input, makeId = () => id("aho")) {
  const entry = normalizeSavingEntry({ ...input, tipo: "Retiro", periodo: String(input.fecha || "").slice(0, 7), id: makeId() });
  if (!entry.objetivo) throw new Error("Selecciona el objetivo del retiro.");
  if (!entry.importe) throw new Error("El valor del retiro debe ser mayor que cero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.fecha)) throw new Error("Indica la fecha del retiro.");
  const balance = objectiveBalance((state.ahorros || []).map(normalizeSavingEntry), entry.objetivo);
  if (entry.importe > balance) throw new Error("El retiro supera lo ahorrado en ese objetivo.");
  return { ...state, ahorros: [...(state.ahorros || []), entry] };
}

export function toggleSavingTransferred(state, entryId) {
  const entries = (state.ahorros || []).map(normalizeSavingEntry);
  const entry = entries.find((item) => item.id === entryId && item.tipo === "Asignacion");
  if (!entry) throw new Error("No se encontro la asignacion.");
  if (entry.transferido && objectiveBalance(entries, entry.objetivo) < entry.importe) {
    throw new Error("No puedes desmarcar: ya hay retiros que dependen de este ahorro.");
  }
  return { ...state, ahorros: entries.map((item) => (item.id === entryId ? { ...item, transferido: !item.transferido } : item)) };
}

export function removeSavingEntry(state, entryId) {
  const entries = (state.ahorros || []).map(normalizeSavingEntry);
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) throw new Error("No se encontro el registro.");
  if (entry.tipo === "Asignacion" && entry.transferido && objectiveBalance(entries, entry.objetivo) < entry.importe) {
    throw new Error("No puedes eliminar: ya hay retiros que dependen de este ahorro.");
  }
  return { ...state, ahorros: entries.filter((item) => item.id !== entryId) };
}

export function calculateSavingsSummary(state, year, month, now = new Date()) {
  const confirmed = confirmedTransfers(state);
  const withdrawals = confirmedWithdrawals(state);
  const selectedPeriod = periodKey(year, month);
  const monthlyTransfers = confirmed.filter((item) => String(item.fechaEfectiva || "").startsWith(selectedPeriod));
  const monthlyWithdrawals = withdrawals.filter((item) => String(item.fechaEfectiva || "").startsWith(selectedPeriod));
  const savingsFromTransfers = confirmed.reduce((sum, item) => sum + toMoney(item.importe), 0);
  const totalWithdrawals = withdrawals.reduce((sum, item) => sum + toMoney(item.importe), 0);
  const recognizedOpeningBalances = (state.metasAhorro || []).reduce((sum, goal) =>
    sum + toMoney(goal.saldoInicialReconocido ?? goal.valorAhorrado), 0);
  const savingsAccumulated = Math.max(0, recognizedOpeningBalances + savingsFromTransfers - totalWithdrawals);
  const periodNetTransfer = monthlyTransfers.reduce((sum, item) => sum + toMoney(item.importe), 0)
    - monthlyWithdrawals.reduce((sum, item) => sum + toMoney(item.importe), 0);
  const financial = calculateMonthlySummary(state, year, month, now);
  const commitments = (state.aportesProgramados || []).map((item) => {
    const paid = confirmed
      .filter((transfer) => transfer.aporteProgramadoId === item.id)
      .reduce((sum, transfer) => sum + toMoney(transfer.importe), 0);
    return { item, paid, remaining: Math.max(0, toMoney(item.importePrevisto) - paid) };
  });
  const monthlySchedules = commitments.filter(({ item }) =>
    item.estado !== "Cancelado" && String(item.fechaProgramada || "").startsWith(selectedPeriod));
  const activePlans = (state.planesAhorro || [])
    .filter((plan) => plan.estado !== "Pausado")
    .map((plan) => ({
      plan,
      amount: calculateSavingsPlanAmount(state, year, month, plan).amount,
      transferred: monthlyTransfers
        .filter((item) => item.planId === plan.id)
        .reduce((sum, item) => sum + toMoney(item.importe), 0),
      remainingSchedule: monthlySchedules
        .filter(({ item }) => item.planId === plan.id)
        .reduce((sum, item) => sum + item.remaining, 0),
    }));
  const unlinkedSchedules = monthlySchedules
    .filter(({ item }) => !activePlans.some(({ plan }) => plan.id === item.planId))
    .reduce((sum, item) => sum + item.remaining, 0);
  const unlinkedScheduleProgrammed = monthlySchedules
    .filter(({ item }) => !activePlans.some(({ plan }) => plan.id === item.planId))
    .reduce((sum, { item }) => sum + toMoney(item.importePrevisto), 0);
  const planPending = activePlans.reduce((sum, item) =>
    sum + Math.max(item.remainingSchedule, item.amount - item.transferred), 0);
  const planProgrammed = activePlans.reduce((sum, item) =>
    sum + Math.max(item.amount, item.transferred + item.remainingSchedule), 0);

  const goalBalances = (state.metasAhorro || []).map((goal) => {
    const deposits = confirmed.filter((item) => item.metaId === goal.id).reduce((sum, item) => sum + toMoney(item.importe), 0);
    const goalRetirements = withdrawals.filter((item) => item.metaId === goal.id).reduce((sum, item) => sum + toMoney(item.importe), 0);
    const openingBalance = toMoney(goal.saldoInicialReconocido ?? goal.valorAhorrado);
    const balance = Math.max(0, openingBalance + deposits - goalRetirements);
    const normalizedGoal = normalizeSavingsGoal({ ...goal, saldoInicialReconocido: openingBalance });
    return {
      id: goal.id,
      nombre: goal.nombre,
      estado: goal.estado || normalizedGoal.estado,
      objetivo: normalizedGoal.valorObjetivo,
      acumulado: balance,
      porcentaje: safePercent(balance, normalizedGoal.valorObjetivo),
      destinosFinancieros: normalizedGoal.destinosFinancieros,
    };
  });

  const destinations = (state.destinosFinancieros || []).map((destination) => {
    const contributed = confirmed.filter((item) => item.destinoId === destination.id)
      .reduce((sum, item) => sum + toMoney(item.importe), 0);
    const withdrawn = withdrawals.filter((item) => item.destinoId === destination.id)
      .reduce((sum, item) => sum + toMoney(item.importe), 0);
    const contributedCapital = toMoney(destination.capitalAportado) + contributed - withdrawn;
    return {
      id: destination.id,
      nombre: destination.nombre,
      tipoProducto: destination.tipoProducto,
      saldoDeclarado: toMoney(destination.saldoDeclarado),
      capitalAportado: contributedCapital,
      saldoContabilizadoUnaVez: Math.max(0, toMoney(destination.saldoDeclarado) || contributedCapital),
    };
  });

  return {
    ahorroAcumulado: savingsAccumulated,
    ahorroProgramadoMes: planProgrammed + unlinkedScheduleProgrammed,
    ahorroTransferidoMes: monthlyTransfers.reduce((sum, item) => sum + toMoney(item.importe), 0),
    ahorroPendienteTransferir: planPending + unlinkedSchedules,
    capacidadAdicional: Math.max(0, financial.saldoProyectado - periodNetTransfer - planPending - unlinkedSchedules),
    dineroReservadoMes: periodNetTransfer,
    dineroLibreParaGastar: financial.saldoProyectado - periodNetTransfer,
    metasActivas: goalBalances.filter((goal) => goal.estado === "Activa").length,
    progresoMetas: goalBalances,
    transferencias: confirmed,
    retiros: withdrawals,
    destinos: destinations,
  };
}

export function createInitialState() {
  const currentYear = new Date().getFullYear();
  const currentMonth = MONTHS[new Date().getMonth()];
  const categorias = DEFAULT_CATEGORY_ROWS.map(([nombre, tipo], index) => ({
    id: `cat_${index + 1}`,
    nombre,
    tipo,
    activa: true,
  }));

  return {
    version: DATA_SCHEMA_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: { moneda: "COP", anioActivo: currentYear, mesActivo: currentMonth },
    movimientos: [],
    presupuestos: [],
    deudas: [],
    metasAhorro: [],
    planesAhorro: [],
    distribucionesAhorro: [],
    destinosFinancieros: [],
    aportesProgramados: [],
    transferenciasAhorro: [],
    retirosAhorro: [],
    ahorros: [],
    categorias,
  };
}

export function getMonthlyMovements(state, year, month) {
  return (state.movimientos || []).filter((item) => Number(item.anio) === Number(year) && item.mes === month);
}

export function upsertRecord(rows, record) {
  const existing = rows.findIndex((item) => item.id === record.id);
  return existing < 0
    ? [record, ...rows]
    : rows.map((item) => item.id === record.id ? record : item);
}

export function removeRecord(rows, recordId) {
  return rows.filter((item) => item.id !== recordId);
}

export function addCategoryIfMissing(categories, category) {
  const clean = String(category || "").trim();
  if (!clean || clean === "Otro") return { category: "", categories: [...categories], added: false };
  const exists = categories.some((item) => item.toLowerCase() === clean.toLowerCase());
  return {
    category: clean,
    categories: exists ? [...categories] : [...categories, clean],
    added: !exists,
  };
}

export function calculateMonthlySummary(state, year, month, now = new Date()) {
  const rows = getMonthlyMovements(state, year, month);
  const recursos = (state.presupuestos || [])
    .filter((item) => Number(item.anio) === Number(year)
      && item.mes === month
      && (item.tipo === "Ingreso" || (!item.tipo && state.settings?.appMode === "simple-v2")));
  const idsRecurso = new Set(recursos.map((item) => item.id));
  const ingresos = [...recursos, ...rows.filter((item) => item.tipo === "Ingreso" && !idsRecurso.has(item.id))];
  const gastos = rows.filter((item) => !["Ingreso", "Transferencia interna"].includes(item.tipo));
  const financial = calculateFinancialSummary(ingresos, gastos, now);
  const sumPaid = (type) => gastos.filter((item) => item.tipo === type).reduce((sum, item) => sum + financialAmounts(item).paid, 0);
  const totalGastosFijos = sumPaid("Gasto fijo");
  const totalGastosVariables = sumPaid("Gasto variable") + sumPaid("Gasto extraordinario");
  const totalDeudas = sumPaid("Deuda");
  const totalAhorro = sumPaid("Ahorro");
  const totalPagado = [...ingresos, ...gastos].reduce((sum, item) => sum + financialAmounts(item).paid, 0);
  const totalPresupuestado = [...ingresos, ...gastos].reduce((sum, item) => sum + financialAmounts(item).total, 0);
  const totalFaltante = [...ingresos, ...gastos].reduce((sum, item) => sum + financialAmounts(item).remaining, 0);

  return {
    ...financial,
    totalGastosFijos,
    totalGastosVariables,
    totalDeudas,
    totalAhorro,
    totalPresupuestado,
    totalPagado,
    totalFaltante,
    porcentajeEjecucion: safePercent(totalPagado, totalPresupuestado),
    nivelEndeudamiento: safePercent(totalDeudas, financial.totalIngresos),
    porcentajeAhorro: safePercent(totalAhorro, financial.totalIngresos),
    movimientos: rows.length,
  };
}

export function buildDashboardData(state, year, month, now = new Date()) {
  const summary = calculateMonthlySummary(state, year, month, now);
  const rows = getMonthlyMovements(state, year, month)
    .filter((item) => !["Ingreso", "Transferencia interna"].includes(item.tipo));
  const incomeRows = (state.presupuestos || []).filter((item) =>
    Number(item.anio) === Number(year)
    && item.mes === month
    && (item.tipo === "Ingreso" || (!item.tipo && state.settings?.appMode === "simple-v2")),
  );
  const incomeIds = new Set(incomeRows.map((item) => item.id));
  const incomeMovementRows = getMonthlyMovements(state, year, month)
    .filter((item) => item.tipo === "Ingreso" && !incomeIds.has(item.id));
  const expensesByCategory = new Map();
  const obligations = {
    pagadas: { count: 0, amount: 0 },
    pendientes: { count: 0, amount: 0 },
    parciales: { count: 0, amount: 0 },
  };
  let overdueCount = 0;

  rows.forEach((row) => {
    const amounts = financialAmounts(row);
    const category = row.categoria || "Otros gastos";
    const categoryData = expensesByCategory.get(category) || { categoria: category, total: 0, pagado: 0, pendiente: 0 };
    categoryData.total += amounts.total;
    categoryData.pagado += amounts.paid;
    categoryData.pendiente += amounts.remaining;
    expensesByCategory.set(category, categoryData);

    if (amounts.remaining === 0) {
      obligations.pagadas.count += 1;
      obligations.pagadas.amount += amounts.total;
    } else if (amounts.paid > 0) {
      obligations.parciales.count += 1;
      obligations.parciales.amount += amounts.total;
    } else {
      obligations.pendientes.count += 1;
      obligations.pendientes.amount += amounts.total;
    }
    if (getMovementStatus(row, now) === "Vencido") overdueCount += 1;
  });

  const categoryTotal = [...expensesByCategory.values()].reduce((sum, item) => sum + item.total, 0);
  const categories = [...expensesByCategory.values()]
    .sort((left, right) => right.total - left.total)
    .map((item) => ({ ...item, share: safePercent(item.total, categoryTotal) }));
  const obligationTotal = Object.values(obligations).reduce((sum, item) => sum + item.amount, 0);
  const obligationStates = Object.entries(obligations).map(([status, item]) => ({
    status,
    ...item,
    share: safePercent(item.amount, obligationTotal),
  }));

  const selectedPeriod = periodKey(year, month);
  const [selectedYear, selectedMonth] = selectedPeriod.split("-").map(Number);
  const history = Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(selectedYear, selectedMonth - 1 - (5 - offset), 1);
    const periodYear = date.getFullYear();
    const periodMonth = MONTHS[date.getMonth()];
    const periodSummary = calculateMonthlySummary(state, periodYear, periodMonth, now);
    return {
      year: periodYear,
      month: periodMonth,
      label: `${periodMonth.slice(0, 3)} ${String(periodYear).slice(-2)}`,
      ingresos: periodSummary.totalIngresos,
      pagos: periodSummary.gastosEfectivamentePagados,
      disponible: periodSummary.saldoDisponible,
      proyectado: periodSummary.saldoProyectado,
    };
  });
  const historyScale = Math.max(0, ...history.flatMap((item) => [item.ingresos, item.pagos, item.disponible, item.proyectado].map(Math.abs)));
  const historyWithWidths = history.map((item) => ({
    ...item,
    widths: {
      ingresos: safePercent(Math.abs(item.ingresos), historyScale),
      pagos: safePercent(Math.abs(item.pagos), historyScale),
      disponible: safePercent(Math.abs(item.disponible), historyScale),
      proyectado: safePercent(Math.abs(item.proyectado), historyScale),
    },
  }));
  const committedAmount = summary.gastosEfectivamentePagados + summary.obligacionesPendientes;
  const committedPercentage = safePercent(committedAmount, summary.totalIngresos);
  const alerts = [];
  if (incomeRows.length + incomeMovementRows.length === 0) {
    alerts.push({ type: "info", message: "Aún no hay ingresos registrados para este periodo." });
  }
  if (summary.saldoProyectado < 0) {
    alerts.push({ type: "danger", message: "Con las obligaciones actuales, el saldo proyectado queda por debajo de cero." });
  }
  if (overdueCount > 0) {
    alerts.push({ type: "warning", message: `${overdueCount} obligación(es) tienen saldo pendiente y fecha límite vencida.` });
  }
  if (summary.totalIngresos > 0 && committedAmount > summary.totalIngresos) {
    alerts.push({ type: "warning", message: "Los pagos y obligaciones pendientes superan los ingresos recibidos del periodo." });
  }
  if (summary.totalIngresos > 0 && summary.saldoProyectado >= 0 && summary.saldoProyectado <= summary.totalIngresos * 0.1) {
    alerts.push({ type: "warning", message: "El saldo proyectado es reducido frente a los ingresos recibidos." });
  }

  return {
    summary,
    categories,
    obligationStates,
    overdueCount,
    committedAmount,
    committedPercentage,
    history: historyWithWidths,
    alerts,
  };
}

export function convertAnnualRateToEffective(ratePercent, rateType = "efectiva", compoundingPerYear = 12) {
  const rate = toNumber(ratePercent) / 100;
  const frequency = Math.max(1, Math.floor(toNumber(compoundingPerYear) || 12));
  if (rateType === "nominal") {
    const periodicRate = rate / frequency;
    if (periodicRate <= -1) throw new Error("La tasa nominal y su capitalizacion producen una tasa periodica invalida.");
    return (1 + periodicRate) ** frequency - 1;
  }
  if (rate <= -1) throw new Error("La tasa efectiva anual no puede ser igual o menor a -100 %.");
  return rate;
}

export function simulateSavingsReturns(input = {}) {
  const productType = SAVINGS_DESTINATION_TYPES.includes(input.tipoProducto) ? input.tipoProducto : "Cuenta remunerada";
  const capitalization = Math.max(1, Math.floor(toNumber(input.capitalizacionPorAnio) || 12));
  const periods = Math.max(1, Math.floor(toNumber(input.plazoMeses) || 1));
  const startingCapital = toMoney(input.capitalInicial);
  const requestedContribution = toMoney(input.aportePeriodico);
  const contributionFrequency = {
    mensual: 12,
    quincenal: 24,
    semanal: 52,
    trimestral: 4,
    anual: 1,
  }[input.periodicidad] || 12;
  const allowsAdditionalContributions = productType !== "CDT" || Boolean(input.permiteAportesDuranteVigencia);
  const effectiveAnnualRate = convertAnnualRateToEffective(input.tasaAnual, input.tipoTasa, capitalization);
  const monthlyRate = (1 + effectiveAnnualRate) ** (1 / 12) - 1;
  const monthlyContribution = allowsAdditionalContributions ? requestedContribution * contributionFrequency / 12 : 0;
  const monthlyCost = toMoney(input.costosMensuales);
  const openingCost = toMoney(input.costoApertura);
  const withholdingRate = Math.max(0, Math.min(100, toNumber(input.retencionPorcentaje))) / 100;
  let balance = Math.max(0, startingCapital - openingCost);
  let contributedCapital = startingCapital;
  let grossReturn = 0;
  let totalCosts = openingCost;
  let totalWithholding = 0;
  const schedule = [];

  for (let month = 1; month <= periods; month += 1) {
    const interest = balance * monthlyRate;
    const withholding = Math.max(0, interest) * withholdingRate;
    const periodCost = monthlyCost;
    const contribution = monthlyContribution;
    balance = Math.max(0, balance + interest - withholding - periodCost + contribution);
    contributedCapital += contribution;
    grossReturn += interest;
    totalWithholding += withholding;
    totalCosts += periodCost;
    schedule.push({
      mes: month,
      capitalAportado: round2(contributedCapital),
      rendimientoBruto: round2(grossReturn),
      costos: round2(totalCosts),
      retenciones: round2(totalWithholding),
      valorEstimado: round2(balance),
    });
  }

  return {
    esProyeccion: true,
    advertencia: "Proyeccion hipotetica; no representa una rentabilidad garantizada ni un saldo real.",
    tipoProducto: productType,
    tasaEfectivaAnualEquivalente: round2(effectiveAnnualRate * 100),
    tasaEfectivaMensual: round2(monthlyRate * 100),
    capitalAportado: round2(contributedCapital),
    rendimientoBrutoEstimado: round2(grossReturn),
    costosEstimados: round2(totalCosts),
    retencionesEstimadas: round2(totalWithholding),
    valorFuturoEstimado: round2(balance),
    aportesAdicionalesHabilitados: allowsAdditionalContributions,
    aportePeriodicoModelado: round2(monthlyContribution),
    evolucionMensual: schedule,
  };
}

export function calculateFinancialSummary(incomeRows = [], expenseRows = [], now = new Date()) {
  const totalIngresos = incomeRows.reduce((sum, item) => sum + financialAmounts(item).paid, 0);
  const gastosEfectivamentePagados = expenseRows.reduce((sum, item) => sum + financialAmounts(item).paid, 0);
  const obligacionesPendientes = expenseRows.reduce((sum, item) => {
    return sum + financialAmounts(item).remaining;
  }, 0);
  const saldoDisponible = totalIngresos - gastosEfectivamentePagados;
  return {
    totalIngresos,
    ingresosRecibidos: totalIngresos,
    gastosEfectivamentePagados,
    obligacionesPendientes,
    saldoDisponible,
    saldoProyectado: saldoDisponible - obligacionesPendientes,
    estados: expenseRows.map((item) => getStatus(
      financialAmounts(item).total,
      financialAmounts(item).paid,
      item.fechaLimite,
      now,
    )),
  };
}
export function validateBackup(payload) {
  if (!isPlainObject(payload)) return { ok: false, message: "El archivo no contiene un objeto JSON valido." };
  const data = isPlainObject(payload.data) ? payload.data : payload;
  const version = Number(payload.schemaVersion ?? data.schemaVersion ?? data.version ?? 1);
  if (!Number.isInteger(version) || version < 1) return { ok: false, message: "La version del respaldo no es valida." };
  if (version > DATA_SCHEMA_VERSION) return { ok: false, message: `El respaldo usa una version (${version}) mas reciente que esta aplicacion.` };
  if (payload.data !== undefined && !isPlainObject(payload.data)) return { ok: false, message: "La seccion data del respaldo no es valida." };
  if (payload.generatedAt !== undefined && (typeof payload.generatedAt !== "string" || Number.isNaN(Date.parse(payload.generatedAt)))) {
    return { ok: false, message: "La fecha de generacion del respaldo no es valida." };
  }
  if (payload.app !== undefined && typeof payload.app !== "string") return { ok: false, message: "El nombre de la aplicacion en el respaldo no es valido." };
  if (!isPlainObject(data.settings)) return { ok: false, message: "Falta una configuracion valida en el respaldo." };

  const listNames = [
    "movimientos",
    "presupuestos",
    "categorias",
    "deudas",
    "metasAhorro",
    "planesAhorro",
    "distribucionesAhorro",
    "destinosFinancieros",
    "aportesProgramados",
    "transferenciasAhorro",
    "retirosAhorro",
    "ahorros",
  ];
  for (const name of listNames) {
    if (data[name] !== undefined && !Array.isArray(data[name])) return { ok: false, message: `La seccion ${name} debe ser una lista.` };
    const rows = data[name] || [];
    const ids = new Set();
    for (const row of rows) {
      if (!isPlainObject(row)) return { ok: false, message: `La seccion ${name} contiene un registro invalido.` };
      if (row.id !== undefined && (typeof row.id !== "string" || !row.id.trim())) return { ok: false, message: `La seccion ${name} contiene un identificador invalido.` };
      for (const field of [
        "fecha", "fechaLimite", "fechaCreacion", "fechaObjetivo", "fechaApertura", "fechaVencimiento",
        "fechaProgramada", "fechaEfectiva", "tipo", "tipoProducto", "tipoTasa", "categoria", "descripcion",
        "concepto", "estado", "nombre", "entidad", "responsable", "observacion", "observaciones", "mes",
        "modalidad", "basePorcentual", "escenario", "moneda", "liquidez", "referencia", "motivo",
      ]) {
        if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "string") {
          return { ok: false, message: `El campo ${field} tiene un tipo invalido en ${name}.` };
        }
      }
      if (row.anio !== undefined && (!Number.isFinite(Number(row.anio)) || Number(row.anio) < 1)) {
        return { ok: false, message: `El campo anio tiene un valor invalido en ${name}.` };
      }
      if (row.id && ids.has(row.id)) return { ok: false, message: `El respaldo contiene identificadores duplicados en ${name}.` };
      if (row.id) ids.add(row.id);
      for (const field of [
        "valorPresupuestado", "valorPagado", "valorFaltante", "faltante", "valorObjetivo", "valorAhorrado",
        "saldoInicial", "saldoActual", "cuotaMensual", "importeMensual", "porcentaje", "reservaSeguridad",
        "presupuestoMensual", "capitalizacionPorAnio", "plazoMeses", "costosMensuales",
        "costoApertura", "saldoDeclarado", "capitalAportado", "importePrevisto", "importeTransferido", "importe",
        "aporteMensualPlanificado",
      ]) {
        const value = row[field];
        if (value !== undefined && value !== null && value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          return { ok: false, message: `El campo ${field} contiene un importe invalido en ${name}.` };
        }
      }
      if (row.tasaAnual !== undefined && row.tasaAnual !== null && row.tasaAnual !== ""
        && (!Number.isFinite(Number(row.tasaAnual)) || Number(row.tasaAnual) < -100)) {
        return { ok: false, message: `El campo tasaAnual contiene una tasa invalida en ${name}.` };
      }
    }
  }
  const ingresos = data.ingresos ?? (payload.data ? payload.ingresos : undefined);
  const gastos = data.gastos ?? (payload.data ? payload.gastos : undefined);
  if (ingresos !== undefined && !Array.isArray(ingresos)) return { ok: false, message: "La seccion ingresos debe ser una lista." };
  if (gastos !== undefined && !Array.isArray(gastos)) return { ok: false, message: "La seccion gastos debe ser una lista." };
  for (const [name, rows] of [["ingresos", ingresos], ["gastos", gastos]]) {
    if (!rows) continue;
    const ids = new Set();
    for (const row of rows) {
      if (!isPlainObject(row)) return { ok: false, message: `La seccion ${name} contiene un registro invalido.` };
      if (row.id !== undefined && (typeof row.id !== "string" || !row.id.trim())) return { ok: false, message: `La seccion ${name} contiene un identificador invalido.` };
      if (row.id && ids.has(row.id)) return { ok: false, message: `El respaldo contiene identificadores duplicados en ${name}.` };
      if (row.id) ids.add(row.id);
      for (const field of ["valorPresupuestado", "valorPagado", "valorFaltante", "faltante"]) {
        const value = row[field];
        if (value !== undefined && value !== null && value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
          return { ok: false, message: `El campo ${field} contiene un importe invalido en ${name}.` };
        }
      }
    }
  }
  for (const [alias, rows, canonical] of [["ingresos", ingresos, "presupuestos"], ["gastos", gastos, "movimientos"]]) {
    if (!Array.isArray(rows) || !Array.isArray(data[canonical])) continue;
    const canonicalById = new Map(data[canonical].filter((row) => row.id).map((row) => [row.id, row]));
    for (const row of rows) {
      const counterpart = row.id ? canonicalById.get(row.id) : null;
      if (counterpart && stableStringify(row) !== stableStringify(counterpart)) {
        return { ok: false, message: `El registro ${row.id} tiene contenidos diferentes entre ${alias} y ${canonical}.` };
      }
    }
  }
  if (!listNames.some((name) => (data[name] || []).length) && !Array.isArray(ingresos) && !Array.isArray(gastos)) {
    return { ok: false, message: "El respaldo no contiene secciones financieras reconocibles." };
  }
  return { ok: true, message: "Respaldo valido.", schemaVersion: version, data };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function legacyId(collection, row, index) {
  const text = stableStringify(row);
  let hash = 2166136261;
  for (let position = 0; position < text.length; position += 1) {
    hash ^= text.charCodeAt(position);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy_${collection}_${index}_${(hash >>> 0).toString(16)}`;
}

export function migrateData(input, sourceVersion = input?.schemaVersion ?? input?.version ?? 1, migratedAt = new Date().toISOString()) {
  let data = JSON.parse(JSON.stringify(input));
  let version = Number(sourceVersion) || 1;
  const migrations = [...(Array.isArray(data.migrationHistory) ? data.migrationHistory : [])];
  while (version < DATA_SCHEMA_VERSION) {
    const nextVersion = version + 1;
    if (version === 1 && nextVersion === 2) {
      data.schemaVersion = 2;
      data.version = 2;
    }
    if (version === 2 && nextVersion === 3) {
      for (const name of [
        "planesAhorro",
        "distribucionesAhorro",
        "destinosFinancieros",
        "aportesProgramados",
        "transferenciasAhorro",
        "retirosAhorro",
        "ahorros",
      ]) {
        if (!Array.isArray(data[name])) data[name] = [];
      }
      data.schemaVersion = 3;
      data.version = 3;
    }
    migrations.push({ from: version, to: nextVersion, migratedAt });
    version = nextVersion;
  }
  data.schemaVersion = version;
  data.version = version;
  if (migrations.length) data.migrationHistory = migrations;
  return data;
}

export function createBackup(state, generatedAt = new Date().toISOString()) {
  const data = JSON.parse(JSON.stringify(state));
  data.schemaVersion = DATA_SCHEMA_VERSION;
  data.version = DATA_SCHEMA_VERSION;
  return {
    app: "App_Finanzas",
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt,
    data,
    ingresos: (data.presupuestos || []).filter((item) => item.tipo === "Ingreso"),
    gastos: data.movimientos || [],
  };
}

export function extractBackupData(payload) {
  const validation = validateBackup(payload);
  if (!validation.ok) throw new Error(validation.message);
  const source = validation.data;
  const data = { ...source };
  if (data.ingresos === undefined && payload.data) data.ingresos = payload.ingresos;
  if (data.gastos === undefined && payload.data) data.gastos = payload.gastos;
  if (!Array.isArray(data.presupuestos)) data.presupuestos = [];
  else data.presupuestos = [...data.presupuestos];
  if (!Array.isArray(data.movimientos)) data.movimientos = [];
  else data.movimientos = [...data.movimientos];
  for (const name of [
    "categorias",
    "deudas",
    "metasAhorro",
    "planesAhorro",
    "distribucionesAhorro",
    "destinosFinancieros",
    "aportesProgramados",
    "transferenciasAhorro",
    "retirosAhorro",
    "ahorros",
  ]) {
    if (!Array.isArray(data[name])) data[name] = [];
    else data[name] = [...data[name]];
  }
  const movementIds = new Set(data.movimientos.map((item) => item.id).filter(Boolean));
  for (const expense of [...(data.gastos || [])]) {
    if (expense.id && movementIds.has(expense.id)) continue;
    if (!expense.id && data.movimientos.some((item) => stableStringify(item) === stableStringify(expense))) continue;
    data.movimientos.push(expense);
    if (expense.id) movementIds.add(expense.id);
  }
  const budgetIds = new Set(data.presupuestos.map((item) => item.id).filter(Boolean));
  for (const income of [...(data.ingresos || [])]) {
    if (income.id && budgetIds.has(income.id)) continue;
    if (!income.id && data.presupuestos.some((item) => stableStringify(item) === stableStringify({ ...income, tipo: "Ingreso" }))) continue;
    data.presupuestos.push({ ...income, tipo: "Ingreso" });
    if (income.id) budgetIds.add(income.id);
  }
  if (!data.settings) data.settings = {};
  for (const name of [
    "movimientos",
    "presupuestos",
    "categorias",
    "deudas",
    "metasAhorro",
    "planesAhorro",
    "distribucionesAhorro",
    "destinosFinancieros",
    "aportesProgramados",
    "transferenciasAhorro",
    "retirosAhorro",
    "ahorros",
  ]) {
    data[name] = data[name].map((item, index) => item.id ? item : { ...item, id: legacyId(name, item, index) });
  }
  delete data.ingresos;
  delete data.gastos;
  return migrateData(data, validation.schemaVersion);
}

export function mergeBackup(current, incoming) {
  const validation = validateBackup(incoming);
  if (!validation.ok) throw new Error(validation.message);
  const incomingData = extractBackupData(incoming);
  const collections = [
    "movimientos",
    "presupuestos",
    "categorias",
    "deudas",
    "metasAhorro",
    "planesAhorro",
    "distribucionesAhorro",
    "destinosFinancieros",
    "aportesProgramados",
    "transferenciasAhorro",
    "retirosAhorro",
    "ahorros",
  ];
  const added = {};
  const duplicates = [];
  const conflicts = [];
  const merged = { ...current, settings: current.settings, updatedAt: new Date().toISOString() };

  for (const name of collections) {
    const rows = [...(current[name] || [])];
    const byId = new Map(rows.filter((item) => item.id).map((item) => [item.id, item]));
    let count = 0;
    for (const item of incomingData[name] || []) {
      const existing = item.id ? byId.get(item.id) : null;
      if (!existing) {
        rows.push(item);
        if (item.id) byId.set(item.id, item);
        count += 1;
      } else if (stableStringify(existing) === stableStringify(item)) {
        duplicates.push({ collection: name, id: item.id, type: "identical" });
      } else {
        conflicts.push({ collection: name, id: item.id, current: existing, incoming: item });
      }
    }
    merged[name] = rows;
    added[name] = count;
  }
  merged.schemaVersion = DATA_SCHEMA_VERSION;
  merged.version = DATA_SCHEMA_VERSION;
  return { state: merged, added, duplicates, conflicts, settingsConflict: stableStringify(current.settings) !== stableStringify(incomingData.settings) };
}

export function restoreBackup(incoming) {
  return extractBackupData(incoming);
}

export function backupCounts(payload) {
  const validation = validateBackup(payload);
  if (!validation.ok) return { ok: false, message: validation.message };
  const data = extractBackupData(payload);
  return {
    ok: true,
    schemaVersion: validation.schemaVersion,
    generatedAt: payload.generatedAt || null,
    ingresos: (data.presupuestos || []).filter((item) => item.tipo === "Ingreso").length,
    gastos: (data.movimientos || []).length,
    presupuestos: (data.presupuestos || []).length,
    categorias: (data.categorias || []).length,
    deudas: (data.deudas || []).length,
    metasAhorro: (data.metasAhorro || []).length,
    planesAhorro: (data.planesAhorro || []).length,
    distribucionesAhorro: (data.distribucionesAhorro || []).length,
    destinosFinancieros: (data.destinosFinancieros || []).length,
    aportesProgramados: (data.aportesProgramados || []).length,
    transferenciasAhorro: (data.transferenciasAhorro || []).length,
    retirosAhorro: (data.retirosAhorro || []).length,
    ahorros: (data.ahorros || []).length,
  };
}

export function archiveStorageValue(storage, rawValue, archivedAt = Date.now()) {
  let suffix = archivedAt;
  let key = `${MIGRATION_ARCHIVE_PREFIX}${suffix}`;
  while (storage.getItem(key) !== null) {
    suffix += 1;
    key = `${MIGRATION_ARCHIVE_PREFIX}${suffix}`;
  }
  storage.setItem(key, rawValue);
  return key;
}

export function storageErrorMessage(error) {
  if (error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014) {
    return "No hay espacio suficiente en el almacenamiento local. Descarga un respaldo y libera espacio antes de volver a guardar.";
  }
  return "No fue posible guardar los datos en este navegador. Tus cambios no se confirmaron como guardados.";
}

/*
 * Keep a named wrapper in the API so restoration and merge always use the same validated envelope.
 */
export function restoreStateFromBackup(current, incoming) {
  return {
    ...current,
    ...restoreBackup(incoming),
    schemaVersion: DATA_SCHEMA_VERSION,
    version: DATA_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
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
    const amounts = financialAmounts(item);
    acc[key].valorPresupuestado += amounts.total;
    acc[key].valorPagado += amounts.paid;
    acc[key].faltante += amounts.remaining;
    return acc;
  }, {}));
  const pendientes = mensual.filter((item) => getMovementStatus(item) !== "Pagado");
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
    const status = getMovementStatus(item, now);
    if (status === "Pendiente" || status === "Parcial") {
      alerts.push({ type: "warning", message: `Pago pendiente: ${item.descripcion || item.categoria}` });
    }
    if (status === "Vencido") {
      alerts.push({ type: "danger", message: `Pago vencido: ${item.descripcion || item.categoria}` });
    }
    if (financialAmounts(item).paid > financialAmounts(item).total && financialAmounts(item).total > 0) {
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
