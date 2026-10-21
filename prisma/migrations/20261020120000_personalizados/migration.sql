-- CreateEnum
CREATE TYPE "EstadoCotizacion" AS ENUM ('PROPUESTA', 'ACEPTADA', 'RECHAZADA', 'REEMPLAZADA');

-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "pedido_origen_id" UUID,
ADD COLUMN     "porcentaje_sena" INTEGER,
ADD COLUMN     "sena_centavos" INTEGER;

-- CreateTable
CREATE TABLE "solicitud_personalizacion" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "variante_id" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "fecha_deseada" DATE NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_personalizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referencia_pedido" (
    "pedido_id" UUID NOT NULL,
    "archivo_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referencia_pedido_pkey" PRIMARY KEY ("pedido_id","archivo_id")
);

-- CreateTable
CREATE TABLE "cotizacion" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "precio_unitario_centavos" INTEGER NOT NULL,
    "precio_productos_centavos" INTEGER NOT NULL,
    "costo_envio_centavos" INTEGER,
    "fecha_entrega_propuesta" DATE NOT NULL,
    "detalle" TEXT NOT NULL,
    "estado" "EstadoCotizacion" NOT NULL DEFAULT 'PROPUESTA',
    "autor_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondida_por_id" UUID,
    "respondida_en" TIMESTAMPTZ,

    CONSTRAINT "cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_personalizacion_pedido_id_key" ON "solicitud_personalizacion"("pedido_id");

-- CreateIndex
CREATE INDEX "referencia_pedido_archivo_id_idx" ON "referencia_pedido"("archivo_id");

-- CreateIndex
CREATE INDEX "cotizacion_pedido_id_creado_en_idx" ON "cotizacion"("pedido_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_pedido_origen_id_key" ON "pedido"("pedido_origen_id");

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_pedido_origen_id_fkey" FOREIGN KEY ("pedido_origen_id") REFERENCES "pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_personalizacion" ADD CONSTRAINT "solicitud_personalizacion_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_personalizacion" ADD CONSTRAINT "solicitud_personalizacion_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referencia_pedido" ADD CONSTRAINT "referencia_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referencia_pedido" ADD CONSTRAINT "referencia_pedido_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "solicitud_personalizacion" ADD CONSTRAINT "solicitud_cantidad_positiva" CHECK ("cantidad" > 0);
ALTER TABLE "cotizacion" ADD CONSTRAINT "cotizacion_importes_validos" CHECK (
  "precio_unitario_centavos" > 0 AND "precio_productos_centavos" > 0 AND ("costo_envio_centavos" IS NULL OR "costo_envio_centavos" >= 0)
);
-- RN-21: la seña es parte de lo que se cobra.
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_sena_valida" CHECK ("sena_centavos" IS NULL OR ("sena_centavos" >= 0 AND "sena_centavos" <= "total_centavos"));
-- Una sola cotización vigente por pedido.
CREATE UNIQUE INDEX "cotizacion_una_propuesta_por_pedido" ON "cotizacion" ("pedido_id") WHERE "estado" = 'PROPUESTA';
