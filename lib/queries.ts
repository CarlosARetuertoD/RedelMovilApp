import { supabase } from './supabase';
import { queryAll, queryFirst } from './localDB';
import type { ProductoEscaneado } from './types';

// ─── Catálogos en memoria (desde SQLite) ──────────────

type CatItem = { id: string; valor: string; [k: string]: any };
type Catalogs = {
  marcas: CatItem[]; fits: CatItem[]; colores: CatItem[]; tallas: CatItem[];
  categorias: CatItem[]; subcategorias: CatItem[]; generos: CatItem[]; almacenes: any[];
  marcaMap: Map<string, string>; fitMap: Map<string, string>;
  colorMap: Map<string, string>; tallaMap: Map<string, string>;
  categoriaMap: Map<string, string>; subcategoriaMap: Map<string, string>;
  generoMap: Map<string, string>; almacenMap: Map<string, any>;
};

let _catalogs: Catalogs | null = null;

export async function loadCatalogs(): Promise<Catalogs> {
  if (_catalogs) return _catalogs;

  const [marcas, fits, colores, tallas, categorias, subcategorias, generos, almacenes] = await Promise.all([
    queryAll('SELECT * FROM marcas WHERE activo = 1 ORDER BY valor'),
    queryAll('SELECT * FROM fits WHERE activo = 1 ORDER BY valor'),
    queryAll('SELECT * FROM colores WHERE activo = 1 ORDER BY valor'),
    queryAll('SELECT * FROM tallas ORDER BY orden'),
    queryAll('SELECT * FROM categorias WHERE activo = 1 ORDER BY valor'),
    queryAll('SELECT * FROM subcategorias WHERE activo = 1 ORDER BY valor'),
    queryAll('SELECT * FROM generos WHERE activo = 1 ORDER BY valor'),
    queryAll('SELECT * FROM almacenes WHERE activo = 1 ORDER BY nombre'),
  ]);

  // Orden custom de almacenes
  const almOrder = ['A11', 'A20', 'B80', 'B77', 'C26', 'Almacen 1', 'Almacen 2'];
  almacenes.sort((a: any, b: any) => {
    const ia = almOrder.indexOf(a.nombre);
    const ib = almOrder.indexOf(b.nombre);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const toMap = (arr: any[]) => new Map(arr.map((i: any) => [i.id, i.valor]));

  _catalogs = {
    marcas, fits, colores, tallas, categorias, subcategorias, generos, almacenes,
    marcaMap: toMap(marcas), fitMap: toMap(fits), colorMap: toMap(colores),
    tallaMap: toMap(tallas), categoriaMap: toMap(categorias),
    subcategoriaMap: toMap(subcategorias), generoMap: toMap(generos),
    almacenMap: new Map(almacenes.map((a: any) => [a.id, a])),
  };
  return _catalogs;
}

export function clearCache() { _catalogs = null; }

// ─── Helpers ──────────────────────────────────────────

export async function fetchAlmacenes() { return (await loadCatalogs()).almacenes; }
export async function fetchMarcas() { return (await loadCatalogs()).marcas; }
export async function fetchFits() { return (await loadCatalogs()).fits; }
export async function fetchTallas() { return (await loadCatalogs()).tallas; }

function enrichVariante(v: any, prod: any, cats: Catalogs) {
  return {
    id: v.id, sku_variant: v.sku_variant, codigo_barras: v.codigo_barras,
    precio: v.precio || prod?.precio, producto_id: v.producto_id,
    producto_sku: prod?.sku_product || '', producto_modelo: prod?.modelo || '',
    marca_nombre: cats.marcaMap.get(prod?.marca_id) || '',
    fit_nombre: cats.fitMap.get(prod?.fit_id) || '',
    color_nombre: cats.colorMap.get(v.color_id) || '',
    talla_valor: cats.tallaMap.get(v.talla_id) || '',
    categoria_nombre: cats.categoriaMap.get(prod?.categoria_id) || '',
    subcategoria_nombre: cats.subcategoriaMap.get(prod?.subcategoria_id) || '',
    genero_nombre: cats.generoMap.get(prod?.genero_id) || '',
    color_id: v.color_id, talla_id: v.talla_id,
  };
}

// ─── Escáner (lee de SQLite) ──────────────────────────

export async function escanearProducto(codigoBarras: string): Promise<ProductoEscaneado | null> {
  const barcode = codigoBarras.padStart(13, '0');
  const cats = await loadCatalogs();

  const variante = await queryFirst('SELECT * FROM variantes WHERE codigo_barras = ?', [barcode]);
  if (!variante) return null;

  const producto = await queryFirst('SELECT * FROM productos WHERE id = ?', [variante.producto_id]);
  const enriched = enrichVariante(variante, producto, cats);

  // Stock por almacén
  const stocks = await queryAll('SELECT almacen_id, cantidad FROM stock WHERE variante_id = ? AND cantidad > 0', [variante.id]);
  const stockPorAlmacen = stocks.map((s: any) => {
    const alm: any = cats.almacenMap.get(s.almacen_id);
    return { almacen_id: s.almacen_id, almacen_nombre: alm?.nombre || '?', almacen_codigo: alm?.codigo || '?', cantidad: s.cantidad };
  }).sort((a: any, b: any) => b.cantidad - a.cantidad);
  const stockTotal = stockPorAlmacen.reduce((sum: number, s: any) => sum + s.cantidad, 0);

  // Todas las variantes del producto (para tallas y colores)
  const todasVariantes = await queryAll('SELECT id, color_id, talla_id, codigo_barras FROM variantes WHERE producto_id = ?', [variante.producto_id]);
  const allIds = todasVariantes.map((v: any) => v.id);

  // Stock de todas las hermanas
  const allStocks = allIds.length > 0
    ? await queryAll(`SELECT variante_id, SUM(cantidad) as total FROM stock WHERE variante_id IN (${allIds.map(() => '?').join(',')}) GROUP BY variante_id`, allIds)
    : [];
  const allStockMap = new Map<string, number>();
  allStocks.forEach((s: any) => allStockMap.set(s.variante_id, s.total));

  // Tallas mismo color
  const hermanas = todasVariantes.filter((h: any) => h.color_id === variante.color_id);
  const tallasMismoColor = hermanas.map((h: any) => ({
    variante_id: h.id,
    talla: cats.tallaMap.get(h.talla_id) || h.talla_id,
    codigo_barras: h.codigo_barras,
    stock_total: allStockMap.get(h.id) || 0,
    es_actual: h.id === variante.id,
  }));

  // Colores disponibles
  const colorData = new Map<string, { stock_total: number; codigo_barras: string }>();
  for (const v of todasVariantes) {
    const cn = cats.colorMap.get(v.color_id) || '?';
    const st = allStockMap.get(v.id) || 0;
    const existing = colorData.get(cn);
    if (existing) {
      existing.stock_total += st;
      if (v.talla_id === variante.talla_id) existing.codigo_barras = v.codigo_barras;
      else if (!existing.codigo_barras && st > 0) existing.codigo_barras = v.codigo_barras;
    } else {
      colorData.set(cn, { stock_total: st, codigo_barras: v.codigo_barras });
    }
  }
  const coloresDisponibles = Array.from(colorData.entries())
    .map(([color_nombre, d]) => ({ color_nombre, stock_total: d.stock_total, codigo_barras: d.codigo_barras }))
    .sort((a, b) => b.stock_total - a.stock_total);

  return { ...enriched, stockTotal, stockPorAlmacen, tallasMismoColor, coloresDisponibles };
}

// ─── Opciones de filtro ───────────────────────────────

export async function fetchFilterOptions(): Promise<Record<string, string[]> & { tallasNumericas: string[]; tallasAlfanumericas: string[] }> {
  const cats = await loadCatalogs();
  const unique = (arr: CatItem[]) => [...new Set(arr.map((c: any) => c.valor))].sort();
  const isNumeric = (v: string) => /^\d+$/.test(v);
  const allTallas = cats.tallas.map((c: any) => c.valor);
  return {
    categoria: unique(cats.categorias), subcategoria: unique(cats.subcategorias),
    marca: unique(cats.marcas), fit: unique(cats.fits),
    genero: unique(cats.generos), talla: allTallas,
    tallasNumericas: allTallas.filter(isNumeric),
    tallasAlfanumericas: allTallas.filter(v => !isNumeric(v)),
  };
}

// ─── Top marcas/fits (desde SQLite) ───────────────────

export async function fetchTopMarcasYFits(filtros: {
  categoria?: string; subcategoria?: string; genero?: string; marca?: string;
}): Promise<{ marcas: { nombre: string; count: number }[]; fits: { nombre: string; count: number }[] }> {
  const cats = await loadCatalogs();
  const findAllIds = (catalog: CatItem[], names: string[]) =>
    catalog.filter(c => names.includes(c.valor)).map(c => c.id);

  let where = 'activo = 1';
  const params: any[] = [];

  if (filtros.categoria) {
    const ids = findAllIds(cats.categorias, [filtros.categoria]);
    if (ids.length) { where += ` AND categoria_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
  }
  if (filtros.subcategoria) {
    const ids = findAllIds(cats.subcategorias, [filtros.subcategoria]);
    if (ids.length) { where += ` AND subcategoria_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
  }
  if (filtros.genero) {
    const ids = findAllIds(cats.generos, [filtros.genero]);
    if (ids.length) { where += ` AND genero_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
  }
  if (filtros.marca) {
    const ids = findAllIds(cats.marcas, [filtros.marca]);
    if (ids.length) { where += ` AND marca_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
  }

  const rows = await queryAll<{ marca_id: string; fit_id: string }>(`SELECT marca_id, fit_id FROM productos WHERE ${where}`, params);

  const marcaCount = new Map<string, number>();
  const fitCount = new Map<string, number>();
  for (const r of rows) {
    const mn = cats.marcaMap.get(r.marca_id);
    if (mn) marcaCount.set(mn, (marcaCount.get(mn) || 0) + 1);
    const fn = cats.fitMap.get(r.fit_id);
    if (fn) fitCount.set(fn, (fitCount.get(fn) || 0) + 1);
  }

  const toSorted = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, count]) => ({ nombre, count }));

  return { marcas: toSorted(marcaCount), fits: toSorted(fitCount) };
}

// ─── Búsqueda inteligente ─────────────────────────────

export async function parseSmartSearch(input: string): Promise<Record<string, string>> {
  const cats = await loadCatalogs();
  const words = input.trim().toLowerCase().split(/\s+/);
  const result: Record<string, string> = {};
  const used = new Set<number>();

  for (let i = 0; i < words.length - 1; i++) {
    const pair = words[i] + ' ' + words[i + 1];
    const fit = cats.fits.find(c => c.valor.toLowerCase() === pair);
    if (fit && !result.fit) { result.fit = fit.valor; used.add(i); used.add(i + 1); }
  }

  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    const w = words[i];
    if (!result.marca) { const m = cats.marcas.find(c => c.valor.toLowerCase() === w); if (m) { result.marca = m.valor; continue; } }
    if (!result.fit) { const f = cats.fits.find(c => c.valor.toLowerCase() === w); if (f) { result.fit = f.valor; continue; } }
    if (!result.categoria) { const c = cats.categorias.find(x => x.valor.toLowerCase() === w); if (c) { result.categoria = c.valor; continue; } }
    if (!result.subcategoria) { const s = cats.subcategorias.find(x => x.valor.toLowerCase() === w); if (s) { result.subcategoria = s.valor; continue; } }
    if (!result.genero) { const g = cats.generos.find(x => x.valor.toLowerCase() === w); if (g) { result.genero = g.valor; continue; } }
    if (!result.talla) { const t = cats.tallas.find(x => x.valor.toLowerCase() === w); if (t) { result.talla = t.valor; continue; } }
    result.search = result.search ? result.search + ' ' + words[i] : words[i];
  }
  return result;
}

