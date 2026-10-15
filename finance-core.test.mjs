import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addCategoryIfMissing,
  buildReports,
  archiveStorageValue,
  backupCounts,
  buildDashboardData,
  buildMovementCopyPlan,
  calculateFinancialSummary,
  calculateMonthlySummary,
  createBackup,
  createInitialState,
  DATA_SCHEMA_VERSION,
  extractBackupData,
  formatCOP,
  getMovementStatus,
  generateCsv,
  getAlerts,
  getMonthlyMovements,
  mergeBackup,
  migrateData,
  normalizeBudgetItem,
  normalizeMovement,
  removeRecord,
  createCopiedMovement,
  shiftDateToPeriod,
  restoreStateFromBackup,
  storageErrorMessage,
  upsertRecord,
  validateBackup,
} from "./finance-core.js";

describe("calculos financieros", () => {
  test("mantiene saldo negativo cuando los pagos y obligaciones exceden los ingresos", () => {
    const summary = calculateFinancialSummary(
      [{ valorPresupuestado: 100000, valorPagado: 80000, estado: "Parcial", versionModeloFinanciero: 2 }],
      [
        { valorPresupuestado: 150000, valorPagado: 120000, estado: "Parcial", versionModeloFinanciero: 2 },
        { valorPresupuestado: 50000, valorPagado: 0, estado: "Pendiente", versionModeloFinanciero: 2 },
      ],
    );

    assert.equal(summary.ingresosRecibidos, 80000);
    assert.equal(summary.gastosEfectivamentePagados, 120000);
    assert.equal(summary.obligacionesPendientes, 80000);
    assert.equal(summary.saldoDisponible, -40000);
    assert.equal(summary.saldoProyectado, -120000);
  });

  test("calcula importes altos sin perder exactitud y redondea fracciones al peso COP", () => {
    const income = normalizeBudgetItem({
      id: "high-income",
      tipo: "Ingreso",
      valorPresupuestado: 9876543210000.6,
      valorPagado: 9876543210000.6,
      estado: "Pagado",
      versionModeloFinanciero: 2,
    });
    const expense = normalizeMovement({
      id: "decimal-expense",
      fecha: "2026-06-01",
      tipo: "Gasto variable",
      valorPresupuestado: 1250.4,
      valorPagado: 250.6,
      versionModeloFinanciero: 2,
    });
    const summary = calculateFinancialSummary([income], [expense]);

    assert.equal(income.valorPagado, 9876543210001);
    assert.equal(expense.valorPresupuestado, 1250);
    assert.equal(expense.valorPagado, 251);
    assert.equal(expense.valorFaltante, 999);
    assert.equal(summary.saldoDisponible, 9876543209750);
    assert.equal(summary.saldoProyectado, 9876543208751);
    assert.ok(Object.values(summary).filter((value) => typeof value === "number").every(Number.isFinite));
  });

  test("incluye obligaciones vencidas en el proyectado y no las cuenta como nuevo pago", () => {
    const late = normalizeMovement({
      id: "late-partial",
      fecha: "2026-06-01",
      fechaLimite: "2026-06-10",
      tipo: "Gasto fijo",
      valorPresupuestado: 1000,
      valorPagado: 400,
      estado: "Parcial",
      versionModeloFinanciero: 2,
    }, new Date("2026-06-11T12:00:00"));
    const onDueDate = normalizeMovement({
      id: "due-today",
      fecha: "2026-06-01",
      fechaLimite: "2026-06-11",
      valorPresupuestado: 300,
      valorPagado: 0,
      versionModeloFinanciero: 2,
    }, new Date("2026-06-11T12:00:00"));
    const summary = calculateFinancialSummary([], [late, onDueDate], new Date("2026-06-11T12:00:00"));

    assert.equal(late.estado, "Vencido");
    assert.equal(late.valorPagado, 400);
    assert.equal(late.valorFaltante, 600);
    assert.equal(onDueDate.estado, "Pendiente");
    assert.equal(summary.gastosEfectivamentePagados, 400);
    assert.equal(summary.obligacionesPendientes, 900);
    assert.equal(summary.saldoDisponible, -400);
    assert.equal(summary.saldoProyectado, -1300);
  });

  test("filtra los movimientos por mes registrado y no mezcla años ni meses contiguos", () => {
    const state = {
      ...createInitialState(),
      movimientos: [
        normalizeMovement({ id: "may", fecha: "2026-05-31", tipo: "Gasto fijo", valorPresupuestado: 100 }),
        normalizeMovement({ id: "jun", fecha: "2026-06-01", tipo: "Gasto fijo", valorPresupuestado: 200 }),
        normalizeMovement({ id: "next-year", fecha: "2027-06-01", tipo: "Gasto fijo", valorPresupuestado: 300 }),
      ],
    };

    assert.deepEqual(getMonthlyMovements(state, 2026, "mayo").map((row) => row.id), ["may"]);
    assert.deepEqual(getMonthlyMovements(state, 2026, "junio").map((row) => row.id), ["jun"]);
    assert.deepEqual(getMonthlyMovements(state, 2027, "junio").map((row) => row.id), ["next-year"]);
  });

  test("dashboard calcula tarjetas, distribución, estados, alertas y evolución desde registros", () => {
    const state = createInitialState();
    state.presupuestos = [
      normalizeBudgetItem({ id: "dashboard-income", anio: 2026, mes: "junio", tipo: "Ingreso", valorPresupuestado: 5000000, valorPagado: 5000000, estado: "Pagado", versionModeloFinanciero: 2 }),
      normalizeBudgetItem({ id: "dashboard-pending-income", anio: 2026, mes: "junio", tipo: "Ingreso", valorPresupuestado: 1000000, valorPagado: 0, estado: "Pendiente", versionModeloFinanciero: 2 }),
    ];
    state.movimientos = [
      normalizeMovement({ id: "dashboard-paid", fecha: "2026-06-01", fechaLimite: "2026-06-10", anio: 2026, mes: "junio", tipo: "Gasto fijo", categoria: "Vivienda", valorPresupuestado: 2000000, valorPagado: 2000000, versionModeloFinanciero: 2 }),
      normalizeMovement({ id: "dashboard-partial-late", fecha: "2026-06-02", fechaLimite: "2026-06-10", anio: 2026, mes: "junio", tipo: "Gasto variable", categoria: "Alimentación", valorPresupuestado: 1000000, valorPagado: 400000, versionModeloFinanciero: 2 }),
      normalizeMovement({ id: "dashboard-pending", fecha: "2026-06-03", fechaLimite: "2026-06-30", anio: 2026, mes: "junio", tipo: "Gasto fijo", categoria: "Vivienda", valorPresupuestado: 500000, valorPagado: 0, versionModeloFinanciero: 2 }),
    ];

    const dashboard = buildDashboardData(state, 2026, "junio", new Date("2026-06-15T12:00:00"));
    const category = dashboard.categories.find((item) => item.categoria === "Vivienda");

    assert.equal(dashboard.summary.totalIngresos, 5000000);
    assert.equal(dashboard.summary.gastosEfectivamentePagados, 2400000);
    assert.equal(dashboard.summary.obligacionesPendientes, 1100000);
    assert.equal(dashboard.summary.saldoDisponible, 2600000);
    assert.equal(dashboard.summary.saldoProyectado, 1500000);
    assert.equal(category.total, 2500000);
    assert.equal(category.pagado, 2000000);
    assert.equal(category.pendiente, 500000);
    assert.deepEqual(dashboard.obligationStates.map((item) => [item.status, item.count, item.amount]), [
      ["pagadas", 1, 2000000],
      ["pendientes", 1, 500000],
      ["parciales", 1, 1000000],
    ]);
    assert.equal(dashboard.overdueCount, 1);
    assert.equal(dashboard.committedAmount, 3500000);
    assert.equal(dashboard.committedPercentage, 70);
    assert.equal(dashboard.history.length, 6);
    assert.deepEqual(dashboard.history.at(-1), {
      year: 2026,
      month: "junio",
      label: "jun 26",
      ingresos: 5000000,
      pagos: 2400000,
      disponible: 2600000,
      proyectado: 1500000,
      widths: { ingresos: 100, pagos: 48, disponible: 52, proyectado: 30 },
    });
    assert.ok(dashboard.alerts.some((item) => item.message.includes("fecha límite vencida")));
    assert.ok(dashboard.alerts.every((item) => typeof item.message === "string"));
  });

  test("dashboard alerta por déficit, compromisos altos, saldo bajo y ausencia de ingresos", () => {
    const state = createInitialState();
    state.presupuestos = [normalizeBudgetItem({
      id: "low-income",
      anio: 2026,
      mes: "julio",
      tipo: "Ingreso",
      valorPresupuestado: 1000,
      valorPagado: 1000,
      versionModeloFinanciero: 2,
    })];
    state.movimientos = [normalizeMovement({
      id: "over-budget",
      fecha: "2026-07-01",
      fechaLimite: "2026-07-31",
      anio: 2026,
      mes: "julio",
      tipo: "Gasto fijo",
      categoria: "Vivienda",
      valorPresupuestado: 1100,
      valorPagado: 900,
      versionModeloFinanciero: 2,
    })];

    const deficit = buildDashboardData(state, 2026, "julio", new Date("2026-07-15T12:00:00"));
    assert.equal(deficit.summary.saldoProyectado, -100);
    assert.ok(deficit.alerts.some((item) => item.type === "danger" && item.message.includes("por debajo de cero")));
    assert.ok(deficit.alerts.some((item) => item.message.includes("superan los ingresos")));

    const lowAvailableState = createInitialState();
    lowAvailableState.presupuestos = [normalizeBudgetItem({
      id: "large-income",
      anio: 2026,
      mes: "julio",
      tipo: "Ingreso",
      valorPresupuestado: 10000,
      valorPagado: 10000,
      versionModeloFinanciero: 2,
    })];
    lowAvailableState.movimientos = [normalizeMovement({
      id: "almost-committed",
      fecha: "2026-07-01",
      anio: 2026,
      mes: "julio",
      tipo: "Gasto fijo",
      valorPresupuestado: 9500,
      valorPagado: 9500,
      versionModeloFinanciero: 2,
    })];
    assert.ok(buildDashboardData(lowAvailableState, 2026, "julio").alerts.some((item) => item.message.includes("saldo proyectado es reducido")));

    const noIncome = buildDashboardData(createInitialState(), 2026, "julio");
    assert.equal(noIncome.committedPercentage, 0);
    assert.ok(noIncome.alerts.some((item) => item.message.includes("no hay ingresos registrados")));
    assert.equal(noIncome.categories.length, 0);
    assert.equal(noIncome.history.length, 6);
    assert.ok(noIncome.history.every((period) => Object.values(period.widths).every((width) => width === 0)));
  });

  test("evolucion del dashboard cruza correctamente de diciembre a enero", () => {
    const state = createInitialState();
    state.presupuestos = [normalizeBudgetItem({
      id: "december-income",
      anio: 2026,
      mes: "diciembre",
      tipo: "Ingreso",
      valorPresupuestado: 3000000,
      valorPagado: 3000000,
      versionModeloFinanciero: 2,
    })];
    state.movimientos = [normalizeMovement({
      id: "december-payment",
      fecha: "2026-12-30",
      anio: 2026,
      mes: "diciembre",
      tipo: "Gasto fijo",
      valorPresupuestado: 1000000,
      valorPagado: 1000000,
      versionModeloFinanciero: 2,
    })];

    const dashboard = buildDashboardData(state, 2027, "enero", new Date("2027-01-15T12:00:00"));

    assert.deepEqual(dashboard.history.map(({ year, month }) => [year, month]), [
      [2026, "agosto"],
      [2026, "septiembre"],
      [2026, "octubre"],
      [2026, "noviembre"],
      [2026, "diciembre"],
      [2027, "enero"],
    ]);
    assert.equal(dashboard.history[4].ingresos, 3000000);
    assert.equal(dashboard.history[4].pagos, 1000000);
    assert.equal(dashboard.history[4].disponible, 2000000);
    assert.equal(dashboard.history[5].ingresos, 0);
  });
});

