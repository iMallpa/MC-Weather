<script setup>
import { Chart, registerables } from 'chart.js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { McButton, McButtonTabs, McDropdown, McIcon, McModal, McPanel, McProgress, McRadioGroup, McSkinViewer, McSwitch, McTooltip, playSound } from 'mcui-oreui'
import { DEFAULT_PLACE, loadWeather, reverseGeocodePlace, searchPlaces } from './services/weather.js'

Chart.register(...registerables)

const DEFAULT_PLACE_KEY = 'mc-weather-default-place'
const assetUrl = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
const DEFAULT_SKIN = assetUrl('skin-default.png')
const refreshOptions = ['5 分钟', '15 分钟', '30 分钟', '60 分钟']
const refreshOptionValues = [5, 15, 30, 60]
const skinPoseOptions = ['站立', '行走']
const skinPoseValues = ['none', 'walk']
const themeOptions = [
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
  { label: '自动', value: 'auto' },
]
const loadingSpinnerSrc = assetUrl('mcui-oreui/assets/Loading_white.DMpwGoUC.gif')
const owmLayerOptions = [
  { label: '降水', value: 'precipitation_new' },
  { label: '云量', value: 'clouds_new' },
  { label: '温度', value: 'temp_new' },
  { label: '风场', value: 'wind_new' },
  { label: '气压', value: 'pressure_new' },
]

const tabs = [
  { label: '概览', value: 'current' },
  { label: '图表', value: 'minute' },
  { label: '预报', value: 'forecast' },
  { label: '天气建议', value: 'advice' },
]

const activeTab = ref('current')
const controlPage = ref('location')
const themeMode = ref(localStorage.getItem('mc-weather-theme') || 'auto')
const prefersDark = ref(typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true)
const darkMode = computed(() => themeMode.value === 'auto' ? prefersDark.value : themeMode.value === 'dark')
const autoRefresh = ref(localStorage.getItem('mc-weather-auto-refresh') === 'true')
const refreshMinutes = ref(Number(localStorage.getItem('mc-weather-refresh-minutes') || 15))
const owmApiKey = ref(localStorage.getItem('mc-weather-owm-key') || import.meta.env.VITE_OWM_API_KEY || '')
const owmLayer = ref(localStorage.getItem('mc-weather-owm-layer') || 'precipitation_new')
const useOpenWeatherData = ref(localStorage.getItem('mc-weather-use-openweather') === 'true')
const skinModalOpen = ref(false)
const debugModalOpen = ref(false)
const skinUrl = ref(localStorage.getItem('mc-weather-skin-url') || DEFAULT_SKIN)
const skinFileInput = ref(null)
const skinSlim = ref(localStorage.getItem('mc-weather-skin-slim') === 'true')
const skinSecondLayer = ref(localStorage.getItem('mc-weather-skin-second-layer') !== 'false')
const skinAutoRotate = ref(localStorage.getItem('mc-weather-skin-auto-rotate') === 'true')
const skinPose = ref(localStorage.getItem('mc-weather-skin-pose') || 'walk')
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1180)
const query = ref('')
const places = ref([])
const searchMiss = ref(false)
const selectedPlace = ref(DEFAULT_PLACE)
const savedDefaultPlace = ref(loadSavedDefaultPlace())
const weather = ref(null)
const loading = ref(false)
const locating = ref(false)
const error = ref('')
const minuteCanvas = ref(null)
const hourlyCanvas = ref(null)
const windCanvas = ref(null)
const minuteTooltip = ref({ visible: false, chartId: '', x: 0, y: 0, placement: 'right', title: '', items: [] })
const roadCanvas = ref(null)
const mapElement = ref(null)
const roadWays = ref([])

let searchTimer = 0
let refreshTimer = 0
let minuteChart = null
let hourlyChart = null
let windChart = null
let licenseClickCount = 0
let licenseClickTimer = 0
let roadFallbackImage = null
let roadFallbackTheme = ''
let roadFallbackLoading = null
let roadFallbackLoadingTheme = ''
let resizeObserver = null
let leafletMap = null
let baseLayer = null
let weatherLayer = null
let locationMarker = null
let mapPickMarker = null
let mapPickPlace = null
let mapHost = null
let themeMediaQuery = null
let themeChangeHandler = null

