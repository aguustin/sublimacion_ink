import { z } from "zod";

/** Tope técnico por línea; la disponibilidad real se valida contra el stock. */
export const MAX_QUANTITY = 10_000;
/** Ítems distintos que se aceptan de un carrito de visitante. */
export const MAX_GUEST_ITEMS = 100;

const quantity = z.number().int("Ingresá una cantidad entera.").min(1, "La cantidad mínima es 1.").max(MAX_QUANTITY);

export const addItemSchema = z.strictObject({ varianteId: z.uuid(), cantidad: quantity });

export const updateItemSchema = z.strictObject({ cantidad: quantity });

/** Carrito guardado en el navegador de un visitante. */
export const guestCartSchema = z.strictObject({
  items: z.array(z.object({ varianteId: z.uuid(), cantidad: quantity })).max(MAX_GUEST_ITEMS),
});
