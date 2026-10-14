import type { MetadataRoute } from "next";
import { listSitemapProducts } from "@/server/modules/catalog/catalog.service";
import { getConfig } from "@/server/shared/config";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getConfig().APP_URL;
  const products = await listSitemapProducts();
  return [
    { url: `${baseUrl}/`, changeFrequency: "weekly" },
    { url: `${baseUrl}/productos`, changeFrequency: "daily" },
    ...products.map((product) => ({
      url: `${baseUrl}/productos/${product.slug}`,
      lastModified: product.actualizadoEn,
      changeFrequency: "weekly" as const,
    })),
  ];
}
