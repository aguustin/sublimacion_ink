import {
  Boxes,
  CalendarDays,
  CalendarX,
  ClipboardList,
  House,
  MailWarning,
  Package,
  Settings,
  Tags,
  TicketPercent,
  type LucideIcon,
} from "lucide-react";

/** Secciones del panel, compartidas por la barra lateral y el inicio. */
export const ADMIN_SECTIONS: { href: string; label: string; icon: LucideIcon; description?: string }[] = [
  { href: "/admin", label: "Inicio", icon: House },
  { href: "/admin/pedidos", label: "Pedidos", icon: ClipboardList, description: "Pedidos, pagos, envíos, diseños y cancelaciones." },
  { href: "/admin/productos", label: "Productos", icon: Package, description: "Productos, variantes, precios e imágenes." },
  { href: "/admin/categorias", label: "Categorías", icon: Tags, description: "Organización del catálogo." },
  { href: "/admin/inventario", label: "Inventario", icon: Boxes, description: "Stock de variantes y materiales, y sus movimientos." },
  { href: "/admin/cupones", label: "Cupones", icon: TicketPercent, description: "Cupones de compensación emitidos." },
  { href: "/admin/feriados", label: "Feriados", icon: CalendarDays, description: "Días que no cuentan para el plazo de las reservas." },
  { href: "/admin/fechas-excluidas", label: "Fechas excluidas", icon: CalendarX, description: "Días que no cuentan para la ventana de 48 h." },
  { href: "/admin/correos", label: "Correos fallidos", icon: MailWarning, description: "Correos que no se pudieron enviar." },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings, description: "Datos de contacto de la tienda." },
];
