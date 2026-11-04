// Logo de INK (public/brand/ink, aprobado). Se dibuja en línea y no como <img> para elegir los colores
// según el fondo. El lettering está convertido a curvas (lo que pide el LEEME de los logos): es el mismo
// texto del archivo aprobado (Nunito Sans 900 itálica, 104 u., espaciado -6) y no depende de que la
// fuente esté cargada ni de una tipografía de reemplazo.

const SPLAT =
  "M170 35 C190 20 204 35 204 52 C226 39 242 55 235 73 C260 70 269 90 252 106 C276 120 264 141 245 145 C258 168 237 184 218 173 C208 198 185 204 168 184 C151 204 129 194 128 175 C104 188 87 170 99 151 C75 148 69 126 89 112 C70 94 84 75 105 79 C107 55 128 46 143 62 C150 43 159 34 170 35 Z";
const DROPS: [number, number, number][] = [
  [75, 86, 7],
  [94, 47, 5],
  [132, 22, 6],
  [202, 20, 6],
  [248, 48, 6],
  [278, 91, 7],
  [275, 151, 5],
  [231, 207, 6],
  [164, 225, 6],
  [103, 202, 5],
  [62, 151, 6],
];
const LETTERING =
  "M95.8 143 105.4 82.9H121L111.5 143ZM117.5 143 127 82.9H138.5L162.5 122.1H159.9L166.1 82.9H180.7L171.1 143H159.7L135.7 103.8H138.3L132 143ZM177.1 143 186.6 82.9H202.3L198.2 108.7H198.4L224.9 82.9H244.3L210.8 114.8L209.9 108.2L235.9 143H218.3L197.3 115.5H197.1L192.8 143Z";

// El lienzo original (340 × 250) deja márgenes vacíos; este recorte abarca solo el dibujo (gotas
// incluidas), así el tamaño que se le da en CSS es el tamaño visible del logo. No cambia la proporción.
const VIEW_BOX = "54 12 233 221";

type Variant = "principal" | "invertido";

const COLORS: Record<Variant, { splat: string; text: string }> = {
  principal: { splat: "#1C1B1B", text: "#F5D627" },
  invertido: { splat: "#F5D627", text: "#1C1B1B" },
};

/**
 * Logo principal (fondos claros) o invertido (fondos oscuros), sección 2. Se dimensiona por alto
 * (`height` en CSS, `width: auto`) para que acompañe la altura de la barra que lo contiene.
 */
export function InkLogo({ variant = "principal", className, title = "INK" }: { variant?: Variant; className?: string; title?: string }) {
  const { splat, text } = COLORS[variant];
  return (
    <svg className={className} viewBox={VIEW_BOX} role="img" aria-label={title}>
      <g fill={splat}>
        <path d={SPLAT} />
        {DROPS.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      <path d={LETTERING} fill={text} />
    </svg>
  );
}

/** Solo el lettering «INK», en el color del texto (`currentColor`): marca compacta provisoria de F3. */
export function InkWordmark({ className, title = "INK" }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="94 81 151 63" role="img" aria-label={title}>
      <path d={LETTERING} fill="currentColor" />
    </svg>
  );
}
