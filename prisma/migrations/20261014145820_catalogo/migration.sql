-- CreateEnum
CREATE TYPE "TipoProducto" AS ENUM ('ESTANDAR', 'PERSONALIZABLE');

-- CreateTable
CREATE TABLE "categoria" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producto" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "tipo" "TipoProducto" NOT NULL,
    "categoria_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variante" (
    "id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "material" TEXT,
    "medida" TEXT,
    "color" TEXT,
    "talle" TEXT,
    "precio_centavos" INTEGER,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "variante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categoria_slug_key" ON "categoria"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "producto_slug_key" ON "producto"("slug");

-- CreateIndex
CREATE INDEX "producto_categoria_id_idx" ON "producto"("categoria_id");

-- CreateIndex
CREATE UNIQUE INDEX "variante_sku_key" ON "variante"("sku");

-- CreateIndex
CREATE INDEX "variante_producto_id_idx" ON "variante"("producto_id");

-- AddForeignKey
ALTER TABLE "producto" ADD CONSTRAINT "producto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variante" ADD CONSTRAINT "variante_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
