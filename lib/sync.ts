import { railwayGet } from './railway';
import { upsertRows, getLastSync, setLastSync, getRowCount } from './localDB';

type SyncTable = {
  name: string;
  columns: string[];
};

const TABLES: SyncTable[] = [
  { name: 'marcas',        columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'] },
  { name: 'fits',          columns: ['id', 'valor', 'sku_code', 'subcategoria_id', 'activo', 'updated_at'] },
  { name: 'colores',       columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'] },
  { name: 'tallas',        columns: ['id', 'valor', 'sku_code', 'tipo_talla_id', 'orden', 'updated_at'] },
  { name: 'categorias',    columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'] },
  { name: 'subcategorias', columns: ['id', 'valor', 'categoria_id', 'activo', 'updated_at'] },
  { name: 'generos',       columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'] },
  { name: 'almacenes',     columns: ['id', 'nombre', 'codigo', 'color_hex', 'patron', 'color_secundario', 'es_almacen_principal', 'activo', 'updated_at'] },
  { name: 'productos',     columns: ['id', 'sku_product', 'modelo', 'categoria_id', 'subcategoria_id', 'marca_id', 'fit_id', 'genero_id', 'precio', 'activo', 'updated_at'] },
  { name: 'variantes',     columns: ['id', 'sku_variant', 'codigo_barras', 'producto_id', 'color_id', 'talla_id', 'precio', 'activo', 'updated_at'] },
  { name: 'stock',         columns: ['id', 'variante_id', 'almacen_id', 'cantidad', 'updated_at'] },
];

export type SyncProgress = {
  phase: 'checking' | 'downloading' | 'done' | 'error';
  table?: string;
  tableName?: string;
  current?: number;
  total?: number;
  rows?: number;
  message?: string;
};

const TABLE_LABELS: Record<string, string> = {
  marcas: 'Marcas', fits: 'Fits', colores: 'Colores', tallas: 'Tallas',
  categorias: 'Categorías', subcategorias: 'Subcategorías', generos: 'Géneros',
  almacenes: 'Almacenes', productos: 'Productos', variantes: 'Variantes', stock: 'Stock',
};

type ProgressCallback = (p: SyncProgress) => void;

async function syncTable(
  table: SyncTable,
  since: string | null,
  onProgress?: ProgressCallback,
): Promise<number> {
  let totalRows = 0;
  let page = 1;

  while (true) {
    onProgress?.({
      phase: 'downloading',
      table: table.name,
      tableName: TABLE_LABELS[table.name],
      rows: totalRows,
    });

    const params = new URLSearchParams({ page: String(page) });
    if (since) params.set('since', since);

    const data = await railwayGet<{ results: any[]; has_more: boolean; next_page: number | null }>(
      `/api/movil/sync/${table.name}/?${params}`
    );

    if (!data.results || data.results.length === 0) break;

    await upsertRows(table.name, data.results, table.columns);
    totalRows += data.results.length;

    if (!data.has_more) break;
    page = data.next_page ?? page + 1;
  }

  return totalRows;
}

export async function syncDatabase(onProgress?: ProgressCallback): Promise<{ full: boolean; updated: number }> {
  const lastSync = await getLastSync();
  const varCount = await getRowCount('variantes');
  const isFirstSync = !lastSync || varCount === 0;
  const syncStart = new Date().toISOString();
  let totalUpdated = 0;

  // Tablas que siempre se sincronizan completas (pocos registros, pueden cambiar campos)
  const ALWAYS_FULL = new Set(['almacenes']);

  if (isFirstSync) {
    onProgress?.({ phase: 'downloading', message: 'Descargando base de datos...' });
    for (let i = 0; i < TABLES.length; i++) {
      const table = TABLES[i];
      onProgress?.({
        phase: 'downloading',
        table: table.name,
        tableName: TABLE_LABELS[table.name],
        current: i + 1,
        total: TABLES.length,
      });
      totalUpdated += await syncTable(table, null, onProgress);
    }
  } else {
    onProgress?.({ phase: 'checking', message: 'Buscando actualizaciones...' });
    for (const table of TABLES) {
      const since = ALWAYS_FULL.has(table.name) ? null : lastSync;
      totalUpdated += await syncTable(table, since, onProgress);
    }
  }

  await setLastSync(syncStart);
  onProgress?.({
    phase: 'done',
    message: totalUpdated > 0 ? `${totalUpdated} registros actualizados` : 'Todo al día',
  });

  return { full: isFirstSync, updated: totalUpdated };
}

export async function getSyncInfo(): Promise<{ lastSync: string | null; variantesCount: number; stockCount: number }> {
  const lastSync = await getLastSync();
  const variantesCount = await getRowCount('variantes');
  const stockCount = await getRowCount('stock');
  return { lastSync, variantesCount, stockCount };
}
