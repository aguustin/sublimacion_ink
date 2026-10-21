-- CreateEnum
CREATE TYPE "EstadoCupon" AS ENUM ('ACTIVO', 'USADO', 'VENCIDO', 'ANULADO');

-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "cupon_id" UUID,
ADD COLUMN     "descuento_cupon_centavos" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cupon" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "cliente_id" UUID NOT NULL,
    "pedido_origen_id" UUID NOT NULL,
    "monto_centavos" INTEGER NOT NULL,
    "porcentaje" INTEGER NOT NULL,
    "emitido_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ NOT NULL,
    "estado" "EstadoCupon" NOT NULL DEFAULT 'ACTIVO',
    "usado_en_pedido_id" UUID,
    "restaurado_en" TIMESTAMPTZ,
    "anulado_por_id" UUID,
    "motivo_anulacion" TEXT,

    CONSTRAINT "cupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cupon_codigo_key" ON "cupon"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "cupon_pedido_origen_id_key" ON "cupon"("pedido_origen_id");

-- CreateIndex
CREATE INDEX "cupon_cliente_id_estado_idx" ON "cupon"("cliente_id", "estado");

-- CreateIndex
CREATE INDEX "cupon_estado_vence_en_idx" ON "cupon"("estado", "vence_en");

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cupon_id_fkey" FOREIGN KEY ("cupon_id") REFERENCES "cupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_pedido_origen_id_fkey" FOREIGN KEY ("pedido_origen_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cupon" ADD CONSTRAINT "cupon_monto_positivo" CHECK ("monto_centavos" > 0);
ALTER TABLE "cupon" ADD CONSTRAINT "cupon_usado_con_pedido" CHECK (("estado" = 'USADO') = ("usado_en_pedido_id" IS NOT NULL));
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_descuento_valido" CHECK (
  "descuento_cupon_centavos" >= 0 AND "descuento_cupon_centavos" <= "subtotal_productos_centavos"
  AND ("cupon_id" IS NOT NULL OR "descuento_cupon_centavos" = 0)
);
