-- El email se guarda normalizado (sin espacios y en minúsculas) para que la unicidad no dependa del código.
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_email_normalizado" CHECK ("email" = lower(btrim("email")));