// ─── Stock helper ─────────────────────────────────────

type StockDetail = { total: number; porAlmacen: { almacen_id: string; almacen_nombre: string; cantidad: number }[] };

async function buildStockResult(variantes: any[], almacen_id: string | undefined, cats: Catalogs) {
  const varIds = variantes.map((v: any) => v.id);
  const stockMap = new Map<string, StockDetail>();
  for (let i = 0; i < varIds.length; i += 500) {
    const chunk = varIds.slice(i, i + 500);
    const stockRows = await queryAll(
      `SELECT variante_id, almacen_id, cantidad FROM stock WHERE variante_id IN (${chunk.map(() => '?').join(',')}) AND cantidad > 0`, chunk
    );
    for (const s of stockRows) {
      if (almacen_id && s.almacen_id !== almacen_id) continue;
      let entry = stockMap.get(s.variante_id);
      if (!entry) { entry = { total: 0, porAlmacen: [] }; stockMap.set(s.variante_id, entry); }
      entry.total += s.cantidad;
      entry.porAlmacen.push({ almacen_id: s.almacen_id, almacen_nombre: cats.almacenMap.get(s.almacen_id)?.nombre || '?', cantidad: s.cantidad });
    }
  }
  for (const entry of stockMap.values()) entry.porAlmacen.sort((a, b) => b.cantidad - a.cantidad);
  return { variantes, stockMap };
}