describe("integridad y persistencia", () => {
  test("migra colecciones mixtas sin perder orden, identificadores ni registros", () => {
    const legacy = {
      version: 1,
      schemaVersion: 1,
      settings: { moneda: "COP", userOption: "preserve" },
      movimientos: [
        { id: "expense-paid", tipo: "Gasto fijo", categoria: "Vivienda", valorPresupuestado: 200, valorPagado: 200, estado: "Pagado" },
        { id: "income-pending", tipo: "Ingreso", categoria: "Nomina", valorPresupuestado: 500, valorPagado: 500, estado: "Pendiente" },
      ],
      presupuestos: [{ id: "budget-pending", tipo: "Ingreso", valorPresupuestado: 300, valorPagado: 0, estado: "Pendiente" }],
      categorias: [{ id: "custom-cat", nombre: "Arte", tipo: "Gasto variable" }],
      deudas: [{ id: "debt-1", entidad: "Banco", saldoActual: 100 }],
      metasAhorro: [{ id: "goal-1", nombre: "Viaje", valorObjetivo: 1000, valorAhorrado: 100 }],
    };
    const migrated = migrateData(legacy, 1, "2026-10-14T12:00:00.000Z");

    assert.deepEqual(migrated.movimientos.map((row) => row.id), ["expense-paid", "income-pending"]);
    assert.deepEqual(migrated.presupuestos.map((row) => row.id), ["budget-pending"]);
    assert.equal(migrated.movimientos[1].estado, "Pendiente");
    assert.equal(migrated.movimientos[1].valorPagado, 500);
    assert.equal(migrated.categorias[0].id, "custom-cat");
    assert.equal(migrated.deudas[0].id, "debt-1");
    assert.equal(migrated.metasAhorro[0].id, "goal-1");
    assert.equal(migrated.settings.userOption, "preserve");
  });

  test("respaldo y restauracion conservan datos de todas las colecciones y los saldos", () => {
    const original = createInitialState();
    original.settings.userPreference = "dark";
    original.presupuestos = [normalizeBudgetItem({
      id: "income-roundtrip",
      anio: 2026,
      mes: "junio",
      tipo: "Ingreso",
      categoria: "Nomina",
      concepto: "Sueldo",
      valorPresupuestado: 2500000,
      valorPagado: 2200000,
      estado: "Parcial",
      versionModeloFinanciero: 2,
    })];
    original.movimientos = [normalizeMovement({
      id: "expense-roundtrip",
      fecha: "2026-06-02",
      fechaLimite: "2026-06-30",
      tipo: "Gasto fijo",
      categoria: "Vivienda",
      descripcion: "Arriendo",
      valorPresupuestado: 900000,
      valorPagado: 300000,
      versionModeloFinanciero: 2,
    })];
    original.deudas = [{ id: "debt-roundtrip", entidad: "Banco", saldoActual: 400000 }];
    original.metasAhorro = [{ id: "goal-roundtrip", nombre: "Emergencias", valorObjetivo: 1000000, valorAhorrado: 100000 }];
    original.categorias.push({ id: "user-category", nombre: "Mascota", tipo: "Gasto variable", activa: true });

    const backup = createBackup(original, "2026-10-14T12:00:00.000Z");
    const restored = restoreStateFromBackup(createInitialState(), backup);
    const summary = calculateMonthlySummary(restored, 2026, "junio");

    assert.deepEqual(restored.settings, original.settings);
    for (const collection of ["presupuestos", "movimientos", "deudas", "metasAhorro", "categorias"]) {
      assert.deepEqual(restored[collection], original[collection]);
    }
    assert.equal(summary.ingresosRecibidos, 2200000);
    assert.equal(summary.gastosEfectivamentePagados, 300000);
    assert.equal(summary.obligacionesPendientes, 600000);
    assert.equal(summary.saldoDisponible, 1900000);
    assert.equal(summary.saldoProyectado, 1300000);
  });
});

