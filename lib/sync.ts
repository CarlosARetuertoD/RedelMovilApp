import { supabase } from './supabase';
import { upsertRows, getLastSync, setLastSync, getRowCount, queryAll } from './localDB';

type SyncTable = {
  name: string;
  columns: string[];
  pageSize: number;
  filter?: (q: any) => any; // filtro extra para la tabla
};

const TABLES: SyncTable[] = [
  { name: 'marcas', columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'fits', columns: ['id', 'valor', 'sku_code', 'subcategoria_id', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'colores', columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'tallas', columns: ['id', 'valor', 'sku_code', 'tipo_talla_id', 'orden', 'updated_at'], pageSize: 500 },
  { name: 'categorias', columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'subcategorias', columns: ['id', 'valor', 'categoria_id', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'generos', columns: ['id', 'valor', 'sku_code', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'almacenes', columns: ['id', 'nombre', 'codigo', 'activo', 'updated_at'], pageSize: 500 },
  { name: 'productos', columns: ['id', 'sku_product', 'modelo', 'categoria_id', 'subcategoria_id', 'marca_id', 'fit_id', 'genero_id', 'precio', 'activo', 'updated_at'], pageSize: 900 },
  { name: 'variantes', columns: ['id', 'sku_variant', 'codigo_barras', 'producto_id', 'color_id', 'talla_id', 'precio', 'activo', 'updated_at'], pageSize: 900 },
  { name: 'stock', columns: ['id', 'variante_id', 'almacen_id', 'cantidad', 'updated_at'], pageSize: 900,
    filter: (q: any) => q.gt('cantidad', 0) }, // Solo stock > 0 (3k filas vs 125k)
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

// ─── Full sync (primera vez) ──────────────────────────

async function fullSyncTable(table: SyncTable, onProgress?: ProgressCallback): Promise<number> {
  let totalInserted = 0;
  let lastId = '';
  const selectCols = table.columns.join(',');

  while (true) {
    onProgress?.({ phase: 'downloading', table: table.name, tableName: TABLE_LABELS[table.name], rows: totalInserted });

    let query = supabase.from(table.name).select(selectCols).order('id').limit(table.pageSize);
    if (table.filter) query = table.filter(query);
    if (lastId) query = query.gt('id', lastId);

    const { data, error } = await query;
    if (error) throw new Error(`Error descargando ${TABLE_LABELS[table.name]}: ${error.message}`);
    if (!data || data.length === 0) break;

    await upsertRows(table.name, data, table.columns);
    totalInserted += data.length;
    lastId = data[data.length - 1].id;

    if (data.length < table.pageSize) break;
  }

  return totalInserted;
}

// ─── Incremental sync (delta) ─────────────────────────

async function incrementalSyncTable(table: SyncTable, since: string): Promise<number> {
  let totalUpdated = 0;
  let lastId = '';
  const selectCols = table.columns.join(',');

  while (true) {
    let query = supabase.from(table.name).select(selectCols).gt('updated_at', since).order('id').limit(table.pageSize);
    // No aplicar filter en incremental — necesitamos ver TODO lo que cambió
    if (lastId) query = query.gt('id', lastId);

    const { data, error } = await query;
    if (error) throw new Error(`Error actualizando ${TABLE_LABELS[table.name]}: ${error.message}`);
    if (!data || data.length === 0) break;

    await upsertRows(table.name, data, table.columns);
    totalUpdated += data.length;
    lastId = data[data.length - 1].id;

    if (data.length < table.pageSize) break;
  }

  return totalUpdated;
}

// ─── Sync principal ───────────────────────────────────

export async function syncDatabase(onProgress?: ProgressCallback): Promise<{ full: boolean; updated: number }> {
  const lastSync = await getLastSync();
  const varCount = await getRowCount('variantes');
  const isFirstSync = !lastSync || varCount === 0;
  const syncStart = new Date().toISOString();

  let totalUpdated = 0;

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
      const count = await fullSyncTable(table, onProgress);
      totalUpdated += count;
    }
  } else {
    onProgress?.({ phase: 'checking', message: 'Buscando actualizaciones...' });
    for (const table of TABLES) {
      const count = await incrementalSyncTable(table, lastSync);
      totalUpdated += count;
    }
  }

  await setLastSync(syncStart);
  onProgress?.({ phase: 'done', message: totalUpdated > 0 ? `${totalUpdated} registros actualizados` : 'Todo al día' });

  return { full: isFirstSync, updated: totalUpdated };
}

export async function getSyncInfo(): Promise<{ lastSync: string | null; variantesCount: number; stockCount: number }> {
  const lastSync = await getLastSync();
  const variantesCount = await getRowCount('variantes');
  const stockCount = await getRowCount('stock');
  return { lastSync, variantesCount, stockCount };
}
