-- CreateEnum
CREATE TYPE "EstadoDiseno" AS ENUM ('SIN_PROPUESTA', 'PENDIENTE_APROBACION', 'CAMBIOS_SOLICITADOS', 'APROBADO');

-- CreateTable
CREATE TABLE "diseno" (
    "id" UUID NOT NULL,
    "item_pedido_id" UUID NOT NULL,
    "estado" "EstadoDiseno" NOT NULL DEFAULT 'SIN_PROPUESTA',
    "version_vigente_id" UUID,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "diseno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "version_diseno" (
    "id" UUID NOT NULL,
    "diseno_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "nota" TEXT,
    "creada_por_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "huella" TEXT NOT NULL,

    CONSTRAINT "version_diseno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivo_version_diseno" (
    "version_id" UUID NOT NULL,
    "archivo_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "archivo_version_diseno_pkey" PRIMARY KEY ("version_id","archivo_id")
);

-- CreateTable
CREATE TABLE "aprobacion_diseno" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "aprobada_por_id" UUID NOT NULL,
    "aprobada_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "huella_aprobada" TEXT NOT NULL,

    CONSTRAINT "aprobacion_diseno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud_cambio" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "comentario" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_cambio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diseno_item_pedido_id_key" ON "diseno"("item_pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "diseno_version_vigente_id_key" ON "diseno"("version_vigente_id");

-- CreateIndex
CREATE UNIQUE INDEX "version_diseno_diseno_id_numero_key" ON "version_diseno"("diseno_id", "numero");

-- CreateIndex
CREATE INDEX "archivo_version_diseno_archivo_id_idx" ON "archivo_version_diseno"("archivo_id");

-- CreateIndex
CREATE UNIQUE INDEX "aprobacion_diseno_version_id_key" ON "aprobacion_diseno"("version_id");

-- CreateIndex
CREATE INDEX "solicitud_cambio_version_id_idx" ON "solicitud_cambio"("version_id");

-- AddForeignKey
ALTER TABLE "diseno" ADD CONSTRAINT "diseno_item_pedido_id_fkey" FOREIGN KEY ("item_pedido_id") REFERENCES "item_pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diseno" ADD CONSTRAINT "diseno_version_vigente_id_fkey" FOREIGN KEY ("version_vigente_id") REFERENCES "version_diseno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_diseno" ADD CONSTRAINT "version_diseno_diseno_id_fkey" FOREIGN KEY ("diseno_id") REFERENCES "diseno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivo_version_diseno" ADD CONSTRAINT "archivo_version_diseno_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version_diseno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivo_version_diseno" ADD CONSTRAINT "archivo_version_diseno_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobacion_diseno" ADD CONSTRAINT "aprobacion_diseno_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version_diseno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud_cambio" ADD CONSTRAINT "solicitud_cambio_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "version_diseno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RN-P-05, RN-07: una versión de diseño, sus archivos y su aprobación no se modifican ni se borran.
-- Cualquier cambio es una versión nueva. (TRUNCATE, que usan solo las pruebas, no dispara estos triggers.)
CREATE FUNCTION rechazar_cambio_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable: no se puede % una fila', TG_TABLE_NAME, lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER version_diseno_inmutable BEFORE UPDATE OR DELETE ON "version_diseno" FOR EACH ROW EXECUTE FUNCTION rechazar_cambio_inmutable();
CREATE TRIGGER archivo_version_diseno_inmutable BEFORE UPDATE OR DELETE ON "archivo_version_diseno" FOR EACH ROW EXECUTE FUNCTION rechazar_cambio_inmutable();
CREATE TRIGGER aprobacion_diseno_inmutable BEFORE UPDATE OR DELETE ON "aprobacion_diseno" FOR EACH ROW EXECUTE FUNCTION rechazar_cambio_inmutable();

ALTER TABLE "version_diseno" ADD CONSTRAINT "version_diseno_numero_positivo" CHECK ("numero" > 0);
ALTER TABLE "version_diseno" ADD CONSTRAINT "version_diseno_huella" CHECK ("huella" ~ '^[0-9a-f]{64}$');