describe("formularios y cambios de registros", () => {
  test("normaliza campos vacios y rechaza importes negativos a nivel de modelo", () => {
    const movement = normalizeMovement({
      id: "empty-fields",
      fecha: "2026-06-01",
      tipo: "Gasto variable",
      categoria: "",
      descripcion: "",
      valorPresupuestado: -100,
      valorPagado: -20,
    });
    const budget = normalizeBudgetItem({
      id: "negative-income",
      valorPresupuestado: -100,
      valorPagado: -10,
    });

    assert.equal(movement.categoria, "");
    assert.equal(movement.descripcion, "");
    assert.equal(movement.valorPresupuestado, 0);
    assert.equal(movement.valorPagado, 0);
    assert.equal(movement.valorFaltante, 0);
    assert.equal(budget.valorPresupuestado, 0);
    assert.equal(budget.valorPagado, 0);
  });

  test("los formularios declaran restricciones nativas para campos requeridos e importes", async () => {
    const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
    const expenseForm = app.slice(app.indexOf('function movementForm'), app.indexOf("function renderMovimientos"));
    const budgetForm = app.slice(app.indexOf("function budgetForm"), app.indexOf("function renderPresupuesto"));

    for (const name of ["fecha", "fechaLimite", "categoria", "descripcion", "valorPresupuestado"]) {
      assert.match(expenseForm, new RegExp(`name="${name}"[^>]*required|name="${name}"[^>]*` + `required`));
    }
    assert.match(expenseForm, /type="number" min="0" name="valorPresupuestado"/);
    assert.match(expenseForm, /type="number" min="0" name="valorPagado"/);
    assert.match(budgetForm, /name="categoria" required/);
    assert.match(budgetForm, /name="concepto" required/);
    assert.match(budgetForm, /type="number" min="0" name="valorPresupuestado"/);
    assert.match(budgetForm, /type="number" min="0" name="valorPagado"/);
  });

  test("agrega categorias personalizadas, rechaza vacias y evita duplicados sin distinguir mayusculas", () => {
    const initial = ["Mercado", "Vivienda"];
    const added = addCategoryIfMissing(initial, "  Mascotas  ");
    const duplicate = addCategoryIfMissing(added.categories, "mascotas");
    const empty = addCategoryIfMissing(added.categories, "  ");
    const placeholder = addCategoryIfMissing(added.categories, "Otro");

    assert.deepEqual(added, { category: "Mascotas", categories: ["Mercado", "Vivienda", "Mascotas"], added: true });
    assert.equal(duplicate.category, "mascotas");
    assert.equal(duplicate.added, false);
    assert.equal(duplicate.categories.length, 3);
    assert.equal(empty.category, "");
    assert.equal(placeholder.category, "");
    assert.deepEqual(initial, ["Mercado", "Vivienda"]);
  });

  test("actualiza movimientos por identificador, conserva una sola fila y no cambia el id", () => {
    const original = normalizeMovement({
      id: "edit-id",
      fecha: "2026-06-01",
      tipo: "Gasto fijo",
      categoria: "Internet",
      descripcion: "Internet",
      valorPresupuestado: 100000,
      valorPagado: 0,
      versionModeloFinanciero: 2,
    });
    const edited = normalizeMovement({
      ...original,
      descripcion: "Internet hogar",
      valorPresupuestado: 120000,
      origenCopiaId: "source-stable",
      periodoCopia: "2026-06",
    });
    const rows = upsertRecord([original], edited);
    const inserted = upsertRecord(rows, normalizeMovement({ id: "new-id", fecha: "2026-06-02", valorPresupuestado: 50 }));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "edit-id");
    assert.equal(rows[0].descripcion, "Internet hogar");
    assert.equal(rows[0].origenCopiaId, "source-stable");
    assert.equal(rows[0].periodoCopia, "2026-06");
    assert.deepEqual(inserted.map((row) => row.id), ["new-id", "edit-id"]);
    assert.equal(original.descripcion, "Internet");
  });

  test("elimina solo el identificador indicado y actualiza estado al registrar el pago", () => {
    const rows = [
      normalizeMovement({ id: "paid-target", fecha: "2026-06-01", valorPresupuestado: 800, valorPagado: 0, versionModeloFinanciero: 2 }),
      normalizeMovement({ id: "keep-target", fecha: "2026-06-01", valorPresupuestado: 500, valorPagado: 0, versionModeloFinanciero: 2 }),
    ];
    const paid = normalizeMovement({ ...rows[0], valorPagado: 800, versionModeloFinanciero: 2 });
    const updated = upsertRecord(rows, paid);
    const remaining = removeRecord(updated, "paid-target");

    assert.equal(updated.length, 2);
    assert.equal(updated.find((row) => row.id === "paid-target").estado, "Pagado");
    assert.equal(updated.find((row) => row.id === "paid-target").valorFaltante, 0);
    assert.deepEqual(remaining.map((row) => row.id), ["keep-target"]);
    assert.equal(rows[0].estado, "Pendiente");
    assert.equal(rows[1].id, "keep-target");
  });
});