const current = computed(() => weather.value?.current)
const cei = computed(() => current.value?.cei)
const openWeatherOptions = computed(() => ({
  owmApiKey: owmApiKey.value.trim(),
  useOpenWeather: useOpenWeatherData.value && Boolean(owmApiKey.value.trim()),
}))
const weatherAlerts = computed(() => weather.value?.alerts || [])
const displayedWeatherAlerts = computed(() => {
  const alerts = [...weatherAlerts.value].filter(Boolean)
  if (!alerts.length) return []
  const timeValue = (alert) => new Date(alert.start || alert.end || weather.value?.updatedAt || 0).getTime() || 0
  const latestTime = Math.max(...alerts.map(timeValue))
  const latestAlerts = alerts.filter((alert) => timeValue(alert) === latestTime)
  const seen = new Set()
  const uniqueAlerts = []
  for (const alert of latestAlerts) {
    const key = `${alert.title || ''}|${alert.description || ''}`.trim()
    if (seen.has(key)) continue
    seen.add(key)
    uniqueAlerts.push(alert)
  }
  return uniqueAlerts.slice(0, 2)
})
const isOpenWeatherSource = computed(() => weather.value?.source === 'openweather')
const ceiLevelTitle = computed(() => {
  const [title] = String(cei.value?.level || '').split(' - ')
  return title.replace(/^CEI\s+/, '') || '--'
})
const ceiLevelDescription = computed(() => {
  const [, description] = String(cei.value?.level || '').split(' - ')
  return description || ''
})
const nowDisplay = computed(() => weather.value ? new Date(weather.value.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--')
const placeTitle = computed(() => formatPlace(selectedPlace.value))
const placeMeta = computed(() => `${Number(selectedPlace.value.latitude).toFixed(4)}, ${Number(selectedPlace.value.longitude).toFixed(4)}`)
const defaultPlaceTitle = computed(() => savedDefaultPlace.value ? formatPlace(savedDefaultPlace.value) : '未设置')
const currentOwmLayerLabel = computed(() => owmLayerOptions.find((item) => item.value === owmLayer.value)?.label || '图层')
const activeSkin = computed(() => skinUrl.value.trim() || DEFAULT_SKIN)
const skinPoseIndex = computed({
  get: () => Math.max(1, skinPoseValues.indexOf(skinPose.value) + 1),
  set: (index) => {
    skinPose.value = skinPoseValues[index - 1] ?? 'walk'
  },
})
const skinScale = computed(() => {
  if (viewportWidth.value >= 1080) return 1.95
  if (viewportWidth.value >= 720) return 1.7
  return 1.45
})
const previewSkinScale = 4.4
const refreshOptionIndex = computed({
  get: () => Math.max(1, refreshOptionValues.indexOf(Number(refreshMinutes.value)) + 1),
  set: (index) => {
    refreshMinutes.value = refreshOptionValues[index - 1] ?? 15
  },
})
const mainEffect = computed(() => ({
  heat: '体感温度',
  air: '空气质量',
  uv: '紫外线',
  pressure: '气压',
  risk: '安全风险',
}[cei.value?.detail.main_effect] ?? '综合环境'))
const weatherIcon = computed(() => {
  const code = current.value?.weatherCode
  if ([0, 1].includes(code)) return current.value?.isDay === 0 ? 'mdi-weather-night' : 'mdi-weather-sunny'
  if (code === 2) return 'mdi-weather-partly-cloudy'
  if (code === 3) return 'mdi-weather-cloudy'
  if ([45, 48].includes(code)) return 'mdi-weather-fog'
  if (code >= 51 && code <= 57) return 'mdi-weather-partly-rainy'
  if (code >= 61 && code <= 67) return 'mdi-weather-pouring'
  if (code >= 71 && code <= 77) return 'mdi-weather-snowy'
  if (code >= 80 && code <= 82) return 'mdi-weather-rainy'
  if (code >= 85 && code <= 86) return 'mdi-weather-snowy-heavy'
  if (code >= 95) return 'mdi-weather-lightning-rainy'
  return 'mdi-weather-partly-cloudy'
})
const riskFactors = computed(() => {
  const labels = {
    extreme_cold: '严寒',
    extreme_heat: '高温',
    wind: '强风',
    snow_ice: '雪冰',
    heavy_rain: '强降雨',
    thunderstorm: '雷暴',
    fog: '低能见度',
    dust_sand: '沙尘',
    tornado: '龙卷风',
    air_quality: '空气健康',
  }
  return (cei.value?.detail.risk.factors ?? []).map((item) => labels[item] ?? item)
})
const aqiSummary = computed(() => {
  const owmAqi = Number(current.value?.air?.openWeatherAqi)
  if (isOpenWeatherSource.value) {
    const labels = {
      1: '优',
      2: '良',
      3: '中等',
      4: '较差',
      5: '很差',
    }
    return {
      value: Number.isFinite(owmAqi) && owmAqi > 0 ? owmAqi : null,
      label: labels[owmAqi] || '暂无',
      scale: 'OWM',
      bad: owmAqi >= 4,
    }
  }
  const aqi = current.value?.air?.europeanAqi || current.value?.air?.usAqi || 0
  if (aqi <= 20) return { value: aqi, label: '优', scale: 'AQI', bad: false }
  if (aqi <= 40) return { value: aqi, label: '良', scale: 'AQI', bad: false }
  if (aqi <= 60) return { value: aqi, label: '一般', scale: 'AQI', bad: false }
  if (aqi <= 80) return { value: aqi, label: '较差', scale: 'AQI', bad: true }
  return { value: aqi, label: '差', scale: 'AQI', bad: true }
})
const summaryText = computed(() => {
  return adviceSummary.value
})
const adviceSummary = computed(() => {
  if (!current.value || !cei.value) return ''
  const core = [
    `${placeTitle.value} 当前 ${current.value.label}`,
    `气温 ${rounded(current.value.temp)}°C`,
    `体感 ${rounded(current.value.feelsLike)}°C`,
    `CEI ${cei.value.cei}`,
  ].join('，')
  const top = adviceItems.value.find((item) => item.level === 'priority') || adviceItems.value[0]
  const second = adviceItems.value.find((item) => item.level === 'notice' && item !== top)
  const tail = [top?.text, second?.text].filter(Boolean).join(' ')
  return `${core}。主要影响来自 ${mainEffect.value}。${tail}`
})
const adviceItems = computed(() => {
  if (!current.value || !cei.value) return []
  const items = []
  const rainChance = Number(current.value.precipitationProbability) || 0
  const rainNow = Number(current.value.precipitation) || 0
  const wind = (Number(current.value.wind) || 0) * 3.6
  const gust = (Number(current.value.windGust) || 0) * 3.6
  const feels = Number(current.value.feelsLike)
  const uvi = Number(current.value.uvi)
  const visibility = Number(current.value.visibility)
  const code = Number(current.value.weatherCode)
  const humidity = Number(current.value.humidity)

  if (rainChance >= 70 || rainNow >= 2) {
    items.push(adviceItem('降水', 'priority', `降水信号明显，出门带伞，骑行和步行都要预留时间。`))
  } else if (rainChance >= 40 || rainNow > 0) {
    items.push(adviceItem('降水', 'notice', `短时有降水可能，建议随身带轻便雨具。`))
  } else {
    items.push(adviceItem('降水', 'stable', `短时降水影响较低，正常出行即可。`))
  }

  if (gust >= 45 || wind >= 30) {
    items.push(adviceItem('风力', 'priority', `风力偏强，避免在广告牌、树下和临时搭建物附近停留。`))
  } else if (gust >= 25 || wind >= 18) {
    items.push(adviceItem('风力', 'notice', `阵风略明显，帽子、伞和轻物品注意固定。`))
  } else {
    items.push(adviceItem('风力', 'stable', `风力平稳，对通勤影响不大。`))
  }

  if (Number.isFinite(feels) && feels >= 33) {
    items.push(adviceItem('体感', 'priority', `体感炎热，减少暴晒时段活动，及时补水。`))
  } else if (Number.isFinite(feels) && feels <= 3) {
    items.push(adviceItem('体感', 'priority', `体感寒冷，注意保暖，长时间户外需要加厚外层。`))
  } else if (Number.isFinite(feels) && (feels >= 29 || feels <= 8)) {
    items.push(adviceItem('体感', 'notice', `体感略有压力，按活动时间调整衣物和补水。`))
  } else {
    items.push(adviceItem('体感', 'stable', `体感处于可接受范围，日常活动压力不高。`))
  }

  if (aqiSummary.value.bad) {
    items.push(adviceItem('空气', 'priority', `空气质量偏弱，敏感人群减少长时间户外运动。`))
  } else {
    items.push(adviceItem('空气', 'stable', `空气质量整体可接受，正常通风和户外活动即可。`))
  }

  if (Number.isFinite(uvi) && uvi >= 8) {
    items.push(adviceItem('紫外线', 'priority', `紫外线很强，外出使用防晒并减少正午暴露。`))
  } else if (Number.isFinite(uvi) && uvi >= 5) {
    items.push(adviceItem('紫外线', 'notice', `紫外线中等偏强，长时间户外建议防晒。`))
  }

  if (Number.isFinite(visibility) && visibility < 3000) {
    items.push(adviceItem('能见度', 'priority', `能见度偏低，驾驶注意车距和灯光。`))
  } else if (Number.isFinite(visibility) && visibility < 8000) {
    items.push(adviceItem('能见度', 'notice', `能见度一般，夜间和快速路段注意观察。`))
  }

  if (code >= 95) {
    items.push(adviceItem('雷暴', 'priority', `存在雷暴风险，避免开阔地、水边和高处停留。`))
  } else if ((code >= 71 && code <= 86) || riskFactors.value.includes('雪冰')) {
    items.push(adviceItem('路面', 'priority', `可能有雪或结冰影响，注意防滑和路面变化。`))
  } else if ([45, 48].includes(code)) {
    items.push(adviceItem('雾', 'notice', `有雾或低云影响，通勤注意能见度变化。`))
  }

  if (humidity >= 85 && feels >= 26) {
    items.push(adviceItem('湿度', 'notice', `湿度偏高，闷热感会更明显，室内注意通风除湿。`))
  }

  const ceiScore = Number(cei.value.cei) || 0
  if (ceiScore < 40) {
    items.push(adviceItem('舒适度', 'priority', `环境压力较高，非必要减少户外停留。`))
  } else if (ceiScore < 60) {
    items.push(adviceItem('舒适度', 'notice', `舒适度偏低，安排户外活动时留意主要影响项。`))
  } else {
    items.push(adviceItem('舒适度', 'stable', `舒适度可接受，按常规计划安排即可。`))
  }

  const order = { priority: 0, notice: 1, stable: 2 }
  return items
    .filter((item, index, list) => list.findIndex((other) => other.title === item.title) === index)
    .sort((a, b) => order[a.level] - order[b.level])
    .slice(0, 8)
})
function adviceItem(title, level, text) {
  return { title, level, text }
}
const currentBrief = computed(() => {
  if (!current.value) return ''
  const rain = current.value.precipitationProbability >= 40 ? '短时有降水可能' : '短时降水不明显'
  const wind = current.value.windGust * 3.6 >= 25 ? '阵风偏明显' : '风力平稳'
  return `${current.value.label}，体感 ${rounded(current.value.feelsLike)}°C，${rain}，${wind}。`
})
const ceiAdvice = computed(() => {
  const score = cei.value?.cei ?? 0
  if (score >= 80) return '环境舒适，适合正常户外活动。'
  if (score >= 60) return '整体可接受，留意主要影响项即可。'
  if (score >= 40) return '舒适度偏低，建议减少长时间暴露。'
  return '环境压力较高，尽量降低户外停留时间。'
})
const ceiTone = computed(() => {
  const score = cei.value?.cei ?? 0
  if (score >= 80) return '#3c8527'
  if (score >= 60) return '#b8944d'
  if (score >= 40) return '#c56a32'
  return '#c94b3e'
})
const overviewMetrics = computed(() => [
  ['体感', `${rounded(current.value?.feelsLike)}°C`],
  ['云量', `${rounded(current.value?.cloudCover)}%`],
  ['降水', `${rounded(current.value?.precipitationProbability)}%`],
  ['湿度', `${rounded(current.value?.humidity)}%`],
  ['风速', `${rounded((current.value?.wind ?? 0) * 3.6)} km/h`],
  ['阵风', `${rounded((current.value?.windGust ?? 0) * 3.6)} km/h`],
  ['气压', `${rounded(current.value?.pressure)} hPa`],
  ['AQI', `${rounded(aqiSummary.value.value)} ${aqiSummary.value.label}`],
])
const detailMetrics = computed(() => {
  if (!current.value) return []
  if (isOpenWeatherSource.value) {
    return [
      ['UVI', rounded(current.value.uvi, 1), uvStatus(current.value.uvi)],
      ['能见度', `${rounded(current.value.visibility / 1000, 1)} km`, visibilityStatus(current.value.visibility)],
      ['露点', `${rounded(current.value.dewPoint)}°C`, dewPointStatus(current.value.dewPoint)],
      ['PM2.5 / PM10', `${rounded(current.value.air?.pm25, 1)} / ${rounded(current.value.air?.pm10, 1)}`, particulateStatus(current.value.air)],
    ]
  }
  return [
    ['UVI', rounded(current.value.uvi, 1), uvStatus(current.value.uvi)],
    ['能见度', `${rounded(current.value.visibility / 1000, 1)} km`, visibilityStatus(current.value.visibility)],
    ['日出 - 日落', `${formatTime(weather.value.daily[0]?.sunrise)} - ${formatTime(weather.value.daily[0]?.sunset)}`, `白昼 ${formatDurationHours(weather.value.daily[0]?.daylightDuration)}`],
    ['短波辐射', `${rounded(current.value.radiation)} W/m²`, radiationStatus(current.value.radiation)],
  ]
})
const minutePanelTitle = computed(() => {
  if (isOpenWeatherSource.value) return '未来 60 分钟降水表'
  return '未来 4 小时趋势表'
})
const minutePanelSubtitle = computed(() => {
  if (isOpenWeatherSource.value) return '1 分钟步长 · 降水量'
  return '15 分钟步长 · 温度与降水'
})
const minuteHasPrecipitation = computed(() => (weather.value?.minutely || []).some((item) => Number(item.precipitation) > 0))
const hourlyStepLabel = computed(() => formatStepLabel(stepMinutes(weather.value?.hourly)))
const weatherDebug = computed(() => weather.value?.debug || null)
const debugSeriesRows = computed(() => (weatherDebug.value?.series || []).map(formatDebugSeries))
const debugRequests = computed(() => (weatherDebug.value?.requests || []).map(formatDebugRequest))
watch(darkMode, (value) => {
  document.documentElement.dataset.theme = value ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value ? '#141C17' : '#EFEDDB')
  drawRoadBackdrop()
  renderMinuteChart()
  updateLeafletMap()
}, { immediate: true })

watch(themeMode, (value) => {
  localStorage.setItem('mc-weather-theme', value)
})

watch(autoRefresh, (value) => {
  localStorage.setItem('mc-weather-auto-refresh', String(value))
  setupAutoRefresh()
})

watch(refreshMinutes, (value) => {
  localStorage.setItem('mc-weather-refresh-minutes', String(value))
  setupAutoRefresh()
})

watch(owmApiKey, (value) => {
  localStorage.setItem('mc-weather-owm-key', value.trim())
  updateLeafletMap()
})

watch(useOpenWeatherData, (value) => {
  localStorage.setItem('mc-weather-use-openweather', String(value))
  if (owmApiKey.value.trim()) refreshWeather()
})

watch(owmLayer, (value) => {
  localStorage.setItem('mc-weather-owm-layer', value)
  updateLeafletMap()
})

watch(skinUrl, (value) => {
  const normalized = value.trim() || DEFAULT_SKIN
  localStorage.setItem('mc-weather-skin-url', normalized)
})

watch(skinSlim, (value) => {
  localStorage.setItem('mc-weather-skin-slim', String(value))
})

watch(skinSecondLayer, (value) => {
  localStorage.setItem('mc-weather-skin-second-layer', String(value))
})

watch(skinAutoRotate, (value) => {
  localStorage.setItem('mc-weather-skin-auto-rotate', String(value))
})

watch(skinPose, (value) => {
  localStorage.setItem('mc-weather-skin-pose', value)
})

watch(query, (value) => {
  clearTimeout(searchTimer)
  searchMiss.value = false
  if (value.trim().length < 2) {
    places.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      places.value = await searchPlaces(value.trim(), openWeatherOptions.value)
    } catch (err) {
      error.value = err.message
    }
  }, 320)
})

