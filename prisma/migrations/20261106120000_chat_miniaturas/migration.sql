-- INC-13: chat cliente-tienda con adjuntos (RF-29, F-07). INC-07: clave de la miniatura de las imágenes (16.1).

-- AlterTable
ALTER TABLE "archivo" ADD COLUMN     "clave_miniatura" TEXT;

-- CreateTable
CREATE TABLE "conversacion" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "ultimo_mensaje_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensaje" (
    "id" UUID NOT NULL,
    "conversacion_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "de_tienda" BOOLEAN NOT NULL,
    "texto" TEXT NOT NULL,
    "pedido_id" UUID,
    "leido_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivo_mensaje" (
    "mensaje_id" UUID NOT NULL,
    "archivo_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "archivo_mensaje_pkey" PRIMARY KEY ("mensaje_id","orden")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversacion_cliente_id_key" ON "conversacion"("cliente_id");

-- CreateIndex
CREATE INDEX "conversacion_ultimo_mensaje_en_idx" ON "conversacion"("ultimo_mensaje_en");

-- CreateIndex
CREATE INDEX "mensaje_conversacion_id_creado_en_idx" ON "mensaje"("conversacion_id", "creado_en");

-- CreateIndex
CREATE INDEX "mensaje_de_tienda_leido_en_idx" ON "mensaje"("de_tienda", "leido_en");

-- CreateIndex
CREATE UNIQUE INDEX "archivo_mensaje_archivo_id_key" ON "archivo_mensaje"("archivo_id");

-- CreateIndex
CREATE UNIQUE INDEX "archivo_clave_miniatura_key" ON "archivo"("clave_miniatura");

-- AddForeignKey
ALTER TABLE "conversacion" ADD CONSTRAINT "conversacion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivo_mensaje" ADD CONSTRAINT "archivo_mensaje_mensaje_id_fkey" FOREIGN KEY ("mensaje_id") REFERENCES "mensaje"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archivo_mensaje" ADD CONSTRAINT "archivo_mensaje_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 16.2: texto no vacío y acotado; el orden de los adjuntos empieza en 0.
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_texto_valido" CHECK (char_length(btrim("texto")) BETWEEN 1 AND 2000);
ALTER TABLE "archivo_mensaje" ADD CONSTRAINT "archivo_mensaje_orden_valido" CHECK ("orden" >= 0);
