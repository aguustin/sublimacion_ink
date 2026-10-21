import { formatDateTime } from "@/lib/orders";
import type { getOrderDesigns } from "@/server/modules/designs/design.service";
import { OpenFileButton } from "./open-file-button";

export type OrderDesigns = Awaited<ReturnType<typeof getOrderDesigns>>;

export const DESIGN_STATUS_LABELS: Record<string, string> = {
  SIN_PROPUESTA: "Sin propuesta",
  PENDIENTE_APROBACION: "Esperando la aprobación del cliente",
  CAMBIOS_SOLICITADOS: "El cliente pidió cambios",
  APROBADO: "Aprobado",
};

/** RF-28: historial de versiones de un ítem, igual para el cliente y el admin. */
export function DesignHistory({ design }: { design: NonNullable<OrderDesigns[number]["diseno"]> }) {
  return (
    <ol>
      {design.versiones.map((version) => (
        <li key={version.id}>
          Versión {version.numero} · {formatDateTime(version.creadaEn)}
          {version.id === design.versionVigenteId ? " · vigente" : " · superada"}
          {version.aprobacion && ` · aprobada el ${formatDateTime(version.aprobacion.aprobadaEn)}`}
          {version.nota && <p>{version.nota}</p>}
          <ul>
            {version.archivos.map(({ archivo }) => (
              <li key={archivo.id}>
                <OpenFileButton fileId={archivo.id} name={archivo.nombreOriginal} />
              </li>
            ))}
          </ul>
          {version.solicitudes.map((request) => (
            <p key={request.creadoEn.toISOString()}>
              Cambios pedidos el {formatDateTime(request.creadoEn)}: {request.comentario}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}
