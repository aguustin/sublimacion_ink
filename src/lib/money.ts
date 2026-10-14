const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

/** 1234550 → "$ 12.345,50" (precio final con impuestos incluidos, RN-26). */
export function formatPesos(cents: number): string {
  return pesos.format(cents / 100);
}

/** Texto de precio para el catálogo: personalizables sin precio hasta definir D-10. */
export function priceLabel(fromCents: number | null, severalPrices = false): string {
  if (fromCents === null) return "Consultá el precio";
  return severalPrices ? `Desde ${formatPesos(fromCents)}` : formatPesos(fromCents);
}
