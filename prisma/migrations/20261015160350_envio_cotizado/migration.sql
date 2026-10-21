-- CreateEnum
CREATE TYPE "EstadoCotizacionEnvio" AS ENUM ('PROPUESTA', 'ACEPTADA', 'RECHAZADA', 'REEMPLAZADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EstadoPedido" ADD VALUE 'ENVIO_A_COTIZAR';
ALTER TYPE "EstadoPedido" ADD VALUE 'ENVIO_COTIZADO';

-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "direccion_envio" JSONB;

-- CreateTable
CREATE TABLE "cotizacion_envio" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "importe_centavos" INTEGER,
    "nota" TEXT,
    "estado" "EstadoCotizacionEnvio" NOT NULL DEFAULT 'PROPUESTA',
    "autor_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondida_en" TIMESTAMPTZ,

    CONSTRAINT "cotizacion_envio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cotizacion_envio_pedido_id_creado_en_idx" ON "cotizacion_envio"("pedido_id", "creado_en");

-- AddForeignKey
ALTER TABLE "cotizacion_envio" ADD CONSTRAINT "cotizacion_envio_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
