/**
 * Ingresos de Stock (Distribuciones / "lotes") — Fase 2: Enviar a Tiendas.
 *
 * La Fase 1 (armar el lote + "Recibir en Principal", donde se consume la etiqueta
 * física) sigue siendo tarea de escritorio en KarolayJeansApp. Esta app solo cubre
 * la Fase 2: confirmar que una prenda ya etiquetada y en Almacén Principal llegó
 * físicamente a su almacén destino, escaneándola. Esto SÍ mueve stock real
 * (TRASLADO Almacén Principal → destino) — lo único que no se vuelve a tocar es
 * el conteo de etiquetas, ya descontado en Fase 1.
 *
 * Backend: KarolayJeansERP, apps/inventario (modelo Distribucion/DistribucionDetalle).
 * No hay cola de aprobación para esta fase — por eso queda restringida a
 * admin/supervisor (mismo criterio que ya aplica en KarolayJeansApp).
 */
import { railwayGet, railwayPost } from './railway';

export interface ItemPendiente {
  detalle_id: string;
  variante_id: string;
  variante_sku: string;
  marca: string;
  modelo: string;
  color: string;
  talla: string;
  almacen_destino_id: string;
  almacen_destino_nombre: string;
  almacen_destino_color: string | null;
  cantidad_en_principal: number;
  cantidad_ingresada: number;
  pendiente_envio: number;
}

export interface DistribucionPendiente {
  distribucion_id: string;
  codigo: string;
  descripcion: string;
  fecha: string;
  items_pendientes: ItemPendiente[];
}

export interface PendientePrincipalResponse {
  almacen_principal: { id: string; nombre: string } | null;
  total_en_principal: number;
  distribuciones: DistribucionPendiente[];
}

export async function fetchPendientePrincipal(): Promise<PendientePrincipalResponse> {
  return railwayGet('/api/inventario/distribuciones/pendiente-principal/');
}

export async function enviarATiendas(distribucionId: string, items: { detalle_id: string; cantidad: number }[]) {
  return railwayPost(`/api/inventario/distribuciones/${distribucionId}/enviar-a-tiendas/`, { items });
}
