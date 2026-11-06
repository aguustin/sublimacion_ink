-- INC-12: entregas (F-06, D-06 sin estados propios), compensación por demora (RN-04, D-05) y comprobantes externos (RN-26).

-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('FACTURA', 'NOTA_CREDITO');

-- AlterEnum
ALTER TYPE "TipoAjuste" ADD VALUE 'COMPENSACION_DEMORA';

-- AlterTable
ALTER TABLE "ajuste_economico" ADD COLUMN     "autor_id" UUID,
ADD COLUMN     "autorizado_por" TEXT,
ADD COLUMN     "justificacion" TEXT;

-- AlterTable
ALTER TABLE "reembolso" ADD COLUMN     "ajuste_id" UUID;

-- CreateTable
CREATE TABLE "entrega" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "transportista" TEXT,
    "codigo_seguimiento" TEXT,
    "listo_en" TIMESTAMPTZ,
    "listo_por_id" UUID,
    "despachado_en" TIMESTAMPTZ,
    "despachado_por_id" UUID,
    "entregado_en" TIMESTAMPTZ,
    "entregado_por_id" UUID,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobante_externo" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "tipo" "TipoComprobante" NOT NULL,
    "letra" TEXT NOT NULL,
    "punto_venta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha_emision" DATE NOT NULL,
    "importe_centavos" INTEGER NOT NULL,
    "archivo_id" UUID,
    "registrado_por_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobante_externo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entrega_pedido_id_key" ON "entrega"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_externo_archivo_id_key" ON "comprobante_externo"("archivo_id");

-- CreateIndex
CREATE INDEX "comprobante_externo_pedido_id_idx" ON "comprobante_externo"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_externo_tipo_letra_punto_venta_numero_key" ON "comprobante_externo"("tipo", "letra", "punto_venta", "numero");

-- CreateIndex
CREATE INDEX "reembolso_ajuste_id_idx" ON "reembolso"("ajuste_id");

-- AddForeignKey
ALTER TABLE "reembolso" ADD CONSTRAINT "reembolso_ajuste_id_fkey" FOREIGN KEY ("ajuste_id") REFERENCES "ajuste_economico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante_externo" ADD CONSTRAINT "comprobante_externo_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante_externo" ADD CONSTRAINT "comprobante_externo_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Compensación por demora (D-05): exige motivo, quién la autorizó y el admin que la cargó. Se compara como
-- texto porque el valor nuevo del enum no se puede usar como literal en la misma transacción.
ALTER TABLE "ajuste_economico" ADD CONSTRAINT "ajuste_compensacion_completa" CHECK (
  "tipo"::text <> 'COMPENSACION_DEMORA' OR (coalesce(btrim("justificacion"), '') <> '' AND coalesce(btrim("autorizado_por"), '') <> '' AND "autor_id" IS NOT NULL)
);

-- Comprobantes (RN-26): números y punto de venta positivos, importe positivo y letra no vacía.
ALTER TABLE "comprobante_externo" ADD CONSTRAINT "comprobante_datos_validos" CHECK (
  "punto_venta" > 0 AND "numero" > 0 AND "importe_centavos" > 0 AND btrim("letra") <> ''
);
