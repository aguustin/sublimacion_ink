-- AlterTable
ALTER TABLE "pedido" ADD COLUMN     "fecha_despacho_comprometida" TIMESTAMPTZ,
ADD COLUMN     "inicio_ventana_cargo" TIMESTAMPTZ,
ADD COLUMN     "ventana_cargo_fija" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "direccion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "calle" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "codigo_postal" TEXT NOT NULL,
    "referencias" TEXT,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "direccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_tienda" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "email_contacto" TEXT,
    "telefono_contacto" TEXT,
    "zona_horaria" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "configuracion_tienda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cambio_fecha_despacho" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "fecha_anterior" TIMESTAMPTZ,
    "fecha_nueva" TIMESTAMPTZ NOT NULL,
    "inicio_ventana_anterior" TIMESTAMPTZ,
    "inicio_ventana_nuevo" TIMESTAMPTZ NOT NULL,
    "confirmada_con_48h_o_menos" BOOLEAN NOT NULL,
    "motivo" TEXT,
    "autor_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cambio_fecha_despacho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direccion_usuario_id_idx" ON "direccion"("usuario_id");

-- CreateIndex
CREATE INDEX "cambio_fecha_despacho_pedido_id_creado_en_idx" ON "cambio_fecha_despacho"("pedido_id", "creado_en");

-- AddForeignKey
ALTER TABLE "direccion" ADD CONSTRAINT "direccion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambio_fecha_despacho" ADD CONSTRAINT "cambio_fecha_despacho_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una sola fila de configuración (RF-49).
ALTER TABLE "configuracion_tienda" ADD CONSTRAINT "configuracion_tienda_fila_unica" CHECK ("id" = 1);
