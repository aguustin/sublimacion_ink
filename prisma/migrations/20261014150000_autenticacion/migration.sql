-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('CLIENTE', 'ADMIN');

-- CreateEnum
CREATE TYPE "TipoToken" AS ENUM ('VERIFICACION_EMAIL', 'RESTABLECER_CONTRASENA');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "hash_contrasena" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'CLIENTE',
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "email_verificado_en" TIMESTAMPTZ,
    "bloqueado_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "hash_token" TEXT NOT NULL,
    "expira_en" TIMESTAMPTZ NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usuario" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "tipo" "TipoToken" NOT NULL,
    "hash_token" TEXT NOT NULL,
    "expira_en" TIMESTAMPTZ NOT NULL,
    "usado_en" TIMESTAMPTZ,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_auditoria" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT,
    "datos" JSONB,
    "ip" TEXT,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limite_solicitud" (
    "clave" TEXT NOT NULL,
    "ventana_inicio" TIMESTAMPTZ NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "limite_solicitud_pkey" PRIMARY KEY ("clave","ventana_inicio")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sesion_hash_token_key" ON "sesion"("hash_token");

-- CreateIndex
CREATE INDEX "sesion_usuario_id_idx" ON "sesion"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_usuario_hash_token_key" ON "token_usuario"("hash_token");

-- CreateIndex
CREATE INDEX "token_usuario_usuario_id_tipo_idx" ON "token_usuario"("usuario_id", "tipo");

-- CreateIndex
CREATE INDEX "evento_auditoria_entidad_entidad_id_idx" ON "evento_auditoria"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX "evento_auditoria_actor_id_idx" ON "evento_auditoria"("actor_id");

-- AddForeignKey
ALTER TABLE "sesion" ADD CONSTRAINT "sesion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_usuario" ADD CONSTRAINT "token_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