watch([activeTab, weather, darkMode], () => scheduleMinuteChart())
watch(current, () => scheduleLeafletMap())
watch(selectedPlace, () => {
  nextTick(() => {
    updateLeafletMap()
    loadRoadNetwork()
  })
}, { deep: true })

onMounted(() => {
  themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  themeChangeHandler = (event) => {
    prefersDark.value = event.matches
  }
  themeMediaQuery.addEventListener?.('change', themeChangeHandler)
  themeMediaQuery.addListener?.(themeChangeHandler)
  window.addEventListener('keydown', handleGlobalShortcut)
  loadInitialWeather()
  setupAutoRefresh()
  resizeObserver = new ResizeObserver(() => {
    viewportWidth.value = window.innerWidth
    drawRoadBackdrop()
  })
  resizeObserver.observe(document.body)
  nextTick(() => {
    drawRoadBackdrop()
    initLeafletMap()
  })
})

onBeforeUnmount(() => {
  clearInterval(refreshTimer)
  window.clearTimeout(licenseClickTimer)
  minuteChart?.destroy()
  hourlyChart?.destroy()
  windChart?.destroy()
  resizeObserver?.disconnect()
  leafletMap?.remove()
  window.removeEventListener('keydown', handleGlobalShortcut)
  if (themeMediaQuery && themeChangeHandler) {
    themeMediaQuery.removeEventListener?.('change', themeChangeHandler)
    themeMediaQuery.removeListener?.(themeChangeHandler)
  }
})

function handleGlobalShortcut(event) {
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    debugModalOpen.value = true
  }
}

function handleLicenseDebugClick() {
  window.clearTimeout(licenseClickTimer)
  licenseClickCount += 1
  if (licenseClickCount >= 5) {
    licenseClickCount = 0
    debugModalOpen.value = true
    return
  }
  licenseClickTimer = window.setTimeout(() => {
    licenseClickCount = 0
  }, 1500)
}

async function refreshWeather(place = selectedPlace.value) {
  loading.value = true
  error.value = ''
  try {
    selectedPlace.value = place
    weather.value = await loadWeather(place, openWeatherOptions.value)
    scheduleLeafletMap()
    loadRoadNetwork()
  } catch (err) {
    error.value = err.message || '天气数据加载失败'
  } finally {
    loading.value = false
  }
}

async function loadInitialWeather() {
  if (savedDefaultPlace.value) {
    await refreshWeather(savedDefaultPlace.value)
    return
  }
  await refreshWeatherFromCurrentLocation({ fallback: true, silentFallback: true })
}

function choosePlace(place) {
  query.value = ''
  places.value = []
  searchMiss.value = false
  refreshWeather(place)
}

async function chooseFirstPlace() {
  const term = query.value.trim()
  if (places.value.length) {
    choosePlace(places.value[0])
    return
  }
  if (term.length >= 2) {
    try {
      places.value = await searchPlaces(term, openWeatherOptions.value)
      if (places.value.length) choosePlace(places.value[0])
      else searchMiss.value = true
    } catch (err) {
      error.value = err.message || '地点搜索失败'
    }
  }
}

async function useMyLocation() {
  if (!navigator.geolocation) {
    error.value = '当前浏览器不支持定位'
    return
  }
  await refreshWeatherFromCurrentLocation({ fallback: false })
}

async function refreshWeatherFromCurrentLocation({ fallback = false, silentFallback = false } = {}) {
  if (!navigator.geolocation) {
    if (fallback) await refreshWeather(DEFAULT_PLACE)
    return
  }
  locating.value = true
  error.value = ''
  try {
    const position = await getCurrentPosition()
    const latitude = Number(position.coords.latitude.toFixed(4))
    const longitude = Number(position.coords.longitude.toFixed(4))
    try {
      await refreshWeather(await reverseGeocodePlace(latitude, longitude, openWeatherOptions.value))
    } catch {
      await refreshWeather({ name: '当前位置', country: '', latitude, longitude, timezone: 'auto' })
    }
  } catch (err) {
    if (fallback) {
      if (!silentFallback) error.value = err.message || '定位失败，已使用默认地点'
      await refreshWeather(DEFAULT_PLACE)
    } else {
      error.value = err.message || '定位失败'
    }
  } finally {
    locating.value = false
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 300000 },
    )
  })
}

function saveDefaultPlace() {
  const place = {
    name: selectedPlace.value.name,
    admin1: selectedPlace.value.admin1 || '',
    admin2: selectedPlace.value.admin2 || '',
    country: selectedPlace.value.country || '',
    latitude: Number(selectedPlace.value.latitude),
    longitude: Number(selectedPlace.value.longitude),
    timezone: selectedPlace.value.timezone || 'auto',
  }
  savedDefaultPlace.value = place
  localStorage.setItem(DEFAULT_PLACE_KEY, JSON.stringify(place))
}

function clearDefaultPlace() {
  savedDefaultPlace.value = null
  localStorage.removeItem(DEFAULT_PLACE_KEY)
}

function openSkinModal() {
  skinModalOpen.value = true
}

function resetSkin() {
  skinUrl.value = DEFAULT_SKIN
  skinSlim.value = false
  skinSecondLayer.value = true
  skinAutoRotate.value = false
  skinPose.value = 'walk'
}

function chooseSkinFile() {
  skinFileInput.value?.click()
}

