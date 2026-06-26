import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReports,
  calculateMonthlySummary,
  createInitialState,
  formatCOP,
  generateCsv,
  getAlerts,
  mergeBackup,
  normalizeMovement,
  validateBackup,
} from "./finance-core.js";

test("formats values as Colombian pesos", () => {
  assert.equal(formatCOP(1000000), "$ 1.000.000 COP");
  assert.equal(formatCOP("45000"), "$ 45.000 COP");
  assert.equal(formatCOP(null), "$ 0 COP");
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
  });

  assert.equal(movement.anio, 2026);
  assert.equal(movement.mes, "junio");
  assert.equal(movement.valorPresupuestado, 180000);
  assert.equal(movement.valorPagado, 120000);
  assert.equal(movement.valorFaltante, 60000);
  assert.equal(movement.estado, "Parcial");
  assert.equal(movement.fechaLimite, "2026-06-30");
  assert.ok(movement.id);
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

  const merged = mergeBackup(current, incoming);

  assert.equal(merged.movimientos.length, 2);
  assert.equal(merged.movimientos.find((item) => item.id === "same").valorPagado, 1);
  assert.equal(merged.movimientos.find((item) => item.id === "new").valorPagado, 3);
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
