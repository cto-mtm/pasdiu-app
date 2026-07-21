import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.pasdiu.app',           // reverse-DNS bundle id
  appName: 'Pasdiu',
  webDir: 'dist',
  // Uncomment during development to live-reload inside the native shell:
  // server: { url: 'http://192.168.1.XX:5173', cleartext: true },
}

export default config
