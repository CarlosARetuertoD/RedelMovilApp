export interface User {
  id: number;
  username: string;
  nombre: string;
  rol: string;
}

export interface ProductoEscaneado {
  id: string;
  sku_variant: string;
  codigo_barras: string;
  producto_id: string;
  producto_sku: string;
  producto_modelo: string;
  marca_nombre: string;
  fit_nombre: string;
  color_nombre: string;
  talla_valor: string;
  categoria_nombre: string;
  subcategoria_nombre: string;
  genero_nombre: string;
  precio: number;
  color_id: string;
  talla_id: string;
  stockTotal: number;
  stockPorAlmacen: { almacen_id: string; almacen_nombre: string; almacen_codigo: string; cantidad: number }[];
  tallasMismoColor: { variante_id: string; talla: string; codigo_barras: string; stock_total: number; es_actual: boolean }[];
  coloresDisponibles: { color_nombre: string; stock_total: number; codigo_barras: string }[];
}
