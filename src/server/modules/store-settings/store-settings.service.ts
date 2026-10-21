import { z } from "zod";
import { recordAudit, type Actor } from "@/server/modules/audit/audit.service";
import { phoneSchema } from "@/server/modules/auth/auth.schemas";
import { getDb, type Db, type DbClient } from "@/server/shared/db";

// Datos de contacto de la tienda (RF-49): una sola fila, editable por el administrador.

const SETTINGS_ID = 1;

const emptyToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

const updateSettingsSchema = z.strictObject({
  emailContacto: z.preprocess(emptyToNull, z.string().trim().toLowerCase().pipe(z.email("Ingresá un email válido.")).nullable()).optional(),
  telefonoContacto: z.preprocess(emptyToNull, phoneSchema.nullable()).optional(),
});

export type StoreContact = { emailContacto: string | null; telefonoContacto: string | null };

/** Contacto de la tienda; vacío si el administrador todavía no lo cargó. */
export async function getStoreContact(db: DbClient = getDb()): Promise<StoreContact> {
  const settings = await db.configuracionTienda.findUnique({ where: { id: SETTINGS_ID } });
  return { emailContacto: settings?.emailContacto ?? null, telefonoContacto: settings?.telefonoContacto ?? null };
}

export async function updateStoreSettings(actor: Actor, input: unknown, db: Db = getDb()): Promise<StoreContact> {
  const data = updateSettingsSchema.parse(input);
  return db.$transaction(async (tx) => {
    const settings = await tx.configuracionTienda.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    await recordAudit(tx, { actorId: actor.id, accion: "CONFIGURACION_ACTUALIZADA", entidad: "configuracion_tienda", datos: data, ip: actor.ip });
    return { emailContacto: settings.emailContacto, telefonoContacto: settings.telefonoContacto };
  });
}

/** «Escribinos a … o llamanos al …», para los avisos; vacío si no hay datos cargados. */
export function contactSentence({ emailContacto, telefonoContacto }: StoreContact): string {
  const parts = [emailContacto && `escribinos a ${emailContacto}`, telefonoContacto && `llamanos al ${telefonoContacto}`].filter(Boolean);
  return parts.length > 0 ? ` Si tenés dudas, ${parts.join(" o ")}.` : "";
}
