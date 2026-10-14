import type { MetadataRoute } from "next";
import { getConfig } from "@/server/shared/config";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getConfig().APP_URL;
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/cuenta", "/api/"] },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
