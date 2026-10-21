import { z } from "zod";
import { recordAudit } from "@/server/modules/audit/audit.service";
import { phoneSchema } from "@/server/modules/auth/auth.schemas";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

// Perfil del cliente (RF-03): nombre, teléfono y direcciones de envío.

const MAX_ADDRESSES = 10;

/** Un campo vacío borra el teléfono; el teléfono solo es obligatorio para reservar en efectivo (RN-18). */
const nullablePhone = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), phoneSchema.nullable());

const updateProfileSchema = z.strictObject({
  nombre: z.string().trim().min(1, "Ingresá tu nombre.").max(100).optional(),
  telefono: nullablePhone.optional(),
});

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max);
const addressFields = {
  calle: text(150, "Ingresá la calle y el número."),
  ciudad: text(100, "Ingresá la ciudad o localidad."),
  provincia: text(100, "Ingresá la provincia."),
  codigoPostal: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]?\d{4}[A-Z]{0,3}$/, "Ingresá un código postal válido (por ejemplo 1414 o C1414AAB)."),
  referencias: z.preprocess((value) => (value === "" ? null : value), z.string().trim().max(300).nullable().optional()),
};

const createAddressSchema = z.strictObject(addressFields);
const updateAddressSchema = z.strictObject({
  calle: addressFields.calle.optional(),
  ciudad: addressFields.ciudad.optional(),
  provincia: addressFields.provincia.optional(),
  codigoPostal: addressFields.codigoPostal.optional(),
  referencias: addressFields.referencias,
});

export async function updateProfile(userId: string, input: unknown, db: Db = getDb()) {
  const data = updateProfileSchema.parse(input);
  return db.$transaction(async (tx) => {
    const user = await tx.usuario.update({ where: { id: userId }, data, select: { nombre: true, telefono: true } });
    await recordAudit(tx, { actorId: userId, accion: "PERFIL_ACTUALIZADO", entidad: "usuario", entidadId: userId, datos: data });
    return user;
  });
}

export function listAddresses(userId: string, db: Db = getDb()) {
  return db.direccion.findMany({ where: { usuarioId: userId }, orderBy: { creadoEn: "asc" } });
}

export async function createAddress(userId: string, input: unknown, db: Db = getDb()) {
  const data = createAddressSchema.parse(input);
  return db.$transaction(async (tx) => {
    if ((await tx.direccion.count({ where: { usuarioId: userId } })) >= MAX_ADDRESSES) {
      throw new AppError("LIMITE_DIRECCIONES", `Podés guardar hasta ${MAX_ADDRESSES} direcciones.`, 422);
    }
    return tx.direccion.create({ data: { ...data, usuarioId: userId } });
  });
}

export async function updateAddress(userId: string, addressId: string, input: unknown, db: Db = getDb()) {
  const data = updateAddressSchema.parse(input);
  await findOwnAddress(db, userId, addressId);
  return db.direccion.update({ where: { id: addressId }, data });
}

export async function deleteAddress(userId: string, addressId: string, db: Db = getDb()) {
  await findOwnAddress(db, userId, addressId);
  await db.direccion.delete({ where: { id: addressId } });
}

/** Una dirección de otro cliente se trata como inexistente (404). */
export async function findOwnAddress(db: DbClient, userId: string, addressId: string) {
  const address = /^[0-9a-f-]{36}$/i.test(addressId)
    ? await db.direccion.findFirst({ where: { id: addressId, usuarioId: userId } })
    : null;
  if (!address) throw new AppError("DIRECCION_NO_ENCONTRADA", "No encontramos esa dirección.", 404);
  return address;
}
