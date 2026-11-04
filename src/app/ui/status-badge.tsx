import type { StatusFamily } from "@/lib/status";

/** Etiqueta de estado (sección 12): el color acompaña al texto, nunca lo reemplaza. */
export function StatusBadge({ family, children }: { family: StatusFamily; children: string }) {
  return (
    <span className="ink-badge" data-family={family}>
      {children}
    </span>
  );
}
