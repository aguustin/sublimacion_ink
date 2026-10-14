/** "Taza Mágica 11 oz!" → "taza-magica-11-oz". */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** Primer slug libre: "taza", "taza-2", "taza-3"… */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "item";
  let candidate = root;
  for (let suffix = 2; await exists(candidate); suffix++) {
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}
