-- Búsqueda del catálogo sin distinguir acentos (RF-05). unaccent es una extensión "trusted" desde PostgreSQL 13.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Precio final en centavos de ARS (RN-26): si existe, es positivo.
ALTER TABLE "variante" ADD CONSTRAINT "variante_precio_positivo" CHECK ("precio_centavos" IS NULL OR "precio_centavos" > 0);
