import { Redirect } from 'expo-router';

// La ruta raíz "/" DEBE existir: sin este archivo, el APK de producción renderiza
// el Sitemap interno de expo-router (ruta no encontrada) y crashea antes del login
// — la app se queda congelada en el splash. En dev no se nota porque el Sitemap
// no crashea con Metro conectado y el AuthGate redirige antes de que se vea.
// unstable_settings.initialRouteName de (tabs) NO cubre "/": solo ordena los tabs.
export default function Index() {
  return <Redirect href="/escaner" />;
}
