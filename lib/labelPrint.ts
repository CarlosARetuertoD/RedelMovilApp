/**
 * Impresión de etiquetas 50×25 por Bluetooth desde el celular.
 *
 * Mismo pipeline que la PWA KarolayJeansApp en la tablet (src/lib/labelPrint.ts),
 * adaptado a React Native:
 *
 *   plantilla (ERP /api/plantillas-etiqueta/)
 *     → WebView oculto (components/LabelRenderer): canvas + jsbarcode → BITMAP TSPL2 base64
 *       → módulo nativo SppPrinter (modules/spp-printer): Bluetooth SPP → ADV-9013N/HL80
 *
 * React Native no tiene canvas, por eso la rasterización corre dentro de un WebView
 * (mismo motor Android donde ya se verificó que el barcode impreso escanea).
 * Protocolo TSPL2 confirmado por ingeniería inversa de la app oficial
 * (Escritorio/ADV9013N_TSPL): 203 dpi = 8 dots/mm, cabecera idéntica a la capturada.
 */

import { railwayGet } from './railway';
import { JSBARCODE_SRC } from './vendor/jsbarcodeSource';

export interface LabelElement {
  type: string; // "barcode" | (texto)
  field: string;
  x: number; y: number; w: number; h: number; // en mm
  fontSize: number; // en pt
  fontWeight?: number | string;
  color?: string;
  align?: 'left' | 'center' | 'right' | string;
  showText?: boolean;
  placeholder?: string;
}

export interface LabelInfo {
  producto?: {
    marca?: string; modelo?: string; sku_product?: string;
    categoria?: string; subcategoria?: string; fit?: string; genero?: string;
  };
  variante?: {
    sku_variant?: string; codigo_barras?: string;
    color?: string; talla?: string; precio?: number;
  };
}

export interface LabelJob {
  template: LabelElement[];
  info?: LabelInfo;
  /** Valores literales por `field` (etiquetas que no son de producto). */
  values?: Record<string, string>;
  copies: number;
}

/** Plantilla de etiqueta por defecto desde el ERP (misma que usa la PWA/tablet). */
export async function fetchPlantillaEtiqueta(): Promise<LabelElement[]> {
  const data = await railwayGet<any>('/api/plantillas-etiqueta/');
  const arr: any[] = Array.isArray(data) ? data : data?.results || [];
  const def = arr.find(p => p.es_default) || arr[0];
  return def?.json_data || [];
}

// ───────── HTML del renderizador (corre en el WebView oculto) ─────────
//
// Port 1:1 del rasterizado de la PWA: mismo canvas 400×200, misma fuente serif,
// mismo CODE128 sin suavizado, misma cabecera TSPL2. El RN inyecta
// window.__renderJobs({id, jobs}) y recibe {id, ok, b64|error} por postMessage.

