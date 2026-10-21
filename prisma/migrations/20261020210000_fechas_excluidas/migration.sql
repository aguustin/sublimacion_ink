-- CreateEnum
CREATE TYPE "CausaCambioVentana" AS ENUM ('FECHA_EXCLUIDA_AGREGADA', 'FECHA_EXCLUIDA_QUITADA');

-- AlterTable
ALTER TABLE "cancelacion" ADD COLUMN     "inicio_ventana_cargo" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "dia_excluido_ventana" (
    "id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "creado_por_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dia_excluido_ventana_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cambio_ventana_cargo" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "causa" "CausaCambioVentana" NOT NULL,
    "fecha_excluida" DATE NOT NULL,
    "inicio_anterior" TIMESTAMPTZ NOT NULL,
    "inicio_nuevo" TIMESTAMPTZ NOT NULL,
    "autor_id" UUID NOT NULL,
    "notificacion_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cambio_ventana_cargo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dia_excluido_ventana_fecha_key" ON "dia_excluido_ventana"("fecha");

-- CreateIndex
CREATE INDEX "cambio_ventana_cargo_pedido_id_creado_en_idx" ON "cambio_ventana_cargo"("pedido_id", "creado_en");

-- AddForeignKey
ALTER TABLE "cambio_ventana_cargo" ADD CONSTRAINT "cambio_ventana_cargo_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