test("formats values as Colombian pesos", () => {
  assert.equal(formatCOP(1000000), "$ 1.000.000 COP");
  assert.equal(formatCOP("45000"), "$ 45.000 COP");
  assert.equal(formatCOP(null), "$ 0 COP");
  assert.equal(formatCOP(-1250), "-$ 1.250 COP");
});

test("normalizes movement dates, numbers, status, and missing value", () => {
  const movement = normalizeMovement({
    fecha: "2026-06-25",
    fechaLimite: "2026-06-30",
    tipo: "Gasto fijo",
    categoria: "Internet",
    descripcion: "Pago internet",
    valorPresupuestado: "180000",
    valorPagado: "120000",
  }, new Date("2026-06-25T12:00:00"));

  assert.equal(movement.anio, 2026);
  assert.equal(movement.mes, "junio");
  assert.equal(movement.valorPresupuestado, 180000);
  assert.equal(movement.valorPagado, 120000);
  assert.equal(movement.valorFaltante, 60000);
  assert.equal(movement.estado, "Parcial");
  assert.equal(movement.versionModeloFinanciero, 2);
  assert.equal(movement.fechaLimite, "2026-06-30");
  assert.ok(movement.id);
});

test("calculates current and projected balances from received income and obligations", () => {
  const state = createInitialState();
  state.presupuestos = [
    normalizeBudgetItem({ anio: 2026, mes: "junio", categoria: "Nomina", valorPresupuestado: 5000000, valorPagado: 5000000, estado: "Pagado" }),
    normalizeBudgetItem({ anio: 2026, mes: "junio", categoria: "Proyecto", valorPresupuestado: 900000, valorPagado: 0, estado: "Pendiente" }),
  ];
  state.movimientos = [
    normalizeMovement({ fecha: "2026-06-01", tipo: "Gasto fijo", valorPresupuestado: 2000000, valorPagado: 2000000, estado: "Pagado" }),
    normalizeMovement({ fecha: "2026-06-02", tipo: "Gasto variable", valorPresupuestado: 1500000, valorPagado: 0, estado: "Pendiente" }),
  ];

  const summary = calculateMonthlySummary(state, 2026, "junio");
  assert.equal(summary.ingresosRecibidos, 5000000);
  assert.equal(summary.gastosEfectivamentePagados, 2000000);
  assert.equal(summary.obligacionesPendientes, 1500000);
  assert.equal(summary.saldoDisponible, 3000000);
  assert.equal(summary.saldoProyectado, 1500000);
});