// ─── Consultas: variantes con stock (SQLite) ──────────

export async function fetchVariantesConStock(filtros: {
  almacen_id?: string; marca?: string; fit?: string; categoria?: string;
  subcategoria?: string; genero?: string; talla?: string;
  marca_ids?: string[]; fit_ids?: string[]; talla_ids?: string[];
  search?: string; limit?: number;
}) {
  const cats = await loadCatalogs();
  const emptyResult = { variantes: [] as any[], stockMap: new Map<string, StockDetail>() };

  const findAllIds = (catalog: CatItem[], names: string[]) =>
    catalog.filter(c => names.includes(c.valor)).map(c => c.id);

  // Build producto filter
  let prodWhere = 'activo = 1';
  const prodParams: any[] = [];
  const marcaNames = filtros.marca ? [filtros.marca] : filtros.marca_ids || [];
  const fitNames = filtros.fit ? [filtros.fit] : filtros.fit_ids || [];

  if (marcaNames.length) {
    const ids = findAllIds(cats.marcas, marcaNames);
    if (!ids.length) return emptyResult;
    prodWhere += ` AND marca_id IN (${ids.map(() => '?').join(',')})`; prodParams.push(...ids);
  }
  if (fitNames.length) {
    const ids = findAllIds(cats.fits, fitNames);
    if (!ids.length) return emptyResult;
    prodWhere += ` AND fit_id IN (${ids.map(() => '?').join(',')})`; prodParams.push(...ids);
  }
  if (filtros.categoria) {
    const ids = findAllIds(cats.categorias, [filtros.categoria]);
    if (!ids.length) return emptyResult;
    prodWhere += ` AND categoria_id IN (${ids.map(() => '?').join(',')})`; prodParams.push(...ids);
  }
  if (filtros.subcategoria) {
    const ids = findAllIds(cats.subcategorias, [filtros.subcategoria]);
    if (!ids.length) return emptyResult;
    prodWhere += ` AND subcategoria_id IN (${ids.map(() => '?').join(',')})`; prodParams.push(...ids);
  }
  if (filtros.genero) {
    const ids = findAllIds(cats.generos, [filtros.genero]);
    if (!ids.length) return emptyResult;
    prodWhere += ` AND genero_id IN (${ids.map(() => '?').join(',')})`; prodParams.push(...ids);
  }
  if (filtros.search) {
    prodWhere += ' AND (modelo LIKE ? OR sku_product LIKE ?)';
    prodParams.push(`%${filtros.search}%`, `%${filtros.search}%`);
  }

  // Get producto IDs
  const prods = await queryAll<{ id: string }>(`SELECT id FROM productos WHERE ${prodWhere}`, prodParams);
  const prodIds = prods.map(p => p.id);
  console.log('[fetchVariantesConStock] prodWhere:', prodWhere, 'params:', prodParams.length, 'prodIds:', prodIds.length);

  // Build variante query
  let varWhere = 'v.activo = 1';
  const varParams: any[] = [];

  if (prodIds.length > 0) {
    // SQLite limit: 999 params. Chunk if needed.
    if (prodIds.length > 900) {
      // Too many, skip IN filter and do client-side filtering after
      const prodIdSet = new Set(prodIds);
      const limit = filtros.limit || 200;
      const allVars = await queryAll('SELECT * FROM variantes WHERE activo = 1 ORDER BY sku_variant');
      let rawVariantes = allVars.filter((v: any) => prodIdSet.has(v.producto_id));

      const tallaNames = filtros.talla ? [filtros.talla] : filtros.talla_ids || [];
      if (tallaNames.length) {
        const tallaIdSet = new Set(findAllIds(cats.tallas, tallaNames));
        rawVariantes = rawVariantes.filter((v: any) => tallaIdSet.has(v.talla_id));
      }
      rawVariantes = rawVariantes.slice(0, limit);

      if (!rawVariantes.length) return emptyResult;
      const uniqueProdIds2 = [...new Set(rawVariantes.map((v: any) => v.producto_id))];
      const prodMap2 = new Map<string, any>();
      // Chunk producto lookups too
      for (let i = 0; i < uniqueProdIds2.length; i += 500) {
        const chunk = uniqueProdIds2.slice(i, i + 500);
        const ps = await queryAll(`SELECT * FROM productos WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
        ps.forEach((p: any) => prodMap2.set(p.id, p));
      }
      const variantes = rawVariantes.map((v: any) => enrichVariante(v, prodMap2.get(v.producto_id), cats));
      return buildStockResult(variantes, filtros.almacen_id, cats);
    }
    varWhere += ` AND v.producto_id IN (${prodIds.map(() => '?').join(',')})`;
    varParams.push(...prodIds);
  } else if (filtros.search) {
    varWhere += ' AND (v.sku_variant LIKE ? OR v.codigo_barras LIKE ?)';
    varParams.push(`%${filtros.search}%`, `%${filtros.search}%`);
  } else {
    return emptyResult;
  }

  const tallaNames = filtros.talla ? [filtros.talla] : filtros.talla_ids || [];
  if (tallaNames.length) {
    const ids = findAllIds(cats.tallas, tallaNames);
    if (!ids.length) return emptyResult;
    varWhere += ` AND v.talla_id IN (${ids.map(() => '?').join(',')})`;
    varParams.push(...ids);
  }

  const limit = filtros.limit || 200;
  console.log('[fetchVariantesConStock] varWhere:', varWhere, 'varParams:', varParams.length, 'limit:', limit);
  let rawVariantes = await queryAll(`SELECT v.* FROM variantes v WHERE ${varWhere} ORDER BY v.sku_variant LIMIT ?`, [...varParams, limit]);
  console.log('[fetchVariantesConStock] rawVariantes:', rawVariantes.length);

  // If search, also find by sku/barcode and merge
  if (filtros.search && prodIds.length > 0) {
    const skuVars = await queryAll(
      'SELECT * FROM variantes WHERE activo = 1 AND (sku_variant LIKE ? OR codigo_barras LIKE ?) LIMIT ?',
      [`%${filtros.search}%`, `%${filtros.search}%`, limit]
    );
    const seen = new Set(rawVariantes.map((v: any) => v.id));
    for (const v of skuVars) { if (!seen.has(v.id)) { rawVariantes.push(v); seen.add(v.id); } }
    rawVariantes = rawVariantes.slice(0, limit);
  }

  if (!rawVariantes.length) return emptyResult;

  // Enrich variantes (chunk producto lookups)
  const uniqueProdIds = [...new Set(rawVariantes.map((v: any) => v.producto_id))];
  const prodMap = new Map<string, any>();
  for (let i = 0; i < uniqueProdIds.length; i += 500) {
    const chunk = uniqueProdIds.slice(i, i + 500);
    const productos = await queryAll(`SELECT * FROM productos WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
    productos.forEach((p: any) => prodMap.set(p.id, p));
  }
  const variantes = rawVariantes.map((v: any) => enrichVariante(v, prodMap.get(v.producto_id), cats));

  return buildStockResult(variantes, filtros.almacen_id, cats);
}

// ─── Solicitudes (sigue yendo a Supabase) ─────────────

export async function crearSolicitud(tipo: string, usuario_id: number, usuario_nombre: string, datos: any) {
  const { error } = await supabase.from('solicitudes_movil').insert({
    tipo, usuario_id, usuario_nombre, app_origen: 'redel_movil', estado: 'pendiente', datos,
  });
  if (error) throw error;
}
