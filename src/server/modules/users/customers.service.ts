import { z } from "zod";
import { recordAudit } from "@/server/modules/audit/audit.service";
import { revokeAllSessions } from "@/server/modules/auth/session.service";
import { getDb, type Db, type DbClient } from "@/server/shared/db";
import { AppError } from "@/server/shared/errors";

const PAGE_SIZE = 50;

const listCustomersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
});

const blockSchema = z.object({ motivo: z.string().trim().min(3, "Indicá el motivo del bloqueo.").max(500) });
const unblockSchema = z.object({ motivo: z.string().trim().max(500).optional() });

export type CustomerSummary = {
  id: string;
  nombre: string;
  email: string;
  telefono: string | null;
  emailVerificado: boolean;
  bloqueado: boolean;
  creadoEn: Date;
};

export async function listCustomers(
  input: unknown,
  db: Db = getDb(),
): Promise<{ clientes: CustomerSummary[]; total: number; pagina: number }> {
  const { q, pagina } = listCustomersSchema.parse(input);
  const where = {
    rol: "CLIENTE" as const,
    ...(q && {
      OR: [
        { email: { contains: q, mode: "insensitive" as const } },
        { nombre: { contains: q, mode: "insensitive" as const } },
      ],
    }),
  };
  const [users, total] = await Promise.all([
    db.usuario.findMany({ where, orderBy: { creadoEn: "desc" }, skip: (pagina - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.usuario.count({ where }),
  ]);
  return {
    clientes: users.map((user) => ({
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      telefono: user.telefono,
      emailVerificado: user.emailVerificadoEn !== null,
      bloqueado: user.bloqueadoEn !== null,
      creadoEn: user.creadoEn,
    })),
    total,
    pagina,
  };
}

/** Bloquea la cuenta de un cliente y cierra todas sus sesiones (sección 17). */
export async function blockCustomer(adminId: string, customerId: string, input: unknown, ip: string, db: Db = getDb()) {
  const { motivo } = blockSchema.parse(input);
  await db.$transaction(async (tx) => {
    await findCustomerOrThrow(tx, customerId);
    await tx.usuario.updateMany({ where: { id: customerId, bloqueadoEn: null }, data: { bloqueadoEn: new Date() } });
    await revokeAllSessions(tx, customerId);
    await recordAudit(tx, { actorId: adminId, accion: "CUENTA_BLOQUEADA", entidad: "usuario", entidadId: customerId, datos: { motivo }, ip });
  });
}

export async function unblockCustomer(adminId: string, customerId: string, input: unknown, ip: string, db: Db = getDb()) {
  const { motivo } = unblockSchema.parse(input);
  await db.$transaction(async (tx) => {
    await findCustomerOrThrow(tx, customerId);
    await tx.usuario.update({ where: { id: customerId }, data: { bloqueadoEn: null } });
    await recordAudit(tx, {
      actorId: adminId,
      accion: "CUENTA_DESBLOQUEADA",
      entidad: "usuario",
      entidadId: customerId,
      datos: motivo ? { motivo } : undefined,
      ip,
    });
  });
}

async function findCustomerOrThrow(db: DbClient, customerId: string) {
  const customer = z.uuid().safeParse(customerId).success
    ? await db.usuario.findFirst({ where: { id: customerId, rol: "CLIENTE" } })
    : null;
  if (!customer) throw new AppError("CLIENTE_NO_ENCONTRADO", "No existe ese cliente.", 404);
  return customer;
}