test("counts partial payments once and keeps overdue remainder committed", () => {
  const obligation = normalizeMovement({
    fecha: "2026-06-01",
    fechaLimite: "2026-06-10",
    tipo: "Gasto fijo",
    valorPresupuestado: 100000,
    valorPagado: 30000,
    estado: "Parcial",
  }, new Date("2026-06-15T12:00:00"));
  const summary = calculateFinancialSummary(
    [{ valorPresupuestado: 200000, valorPagado: 200000, estado: "Pagado", versionModeloFinanciero: 2 }],
    [obligation],
    new Date("2026-06-15T12:00:00"),
  );

  assert.equal(obligation.estado, "Vencido");
  assert.equal(obligation.valorPagado, 30000);
  assert.equal(obligation.valorFaltante, 70000);
  assert.equal(summary.saldoDisponible, 170000);
  assert.equal(summary.obligacionesPendientes, 70000);
  assert.equal(summary.saldoProyectado, 100000);
});

test("does not count pending income as received and handles an empty month", () => {
  const pendingIncome = normalizeBudgetItem({
    anio: 2026,
    mes: "junio",
    valorPresupuestado: 750000,
    valorPagado: 0,
    estado: "Pendiente",
  });
  const summary = calculateFinancialSummary([pendingIncome], []);
  assert.equal(summary.totalIngresos, 0);
  assert.equal(summary.saldoDisponible, 0);
  assert.equal(summary.saldoProyectado, 0);
  assert.equal(getMovementStatus({ valorPresupuestado: 0, valorPagado: 0 }), "Pendiente");

  const emptyMonth = calculateMonthlySummary(createInitialState(), 2026, "junio");
  assert.equal(emptyMonth.totalIngresos, 0);
  assert.equal(emptyMonth.saldoDisponible, 0);
  assert.equal(emptyMonth.saldoProyectado, 0);
  assert.equal(emptyMonth.porcentajeEjecucion, 0);
  assert.ok(Number.isFinite(emptyMonth.nivelEndeudamiento));
});

test("migrates ambiguous historical pending amounts without losing their source values", () => {
  const movement = normalizeMovement({
    id: "legacy-pending",
    fecha: "2026-06-01",
    tipo: "Gasto variable",
    valorPresupuestado: 100000,
    valorPagado: 100000,
    valorFaltante: 0,
    estado: "Pendiente",
  });

  assert.equal(movement.valorPagado, 0);
  assert.equal(movement.valorFaltante, 100000);
  assert.equal(movement.migracionFinanciera.original.valorPagado, 100000);
  assert.match(movement.migracionFinanciera.regla, /Pendiente no se considera pagado/);
  assert.equal(movement.versionModeloFinanciero, 2);
});

test("does not treat an unnormalized historical pending expense as paid", () => {
  const summary = calculateFinancialSummary(
    [{ valorPresupuestado: 250000, valorPagado: 250000, estado: "Pagado" }],
    [{ valorPresupuestado: 80000, valorPagado: 80000, estado: "Pendiente" }],
  );

  assert.equal(summary.totalIngresos, 250000);
  assert.equal(summary.gastosEfectivamentePagados, 0);
  assert.equal(summary.obligacionesPendientes, 80000);
  assert.equal(summary.saldoDisponible, 250000);
  assert.equal(summary.saldoProyectado, 170000);
});

test("first copy creates a pending obligation with source and destination metadata", () => {
  const source = normalizeMovement({
    id: "recurring-rent",
    fecha: "2026-05-31",
    fechaLimite: "2026-05-31",
    anio: 2026,
    mes: "mayo",
    tipo: "Gasto fijo",
    categoria: "Vivienda",
    descripcion: "Arriendo",
    valorPresupuestado: 1200000,
    valorPagado: 1200000,
    estado: "Pagado",
  }, new Date("2026-06-01T12:00:00"));
  const plan = buildMovementCopyPlan([source], [], 2026, "junio", [source.id]);
  const copy = plan.copies[0];

  assert.equal(plan.newCount, 1);
  assert.equal(plan.totalNewValue, 1200000);
  assert.equal(copy.valorPresupuestado, 1200000);
  assert.equal(copy.valorPagado, 0);
  assert.equal(copy.valorFaltante, 1200000);
  assert.equal(copy.origenCopiaId, source.id);
  assert.equal(copy.periodoCopia, "2026-06");
  assert.equal(source.valorPagado, 1200000);
});

