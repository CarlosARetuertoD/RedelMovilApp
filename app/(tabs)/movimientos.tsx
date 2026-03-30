import { View, Text } from 'react-native';
import { C } from '../../lib/colors';

export default function MovimientosScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: C.textMuted }}>No disponible</Text>
    </View>
  );
}
