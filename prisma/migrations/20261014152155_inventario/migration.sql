-- CreateEnum
CREATE TYPE "EstadoRetencion" AS ENUM ('ACTIVA', 'CONSUMIDA', 'LIBERADA');

-- CreateEnum
CREATE TYPE "MotivoLiberacion" AS ENUM ('CANCELACION', 'VENCIMIENTO_PAGO_ONLINE', 'VENCIMIENTO_RESERVA');

-- CreateEnum
CREATE TYPE "TipoMovimientoStock" AS ENUM ('INGRESO', 'AJUSTE', 'RETENCION', 'LIBERACION', 'CONSUMO');

-- AlterTable
ALTER TABLE "variante" ADD COLUMN     "stock_fisico" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stock_reservado" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "umbral_stock_bajo" INTEGER;

-- CreateTable
CREATE TABLE "material" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "stock_fisico" INTEGER NOT NULL DEFAULT 0,
    "stock_reservado" INTEGER NOT NULL DEFAULT 0,
    "umbral_stock_bajo" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retencion_stock" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "variante_id" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "estado" "EstadoRetencion" NOT NULL DEFAULT 'ACTIVA',
    "motivo_liberacion" "MotivoLiberacion",
    "cerrada_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retencion_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento_stock" (
    "id" UUID NOT NULL,
    "tipo" "TipoMovimientoStock" NOT NULL,
    "variante_id" UUID,
    "material_id" UUID,
    "delta_fisico" INTEGER NOT NULL,
    "delta_reservado" INTEGER NOT NULL,
    "retencion_id" UUID,
    "motivo" TEXT,
    "autor_id" UUID,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "retencion_stock_pedido_id_idx" ON "retencion_stock"("pedido_id");

-- CreateIndex
CREATE INDEX "retencion_stock_variante_id_estado_idx" ON "retencion_stock"("variante_id", "estado");

-- CreateIndex
CREATE INDEX "movimiento_stock_variante_id_creado_en_idx" ON "movimiento_stock"("variante_id", "creado_en");

-- CreateIndex
CREATE INDEX "movimiento_stock_material_id_creado_en_idx" ON "movimiento_stock"("material_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_stock_retencion_id_tipo_key" ON "movimiento_stock"("retencion_id", "tipo");

-- AddForeignKey
ALTER TABLE "retencion_stock" ADD CONSTRAINT "retencion_stock_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "variante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_stock_retencion_id_fkey" FOREIGN KEY ("retencion_id") REFERENCES "retencion_stock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Integridad del stock (sección 14.3): aunque el código fallara, la base rechaza valores inválidos.
ALTER TABLE "variante" ADD CONSTRAINT "variante_stock_reservado_valido"
  CHECK ("stock_reservado" >= 0 AND "stock_reservado" <= "stock_fisico");
ALTER TABLE "variante" ADD CONSTRAINT "variante_umbral_valido" CHECK ("umbral_stock_bajo" IS NULL OR "umbral_stock_bajo" >= 0);
ALTER TABLE "material" ADD CONSTRAINT "material_stock_reservado_valido"
  CHECK ("stock_reservado" >= 0 AND "stock_reservado" <= "stock_fisico");
ALTER TABLE "material" ADD CONSTRAINT "material_umbral_valido" CHECK ("umbral_stock_bajo" IS NULL OR "umbral_stock_bajo" >= 0);
ALTER TABLE "retencion_stock" ADD CONSTRAINT "retencion_cantidad_positiva" CHECK ("cantidad" > 0);
-- Un movimiento es de una variante o de un material, nunca de ambos ni de ninguno.
ALTER TABLE "movimiento_stock" ADD CONSTRAINT "movimiento_un_solo_destino"
  CHECK (num_nonnulls("variante_id", "material_id") = 1);
