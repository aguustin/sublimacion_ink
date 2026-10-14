-- CreateTable
CREATE TABLE "carrito" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carrito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_carrito" (
    "id" UUID NOT NULL,
    "carrito_id" UUID NOT NULL,
    "variante_id" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_al_agregar_centavos" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "item_carrito_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carrito_usuario_id_key" ON "carrito"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_carrito_carrito_id_variante_id_key" ON "item_carrito"("carrito_id", "variante_id");

-- AddForeignKey
ALTER TABLE "carrito" ADD CONSTRAINT "carrito_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carrito" ADD CONSTRAINT "item_carrito_carrito_id_fkey" FOREIGN KEY ("carrito_id") REFERENCES "carrito"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_carrito" ADD CONSTRAINT "item_carrito_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un ítem del carrito tiene al menos una unidad.
ALTER TABLE "item_carrito" ADD CONSTRAINT "item_carrito_cantidad_positiva" CHECK ("cantidad" > 0);
