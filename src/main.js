import { mount } from 'svelte'
import './app.css'
import 'leaflet/dist/leaflet.css'
import App from './App.svelte'

const target = document.getElementById('app')

if (!target) {
  throw new Error('Could not find the app mount target.')
}

export default mount(App, { target })