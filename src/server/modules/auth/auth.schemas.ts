import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./auth.policy";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Ingresá un email válido." }));

const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `La contraseña puede tener hasta ${PASSWORD_MAX_LENGTH} caracteres.`);

const optionalPhoneSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s-]{5,19}$/, "Ingresá un teléfono válido.")
    .optional(),
);

const tokenSchema = z.string().min(20).max(200);

export const registerSchema = z.object({
  nombre: z.string().trim().min(1, "Ingresá tu nombre.").max(100),
  email: emailSchema,
  contrasena: newPasswordSchema,
  telefono: optionalPhoneSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Al iniciar sesión no se aplica la política de longitud mínima: solo se compara.
  contrasena: z.string().min(1, "Ingresá tu contraseña.").max(PASSWORD_MAX_LENGTH),
});

export const verifyEmailSchema = z.object({ token: tokenSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({ token: tokenSchema, contrasena: newPasswordSchema });
