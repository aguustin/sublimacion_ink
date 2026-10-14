import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { getConfig } from "./config";

export type Db = PrismaClient;
/** El cliente o una transacción en curso: los servicios aceptan ambos. */
export type DbClient = Db | Prisma.TransactionClient;

export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Una sola instancia por proceso; en desarrollo sobrevive a las recargas en caliente.
const globalForDb = globalThis as unknown as { db?: Db };

export function getDb(): Db {
  globalForDb.db ??= createDb(getConfig().DATABASE_URL);
  return globalForDb.db;
}