function handleSkinFileChange(event) {
  const [file] = event.target.files || []
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    skinUrl.value = String(reader.result || DEFAULT_SKIN)
  }
  reader.onerror = () => {
    error.value = '皮肤文件读取失败'
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

function handleSkinError() {
  error.value = '皮肤图片加载失败，已恢复默认皮肤'
  skinUrl.value = DEFAULT_SKIN
}

function playUiSound(type = 'click') {
  try {
    playSound(type)
  } catch {
    // Audio can be blocked before the first user gesture.
  }
}

function clearSearch() {
  playUiSound()
  query.value = ''
  places.value = []
  searchMiss.value = false
}

function hideMinuteTooltip() {
  minuteTooltip.value = { ...minuteTooltip.value, visible: false }
}

function chartTheme() {
  const isDark = darkMode.value
  return {
    text: isDark ? '#f4f1e8' : '#202326',
    grid: isDark ? 'rgba(244,241,232,.14)' : 'rgba(32,35,38,.18)',
  }
}

function validNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function chartUnit(label) {
  if (label === '降水' || label.includes('RAIN')) return 'mm'
  if (label === '风速' || label === '阵风' || label.includes('WIND') || label.includes('GUST')) return 'km/h'
  if (label.includes('湿度') || label.includes('云量') || label.includes('概率') || label.includes('HUMID') || label.includes('CLOUD') || label.includes('POP')) return '%'
  return '°C'
}

function chartLabel(label) {
  return {
    'TEMP C': '温度',
    'FEELS C': '体感',
    'RAIN mm': '降水',
    'WIND km/h': '风速',
    'GUST km/h': '阵风',
  }[label] || label
}

function chartValue(label, value) {
  if (!Number.isFinite(value)) return '--'
  const unit = chartUnit(label)
  const precision = unit === 'mm' || unit === '°C' ? 1 : 0
  return `${rounded(value, precision)} ${unit}`
}

function chartLegendText(label) {
  return `${chartLabel(label)} ${chartUnit(label)}`
}

function chartFontFamily() {
  return '"Minecraft Seven", "Noto Sans SC", "Microsoft YaHei", sans-serif'
}

function resizeChartCanvas(canvas, minHeight = 240) {
  const wrap = canvas?.parentElement
  if (!canvas || !wrap) return
  canvas.width = Math.max(320, Math.floor(wrap.clientWidth))
  canvas.height = Math.max(minHeight, Math.floor(wrap.clientHeight))
}

function chartTooltip(chartId) {
  return {
    enabled: false,
    mode: 'index',
    axis: 'x',
    intersect: false,
    external: ({ chart, tooltip }) => {
      if (!tooltip || tooltip.opacity === 0) {
        hideMinuteTooltip()
        return
      }

      const points = (tooltip.dataPoints || [])
        .filter((point) => Number.isFinite(point.parsed?.y))
        .sort((a, b) => a.datasetIndex - b.datasetIndex)
      if (!points.length) {
        hideMinuteTooltip()
        return
      }

      const rect = chart.canvas.getBoundingClientRect()
      const wrapRect = chart.canvas.parentElement.getBoundingClientRect()
      const x = rect.left - wrapRect.left + tooltip.caretX
      const y = rect.top - wrapRect.top + tooltip.caretY
      const estimatedWidth = 174
      const placement = x + estimatedWidth + 18 > wrapRect.width && x > estimatedWidth + 18 ? 'left' : 'right'
      minuteTooltip.value = {
        visible: true,
        chartId,
        x,
        y,
        placement,
        title: tooltip.title?.[0] || '',
        items: points.map((point) => ({
          label: chartLabel(point.dataset.label),
          value: chartValue(point.dataset.label, point.parsed.y),
          color: point.dataset.borderColor || point.dataset.backgroundColor || '#3c8527',
        })),
      }
    },
  }
}

function chartOptions(chartId, scales) {
  const { text, grid } = chartTheme()
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 180 },
    interaction: { mode: 'index', axis: 'x', intersect: false },
    events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
    plugins: {
      legend: {
        labels: {
          color: text,
          boxWidth: 16,
          boxHeight: 12,
          font: { family: chartFontFamily() },
          generateLabels(chart) {
            return Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => ({
              ...item,
              text: chartLegendText(item.text),
            }))
          },
        },
      },
      tooltip: chartTooltip(chartId),
    },
    scales: {
      x: {
        type: 'category',
        axis: 'x',
        ticks: {
          color: text,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
          font: { family: chartFontFamily() },
        },
        grid: { color: grid },
      },
      ...scales,
    },
  }
}

function tempAxis() {
  const { text, grid } = chartTheme()
  return {
    type: 'linear',
    axis: 'y',
    ticks: { color: text, font: { family: chartFontFamily() } },
    grid: { color: grid },
  }
}

function secondaryAxis(position = 'right') {
  const { text } = chartTheme()
  return {
    type: 'linear',
    axis: 'y',
    position,
    beginAtZero: true,
    ticks: { color: text, font: { family: chartFontFamily() } },
    grid: { drawOnChartArea: false },
  }
}

function zoomMap(delta) {
  playUiSound()
  if (!leafletMap) return
  if (delta > 0) leafletMap.zoomIn()
  else leafletMap.zoomOut()
}

function cycleOwmLayer() {
  playUiSound()
  const currentIndex = owmLayerOptions.findIndex((item) => item.value === owmLayer.value)
  owmLayer.value = owmLayerOptions[(currentIndex + 1) % owmLayerOptions.length].value
}

function loadSavedDefaultPlace() {
  const raw = localStorage.getItem(DEFAULT_PLACE_KEY)
  if (!raw) return null
  try {
    const place = JSON.parse(raw)
    if (!Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return null
    return { ...place, latitude: Number(place.latitude), longitude: Number(place.longitude), timezone: place.timezone || 'auto' }
  } catch {
    localStorage.removeItem(DEFAULT_PLACE_KEY)
    return null
  }
}

function setupAutoRefresh() {
  clearInterval(refreshTimer)
  if (!autoRefresh.value) return
  const minutes = Math.max(5, Math.min(60, Number(refreshMinutes.value) || 15))
  refreshTimer = setInterval(() => refreshWeather(), minutes * 60 * 1000)
}

function scheduleMinuteChart() {
  window.setTimeout(() => renderMinuteChart(), 320)
}

function scheduleLeafletMap() {
  window.setTimeout(async () => {
    await nextTick()
    initLeafletMap()
    updateLeafletMap()
  }, 520)
}

function initLeafletMap() {
  if (!mapElement.value) return
  if (leafletMap && mapHost === mapElement.value) return
  if (leafletMap) {
    leafletMap.remove()
    leafletMap = null
    baseLayer = null
    weatherLayer = null
    locationMarker = null
    mapPickMarker = null
    mapPickPlace = null
  }
  mapHost = mapElement.value
  const lat = Number(selectedPlace.value.latitude || DEFAULT_PLACE.latitude)
  const lon = Number(selectedPlace.value.longitude || DEFAULT_PLACE.longitude)
  leafletMap = L.map(mapElement.value, {
    zoomControl: false,
    attributionControl: false,
  }).setView([lat, lon], 7)
  L.control.attribution({ prefix: false }).addTo(leafletMap)
  leafletMap.on('click', handleMapClick)
  leafletMap.on('popupopen', bindMapPopupAction)
  updateLeafletMap()
}

function updateLeafletMap() {
  if (!leafletMap) return
  const lat = Number(selectedPlace.value.latitude || DEFAULT_PLACE.latitude)
  const lon = Number(selectedPlace.value.longitude || DEFAULT_PLACE.longitude)
  leafletMap.setView([lat, lon], leafletMap.getZoom() || 7)

  if (baseLayer) leafletMap.removeLayer(baseLayer)
  const baseUrl = darkMode.value
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  baseLayer = L.tileLayer(baseUrl, {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  }).addTo(leafletMap)

  if (weatherLayer) {
    leafletMap.removeLayer(weatherLayer)
    weatherLayer = null
  }
  if (owmApiKey.value.trim()) {
    weatherLayer = L.tileLayer(`https://tile.openweathermap.org/map/${owmLayer.value}/{z}/{x}/{y}.png?appid=${owmApiKey.value.trim()}`, {
      opacity: 0.72,
      maxZoom: 19,
      attribution: '&copy; OpenWeatherMap',
    }).addTo(leafletMap)
  }

  if (locationMarker) leafletMap.removeLayer(locationMarker)
  locationMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'square-map-marker',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
  }).addTo(leafletMap)
  window.setTimeout(() => leafletMap.invalidateSize(), 80)
}

async function handleMapClick(event) {
  if (!leafletMap || !event?.latlng) return
  const latitude = Number(event.latlng.lat.toFixed(4))
  const longitude = Number(normalizeLongitude(event.latlng.lng).toFixed(4))
  const normalizedLatLng = L.latLng(latitude, longitude)
  const pendingPlace = { name: '地图选点', country: '', latitude, longitude, timezone: 'auto' }
  mapPickPlace = pendingPlace
  showMapPickPopup(normalizedLatLng, pendingPlace, true)

  try {
    const place = await reverseGeocodePlace(latitude, longitude, openWeatherOptions.value)
    mapPickPlace = { ...place, latitude, longitude }
    showMapPickPopup(normalizedLatLng, mapPickPlace, false)
  } catch {
    showMapPickPopup(normalizedLatLng, pendingPlace, false)
  }
}

function normalizeLongitude(longitude) {
  const value = Number(longitude)
  if (!Number.isFinite(value)) return 0
  return ((((value + 180) % 360) + 360) % 360) - 180
}

function showMapPickPopup(latlng, place, loadingPlace = false) {
  if (!leafletMap) return
  if (mapPickMarker) leafletMap.removeLayer(mapPickMarker)
  mapPickMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: 'square-map-marker square-map-marker--pick',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  }).addTo(leafletMap)

  const title = escapeHtml(formatPlace(place) || '地图选点')
  const coords = `${Number(place.latitude).toFixed(4)}, ${Number(place.longitude).toFixed(4)}`
  const popup = L.popup({
    className: 'map-weather-popup',
    closeButton: false,
    autoPan: true,
    offset: [0, -12],
  })
    .setLatLng(latlng)
    .setContent(`
      <div class="map-weather-popup__box">
        <strong>${title}</strong>
        <span>${coords}</span>
        <button class="map-weather-popup__button" type="button" ${loadingPlace ? 'disabled' : ''}>查看天气</button>
      </div>
    `)
  popup.openOn(leafletMap)
}

