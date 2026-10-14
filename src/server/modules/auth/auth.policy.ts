import type { RateLimit } from "@/server/shared/rate-limit";

// Parámetros de seguridad (técnicos, no comerciales). Viven en un solo lugar para poder ajustarlos.

export const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
export const EMAIL_VERIFICATION_TTL_SECONDS = 48 * 60 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const MINUTES = 60;
const HOUR = 60 * MINUTES;

export const RATE_LIMITS = {
  loginByEmail: { limit: 10, windowSeconds: 15 * MINUTES },
  loginByIp: { limit: 50, windowSeconds: 15 * MINUTES },
  registerByIp: { limit: 10, windowSeconds: HOUR },
  passwordResetByEmail: { limit: 5, windowSeconds: HOUR },
  passwordResetByIp: { limit: 20, windowSeconds: HOUR },
  resendVerificationByUser: { limit: 5, windowSeconds: HOUR },
} satisfies Record<string, RateLimit>;
