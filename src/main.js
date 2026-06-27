import { createApp, h } from 'vue'
import McUIVue from 'mcui-oreui'
import 'mcui-oreui/style.css'
import './styles.css'
import App from './App.vue'

const modalInternalTags = ['modal', 'modal_area', 'modal_title', 'modal_title_area', 'modal_close_btn']
const app = createApp(App).use(McUIVue)

for (const tag of modalInternalTags) {
  app.component(tag, (_, { attrs, slots }) => h(tag, attrs, slots.default?.()))
}

app.mount('#app')