test("second copy of the same month reports the existing copy and adds nothing", () => {
  const source = normalizeMovement({
    id: "source-1",
    fecha: "2026-05-10",
    fechaLimite: "2026-05-20",
    anio: 2026,
    mes: "mayo",
    tipo: "Gasto fijo",
    categoria: "Servicios",
    descripcion: "Internet hogar",
    valorPresupuestado: 100000,
    valorPagado: 20000,
  });
  const firstCopy = buildMovementCopyPlan([source], [], 2026, "junio").copies[0];
  const repeated = buildMovementCopyPlan([source], [firstCopy], 2026, "junio");

  assert.equal(repeated.newCount, 0);
  assert.equal(repeated.duplicateCount, 1);
  assert.equal(repeated.copies.length, 0);
  assert.equal(repeated.entries[0].existing.id, firstCopy.id);
});

test("copy supports selecting only some source movements", () => {
  const first = normalizeMovement({ id: "selected-1", fecha: "2026-05-02", anio: 2026, mes: "mayo", categoria: "Comida", descripcion: "Mercado", valorPresupuestado: 50000 });
  const second = normalizeMovement({ id: "selected-2", fecha: "2026-05-03", anio: 2026, mes: "mayo", categoria: "Transporte", descripcion: "Bus", valorPresupuestado: 20000 });
  const plan = buildMovementCopyPlan([first, second], [], 2026, "junio", [second.id]);

  assert.equal(plan.selectedCount, 1);
  assert.equal(plan.newCount, 1);
  assert.equal(plan.totalNewValue, 20000);
  assert.equal(plan.copies[0].origenCopiaId, second.id);
});

test("legacy matches require multiple identifying fields and remain excluded until explicit confirmation", () => {
  const source = normalizeMovement({
    id: "source-legacy",
    fecha: "2026-05-15",
    fechaLimite: "2026-05-25",
    anio: 2026,
    mes: "mayo",
    categoria: "Servicios",
    descripcion: "Internet hogar",
    valorPresupuestado: 90000,
    valorPagado: 90000,
  });
  const manualMatch = normalizeMovement({
    id: "manual-target",
    fecha: "2026-06-15",
    fechaLimite: "2026-06-25",
    anio: 2026,
    mes: "junio",
    categoria: "Servicios",
    descripcion: "Internet hogar",
    valorPresupuestado: 90000,
    valorPagado: 0,
  });
  const sameAmountOnly = normalizeMovement({
    id: "same-amount",
    fecha: "2026-06-15",
    fechaLimite: "2026-06-25",
    anio: 2026,
    mes: "junio",
    categoria: "Otro",
    descripcion: "Otro gasto",
    valorPresupuestado: 90000,
  });
  const possible = buildMovementCopyPlan([source], [manualMatch, sameAmountOnly], 2026, "junio");
  const confirmed = buildMovementCopyPlan([source], [manualMatch, sameAmountOnly], 2026, "junio", [source.id], [source.id]);
  const unrelated = buildMovementCopyPlan([source], [sameAmountOnly], 2026, "junio");

  assert.equal(possible.possibleCount, 1);
  assert.equal(possible.newCount, 0);
  assert.equal(possible.entries[0].matches[0].id, "manual-target");
  assert.equal(confirmed.newCount, 1);
  assert.equal(confirmed.totalNewValue, 90000);
  assert.equal(unrelated.newCount, 1);
  assert.equal(unrelated.entries[0].type, "new");
  assert.equal(sameAmountOnly.origenCopiaId, undefined);
});

test("adapts dates for short, leap, and long months while preserving registration versus due dates", () => {
  assert.equal(shiftDateToPeriod("2026-01-31", 2026, "febrero"), "2026-02-28");
  assert.equal(shiftDateToPeriod("2024-01-31", 2024, "febrero"), "2024-02-29");
  assert.equal(shiftDateToPeriod("2026-04-30", 2026, "mayo"), "2026-05-30");
  assert.equal(shiftDateToPeriod("2026-01-31", 2026, "marzo"), "2026-03-31");

  const source = normalizeMovement({
    id: "date-source",
    fecha: "2026-12-31",
    fechaLimite: "2026-12-20",
    anio: 2026,
    mes: "diciembre",
    categoria: "Vivienda",
    descripcion: "Arriendo",
    valorPresupuestado: 500000,
    valorPagado: 100000,
  });
  const januaryCopy = createCopiedMovement(source, 2027, "enero");

  assert.equal(januaryCopy.fecha, "2027-01-31");
  assert.equal(januaryCopy.fechaLimite, "2027-01-20");
  assert.equal(januaryCopy.mes, "enero");
  assert.equal(januaryCopy.anio, 2027);
  assert.equal(source.fecha, "2026-12-31");
  assert.equal(source.fechaLimite, "2026-12-20");
  assert.equal(source.valorPagado, 100000);
  assert.equal(januaryCopy.valorPagado, 0);
});

