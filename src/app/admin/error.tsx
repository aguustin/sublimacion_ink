"use client";

// Los errores del panel usan la misma pantalla que el sitio: desde que cada área tiene su layout
// raíz, el error.tsx del sitio ya no envuelve al panel.
export { default } from "../(sitio)/error";
