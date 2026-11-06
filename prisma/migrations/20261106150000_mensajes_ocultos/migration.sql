-- 16.2: la tienda puede ocultar un mensaje del chat con motivo auditado.

-- AlterTable
ALTER TABLE "mensaje" ADD COLUMN     "motivo_oculto" TEXT,
ADD COLUMN     "oculto_en" TIMESTAMPTZ,
ADD COLUMN     "oculto_por_id" UUID;


-- Oculto siempre con quién y por qué.
ALTER TABLE "mensaje" ADD CONSTRAINT "mensaje_oculto_completo" CHECK (
  ("oculto_en" IS NULL AND "oculto_por_id" IS NULL AND "motivo_oculto" IS NULL)
  OR ("oculto_en" IS NOT NULL AND "oculto_por_id" IS NOT NULL AND coalesce(btrim("motivo_oculto"), '') <> '')
);
