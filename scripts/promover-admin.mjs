// Da el rol ADMIN a una cuenta ya registrada. Uso: npm run admin:promover -- persona@ejemplo.com
// Los administradores no se pueden registrar desde la web (especificación, sección 5).
import "dotenv/config";
import pg from "pg";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Uso: npm run admin:promover -- <email>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(
    `UPDATE usuario SET rol = 'ADMIN', actualizado_en = now() WHERE email = $1 RETURNING id`,
    [email],
  );
  if (rows.length === 0) {
    await client.query("ROLLBACK");
    console.error(`No existe una cuenta con el email ${email}. Registrala primero desde la web.`);
    process.exitCode = 1;
  } else {
    await client.query(
      `INSERT INTO evento_auditoria (id, actor_id, accion, entidad, entidad_id, datos)
       VALUES (gen_random_uuid(), NULL, 'ROL_ADMIN_ASIGNADO', 'usuario', $1, '{"origen":"script"}')`,
      [rows[0].id],
    );
    await client.query("COMMIT");
    console.log(`${email} ahora es administrador.`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
