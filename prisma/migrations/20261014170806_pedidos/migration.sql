-- CreateEnum
CREATE TYPE "TipoPedido" AS ENUM ('ESTANDAR', 'PERSONALIZADO');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('EN_DEFINICION', 'PENDIENTE_PAGO', 'RESERVADO', 'CONFIRMADO', 'EN_PRODUCCION', 'LISTO_PARA_RETIRO', 'DESPACHADO', 'ENTREGADO', 'CANCELADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "ModalidadCierre" AS ENUM ('ONLINE', 'EFECTIVO');

-- CreateEnum
CREATE TYPE "ModalidadEntrega" AS ENUM ('RETIRO', 'ENVIO');

-- CreateEnum
CREATE TYPE "ConceptoPago" AS ENUM ('TOTAL', 'SENA', 'SALDO');

-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('ONLINE', 'EFECTIVO');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('APROBADO', 'RECHAZADO', 'ERROR');

-- CreateEnum
CREATE TYPE "EstadoSalida" AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');

-- CreateTable
CREATE TABLE "pedido" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "cliente_id" UUID NOT NULL,
    "tipo" "TipoPedido" NOT NULL DEFAULT 'ESTANDAR',
    "estado" "EstadoPedido" NOT NULL,
    "modalidad_cierre" "ModalidadCierre" NOT NULL,
    "modalidad_entrega" "ModalidadEntrega" NOT NULL,
    "vence_en" TIMESTAMPTZ,
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "subtotal_productos_centavos" INTEGER NOT NULL,
    "costo_envio_centavos" INTEGER NOT NULL DEFAULT 0,
    "total_centavos" INTEGER NOT NULL,
    "porcentaje_cargo_cancelacion" INTEGER,
    "clave_idempotencia" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_pedido" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "variante_id" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "precio_unitario_centavos" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "item_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "concepto" "ConceptoPago" NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "proveedor" TEXT,
    "simulado" BOOLEAN NOT NULL,
    "estado" "EstadoPago" NOT NULL,
    "importe_centavos" INTEGER NOT NULL,
    "referencia_externa" TEXT,
    "registrado_por_id" UUID,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_estado_pedido" (
    "id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "estado_anterior" "EstadoPedido",
    "estado_nuevo" "EstadoPedido" NOT NULL,
    "actor_id" UUID,
    "motivo" TEXT,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_estado_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "leida_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salida_notificacion" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "estado" "EstadoSalida" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salida_notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pedido_numero_key" ON "pedido"("numero");

-- CreateIndex
CREATE INDEX "pedido_estado_vence_en_idx" ON "pedido"("estado", "vence_en");

-- CreateIndex
CREATE INDEX "pedido_cliente_id_creado_en_idx" ON "pedido"("cliente_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_cliente_id_clave_idempotencia_key" ON "pedido"("cliente_id", "clave_idempotencia");

-- CreateIndex
CREATE INDEX "item_pedido_pedido_id_idx" ON "item_pedido"("pedido_id");

-- CreateIndex
CREATE INDEX "pago_pedido_id_idx" ON "pago"("pedido_id");

-- CreateIndex
CREATE INDEX "historial_estado_pedido_pedido_id_creado_en_idx" ON "historial_estado_pedido"("pedido_id", "creado_en");

-- CreateIndex
CREATE INDEX "notificacion_usuario_id_creado_en_idx" ON "notificacion"("usuario_id", "creado_en");

-- CreateIndex
CREATE INDEX "salida_notificacion_estado_proximo_intento_en_idx" ON "salida_notificacion"("estado", "proximo_intento_en");

-- AddForeignKey
ALTER TABLE "retencion_stock" ADD CONSTRAINT "retencion_stock_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "variante"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_pedido" ADD CONSTRAINT "historial_estado_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Importes y cantidades válidos (RN-26, RN-27).
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_importes_validos"
  CHECK ("subtotal_productos_centavos" >= 0 AND "costo_envio_centavos" >= 0 AND "total_centavos" >= 0 AND "moneda" = 'ARS');
-- El efectivo solo se acepta con retiro en el local (RN-13).
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_efectivo_solo_retiro"
  CHECK ("modalidad_cierre" <> 'EFECTIVO' OR "modalidad_entrega" = 'RETIRO');
ALTER TABLE "item_pedido" ADD CONSTRAINT "item_pedido_valores_validos"
  CHECK ("cantidad" > 0 AND "precio_unitario_centavos" > 0);
ALTER TABLE "pago" ADD CONSTRAINT "pago_importe_positivo" CHECK ("importe_centavos" > 0);
-- En la v1 todo pago online es simulado (RN-09).
ALTER TABLE "pago" ADD CONSTRAINT "pago_online_simulado" CHECK ("medio" <> 'ONLINE' OR "simulado");
