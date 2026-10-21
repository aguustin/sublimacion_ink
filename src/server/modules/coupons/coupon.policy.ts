import { randomBytes } from "node:crypto";

// Reglas del cupón de compensación (RN-20), en un solo lugar.

/** D-34: 10 % del subtotal original de los productos, sin el envío. */
export const COMPENSATION_PERCENT = 10;

export function compensationAmount(subtotalProductosCentavos: number): number {
  return Math.round((subtotalProductosCentavos * COMPENSATION_PERCENT) / 100);
}

/** Vigencia de un mes calendario; si el día no existe en el mes siguiente, el último día de ese mes. */
export function couponExpiry(issuedAt: Date): Date {
  const expiry = new Date(issuedAt);
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
  expiry.setUTCDate(Math.min(issuedAt.getUTCDate(), lastDay));
  return expiry;
}

/** RN-20 [PROPUESTA]: descuenta solo sobre los productos, sin vuelto ni saldo. */
export function couponDiscount(montoCentavos: number, productosCentavos: number): number {
  return Math.min(montoCentavos, productosCentavos);
}

// Sin 0/O ni 1/I para que se pueda dictar; 32 símbolos: cada byte da un símbolo sin sesgo.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Código aleatorio, no secuencial (50 bits): `XXXXX-XXXXX`. */
export function generateCouponCode(): string {
  const symbols = [...randomBytes(10)].map((byte) => ALPHABET[byte % 32]).join("");
  return `${symbols.slice(0, 5)}-${symbols.slice(5)}`;
}

/** Lo que escribe el cliente: sin espacios, en mayúsculas y con el guion en su lugar. */
export function normalizeCouponCode(input: string): string {
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact;
}
