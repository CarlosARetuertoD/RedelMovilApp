import { Tabs } from 'expo-router';
import { View, Text, Pressable, Dimensions } from 'react-native';
import { ScanBarcode, ClipboardList, Search, Package, User } from 'lucide-react-native';
import { router } from 'expo-router';
import { C } from '../../lib/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useAuthStore from '../../store/authStore';

function HeaderRight() {
  const { user } = useAuthStore();
  if (!user) return null;

  return (
    <Pressable onPress={() => router.push('/perfil')} hitSlop={10}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 16 }}>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>{user.nombre}</Text>
        <Text style={{ color: C.textMuted, fontSize: 10 }}>{user.rol}</Text>
      </View>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
        <User size={16} color={C.white} />
      </View>
    </Pressable>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  return (
    <Tabs screenOptions={{
      tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.border, borderTopWidth: 1, height: isTablet ? 70 : 56 + insets.bottom, paddingBottom: insets.bottom + (isTablet ? 8 : 4), paddingTop: isTablet ? 8 : 4 },
      tabBarActiveTintColor: C.accent,
      tabBarInactiveTintColor: C.textMuted,
      tabBarLabelStyle: { fontSize: isTablet ? 12 : 10, fontWeight: '600', marginTop: 2 },
      headerStyle: { backgroundColor: C.surface },
      headerTintColor: C.white,
      headerTitleStyle: { fontWeight: '700', fontSize: isTablet ? 20 : 17 },
      headerShadowVisible: false,
      headerRight: () => <HeaderRight />,
    }}>
      <Tabs.Screen name="index" options={{ title: 'Consultas', headerTitle: 'Consultas',
        tabBarIcon: ({ color, focused }) => <Search size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} /> }} />
      <Tabs.Screen name="escaner" options={{ title: 'Escáner', headerTitle: 'Escáner',
        tabBarIcon: ({ color, focused }) => <ScanBarcode size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} /> }} />
      <Tabs.Screen name="conteo" options={{ title: 'Conteo', headerTitle: 'Conteo',
        tabBarIcon: ({ color, focused }) => <ClipboardList size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} /> }} />
      <Tabs.Screen name="operaciones" options={{ title: 'Operaciones', headerTitle: 'Operaciones',
        tabBarIcon: ({ color, focused }) => <Package size={22} color={color} strokeWidth={focused ? 2.5 : 1.8} /> }} />
      <Tabs.Screen name="movimientos" options={{ href: null }} />
    </Tabs>
  );
}
