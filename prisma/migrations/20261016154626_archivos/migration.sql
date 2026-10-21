-- CreateEnum
CREATE TYPE "ContextoArchivo" AS ENUM ('REFERENCIA', 'VERSION_DISENO', 'CHAT', 'PRODUCTO', 'COMPROBANTE');

-- CreateEnum
CREATE TYPE "EstadoArchivo" AS ENUM ('ACTIVO', 'ELIMINADO');

-- CreateTable
CREATE TABLE "archivo" (
    "id" UUID NOT NULL,
    "clave_objeto" TEXT NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "tipo_mime_detectado" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "hash_sha256" TEXT NOT NULL,
    "subido_por_id" UUID NOT NULL,
    "propietario_cliente_id" UUID,
    "contexto" "ContextoArchivo" NOT NULL,
    "estado" "EstadoArchivo" NOT NULL DEFAULT 'ACTIVO',
    "eliminado_en" TIMESTAMPTZ,
    "eliminado_por_id" UUID,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imagen_producto" (
    "id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "archivo_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imagen_producto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "archivo_clave_objeto_key" ON "archivo"("clave_objeto");

-- CreateIndex
CREATE INDEX "archivo_propietario_cliente_id_creado_en_idx" ON "archivo"("propietario_cliente_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "imagen_producto_archivo_id_key" ON "imagen_producto"("archivo_id");

-- CreateIndex
CREATE INDEX "imagen_producto_producto_id_orden_idx" ON "imagen_producto"("producto_id", "orden");

-- AddForeignKey
ALTER TABLE "imagen_producto" ADD CONSTRAINT "imagen_producto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagen_producto" ADD CONSTRAINT "imagen_producto_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D-08: solo los cuatro tipos admitidos, con tamaño positivo y hash SHA-256 en hexadecimal.
ALTER TABLE "archivo" ADD CONSTRAINT "archivo_tipo_admitido" CHECK ("tipo_mime_detectado" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));
ALTER TABLE "archivo" ADD CONSTRAINT "archivo_tamano_positivo" CHECK ("tamano_bytes" > 0);
ALTER TABLE "archivo" ADD CONSTRAINT "archivo_hash_sha256" CHECK ("hash_sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "archivo" ADD CONSTRAINT "archivo_eliminado_con_fecha" CHECK (("estado" = 'ELIMINADO') = ("eliminado_en" IS NOT NULL));
