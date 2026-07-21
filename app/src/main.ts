import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { registerNative } from './lib/native'
import { initAnalytics } from './lib/analytics'
import './assets/css/main.css'
import './assets/css/transitions.css'

// Before mount: the router's first afterEach (page_view) fires once the app
// mounts, so analytics must already be initialized (or dormant) by then.
initAnalytics()

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

// Android hardware/gesture back button wiring (no-op in the browser).
registerNative(router)

app.mount('#app')