test("calculates required monthly financial summary without division errors", () => {
  const state = {
    ...createInitialState(),
    movimientos: [
      normalizeMovement({ fecha: "2026-06-01", tipo: "Ingreso", categoria: "Salario", valorPresupuestado: 3000000, valorPagado: 3000000 }),
      normalizeMovement({ fecha: "2026-06-02", tipo: "Gasto fijo", categoria: "Internet", valorPresupuestado: 200000, valorPagado: 200000 }),
      normalizeMovement({ fecha: "2026-06-03", tipo: "Gasto variable", categoria: "Mercado", valorPresupuestado: 500000, valorPagado: 450000 }),
      normalizeMovement({ fecha: "2026-06-04", tipo: "Deuda", categoria: "BBVA", valorPresupuestado: 300000, valorPagado: 300000 }),
      normalizeMovement({ fecha: "2026-06-05", tipo: "Ahorro", categoria: "Fondo", valorPresupuestado: 200000, valorPagado: 100000 }),
      normalizeMovement({ fecha: "2026-05-05", tipo: "Ingreso", categoria: "Salario", valorPresupuestado: 1, valorPagado: 1 }),
    ],
  };

  const summary = calculateMonthlySummary(state, 2026, "junio");

  assert.equal(summary.totalIngresos, 3000000);
  assert.equal(summary.totalGastosFijos, 200000);
  assert.equal(summary.totalGastosVariables, 450000);
  assert.equal(summary.totalDeudas, 300000);
  assert.equal(summary.totalAhorro, 100000);
  assert.equal(summary.totalPresupuestado, 4200000);
  assert.equal(summary.totalPagado, 4050000);
  assert.equal(summary.totalFaltante, 150000);
  assert.equal(summary.saldoDisponible, 1950000);
  assert.equal(summary.porcentajeEjecucion, 96.43);
  assert.equal(summary.nivelEndeudamiento, 10);
  assert.equal(summary.porcentajeAhorro, 3.33);
  assert.equal(calculateMonthlySummary({ ...state, movimientos: [] }, 2026, "junio").porcentajeEjecucion, 0);
});

test("validates backups and rejects malformed payloads", () => {
  const state = createInitialState();
  assert.equal(validateBackup(state).ok, true);
  assert.equal(validateBackup({ movimientos: [] }).ok, false);
  assert.equal(validateBackup(null).ok, false);
});

test("merges backups by id without duplicating existing records", () => {
  const current = createInitialState();
  current.movimientos = [normalizeMovement({ id: "same", fecha: "2026-06-01", tipo: "Ingreso", categoria: "Salario", valorPagado: 1 })];
  const incoming = createInitialState();
  incoming.movimientos = [
    normalizeMovement({ id: "same", fecha: "2026-06-01", tipo: "Ingreso", categoria: "Salario", valorPagado: 2 }),
    normalizeMovement({ id: "new", fecha: "2026-06-02", tipo: "Ahorro", categoria: "Ahorro", valorPagado: 3 }),
  ];

  const merged = mergeBackup(current, createBackup(incoming));

  assert.equal(merged.state.movimientos.length, 2);
  assert.equal(merged.state.movimientos.find((item) => item.id === "same").valorPagado, 1);
  assert.equal(merged.state.movimientos.find((item) => item.id === "new").valorPagado, 3);
  assert.equal(merged.duplicates.length, current.categorias.length);
  assert.equal(merged.conflicts.length, 1);
});

test("rejects damaged JSON structures, invalid amounts, and duplicate ids", () => {
  const valid = createBackup(createInitialState());
  assert.equal(validateBackup(valid).ok, true);
  assert.equal(validateBackup({ ...valid, data: { ...valid.data, settings: null } }).ok, false);
  assert.equal(validateBackup({
    ...valid,
    data: { ...valid.data, movimientos: [{ id: "bad", valorPagado: "not-a-number" }] },
  }).ok, false);
  assert.equal(validateBackup({
    ...valid,
    data: { ...valid.data, movimientos: [{ id: "same" }, { id: "same" }] },
  }).ok, false);
  assert.equal(validateBackup({
    ...valid,
    ingresos: [{ id: "income", valorPagado: -1 }],
  }).ok, false);
  assert.equal(backupCounts({ not: "a backup" }).ok, false);
});

test("exports a versioned backup with timestamp, financial sections, and stable ids for legacy rows", () => {
  const state = createInitialState();
  state.presupuestos = [{ id: "income", tipo: "Ingreso", valorPresupuestado: 100, valorPagado: 50 }];
  state.movimientos = [{ fecha: "2026-06-01", tipo: "Gasto fijo", valorPresupuestado: 20, valorPagado: 0 }];
  const backup = createBackup(state, "2026-10-14T12:00:00.000Z");
  const imported = extractBackupData(backup);
  const repeated = extractBackupData(backup);

  assert.equal(backup.app, "App_Finanzas");
  assert.equal(backup.schemaVersion, DATA_SCHEMA_VERSION);
  assert.equal(backup.generatedAt, "2026-10-14T12:00:00.000Z");
  assert.equal(backup.ingresos.length, 1);
  assert.equal(backup.gastos.length, 1);
  assert.ok(imported.movimientos[0].id);
  assert.equal(imported.movimientos[0].id, repeated.movimientos[0].id);
});

