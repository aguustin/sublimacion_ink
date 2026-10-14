import { randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Argon2id (algoritmo por defecto de la biblioteca) con los parámetros mínimos que recomienda OWASP.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Tarda lo mismo que verificar una contraseña real, para que el tiempo de respuesta
 * no revele si un email tiene cuenta.
 */
export async function simulatePasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomUUID());
  await verifyPassword(await dummyHash, password);
}
