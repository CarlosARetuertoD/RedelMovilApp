import { View, Text } from 'react-native';
import { Package } from 'lucide-react-native';
import { C } from '../../lib/colors';

export default function OperacionesScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: C.amber + '20', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
        <Package size={32} color={C.amber} />
      </View>
      <Text style={{ color: C.white, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>En construcción</Text>
      <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
        Esta sección estará disponible próximamente
      </Text>
    </View>
  );
}
