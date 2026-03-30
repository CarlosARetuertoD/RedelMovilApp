import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { ScanBarcode } from 'lucide-react-native';
import useAuthStore from '../store/authStore';
import { C } from '../lib/colors';

export default function LoginScreen() {
  const { login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) { setError('Ingresa usuario y contraseña'); return; }
    setLoading(true);
    setError('');
    try {
      await login(username.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        <View style={{ alignItems: 'center', marginBottom: 48 }}>
          <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' }}>
            <ScanBarcode size={36} color={C.white} />
          </View>
          <Text style={{ color: C.white, fontSize: 24, fontWeight: '800', marginTop: 20 }}>RedelMovilApp</Text>
          <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 6 }}>Inventario y escaneo móvil</Text>
        </View>
        <View style={{ gap: 14 }}>
          <View>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>Usuario</Text>
            <TextInput value={username} onChangeText={setUsername} placeholder="admin" placeholderTextColor={C.textMuted} autoCapitalize="none" autoCorrect={false}
              style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, color: C.white, fontSize: 16, borderWidth: 1, borderColor: C.border }} />
          </View>
          <View>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>Contraseña</Text>
            <TextInput value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={C.textMuted} secureTextEntry autoCapitalize="none"
              style={{ backgroundColor: C.card, borderRadius: 14, padding: 16, color: C.white, fontSize: 16, borderWidth: 1, borderColor: C.border }} />
          </View>
          {error ? <View style={{ backgroundColor: C.redSurface, borderRadius: 10, padding: 12 }}><Text style={{ color: C.red, fontSize: 12, textAlign: 'center' }}>{error}</Text></View> : null}
          <Pressable onPress={handleLogin} disabled={loading} style={{ backgroundColor: loading ? C.border : C.accent, borderRadius: 14, padding: 16, marginTop: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            {loading && <ActivityIndicator color={C.white} size="small" />}
            <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>{loading ? 'Ingresando...' : 'Ingresar'}</Text>
          </Pressable>
        </View>
        <Text style={{ color: C.textMuted, fontSize: 10, textAlign: 'center', marginTop: 40 }}>Admin, supervisor y almacenero</Text>
      </View>
    </KeyboardAvoidingView>
  );
}
