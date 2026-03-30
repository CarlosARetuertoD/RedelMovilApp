import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

const DB_NAME = 'redelmovil.db';
let _db: SQLiteDatabase | null = null;

export function getDB(): SQLiteDatabase {
  if (_db) return _db;
  _db = openDatabaseSync(DB_NAME);
  _db.execSync('PRAGMA journal_mode = WAL;');
  _db.execSync('PRAGMA busy_timeout = 5000;');
  createTables(_db);
  return _db;
}

function createTables(db: SQLiteDatabase) {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS marcas (id TEXT PRIMARY KEY, valor TEXT, sku_code TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS fits (id TEXT PRIMARY KEY, valor TEXT, sku_code TEXT, subcategoria_id TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS colores (id TEXT PRIMARY KEY, valor TEXT, sku_code TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS tallas (id TEXT PRIMARY KEY, valor TEXT, sku_code TEXT, tipo_talla_id TEXT, orden INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS categorias (id TEXT PRIMARY KEY, valor TEXT, sku_code TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS subcategorias (id TEXT PRIMARY KEY, valor TEXT, categoria_id TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS generos (id TEXT PRIMARY KEY, valor TEXT, sku_code TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS almacenes (id TEXT PRIMARY KEY, nombre TEXT, codigo TEXT, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS productos (id TEXT PRIMARY KEY, sku_product TEXT, modelo TEXT, categoria_id TEXT, subcategoria_id TEXT, marca_id TEXT, fit_id TEXT, genero_id TEXT, precio REAL, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS variantes (id TEXT PRIMARY KEY, sku_variant TEXT, codigo_barras TEXT, producto_id TEXT, color_id TEXT, talla_id TEXT, precio REAL, activo INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS stock (id TEXT PRIMARY KEY, variante_id TEXT, almacen_id TEXT, cantidad INTEGER, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX IF NOT EXISTS idx_variantes_barcode ON variantes(codigo_barras);
    CREATE INDEX IF NOT EXISTS idx_variantes_producto ON variantes(producto_id);
    CREATE INDEX IF NOT EXISTS idx_stock_variante ON stock(variante_id);
    CREATE INDEX IF NOT EXISTS idx_productos_marca ON productos(marca_id);
    CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);
  `);
}

// ─── SQL escape ───────────────────────────────────────

function esc(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// ─── Upsert ───────────────────────────────────────────

export async function upsertRows(tableName: string, rows: any[], columns: string[]) {
  if (!rows.length) return;
  const db = getDB();
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const sql = chunk.map(row => {
      const vals = columns.map(c => esc(row[c])).join(',');
      return `INSERT OR REPLACE INTO ${tableName} (${columns.join(',')}) VALUES (${vals});`;
    }).join('\n');
    db.execSync(sql);
  }
}

// ─── Sync metadata ────────────────────────────────────

export async function getLastSync(): Promise<string | null> {
  const db = getDB();
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM sync_meta WHERE key = \'lastSync\'');
  return row?.value || null;
}

export async function setLastSync(ts: string) {
  const db = getDB();
  db.execSync(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('lastSync', ${esc(ts)})`);
}

// ─── Reset ────────────────────────────────────────────

export async function resetDatabase() {
  const db = getDB();
  db.execSync(`
    DELETE FROM stock;
    DELETE FROM variantes;
    DELETE FROM productos;
    DELETE FROM marcas;
    DELETE FROM fits;
    DELETE FROM colores;
    DELETE FROM tallas;
    DELETE FROM categorias;
    DELETE FROM subcategorias;
    DELETE FROM generos;
    DELETE FROM almacenes;
    DELETE FROM sync_meta;
  `);
}

// ─── Query helpers (sync API) ─────────────────────────

export async function queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = getDB();
  let finalSql = sql;
  if (params.length) {
    let i = 0;
    finalSql = sql.replace(/\?/g, () => esc(params[i++]));
  }
  return db.getAllSync<T>(finalSql);
}

export async function queryFirst<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const db = getDB();
  let finalSql = sql;
  if (params.length) {
    let i = 0;
    finalSql = sql.replace(/\?/g, () => esc(params[i++]));
  }
  return db.getFirstSync<T>(finalSql) || null;
}

export async function getRowCount(table: string): Promise<number> {
  const row = await queryFirst<{ c: number }>(`SELECT COUNT(*) as c FROM ${table}`);
  return row?.c || 0;
}
