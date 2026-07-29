import { View, Text, Pressable, Dimensions } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { C } from '../lib/colors';

const SCREEN_W = Dimensions.get('window').width;

function hexToRgb(hex: string) {
  const c = hex?.replace('#', '');
  if (!c || c.length < 6) return null;
  return { r: parseInt(c.slice(0, 2), 16), g: parseInt(c.slice(2, 4), 16), b: parseInt(c.slice(4, 6), 16) };
}
export function textForBg(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > 0.55 ? '#1a1a1a' : '#ffffff';
}

const isStriped = (a: any) => a?.patron === 'rayas' && !!a?.color_secundario;

// Rayas diagonales — mismo diseño que StripeBg de escáner/consultas
export function StripeBg({ color1, color2, w, h, step = 18, sw = 5, overlay = true }: {
  color1: string; color2: string; w: number; h: number; step?: number; sw?: number; overlay?: boolean;
}) {
  const lines = [];
  for (let x = -(h + step); x < w + h; x += step) {
    lines.push(<Line key={x} x1={x} y1={0} x2={x + h} y2={h} stroke={color1} strokeWidth={sw} strokeOpacity={0.6} />);
  }
  return (
    <Svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Rect x={0} y={0} width={w} height={h} fill={color2} fillOpacity={0.85} />
      {lines}
      {overlay && <Rect x={0} y={0} width={w} height={h} fill="rgba(0,0,0,0.28)" />}
    </Svg>
  );
}

// Punto o barra con el color del almacén, respetando el patrón rayado
export function AlmacenSwatch({ almacen, width = 10, height = 10, radius }: {
  almacen: any; width?: number; height?: number; radius?: number;
}) {
  return (
    <View style={{ width, height, borderRadius: radius ?? height / 2, overflow: 'hidden', backgroundColor: almacen?.color_hex || C.accent }}>
      {isStriped(almacen) && (
        <StripeBg color1={almacen.color_hex} color2={almacen.color_secundario} w={width} h={height} step={5} sw={2.5} overlay={false} />
      )}
    </View>
  );
}

// Selector de almacén: pills centradas en varias filas (sin scroll horizontal)
export function AlmacenPills({ almacenes, selectedId, onSelect, excludeId }: {
  almacenes: any[]; selectedId: string | null; onSelect: (id: string) => void; excludeId?: string | null;
}) {
  const list = (almacenes || []).filter((a: any) => !excludeId || a.id !== excludeId);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
      {list.map((a: any) => {
        const sel = a.id === selectedId;
        const striped = isStriped(a);
        const bg = sel ? (striped ? 'transparent' : (a.color_hex || C.accent)) : C.card;
        const tc = sel ? (striped ? '#ffffff' : (a.color_hex ? textForBg(a.color_hex) : C.white)) : C.textSecondary;
        return (
          <Pressable key={a.id} onPress={() => onSelect(a.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: bg, borderRadius: 10,
              paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, overflow: 'hidden',
              borderColor: sel ? (a.color_hex || C.accent) : (a.color_hex || C.border) + '60' }}>
            {sel && striped && <StripeBg color1={a.color_hex} color2={a.color_secundario} w={SCREEN_W} h={48} />}
            {!sel && a.color_hex && <AlmacenSwatch almacen={a} />}
            <Text style={{ color: tc, fontSize: 14, fontWeight: '700', zIndex: 1 }}>{a.nombre}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
