-- CreateEnum
CREATE TYPE "TipoExtensionReserva" AS ENUM ('EXTENSION', 'REACTIVACION');

-- CreateTable
CREATE TABLE "extension_reserva" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "tipo" "TipoExtensionReserva" NOT NULL,
    "vence_en_anterior" TIMESTAMPTZ,
    "vence_en_nuevo" TIMESTAMPTZ NOT NULL,
    "motivo" TEXT NOT NULL,
    "autor_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extension_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extension_reserva_pedido_id_creado_en_idx" ON "extension_reserva"("pedido_id", "creado_en");

-- AddForeignKey
ALTER TABLE "extension_reserva" ADD CONSTRAINT "extension_reserva_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
