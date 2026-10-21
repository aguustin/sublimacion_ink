-- INC-08.2: a lo sumo un pago aprobado por pedido y concepto (TOTAL, SENA o SALDO). Los intentos
-- rechazados o con error no cuentan, y un reembolso no cambia el estado del pago (es otra tabla).
CREATE UNIQUE INDEX "pago_un_aprobado_por_concepto" ON "pago" ("pedido_id", "concepto") WHERE "estado" = 'APROBADO';