const RENDER_JS = `
var LABEL_W_MM = 50, LABEL_H_MM = 25, DOTS_PER_MM = 8;
var PT_TO_DOT = (DOTS_PER_MM * 25.4) / 72;
var TEXT_SCALE = 0.95;

function resolveLabelValue(el, info) {
  if (!info) return el.placeholder || '';
  var p = info.producto || {}, v = info.variante || {};
  var map = {
    marca: p.marca || '',
    modelo: p.modelo || '',
    sku_variant: v.sku_variant || '',
    sku_product: p.sku_product || '',
    color: v.color || '',
    talla: v.talla || '',
    precio: (v.precio !== null && v.precio !== undefined && v.precio !== 0 && v.precio !== '')
      ? 'S/ ' + Number(v.precio).toFixed(2) : '',
    informacion: [p.categoria, p.subcategoria, p.fit].filter(Boolean).join(' '),
    categoria: [p.categoria, p.subcategoria].filter(Boolean).join(' '),
    fit: p.fit || '',
    genero: p.genero || '',
    barcode_img: v.codigo_barras || '0000000000001',
    barcode_num: v.codigo_barras || '',
    free_text: el.placeholder || '',
  };
  return (map[el.field] !== undefined) ? map[el.field] : (el.placeholder || '');
}

function drawText(ctx, text, x, y, w, h, el) {
  var px = Math.max(6, (el.fontSize || 10) * PT_TO_DOT * TEXT_SCALE);
  var weight = (el.fontWeight === undefined || el.fontWeight === null) ? 400 : el.fontWeight;
  ctx.font = weight + ' ' + px + "px 'Times New Roman', 'Noto Serif', serif";
  ctx.fillStyle = el.color || '#000';
  ctx.textBaseline = 'middle';
  var pad = 1 * DOTS_PER_MM;
  var align = el.align || 'left';
  var tx;
  if (align === 'center') { ctx.textAlign = 'center'; tx = x + w / 2; }
  else if (align === 'right') { ctx.textAlign = 'right'; tx = x + w - pad; }
  else { ctx.textAlign = 'left'; tx = x + pad; }
  ctx.fillText(text, tx, y + h / 2);
}

function drawBarcode(ctx, value, x, y, w, h, el) {
  var tmp = document.createElement('canvas');
  try {
    JsBarcode(tmp, value, {
      format: 'CODE128',
      displayValue: el.showText !== false,
      fontSize: Math.max(6, (el.fontSize || 10) * 2.2),
      margin: el.showText !== false ? 3 : 2,
      lineColor: '#000',
      background: '#fff',
      textPosition: 'bottom',
    });
  } catch (e) { return; }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, x, y, w, h);
}

function renderLabelToCanvas(template, valueOf) {
  var wDots = LABEL_W_MM * DOTS_PER_MM, hDots = LABEL_H_MM * DOTS_PER_MM;
  var canvas = document.createElement('canvas');
  canvas.width = wDots; canvas.height = hDots;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, wDots, hDots);
  for (var i = 0; i < template.length; i++) {
    var el = template[i];
    var value = valueOf(el);
    var x = el.x * DOTS_PER_MM, y = el.y * DOTS_PER_MM;
    var w = el.w * DOTS_PER_MM, h = el.h * DOTS_PER_MM;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (el.type === 'barcode') drawBarcode(ctx, value || '0000000000001', x, y, w, h, el);
    else drawText(ctx, value || '', x, y, w, h, el);
    ctx.restore();
  }
  return canvas;
}

function canvasToRaster(canvas) {
  var w = canvas.width, h = canvas.height;
  var img = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  var widthBytes = (w + 7) >> 3;
  var out = new Uint8Array(widthBytes * h);
  out.fill(255);
  for (var yy = 0; yy < h; yy++) {
    var rowBase = yy * widthBytes;
    for (var xx = 0; xx < w; xx++) {
      var i = (yy * w + xx) * 4;
      var a = img[i + 3];
      var lum = a < 128 ? 255 : (img[i] * 299 + img[i + 1] * 587 + img[i + 2] * 114) / 1000;
      if (lum < 128) out[rowBase + (xx >> 3)] &= ~(128 >> (xx & 7));
    }
  }
  return { widthBytes: widthBytes, height: h, data: out };
}

function latin1(s) {
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function concatBytes(arrs) {
  var len = 0;
  for (var i = 0; i < arrs.length; i++) len += arrs[i].length;
  var out = new Uint8Array(len);
  var o = 0;
  for (var j = 0; j < arrs.length; j++) { out.set(arrs[j], o); o += arrs[j].length; }
  return out;
}

function bytesToBase64(bytes) {
  var bin = '';
  var chunk = 32768;
  for (var i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function buildLabelBytes(raster, copies) {
  var header =
    'SIZE ' + LABEL_W_MM + ' mm,' + LABEL_H_MM + ' mm\\r\\n' +
    'SET TEAR ON\\r\\n' +
    'SET RIBBON OFF\\r\\n' +
    'DIRECTION 0,0\\r\\n' +
    'REFERENCE 0,0\\r\\n' +
    'DENSITY 8\\r\\n' +
    'OFFSET 0 mm\\r\\n' +
    'SHIFT 0,0\\r\\n' +
    'GAP 2 mm,0 mm\\r\\n' +
    'SPEED 5\\r\\n' +
    'CLS\\r\\n';
  var bmpHeader = 'BITMAP 0,0,' + raster.widthBytes + ',' + raster.height + ',1,';
  var footer = '\\r\\nPRINT 1,' + Math.max(1, copies) + '\\r\\n';
  return concatBytes([latin1(header + bmpHeader), raster.data, latin1(footer)]);
}

function jobToBytes(job) {
  var valueOf = function (el) {
    return (job.values && (el.field in job.values)) ? job.values[el.field] : resolveLabelValue(el, job.info);
  };
  var canvas = renderLabelToCanvas(job.template, valueOf);
  var raster = canvasToRaster(canvas);
  return buildLabelBytes(raster, job.copies || 1);
}

function post(obj) { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }

window.__renderJobs = function (payload) {
  try {
    var parts = [];
    for (var i = 0; i < payload.jobs.length; i++) {
      var job = payload.jobs[i];
      if (job.template && job.template.length) parts.push(jobToBytes(job));
    }
    if (!parts.length) { post({ id: payload.id, ok: false, error: 'Sin plantilla de etiqueta' }); return; }
    post({ id: payload.id, ok: true, b64: bytesToBase64(concatBytes(parts)) });
  } catch (e) {
    post({ id: payload.id, ok: false, error: String((e && e.message) || e) });
  }
};

post({ type: 'ready' });
`;

export const LABEL_RENDER_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>' +
  '<script>' + JSBARCODE_SRC + '</scr' + 'ipt>' +
  '<script>' + RENDER_JS + '</scr' + 'ipt>' +
  '</body></html>';