test("migrates older data progressively, idempotently, and preserves all original fields", () => {
  const legacy = {
    version: 1,
    settings: { appMode: "simple-v2", customSetting: "keep" },
    movimientos: [{ id: "old-income", tipo: "Ingreso", valorPresupuestado: 10, valorPagado: 10, estado: "Pagado" }],
    presupuestos: [],
    categorias: [{ id: "custom", nombre: "Personalizada", tipo: "Ingreso" }],
    deudas: [],
    metasAhorro: [],
    unknownLegacyField: { keep: true },
  };
  const migrated = migrateData(legacy, 1, "2026-10-14T12:00:00.000Z");
  const repeated = migrateData(migrated, migrated.schemaVersion, "2026-10-15T12:00:00.000Z");
  const extracted = extractBackupData({ schemaVersion: 1, data: legacy });

  assert.equal(migrated.schemaVersion, DATA_SCHEMA_VERSION);
  assert.deepEqual(repeated, migrated);
  assert.deepEqual(migrated.unknownLegacyField, { keep: true });
  assert.equal(migrated.movimientos[0].id, "old-income");
  assert.equal(extracted.movimientos[0].tipo, "Ingreso");
  assert.equal(extracted.settings.customSetting, "keep");
  assert.equal(extracted.categorias[0].nombre, "Personalizada");
});

test("restores a backup as a replacement only when explicitly requested by the caller", () => {
  const current = createInitialState();
  current.settings.userPreference = "current";
  current.movimientos = [normalizeMovement({ id: "current", fecha: "2026-06-01", valorPresupuestado: 100 })];
  const incoming = createInitialState();
  incoming.settings.userPreference = "from-backup";
  incoming.movimientos = [normalizeMovement({ id: "restored", fecha: "2026-06-02", valorPresupuestado: 200 })];

  const restored = restoreStateFromBackup(current, createBackup(incoming));

  assert.equal(restored.movimientos.length, 1);
  assert.equal(restored.movimientos[0].id, "restored");
  assert.equal(restored.settings.userPreference, "from-backup");
  assert.equal(current.movimientos[0].id, "current");
});

test("archives original storage values without overwriting existing copies", () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const key = archiveStorageValue(storage, '{"original":true}', 10);
  const secondKey = archiveStorageValue(storage, '{"second":true}', 10);

  assert.equal(entries.get(key), '{"original":true}');
  assert.equal(entries.get(secondKey), '{"second":true}');
  assert.notEqual(key, secondKey);
});

test("provides a clear message for local storage quota failures", () => {
  assert.match(storageErrorMessage({ name: "QuotaExceededError" }), /No hay espacio suficiente/);
  assert.match(storageErrorMessage(new Error("blocked")), /no se confirmaron como guardados/);
});

test("generates escaped CSV content", () => {
  const csv = generateCsv([{ categoria: "Comida, mercado", observacion: "Linea \"especial\"", valor: 10 }]);
  assert.equal(csv, 'categoria,observacion,valor\r\n"Comida, mercado","Linea ""especial""",10');
});

test("builds reports for month, categories, debts, savings, and pending payments", () => {
  const state = createInitialState();
  state.movimientos = [
    normalizeMovement({ id: "m1", fecha: "2026-06-01", tipo: "Gasto fijo", categoria: "Internet", descripcion: "Internet", valorPresupuestado: 180000, valorPagado: 0, estado: "Pendiente" }),
    normalizeMovement({ id: "m2", fecha: "2026-06-02", tipo: "Gasto variable", categoria: "Mercado", descripcion: "Mercado", valorPresupuestado: 400000, valorPagado: 500000, estado: "Pagado" }),
  ];
  state.deudas = [{ id: "d1", entidad: "BBVA", tipo: "Credito", saldoInicial: 1000, saldoActual: 500, cuotaMensual: 100, fechaPago: 25, estado: "Activa", observacion: "" }];
  state.metasAhorro = [{ id: "a1", nombre: "Fondo", valorObjetivo: 1000, valorAhorrado: 500, fechaObjetivo: "2026-12-31", observacion: "" }];

  const reports = buildReports(state, 2026, "junio");

  assert.equal(reports.mensual.length, 2);
  assert.equal(reports.pendientes.length, 1);
  assert.equal(reports.categorias.find((row) => row.categoria === "Mercado").valorPagado, 500000);
  assert.equal(reports.deudas.length, 1);
  assert.equal(reports.ahorro[0].porcentajeAvance, 50);
});

test("creates actionable financial alerts", () => {
  const state = createInitialState();
  state.movimientos = [
    normalizeMovement({ fecha: "2026-06-01", tipo: "Ingreso", categoria: "Salario", valorPresupuestado: 1000000, valorPagado: 1000000 }),
    normalizeMovement({ fecha: "2026-06-02", tipo: "Gasto fijo", categoria: "Internet", valorPresupuestado: 100000, valorPagado: 0, estado: "Pendiente" }),
    normalizeMovement({ fecha: "2026-06-03", tipo: "Gasto variable", categoria: "Mercado", valorPresupuestado: 100000, valorPagado: 150000, estado: "Pagado" }),
  ];
  state.deudas = [{ id: "d1", entidad: "BBVA", tipo: "Credito", saldoInicial: 1000, saldoActual: 500, cuotaMensual: 100, fechaPago: 25, estado: "Activa", observacion: "" }];
  state.metasAhorro = [{ id: "a1", nombre: "Vacaciones", valorObjetivo: 1000000, valorAhorrado: 100000, fechaObjetivo: "2026-12-31", observacion: "" }];

  const alerts = getAlerts(state, 2026, "junio", new Date("2026-06-24T12:00:00"));
  const messages = alerts.map((alert) => alert.message).join(" | ");

  assert.match(messages, /Pago pendiente/);
  assert.match(messages, /Gasto excedido/);
  assert.match(messages, /Deuda proxima a vencer/);
  assert.match(messages, /Meta de ahorro sin aporte/);
});