function bindMapPopupAction(event) {
  const button = event.popup?.getElement()?.querySelector('.map-weather-popup__button')
  if (!button) return
  button.addEventListener('click', () => {
    if (!mapPickPlace || button.disabled) return
    playUiSound('button')
    refreshWeather(mapPickPlace)
    leafletMap?.closePopup()
  }, { once: true })
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

async function loadRoadNetwork() {
  const lat = Number(selectedPlace.value.latitude)
  const lon = Number(selectedPlace.value.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

  const cacheKey = `roads:${lat.toFixed(2)}:${lon.toFixed(2)}`
  const cached = localStorage.getItem(cacheKey)
  if (cached) {
    try {
      roadWays.value = JSON.parse(cached)
      drawRoadBackdrop()
      return
    } catch {
      localStorage.removeItem(cacheKey)
    }
  }

  const delta = 0.045
  const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`
  const queryText = `[out:json][timeout:12];way["highway"](${bbox});out geom;`
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: queryText,
    })
    if (!res.ok) throw new Error('Overpass request failed')
    const data = await res.json()
    roadWays.value = (data.elements || [])
      .filter((item) => Array.isArray(item.geometry) && item.geometry.length > 1)
      .slice(0, 420)
      .map((item) => item.geometry.map((point) => [point.lat, point.lon]))
    localStorage.setItem(cacheKey, JSON.stringify(roadWays.value))
    drawRoadBackdrop()
  } catch {
    roadWays.value = []
    drawRoadBackdrop()
  }
}

async function renderMinuteChart() {
  if (activeTab.value !== 'minute' || !weather.value) return
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    minuteChart?.destroy()
    hourlyChart?.destroy()
    windChart?.destroy()
    minuteChart = null
    hourlyChart = null
    windChart = null

    const minutely = weather.value.minutely || []
    const hourly = weather.value.hourly || []
    if (minuteCanvas.value && minutely.length && (!isOpenWeatherSource.value || minuteHasPrecipitation.value)) {
      resizeChartCanvas(minuteCanvas.value, 260)
      const labels = minutely.map((item) => formatHour(item.time))
      const datasets = []
      if (!isOpenWeatherSource.value) {
        datasets.push({
          label: '温度',
          data: minutely.map((item) => validNumber(item.temp)),
          borderColor: '#3c8527',
          backgroundColor: 'rgba(60,133,39,.14)',
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHitRadius: 14,
          tension: 0.36,
          cubicInterpolationMode: 'monotone',
          yAxisID: 'temp',
        })
      }
      datasets.push({
        type: 'bar',
        label: '降水',
        data: minutely.map((item) => validNumber(item.precipitation)),
        borderColor: '#5fa9d8',
        backgroundColor: 'rgba(95,169,216,.42)',
        borderWidth: 2,
        borderSkipped: false,
        barPercentage: 1,
        categoryPercentage: 0.98,
        maxBarThickness: isOpenWeatherSource.value ? 24 : 56,
        yAxisID: 'rain',
      })
      minuteChart = new Chart(minuteCanvas.value, {
        type: 'line',
        data: { labels, datasets },
        options: chartOptions('minute', {
          temp: { ...tempAxis(), display: !isOpenWeatherSource.value },
          rain: secondaryAxis(isOpenWeatherSource.value ? 'left' : 'right'),
        }),
      })
    }

    if (hourlyCanvas.value && hourly.length) {
      resizeChartCanvas(hourlyCanvas.value, 240)
      hourlyChart = new Chart(hourlyCanvas.value, {
        type: 'line',
        data: {
          labels: hourly.map((item) => formatHour(item.time)),
          datasets: [
            { label: '温度', data: hourly.map((item) => validNumber(item.temp)), borderColor: '#3c8527', backgroundColor: 'rgba(60,133,39,.14)', borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 14, tension: 0.32, cubicInterpolationMode: 'monotone', yAxisID: 'temp' },
            { label: '体感', data: hourly.map((item) => validNumber(item.feelsLike)), borderColor: '#b8944d', backgroundColor: 'rgba(184,148,77,.14)', borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 14, tension: 0.32, cubicInterpolationMode: 'monotone', yAxisID: 'temp' },
          ],
        },
        options: chartOptions('hourly', { temp: tempAxis() }),
      })
    }

    if (windCanvas.value && hourly.length) {
      resizeChartCanvas(windCanvas.value, 240)
      windChart = new Chart(windCanvas.value, {
        type: 'line',
        data: {
          labels: hourly.map((item) => formatHour(item.time)),
          datasets: [
            { label: '风速', data: hourly.map((item) => validNumber(item.wind) === null ? null : item.wind * 3.6), borderColor: '#2e6f9e', backgroundColor: 'rgba(46,111,158,.14)', borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 14, tension: 0.3, cubicInterpolationMode: 'monotone', yAxisID: 'wind' },
            { label: '阵风', data: hourly.map((item) => validNumber(item.windGust) === null ? null : item.windGust * 3.6), borderColor: '#c56a32', backgroundColor: 'rgba(197,106,50,.14)', borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 14, tension: 0.3, cubicInterpolationMode: 'monotone', yAxisID: 'wind' },
          ],
        },
        options: chartOptions('wind', { wind: tempAxis() }),
      })
    }
  }))
}

function drawRoadBackdrop() {
  const canvas = roadCanvas.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const isDark = darkMode.value
  ctx.globalAlpha = isDark ? 0.56 : 0.62
  ctx.lineCap = 'square'
  const isWideCanvas = width > 1180
  const roadOffsetX = isWideCanvas ? 200 : 0
  const roadOffsetY = isWideCanvas ? -100 : -150
  // @Codex Do not change the offset here from -150 back to 0. I have manually changed it countless times, and you keep changing it back just as often!
  
  const gradient = ctx.createLinearGradient(width, 0, 0, height)
  gradient.addColorStop(0, isDark ? 'rgba(36,96,42,0.42)' : 'rgba(18,48,34,0.46)')
  gradient.addColorStop(0.52, isDark ? 'rgba(118,91,34,0.28)' : 'rgba(86,68,25,0.32)')
  gradient.addColorStop(1, isDark ? 'rgba(0,0,0,0.06)' : 'rgba(20,26,20,0.16)')
  ctx.strokeStyle = gradient

  if (roadWays.value.length) {
    const lat = Number(selectedPlace.value.latitude)
    const lon = Number(selectedPlace.value.longitude)
    const scale = Math.min(width, height) * 9
    ctx.lineWidth = 1.2
    roadWays.value.forEach((way, index) => {
      ctx.lineWidth = index % 9 === 0 ? 2.4 : 1
      ctx.beginPath()
      way.forEach(([pointLat, pointLon], pointIndex) => {
        const x = width * 0.62 + roadOffsetX + (pointLon - lon) * scale
        const y = height * 0.42 + roadOffsetY - (pointLat - lat) * scale
        if (pointIndex === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    })
    return
  }

  drawRoadFallbackSvg(ctx, width, height, roadOffsetX, roadOffsetY, isDark)
}

function drawRoadFallbackSvg(ctx, width, height, roadOffsetX, roadOffsetY, isDark) {
  if (!roadFallbackImage || roadFallbackTheme !== (isDark ? 'dark' : 'light')) {
    loadRoadFallbackSvg(isDark).then(() => drawRoadBackdrop())
    return
  }

  const sourceWidth = 2560.5
  const sourceHeight = 1347
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * 1.18
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const x = (width - drawWidth) / 2 + roadOffsetX * 0.42
  const y = (height - drawHeight) / 2 + roadOffsetY

  ctx.save()
  ctx.globalAlpha = isDark ? 0.64 : 0.52
  ctx.drawImage(roadFallbackImage, x, y, drawWidth, drawHeight)
  ctx.restore()
}

async function loadRoadFallbackSvg(isDark) {
  const theme = isDark ? 'dark' : 'light'
  if (roadFallbackImage && roadFallbackTheme === theme) return
  if (roadFallbackLoading && roadFallbackLoadingTheme === theme) return roadFallbackLoading

  roadFallbackLoadingTheme = theme
  roadFallbackLoading = fetch(assetUrl('kennedy-town.svg'))
    .then((response) => response.text())
    .then((svg) => {
      const themedSvg = svg
        .replace(/<rect id="background"[^>]*>/, '<rect id="background" fill="transparent" x="0" y="0" width="2560.5" height="1347"></rect>')
        .replace(/<g id="lines"[^>]*>/, `<g id="lines" fill="none" stroke-width="${isDark ? 1.05 : 0.95}" stroke="${isDark ? '#9fb196' : '#4c574d'}" stroke-opacity="${isDark ? 0.58 : 0.46}">`)
      return new Promise((resolve, reject) => {
        const image = new Image()
        const url = URL.createObjectURL(new Blob([themedSvg], { type: 'image/svg+xml' }))
        image.onload = () => {
          URL.revokeObjectURL(url)
          roadFallbackImage = image
          roadFallbackTheme = theme
          resolve()
        }
        image.onerror = () => {
          URL.revokeObjectURL(url)
          reject(new Error('Unable to load road fallback SVG'))
        }
        image.src = url
      })
    })
    .catch(() => {
      roadFallbackImage = null
      roadFallbackTheme = ''
    })
    .finally(() => {
      roadFallbackLoading = null
      roadFallbackLoadingTheme = ''
    })

  return roadFallbackLoading
}

function formatPlace(place) {
  return [place.name, place.admin2, place.admin1, place.country].filter(Boolean).filter(unique).join(' · ')
}

function unique(value, index, list) {
  return list.indexOf(value) === index
}

function formatHour(time) {
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function stepMinutes(rows = []) {
  if (!rows || rows.length < 2) return null
  const first = new Date(rows[0].time).getTime()
  const second = new Date(rows[1].time).getTime()
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  return Math.round((second - first) / 60000)
}

function formatStepLabel(minutes) {
  if (!minutes) return '未知步长'
  if (minutes < 60) return `${minutes} 分钟步长`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : rounded(hours, 1)} 小时步长`
}

function decodeDebugPart(value) {
  const text = String(value ?? '')
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    return text
  }
}

function formatDebugRequest(request) {
  try {
    const url = new URL(request.url)
    return {
      ...request,
      origin: url.origin,
      path: decodeDebugPart(url.pathname),
      endpoint: `${url.origin}${decodeDebugPart(url.pathname)}`,
      params: [...url.searchParams.entries()].map(([key, value]) => ({
        key: decodeDebugPart(key),
        value: decodeDebugPart(value),
      })),
    }
  } catch {
    const decodedUrl = decodeDebugPart(request.url)
    return {
      ...request,
      origin: '',
      path: decodedUrl,
      endpoint: decodedUrl,
      params: [],
    }
  }
}

function formatDebugTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatDebugSeries(series) {
  return {
    ...series,
    stepLabel: formatStepLabel(series.stepMinutes),
    firstLabel: formatDebugTime(series.first),
    lastLabel: formatDebugTime(series.last),
  }
}

function formatDay(time) {
  return new Date(time).toLocaleDateString('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' })
}

