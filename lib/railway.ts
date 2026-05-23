import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_RAILWAY_URL ?? 'https://redelerp-backend-production.up.railway.app';
const TOKEN_KEY = '@redelmovil_tokens';

export type Tokens = { access: string; refresh: string };

export async function saveTokens(tokens: Tokens) {
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export async function getTokens(): Promise<Tokens | null> {
  const raw = await AsyncStorage.getItem(TOKEN_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearTokens() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.access) {
      const tokens = await getTokens();
      if (tokens) await saveTokens({ ...tokens, access: data.access });
      return data.access;
    }
    return null;
  } catch {
    return null;
  }
}

export async function railwayGet<T = any>(path: string): Promise<T> {
  const tokens = await getTokens();
  if (!tokens) throw new Error('Sin sesión');

  const doRequest = async (token: string) => {
    return fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  };

  let res = await doRequest(tokens.access);

  if (res.status === 401) {
    const newAccess = await refreshAccessToken(tokens.refresh);
    if (!newAccess) throw new Error('Sesión expirada');
    res = await doRequest(newAccess);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Railway ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

export async function railwayPost<T = any>(path: string, body: object): Promise<T> {
  const tokens = await getTokens();
  if (!tokens) throw new Error('Sin sesión');

  const doRequest = async (token: string) => {
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  let res = await doRequest(tokens.access);

  if (res.status === 401) {
    const newAccess = await refreshAccessToken(tokens.refresh);
    if (!newAccess) throw new Error('Sesión expirada');
    res = await doRequest(newAccess);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Railway ${res.status}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

export async function loginRailway(username: string, password: string): Promise<{
  access: string; refresh: string;
  user: { id: number; username: string; nombre: string; rol: string };
}> {
  const res = await fetch(`${BASE}/api/auth/token-movil/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || data.non_field_errors?.[0] || 'Error al iniciar sesión');
  }
  return data;
}
