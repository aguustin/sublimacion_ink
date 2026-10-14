import { postJson } from "./api";

// Carrito de un visitante, guardado solo en su navegador (RN-25). No retiene stock ni se envía
// al servidor hasta que inicia sesión o se registra.

export type GuestCartItem = { varianteId: string; cantidad: number };

const STORAGE_KEY = "carrito";

export function readGuestCart(): GuestCartItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is GuestCartItem =>
            typeof item?.varianteId === "string" && Number.isInteger(item?.cantidad) && item.cantidad > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function writeGuestCart(items: GuestCartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Sin almacenamiento disponible (modo privado): el carrito de visitante no se conserva.
  }
}

export function setGuestQuantity(varianteId: string, cantidad: number): GuestCartItem[] {
  const others = readGuestCart().filter((item) => item.varianteId !== varianteId);
  const items = cantidad > 0 ? [...others, { varianteId, cantidad }] : others;
  writeGuestCart(items);
  return items;
}

/** Suma unidades sin pasar de lo disponible que muestra el catálogo; el servidor vuelve a validar. */
export function addToGuestCart(varianteId: string, cantidad: number, disponible: number): number {
  const current = readGuestCart().find((item) => item.varianteId === varianteId)?.cantidad ?? 0;
  const total = Math.min(current + cantidad, disponible);
  setGuestQuantity(varianteId, total);
  return total - current;
}

export function clearGuestCart(): void {
  writeGuestCart([]);
}

/**
 * Después de iniciar sesión o registrarse: pasa el carrito del navegador a la cuenta.
 * Devuelve `true` si algún producto se quitó o se ajustó por falta de stock.
 */
export async function mergeGuestCartIntoAccount(): Promise<{ hadItems: boolean; adjusted: boolean }> {
  const items = readGuestCart();
  if (items.length === 0) return { hadItems: false, adjusted: false };
  const result = await postJson<{ descartados: string[]; ajustados: string[] }>("/api/cart/merge", { items });
  if (!result.ok) return { hadItems: true, adjusted: true };
  clearGuestCart();
  return { hadItems: true, adjusted: result.data.descartados.length + result.data.ajustados.length > 0 };
}

/** Destino seguro después de ingresar: solo rutas internas. */
export function safeNextPath(next: string | null, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
