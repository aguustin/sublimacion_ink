-- CreateEnum
CREATE TYPE "RolCancelacion" AS ENUM ('CLIENTE', 'TIENDA');

-- CreateEnum
CREATE TYPE "ReglaCancelacion" AS ENUM ('RN_19', 'RN_21', 'RN_15', 'SIN_CARGO');

-- CreateEnum
CREATE TYPE "TipoAjuste" AS ENUM ('CARGO_SERVICIO_CANCELACION', 'RETENCION_SENA');

-- CreateEnum
CREATE TYPE "EstadoAjuste" AS ENUM ('REGISTRADO', 'PENDIENTE_ARREGLO', 'COBRADO', 'CONDONADO', 'INCOBRABLE');

-- CreateEnum
CREATE TYPE "EstadoReembolso" AS ENUM ('PENDIENTE', 'REALIZADO_SIMULADO', 'PENDIENTE_ARREGLO', 'DEVUELTO');

-- CreateTable
CREATE TABLE "cancelacion" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "solicitada_por_id" UUID NOT NULL,
    "rol" "RolCancelacion" NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado_previo" "EstadoPedido" NOT NULL,
    "dentro_ventana_48h" BOOLEAN NOT NULL,
    "regla_aplicada" "ReglaCancelacion" NOT NULL,
    "subtotal_productos_centavos" INTEGER NOT NULL,
    "descuento_cupon_centavos" INTEGER NOT NULL,
    "productos_cobrados_centavos" INTEGER NOT NULL,
    "envio_centavos" INTEGER NOT NULL,
    "sena_pagada_centavos" INTEGER NOT NULL,
    "saldo_pagado_centavos" INTEGER NOT NULL,
    "total_pagado_centavos" INTEGER NOT NULL,
    "porcentaje_aplicado" INTEGER,
    "cargo_centavos" INTEGER NOT NULL,
    "a_reembolsar_centavos" INTEGER NOT NULL,
    "incluye_envio" BOOLEAN NOT NULL,
    "consecuencias" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cancelacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ajuste_economico" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "tipo" "TipoAjuste" NOT NULL,
    "base_centavos" INTEGER NOT NULL,
    "porcentaje" INTEGER,
    "importe_centavos" INTEGER NOT NULL,
    "estado" "EstadoAjuste" NOT NULL,
    "costo_real_estimado_centavos" INTEGER,
    "nota_cierre" TEXT,
    "cerrado_por_id" UUID,
    "cerrado_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ajuste_economico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reembolso" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "pago_id" UUID NOT NULL,
    "importe_centavos" INTEGER NOT NULL,
    "incluye_envio" BOOLEAN NOT NULL,
    "estado" "EstadoReembolso" NOT NULL,
    "simulado" BOOLEAN NOT NULL,
    "motivo" TEXT NOT NULL,
    "referencia_externa" TEXT,
    "nota_cierre" TEXT,
    "cerrado_por_id" UUID,
    "cerrado_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reembolso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cancelacion_pedido_id_key" ON "cancelacion"("pedido_id");

-- CreateIndex
CREATE INDEX "ajuste_economico_pedido_id_idx" ON "ajuste_economico"("pedido_id");

-- CreateIndex
CREATE INDEX "reembolso_pedido_id_idx" ON "reembolso"("pedido_id");

-- AddForeignKey
ALTER TABLE "cancelacion" ADD CONSTRAINT "cancelacion_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajuste_economico" ADD CONSTRAINT "ajuste_economico_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reembolso" ADD CONSTRAINT "reembolso_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reembolso" ADD CONSTRAINT "reembolso_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RN-24: un solo cargo de cancelación por pedido (15 % o retención de la seña).
CREATE UNIQUE INDEX "ajuste_economico_un_cargo_por_pedido" ON "ajuste_economico" ("pedido_id")
  WHERE "tipo" IN ('CARGO_SERVICIO_CANCELACION', 'RETENCION_SENA');

ALTER TABLE "cancelacion" ADD CONSTRAINT "cancelacion_importes_no_negativos" CHECK (
  "cargo_centavos" >= 0 AND "a_reembolsar_centavos" >= 0 AND "total_pagado_centavos" >= 0 AND "a_reembolsar_centavos" <= "total_pagado_centavos"
);
ALTER TABLE "ajuste_economico" ADD CONSTRAINT "ajuste_economico_importe_positivo" CHECK ("importe_centavos" > 0);
ALTER TABLE "reembolso" ADD CONSTRAINT "reembolso_importe_positivo" CHECK ("importe_centavos" > 0);
