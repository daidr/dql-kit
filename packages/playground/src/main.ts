import { createDqlKit } from '@dql-kit/vue-headless'
import { createApp } from 'vue'
import App from './App.vue'
// Opt-in stylesheet shipped with @dql-kit/vue-ui — wires up the .dql-*
// class names emitted by FilterBuilder and the renderer components.
import '@dql-kit/vue-ui/styles.css'
import './styles.css'

const dqlKit = createDqlKit()

const app = createApp(App)
app.use(dqlKit)
app.mount('#app')
