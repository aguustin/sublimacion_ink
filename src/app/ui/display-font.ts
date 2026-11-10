import { Fredoka } from "next/font/google";

// Tipografía de títulos de la tienda (elegida en v1.39): redondeada y con espíritu de sticker. El texto
// sigue en Nunito Sans. Solo la carga el sitio público; el panel no la usa.
export const inkDisplayFont = Fredoka({ subsets: ["latin"], variable: "--font-ink-display", display: "swap" });
