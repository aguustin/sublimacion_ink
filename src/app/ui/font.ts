import { Nunito_Sans } from "next/font/google";

// Tipografía de INK (Documento Maestro, sección 4), servida por Next sin dependencias nuevas.
// La comparten los dos layouts raíz: el sitio público y el panel.
export const inkFont = Nunito_Sans({ subsets: ["latin"], variable: "--font-ink", display: "swap" });