function formatForecastDate(time) {
  return new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function formatForecastWeek(time) {
  return new Date(time).toLocaleDateString('zh-CN', { weekday: 'short' })
}

function formatTime(time) {
  if (!time) return '--'
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatAlertRange(alert) {
  if (!alert.start && !alert.end) return '时间待确认'
  return `${formatTime(alert.start)} - ${formatTime(alert.end)}`
}

function formatDurationHours(seconds) {
  return Number.isFinite(seconds) ? `${(seconds / 3600).toFixed(1)} h` : '--'
}

function uvStatus(value) {
  if (!Number.isFinite(value)) return '紫外线 --'
  if (value < 3) return '紫外线较低'
  if (value < 6) return '紫外线中等'
  if (value < 8) return '紫外线偏强'
  return '紫外线很强'
}

function visibilityStatus(value) {
  const km = Number(value) / 1000
  if (!Number.isFinite(km)) return '能见度 --'
  if (km >= 10) return '能见度良好'
  if (km >= 4) return '能见度一般'
  return '能见度偏低'
}

function dewPointStatus(value) {
  if (!Number.isFinite(value)) return '露点 --'
  if (value >= 24) return '闷热潮湿'
  if (value >= 18) return '湿度体感明显'
  if (value <= 5) return '空气偏干'
  return '湿度体感适中'
}

function particulateStatus(air = {}) {
  const pm25 = Number(air.pm25)
  const pm10 = Number(air.pm10)
  if (!Number.isFinite(pm25) && !Number.isFinite(pm10)) return '颗粒物 --'
  if (pm25 >= 35 || pm10 >= 100) return '颗粒物偏高'
  if (pm25 >= 15 || pm10 >= 50) return '颗粒物一般'
  return '颗粒物较低'
}

function radiationStatus(value) {
  if (!Number.isFinite(value)) return '辐射 --'
  if (value >= 650) return '日照很强'
  if (value >= 300) return '日照中等'
  if (value > 0) return '日照偏弱'
  return '夜间或无直射'
}

function formatDirection(degrees) {
  if (!Number.isFinite(degrees)) return '--'
  return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(degrees / 45) % 8]
}

function rounded(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}
</script>

<template>
  <canvas ref="roadCanvas" class="road-backdrop" aria-hidden="true"></canvas>

  <main class="app-shell">
    <header class="brand-header">
      <div class="brand-title-row">
        <div class="brand-skin" aria-hidden="true">
          <McSkinViewer
            :skin="activeSkin"
            :slim="skinSlim"
            :scale="skinScale"
            :show-second-layer="skinSecondLayer"
            :pose="skinPose"
            :auto-rotate="skinAutoRotate"
            :interactive="true"
            :yaw="-18"
            :pitch="8"
            background="transparent"
            @error="handleSkinError"
          />
        </div>
        <h1><span class="brand-title-texture">Mc</span> Weather</h1>
      </div>
    </header>

    <section class="control-card" :class="{ 'is-settings': controlPage === 'settings' }">
      <Transition name="fade" mode="out-in">
        <div v-if="controlPage === 'location'" key="location" class="control-section control-location">
          <header class="control-card__header">
            <div class="place-hero">
              <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
              <div>
                <strong>{{ placeTitle }}</strong>
                <small>{{ placeMeta }} · 更新 {{ nowDisplay }}</small>
              </div>
            </div>

            <div class="control-actions">
              <button class="square-action" type="button" :disabled="loading" @click="playUiSound('button'); refreshWeather()" aria-label="刷新">
                <McTooltip content="刷新" placement="top">
                  <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
                </McTooltip>
              </button>
              <button class="square-action" type="button" @click="playUiSound(); controlPage = 'settings'" aria-label="设置">
                <McTooltip content="设置" placement="top">
                  <span class="material-symbols-outlined" aria-hidden="true">tune</span>
                </McTooltip>
              </button>
            </div>
          </header>

          <div class="control-card__body">
            <div class="search-row">
              <div class="search-box" :class="{ 'is-error': searchMiss }">
                <span class="material-symbols-outlined" aria-hidden="true">search</span>
                <input
                  v-model="query"
                  type="text"
                  :placeholder="searchMiss ? '找不到位置，请换个关键词' : '搜索城市、地区或邮编'"
                  @keydown.enter="chooseFirstPlace"
                />
                <button class="clear-action" :class="{ 'is-hidden': !query }" type="button" @click="clearSearch" aria-label="清除搜索">
                  <McTooltip content="清除搜索" placement="bottom">
                    <span class="material-symbols-outlined" aria-hidden="true">close</span>
                  </McTooltip>
                </button>
                <button class="square-action inline-action" type="button" :disabled="locating" @click="playUiSound(); useMyLocation()" aria-label="定位">
                  <McTooltip content="定位" placement="bottom">
                    <span class="material-symbols-outlined" aria-hidden="true">my_location</span>
                  </McTooltip>
                </button>
                <button class="square-action inline-action" type="button" @click="playUiSound('button'); chooseFirstPlace()" aria-label="搜索">
                  <McTooltip content="搜索" placement="bottom">
                    <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                  </McTooltip>
                </button>
              </div>

              <Transition name="fade">
                <div v-if="places.length" class="place-results">
                  <button v-for="place in places" :key="place.id" type="button" @click="choosePlace(place)">
                    <strong>{{ formatPlace(place) }}</strong>
                    <span>{{ place.latitude.toFixed(3) }}, {{ place.longitude.toFixed(3) }}</span>
                  </button>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <div v-else key="settings" class="control-section settings-content">
          <header class="control-card__header">
            <div class="place-hero">
              <span class="material-symbols-outlined" aria-hidden="true">tune</span>
              <div>
                <strong>设置</strong>
              </div>
            </div>
            <button class="square-action settings-back" type="button" @click="playUiSound('close'); controlPage = 'location'" aria-label="返回">
              <McTooltip content="返回" placement="left">
                <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
              </McTooltip>
            </button>
          </header>

          <div class="control-card__body settings-body">
            <div class="setting-row default-place-row">
              <span>默认位置</span>
              <div class="setting-actions">
                <strong class="default-place-value">{{ defaultPlaceTitle }}</strong>
                <button class="square-action" type="button" @click="playUiSound('button'); saveDefaultPlace()" aria-label="保存当前地点">
                  <McTooltip content="保存当前地点" placement="bottom">
                    <span class="material-symbols-outlined" aria-hidden="true">bookmark_add</span>
                  </McTooltip>
                </button>
                <button class="square-action" type="button" :disabled="!savedDefaultPlace" @click="playUiSound(); clearDefaultPlace()" aria-label="清除默认地点">
                  <McTooltip content="清除默认地点" placement="bottom">
                    <span class="material-symbols-outlined" aria-hidden="true">bookmark_remove</span>
                  </McTooltip>
                </button>
              </div>
            </div>
            <div class="setting-row theme-mode-row">
              <span>颜色模式</span>
              <McRadioGroup v-model="themeMode" :options="themeOptions" />
            </div>
            <div class="setting-row skin-row">
              <span>角色皮肤</span>
              <McButton icon="mc-players" @click="openSkinModal">编辑角色</McButton>
            </div>
            <label class="setting-row">
              <span>自动刷新</span>
              <McSwitch v-model="autoRefresh" />
            </label>
            <label class="setting-row">
              <span>刷新间隔</span>
              <McDropdown v-model="refreshOptionIndex" :options="refreshOptions" />
            </label>
            <label class="setting-row api-row">
              <span>OWM Key</span>
              <input v-model="owmApiKey" type="password" placeholder="OpenWeatherMap API Key" />
            </label>
            <label class="setting-row">
              <span>优先使用 OWM 数据</span>
              <McSwitch v-model="useOpenWeatherData" :disabled="!owmApiKey.trim()" />
            </label>
          </div>
        </div>
      </Transition>
    </section>

    <Transition name="fade">
      <p v-if="error" class="error-line">{{ error }}</p>
    </Transition>

    <Transition name="slide-fade">
      <section v-if="current && displayedWeatherAlerts.length" class="weather-alerts">
        <article v-for="alert in displayedWeatherAlerts" :key="alert.id" class="weather-alert">
          <div>
            <span class="material-symbols-outlined" aria-hidden="true">warning</span>
            <strong>{{ alert.title }}</strong>
          </div>
          <p>{{ alert.description || '当前位置存在天气警报，请留意官方更新并调整出行安排。' }}</p>
          <small>{{ alert.sender }} · {{ formatAlertRange(alert) }}</small>
        </article>
      </section>
    </Transition>

    <Transition name="slide-fade" mode="out-in">
      <section v-if="current" :key="selectedPlace.name + current.time" class="hero-grid">
        <McPanel class="current-panel" title="CURRENT" bordered elevated>
          <div class="current-metrics">
            <div class="condition-block">
              <div class="weather-icon">
                <McIcon class="weather-icon__glyph" :name="weatherIcon" :size="52" :pixel-size="24" color="#f4f1e8" />
              </div>
              <p class="condition">{{ current.label }}</p>
            </div>
            <div class="temp-stack">
              <span class="temp">{{ rounded(current.temp) }}°</span>
            </div>
          </div>
          <p class="current-brief">{{ currentBrief }}</p>
          <div class="quick-grid">
            <span v-for="item in overviewMetrics" :key="item[0]">{{ item[0] }} <b>{{ item[1] }}</b></span>
          </div>
        </McPanel>

        <McPanel class="cei-panel" title="CEI INDEX" :style="{ '--cei-tone': ceiTone }" bordered elevated>
          <div class="cei-card">
            <div class="cei-score" :style="{ '--score': cei.cei }">
              <span>{{ cei.cei }}</span>
            </div>
            <div class="cei-summary">
              <p class="cei-level-title">{{ ceiLevelTitle }}</p>
              <p v-if="ceiLevelDescription">{{ ceiLevelDescription }}</p>
              <p>主要影响：{{ mainEffect }}</p>
            </div>
            <p v-if="!riskFactors.length" class="current-brief cei-brief">{{ ceiAdvice }}</p>
            <div v-else class="tag-row">
              <span v-for="tag in riskFactors" :key="tag">{{ tag }}</span>
            </div>
            <div class="cei-score-bars">
              <div v-for="(value, key) in cei.components" :key="key" class="mini-progress-row">
                <span>{{ { heat: '热舒适', air: '空气', uv: '紫外线', pressure: '气压', risk: '风险' }[key] }}</span>
                <McProgress :value="value" :show-value="false" />
                <b>{{ value }}</b>
              </div>
            </div>
          </div>
        </McPanel>

        <McPanel class="radar-panel" title="RADAR MAP" bordered elevated>
          <div class="leaflet-map-wrap">
            <div class="radar-map-controls">
              <button type="button" aria-label="放大地图" @click="zoomMap(1)">
                <span aria-hidden="true">+</span>
              </button>
              <button type="button" aria-label="缩小地图" @click="zoomMap(-1)">
                <span aria-hidden="true">−</span>
              </button>
              <button
                type="button"
                :disabled="!owmApiKey"
                :aria-label="`切换图层：${currentOwmLayerLabel}`"
                @click="cycleOwmLayer"
              >
                <McTooltip :content="`图层：${currentOwmLayerLabel}`" placement="right">
                  <span class="material-symbols-outlined" aria-hidden="true">layers</span>
                </McTooltip>
              </button>
            </div>
            <div ref="mapElement" class="leaflet-map"></div>
            <p v-if="!owmApiKey" class="map-note">
              在设置里输入 OWM Key 后启用 OpenWeatherMap 图层。
              <a href="https://openweathermap.org/api" target="_blank" rel="noreferrer">获取 API Key</a>
            </p>
          </div>
        </McPanel>
      </section>

      <section v-else class="loading-state">
        <div class="loader">
          <img id="spinner_img" :src="loadingSpinnerSrc" alt="" />
        </div>
        <p>正在加载天气数据</p>
      </section>
    </Transition>

    <McButtonTabs v-model="activeTab" :items="tabs" class="tabs" />

    <Transition name="slide-fade" mode="out-in">
      <section v-if="activeTab === 'current' && current" key="current" class="content-grid">
        <McPanel v-for="item in detailMetrics" :key="item[0]" :title="item[0]" :subtitle="item[2]" bordered>
          <p class="metric-value">{{ item[1] }}</p>
        </McPanel>
      </section>

      <section v-else-if="activeTab === 'minute' && weather" key="minute" class="chart-panel">
        <McPanel v-if="weather.minutely?.length" :title="minutePanelTitle" :subtitle="minutePanelSubtitle" bordered>
          <div v-if="!isOpenWeatherSource || minuteHasPrecipitation" class="chart-wrap" @mouseleave="hideMinuteTooltip">
            <canvas ref="minuteCanvas"></canvas>
            <div
              v-if="minuteTooltip.visible && minuteTooltip.chartId === 'minute'"
              class="chart-tooltip-panel"
              :class="{ 'is-left': minuteTooltip.placement === 'left' }"
              :style="{ left: `${minuteTooltip.x}px`, top: `${minuteTooltip.y}px` }"
            >
              <strong>{{ minuteTooltip.title }}</strong>
              <span v-for="item in minuteTooltip.items" :key="item.label" class="chart-tooltip-row">
                <i :style="{ backgroundColor: item.color }"></i>
                <b>{{ item.label }}</b>
                <em>{{ item.value }}</em>
              </span>
            </div>
          </div>
          <p v-else class="chart-empty">未来 60 分钟无明显降水。</p>
        </McPanel>
        <McPanel v-if="weather.hourly?.length" title="未来 48 小时温度表" :subtitle="`${hourlyStepLabel} · 气温与体感`" bordered>
          <div class="chart-wrap chart-wrap--compact" @mouseleave="hideMinuteTooltip">
            <canvas ref="hourlyCanvas"></canvas>
            <div
              v-if="minuteTooltip.visible && minuteTooltip.chartId === 'hourly'"
              class="chart-tooltip-panel"
              :class="{ 'is-left': minuteTooltip.placement === 'left' }"
              :style="{ left: `${minuteTooltip.x}px`, top: `${minuteTooltip.y}px` }"
            >
              <strong>{{ minuteTooltip.title }}</strong>
              <span v-for="item in minuteTooltip.items" :key="item.label" class="chart-tooltip-row">
                <i :style="{ backgroundColor: item.color }"></i>
                <b>{{ item.label }}</b>
                <em>{{ item.value }}</em>
              </span>
            </div>
          </div>
        </McPanel>
        <McPanel v-if="weather.hourly?.length" title="未来 48 小时风力表" :subtitle="`${hourlyStepLabel} · 风速与阵风`" bordered>
          <div class="chart-wrap chart-wrap--compact" @mouseleave="hideMinuteTooltip">
            <canvas ref="windCanvas"></canvas>
            <div
              v-if="minuteTooltip.visible && minuteTooltip.chartId === 'wind'"
              class="chart-tooltip-panel"
              :class="{ 'is-left': minuteTooltip.placement === 'left' }"
              :style="{ left: `${minuteTooltip.x}px`, top: `${minuteTooltip.y}px` }"
            >
              <strong>{{ minuteTooltip.title }}</strong>
              <span v-for="item in minuteTooltip.items" :key="item.label" class="chart-tooltip-row">
                <i :style="{ backgroundColor: item.color }"></i>
                <b>{{ item.label }}</b>
                <em>{{ item.value }}</em>
              </span>
            </div>
          </div>
        </McPanel>
      </section>

      <section v-else-if="activeTab === 'forecast' && weather" key="forecast" class="forecast-grid">
        <article v-for="day in weather.daily" :key="day.time" class="forecast-card">
          <div class="forecast-head">
            <div class="forecast-day">
              <time>
                <span>{{ formatForecastDate(day.time) }}</span>
                <b>{{ formatForecastWeek(day.time) }}</b>
              </time>
              <strong>{{ day.label }}</strong>
            </div>
            <div class="forecast-temp">
              <span>{{ rounded(day.tempMin) }}°</span>
              <i></i>
              <span>{{ rounded(day.tempMax) }}°</span>
            </div>
          </div>

          <div class="forecast-groups">
            <div class="forecast-group">
              <b>体感</b>
              <span>{{ rounded(day.feelsMin) }}° / {{ rounded(day.feelsMax) }}°</span>
            </div>
            <div class="forecast-group">
              <b>降水</b>
              <span>{{ rounded(day.precipitation, 1) }} mm · {{ rounded(day.precipitationProbability) }}%</span>
              <small>{{ Number.isFinite(day.precipitationHours) ? `${rounded(day.precipitationHours, 1)} h` : '雨雪量 / 概率' }}</small>
            </div>
            <div class="forecast-group">
              <b>风</b>
              <span>{{ rounded(day.windMax) }} km/h</span>
              <small>{{ formatDirection(day.windDirection) }} · 阵风 {{ rounded(day.windGustMax) }}</small>
            </div>
            <div class="forecast-group">
              <b>天光</b>
              <span>UV {{ rounded(day.uvMax, 1) }}</span>
              <small>{{ isOpenWeatherSource ? `云量 ${rounded(day.cloudCover)}%` : `日照 ${formatDurationHours(day.sunshineDuration)}` }}</small>
            </div>
          </div>

          <div class="sun-cycle" aria-label="日出日落">
            <svg viewBox="0 0 220 70" aria-hidden="true">
              <path class="sun-cycle__ground" d="M18 56 H202" />
              <path class="sun-cycle__arc" d="M26 56 C68 8 152 8 194 56" />
            </svg>
            <span class="sun-cycle__icon sun-cycle__icon--sun material-symbols-outlined">wb_sunny</span>
            <span class="sun-cycle__icon sun-cycle__icon--moon material-symbols-outlined">dark_mode</span>
            <div class="sun-cycle__time sun-cycle__time--rise">
              <b>日出</b>
              <span>{{ formatTime(day.sunrise) }}</span>
            </div>
            <div class="sun-cycle__time sun-cycle__time--set">
              <b>日落</b>
              <span>{{ formatTime(day.sunset) }}</span>
            </div>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'advice' && cei" key="advice" class="advice-grid">
        <McPanel title="天气建议" subtitle="按当前天气自动生成" bordered>
          <p class="advice-text">{{ summaryText }}</p>
        </McPanel>
        <McPanel title="行动提醒" subtitle="按优先级排序" bordered>
          <div class="advice-list">
            <span v-for="item in adviceItems" :key="item.title" :class="`is-${item.level}`">
              <b>{{ item.title }}</b>
              <em>{{ item.text }}</em>
            </span>
          </div>
        </McPanel>
      </section>
    </Transition>

    <McModal v-model:open="debugModalOpen" title="调试数据" :close-on-overlay="true">
      <div class="debug-modal">
        <div class="debug-scroll-frame">
          <mc-scroll-view class="debug-scroll">
            <div class="debug-content">
              <section class="debug-section debug-section--summary">
                <div class="debug-summary">
                  <span>快捷键</span>
                  <strong>Ctrl + Alt + D</strong>
                </div>
                <div class="debug-summary">
                  <span>数据源</span>
                  <strong>{{ weatherDebug?.provider || (isOpenWeatherSource ? 'OpenWeatherMap' : 'Open-Meteo') }}</strong>
                </div>
                <div class="debug-summary">
                  <span>地点</span>
                  <strong>{{ placeTitle }}</strong>
                </div>
              </section>

              <section class="debug-section">
                <h3>请求</h3>
                <p v-if="!debugRequests.length" class="debug-empty">暂无请求记录。</p>
                <div v-else class="debug-table">
                  <div v-for="request in debugRequests" :key="request.label + request.url" class="debug-request">
                    <strong>{{ request.label }}</strong>
                    <code>{{ request.endpoint }}</code>
                    <div class="debug-param-grid">
                      <span v-for="param in request.params" :key="request.label + param.key">
                        <b>{{ param.key }}</b>
                        <em>{{ param.value }}</em>
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section class="debug-section">
                <h3>序列</h3>
                <p v-if="!debugSeriesRows.length" class="debug-empty">暂无序列记录。</p>
                <div v-else class="debug-table">
                  <div v-for="series in debugSeriesRows" :key="series.label" class="debug-series">
                    <strong>{{ series.label }}</strong>
                    <div class="debug-series-grid">
                      <span><b>数量</b><em>{{ series.count }}</em></span>
                      <span><b>步长</b><em>{{ series.stepLabel }}</em></span>
                      <span><b>开始</b><em>{{ series.firstLabel }}</em></span>
                      <span><b>结束</b><em>{{ series.lastLabel }}</em></span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </mc-scroll-view>
        </div>
      </div>
    </McModal>

    <McModal v-model:open="skinModalOpen" title="角色皮肤" :close-on-overlay="true" :show-close="false">
      <div class="skin-modal">
        <div class="skin-preview">
          <McSkinViewer
            :skin="activeSkin"
            :slim="skinSlim"
            :scale="previewSkinScale"
            :show-second-layer="skinSecondLayer"
            :pose="skinPose"
            :auto-rotate="skinAutoRotate"
            :interactive="true"
            :yaw="-18"
            :pitch="8"
            background="transparent"
            @error="handleSkinError"
          />
        </div>
        <div class="skin-settings">
          <div class="skin-setting-row skin-file-row">
            <span aria-hidden="true"></span>
            <div class="skin-file-controls">
              <input ref="skinFileInput" class="skin-file-input" type="file" accept="image/png,image/*" @change="handleSkinFileChange" />
              <McButton icon="mc-folder-open" @click="chooseSkinFile">选择皮肤文件</McButton>
            </div>
          </div>
          <div class="skin-setting-row">
            <span>Slim 体型</span>
            <McSwitch v-model="skinSlim" />
          </div>
          <div class="skin-setting-row">
            <span>第二层装饰</span>
            <McSwitch v-model="skinSecondLayer" />
          </div>
          <div class="skin-setting-row">
            <span>自动旋转</span>
            <McSwitch v-model="skinAutoRotate" />
          </div>
          <label class="skin-setting-row skin-pose-row">
            <span>姿势</span>
            <McDropdown v-model="skinPoseIndex" :options="skinPoseOptions" />
          </label>
          <div class="skin-modal-actions">
            <McButton icon="mc-reload" @click="resetSkin">恢复默认</McButton>
            <McButton icon="mc-save" variant="primary" @click="skinModalOpen = false">保存</McButton>
          </div>
        </div>
      </div>
    </McModal>

    <footer class="app-footer">
      <div class="footer-inner">
        <div class="footer-brand-row">
          <img :src="assetUrl('icon.png')" alt="" />
          <div class="footer-brand-copy">
            <strong>MC Weather</strong>
            <span>一款受 Minecraft 启发的像素风格天气应用，把天空装进方块世界。</span>
          </div>
        </div>
        <div class="footer-divider" aria-hidden="true"></div>
        <div class="footer-meta">
          <div class="footer-actions">
            <a class="footer-source" href="https://github.com/iMallpa/MC-Weather" target="_blank" rel="noreferrer" aria-label="View source on GitHub">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true">
                <path d="M256 32C132.3 32 32 134.9 32 261.7c0 101.5 64.2 187.5 153.2 217.9a17.6 17.6 0 0 0 3.8.4c8.3 0 11.5-6.1 11.5-11.4 0-5.5-.2-19.9-.3-39.1a102.4 102.4 0 0 1-22.6 2.7c-43.1 0-52.9-33.5-52.9-33.5-10.2-26.5-24.9-33.6-24.9-33.6-19.5-13.7-.1-14.1 1.4-14.1h.1c22.5 2 34.3 23.8 34.3 23.8 11.2 19.6 26.2 25.1 39.6 25.1a63 63 0 0 0 25.6-6c2-14.8 7.8-24.9 14.2-30.7-49.7-5.8-102-25.5-102-113.5 0-25.1 8.7-45.6 23-61.6-2.3-5.8-10-29.2 2.2-60.8a18.6 18.6 0 0 1 5-.5c8.1 0 26.4 3.1 56.6 24.1a208.2 208.2 0 0 1 112.2 0c30.2-21 48.5-24.1 56.6-24.1a18.6 18.6 0 0 1 5 .5c12.2 31.6 4.5 55 2.2 60.8 14.3 16.1 23 36.6 23 61.6 0 88.2-52.4 107.6-102.3 113.3 8 7.1 15.2 21.1 15.2 42.5 0 30.7-.3 55.5-.3 63 0 5.4 3.1 11.5 11.4 11.5a19.4 19.4 0 0 0 4-.4C415.9 449.2 480 363.1 480 261.7 480 134.9 379.7 32 256 32" />
              </svg>
              <span>View source on GitHub</span>
            </a>
            <span class="footer-license" @click="handleLicenseDebugClick">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true">
                <path d="M80-120v-80h360v-447q-26-9-45-28t-28-45H240l120 280q0 50-41 85t-99 35q-58 0-99-35t-41-85l120-280h-80v-80h247q12-35 43-57.5t70-22.5q39 0 70 22.5t43 57.5h247v80h-80l120 280q0 50-41 85t-99 35q-58 0-99-35t-41-85l120-280H593q-9 26-28 45t-45 28v447h360v80H80Zm585-320h150l-75-174-75 174Zm-520 0h150l-75-174-75 174Zm335-280q17 0 28.5-11.5T520-760q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760q0 17 11.5 28.5T480-720Z" />
              </svg>
              <span>MIT License</span>
            </span>
          </div>
          <p>本项目的构建离不开 McUI Vue、City Roads 与 CWC CEI (Comfort Environment Index) 等开源项目的启发和支持，也感谢 Open-Meteo、OpenWeatherMap 与 OpenStreetMap 提供的天气数据、地图图层与开放地图服务。</p>
          <div class="footer-legal">
            <p>Minecraft 相关商标归 Mojang Studios、Microsoft 及相关权利方所有。本项目为非官方开源作品，未获其授权、认可或赞助。</p>
          </div>
        </div>
      </div>
    </footer>
  </main>
</template>
