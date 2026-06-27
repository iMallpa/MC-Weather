import { computeCEI } from './cei.js'

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const AIR_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const GEO_BASE = 'https://geocoding-api.open-meteo.com/v1/search'
const REVERSE_GEO_BASE = 'https://nominatim.openstreetmap.org/reverse'
const OWM_ONECALL4_BASE = 'https://api.openweathermap.org/data/4.0/onecall'
const OWM_ONECALL3_BASE = 'https://api.openweathermap.org/data/3.0/onecall'
const OWM_AIR_BASE = 'https://api.openweathermap.org/data/2.5/air_pollution'
const OWM_GEO_BASE = 'https://api.openweathermap.org/geo/1.0/direct'
const OWM_REVERSE_GEO_BASE = 'https://api.openweathermap.org/geo/1.0/reverse'

export const DEFAULT_PLACE = {
  name: 'Shanghai',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'auto',
}

const weatherLabels = {
  0: '晴朗',
  1: '大部晴朗',
  2: '局部多云',
  3: '阴天',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '强毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴小冰雹',
  99: '雷暴伴大冰雹',
}

export function labelForWeather(code) {
  return weatherLabels[code] ?? `天气码 ${code}`
}

export function wmoToOpenWeatherId(code) {
  if (code === 0) return 800
  if ([1, 2].includes(code)) return 801
  if (code === 3) return 804
  if ([45, 48].includes(code)) return 741
  if ([51, 53, 55].includes(code)) return 300
  if ([56, 57, 66, 67].includes(code)) return 511
  if ([61, 80].includes(code)) return 500
  if ([63, 81].includes(code)) return 501
  if ([65, 82].includes(code)) return 502
  if ([71, 85].includes(code)) return 600
  if ([73].includes(code)) return 601
  if ([75, 77, 86].includes(code)) return 602
  if (code === 95) return 211
  if ([96, 99].includes(code)) return 212
  return 800
}

export async function searchPlaces(query, options = {}) {
  if (options.useOpenWeather && options.owmApiKey) {
    try {
      return await searchOpenWeatherPlaces(query, options.owmApiKey)
    } catch {
      // Fall back to Open-Meteo geocoding. A bad user key should not break search.
    }
  }

  const url = new URL(GEO_BASE)
  url.searchParams.set('name', query)
  url.searchParams.set('count', '6')
  url.searchParams.set('language', 'zh')
  url.searchParams.set('format', 'json')

  const data = await fetchJson(url)
  return (data.results ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    country: item.country,
    admin1: item.admin1,
    admin2: item.admin2,
    admin3: item.admin3,
    latitude: item.latitude,
    longitude: item.longitude,
    timezone: item.timezone || 'auto',
    source: 'open-meteo-geocoding',
  }))
}

export async function reverseGeocodePlace(latitude, longitude, options = {}) {
  if (options.useOpenWeather && options.owmApiKey) {
    try {
      return await reverseOpenWeatherPlace(latitude, longitude, options.owmApiKey)
    } catch {
      // Fall back to OSM reverse geocoding.
    }
  }

  const url = new URL(REVERSE_GEO_BASE)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', latitude)
  url.searchParams.set('lon', longitude)
  url.searchParams.set('zoom', '10')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('accept-language', 'zh-CN,zh,en')

  const data = await fetchJson(url)
  const address = data.address ?? {}
  const city = address.city || address.town || address.village || address.county || address.state || '当前位置'
  return {
    name: city,
    admin1: address.state || address.province,
    admin2: address.county,
    country: address.country,
    latitude,
    longitude,
    timezone: 'auto',
    displayName: data.display_name,
    source: 'osm-nominatim',
  }
}

export async function loadWeather(place, options = {}) {
  if (options.useOpenWeather && options.owmApiKey) {
    try {
      return await loadOpenWeather(place, options.owmApiKey)
    } catch {
      // Keep the app usable when an OWM key is invalid, over quota, or the endpoint is unavailable.
    }
  }

  const [forecast, air] = await Promise.all([fetchForecast(place), fetchAirQuality(place)])
  return normalizeWeather(place, forecast, air)
}

async function loadOpenWeather(place, apiKey) {
  const [oneCall, air] = await Promise.all([
    fetchOpenWeatherOneCall(place, apiKey),
    fetchOpenWeatherAir(place, apiKey),
  ])
  return normalizeOpenWeather(place, oneCall, air)
}

async function fetchOpenWeatherOneCall(place, apiKey) {
  try {
    return await fetchOpenWeatherOneCall4(place, apiKey)
  } catch {
    return fetchOpenWeatherOneCall3(place, apiKey)
  }
}

async function fetchOpenWeatherOneCall4(place, apiKey) {
  const common = {
    lat: String(place.latitude),
    lon: String(place.longitude),
    appid: apiKey,
    units: 'metric',
    lang: 'zh_cn',
  }

  const urls = {
    current: openWeatherUrl(`${OWM_ONECALL4_BASE}/current`, common),
    minutely: openWeatherUrl(`${OWM_ONECALL4_BASE}/timeline/1min`, { ...common, cnt: '60' }),
    hourly: openWeatherUrl(`${OWM_ONECALL4_BASE}/timeline/1h`, { ...common, cnt: '48' }),
    daily: openWeatherUrl(`${OWM_ONECALL4_BASE}/timeline/1day`, { ...common, cnt: '7' }),
  }

  const [current, minutely, hourly, daily] = await Promise.all([
    fetchJson(urls.current),
    fetchJson(urls.minutely),
    fetchJson(urls.hourly),
    fetchJson(urls.daily),
  ])

  const alerts = await fetchOpenWeatherAlertDetails(current, apiKey)
  return {
    version: 4,
    current,
    minutely,
    hourly,
    daily,
    alerts,
    debug: [
      debugRequest('OpenWeatherMap One Call 4 Current', urls.current),
      debugRequest('OpenWeatherMap One Call 4 1min Timeline', urls.minutely),
      debugRequest('OpenWeatherMap One Call 4 1h Timeline', urls.hourly),
      debugRequest('OpenWeatherMap One Call 4 1day Timeline', urls.daily),
    ],
  }
}

function openWeatherUrl(base, params) {
  const url = new URL(base)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url
}

async function fetchOpenWeatherAlertDetails(current, apiKey) {
  const alertIds = unwrapOpenWeatherList(current, ['alerts', 'weather_alerts', 'wx_alerts'])
    .map((alert) => typeof alert === 'string' ? alert : alert.id || alert.alert_id)
    .filter(Boolean)
  if (!alertIds.length) return []

  const details = await Promise.allSettled(alertIds.slice(0, 4).map((id) => {
    const url = new URL(`${OWM_ONECALL4_BASE}/alert/${id}`)
    url.searchParams.set('appid', apiKey)
    return fetchJson(url)
  }))
  return details.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
}

async function fetchOpenWeatherOneCall3(place, apiKey) {
  const url = new URL(OWM_ONECALL3_BASE)
  url.searchParams.set('lat', place.latitude)
  url.searchParams.set('lon', place.longitude)
  url.searchParams.set('appid', apiKey)
  url.searchParams.set('units', 'metric')
  url.searchParams.set('lang', 'zh_cn')
  return { version: 3, onecall: await fetchJson(url), debug: [debugRequest('OpenWeatherMap One Call 3', url)] }
}

async function fetchOpenWeatherAir(place, apiKey) {
  const url = new URL(OWM_AIR_BASE)
  url.searchParams.set('lat', place.latitude)
  url.searchParams.set('lon', place.longitude)
  url.searchParams.set('appid', apiKey)
  const data = await fetchJson(url)
  data.__debugRequest = debugRequest('OpenWeatherMap Air Pollution', url)
  return data
}

async function searchOpenWeatherPlaces(query, apiKey) {
  const url = new URL(OWM_GEO_BASE)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '6')
  url.searchParams.set('appid', apiKey)

  const data = await fetchJson(url)
  return (data ?? []).map((item, index) => ({
    id: `owm-${item.lat}-${item.lon}-${index}`,
    name: item.local_names?.zh || item.name,
    country: item.country,
    admin1: item.state,
    admin2: '',
    latitude: item.lat,
    longitude: item.lon,
    timezone: 'auto',
    source: 'openweather-geocoding',
  }))
}

async function reverseOpenWeatherPlace(latitude, longitude, apiKey) {
  const url = new URL(OWM_REVERSE_GEO_BASE)
  url.searchParams.set('lat', latitude)
  url.searchParams.set('lon', longitude)
  url.searchParams.set('limit', '1')
  url.searchParams.set('appid', apiKey)

  const [item] = await fetchJson(url)
  if (!item) throw new Error('OpenWeatherMap reverse geocoding returned no result')
  return {
    name: item.local_names?.zh || item.name || '当前位置',
    admin1: item.state,
    admin2: '',
    country: item.country,
    latitude,
    longitude,
    timezone: 'auto',
    source: 'openweather-geocoding',
  }
}

async function fetchForecast(place) {
  const url = new URL(FORECAST_BASE)
  url.searchParams.set('latitude', place.latitude)
  url.searchParams.set('longitude', place.longitude)
  url.searchParams.set('timezone', place.timezone || 'auto')
  url.searchParams.set('forecast_days', '7')
  url.searchParams.set('forecast_hours', '48')
  url.searchParams.set('forecast_minutely_15', '16')
  url.searchParams.set('current', [
    'temperature_2m',
    'relative_humidity_2m',
    'apparent_temperature',
    'is_day',
    'precipitation',
    'rain',
    'showers',
    'snowfall',
    'weather_code',
    'cloud_cover',
    'pressure_msl',
    'surface_pressure',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
  ].join(','))
  url.searchParams.set('minutely_15', [
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
    'wind_gusts_10m',
  ].join(','))
  url.searchParams.set('hourly', [
    'temperature_2m',
    'relative_humidity_2m',
    'dew_point_2m',
    'apparent_temperature',
    'precipitation_probability',
    'precipitation',
    'weather_code',
    'pressure_msl',
    'surface_pressure',
    'cloud_cover',
    'visibility',
    'uv_index',
    'cape',
    'shortwave_radiation',
    'wind_speed_10m',
    'wind_gusts_10m',
  ].join(','))
  url.searchParams.set('daily', [
    'weather_code',
    'sunrise',
    'sunset',
    'temperature_2m_max',
    'temperature_2m_min',
    'apparent_temperature_max',
    'apparent_temperature_min',
    'uv_index_max',
    'precipitation_sum',
    'precipitation_probability_max',
    'precipitation_hours',
    'sunshine_duration',
    'daylight_duration',
    'wind_speed_10m_max',
    'wind_gusts_10m_max',
    'wind_direction_10m_dominant',
    'shortwave_radiation_sum',
    'et0_fao_evapotranspiration',
  ].join(','))

  const data = await fetchJson(url)
  data.__debugRequest = debugRequest('Open-Meteo Forecast', url)
  return data
}

async function fetchAirQuality(place) {
  const url = new URL(AIR_BASE)
  url.searchParams.set('latitude', place.latitude)
  url.searchParams.set('longitude', place.longitude)
  url.searchParams.set('timezone', place.timezone || 'auto')
  url.searchParams.set('forecast_days', '5')
  url.searchParams.set('past_days', '1')
  url.searchParams.set('hourly', [
    'european_aqi',
    'us_aqi',
    'pm10',
    'pm2_5',
    'carbon_monoxide',
    'nitrogen_dioxide',
    'sulphur_dioxide',
    'ozone',
  ].join(','))

  const data = await fetchJson(url)
  data.__debugRequest = debugRequest('Open-Meteo Air Quality', url)
  return data
}

function debugRequest(label, url) {
  const safeUrl = new URL(String(url))
  if (safeUrl.searchParams.has('appid')) safeUrl.searchParams.set('appid', '***')
  return {
    label,
    url: safeUrl.toString(),
  }
}

function debugSeries(label, rows) {
  const times = (rows || []).map((item) => item?.time).filter(Boolean)
  return {
    label,
    count: rows?.length || 0,
    first: times[0] || '',
    last: times.at(-1) || '',
    stepMinutes: inferStepMinutes(times),
  }
}

function inferStepMinutes(times) {
  if (!times || times.length < 2) return null
  const start = new Date(times[0]).getTime()
  const next = new Date(times[1]).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(next)) return null
  return Math.round((next - start) / 60000)
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`请求失败 ${res.status}: ${url}`)
  }
  return res.json()
}

function normalizeWeather(place, forecast, air) {
  const current = forecast.current
  const currentTime = current.time
  const currentHour = nearestIndex(forecast.hourly.time, currentTime)
  const hourlyStart = boundedStartIndex(forecast.hourly.time, currentHour)
  const minutelyStart = firstIndexAtOrAfter(forecast.minutely_15?.time, currentTime)
  const airHour = nearestIndex(air.hourly.time, currentTime)
  const hourlyAirByTime = new Map((air.hourly.time ?? []).map((time, index) => [time, pickAir(air.hourly, index)]))

  const airNow = pickAir(air.hourly, airHour)
  const hourly = (forecast.hourly.time ?? []).slice(hourlyStart, hourlyStart + 48).map((time, offset) => {
    const index = hourlyStart + offset
    const itemAir = hourlyAirByTime.get(time) || airNow
    return buildMoment({
      time,
      latitude: place.latitude,
      temp: at(forecast.hourly.temperature_2m, index),
      humidity: at(forecast.hourly.relative_humidity_2m, index),
      wind: at(forecast.hourly.wind_speed_10m, index) / 3.6,
      windGust: at(forecast.hourly.wind_gusts_10m, index) / 3.6,
      dewPoint: at(forecast.hourly.dew_point_2m, index),
      feelsLike: at(forecast.hourly.apparent_temperature, index),
      weatherCode: at(forecast.hourly.weather_code, index),
      uvi: at(forecast.hourly.uv_index, index),
      visibility: at(forecast.hourly.visibility, index),
      cape: at(forecast.hourly.cape, index),
      radiation: at(forecast.hourly.shortwave_radiation, index),
      pressure: at(forecast.hourly.pressure_msl, index),
      air: itemAir,
      precipitation: at(forecast.hourly.precipitation, index),
      precipitationProbability: at(forecast.hourly.precipitation_probability, index),
    })
  })

  const currentMoment = buildMoment({
    time: current.time,
    latitude: place.latitude,
    temp: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    wind: current.wind_speed_10m / 3.6,
    windGust: current.wind_gusts_10m / 3.6,
    dewPoint: at(forecast.hourly.dew_point_2m, currentHour),
    feelsLike: current.apparent_temperature,
    weatherCode: current.weather_code,
    uvi: at(forecast.hourly.uv_index, currentHour),
    visibility: at(forecast.hourly.visibility, currentHour),
    cape: at(forecast.hourly.cape, currentHour),
    radiation: at(forecast.hourly.shortwave_radiation, currentHour),
    pressure: current.pressure_msl,
    air: airNow,
    precipitation: current.precipitation,
    precipitationProbability: at(forecast.hourly.precipitation_probability, currentHour),
    isDay: current.is_day,
    cloudCover: current.cloud_cover,
    windDirection: current.wind_direction_10m,
  })

  const minutely = (forecast.minutely_15?.time ?? []).slice(minutelyStart, minutelyStart + 16).map((time, offset) => {
    const index = minutelyStart + offset
    return {
    time,
    temp: at(forecast.minutely_15.temperature_2m, index),
    humidity: at(forecast.minutely_15.relative_humidity_2m, index),
    precipitation: at(forecast.minutely_15.precipitation, index),
    weatherCode: at(forecast.minutely_15.weather_code, index),
    label: labelForWeather(at(forecast.minutely_15.weather_code, index)),
    wind: at(forecast.minutely_15.wind_speed_10m, index) / 3.6,
    windGust: at(forecast.minutely_15.wind_gusts_10m, index) / 3.6,
    }
  })

  const daily = (forecast.daily.time ?? []).map((time, index) => ({
    time,
    code: at(forecast.daily.weather_code, index),
    label: labelForWeather(at(forecast.daily.weather_code, index)),
    sunrise: forecast.daily.sunrise?.[index] || '',
    sunset: forecast.daily.sunset?.[index] || '',
    tempMax: at(forecast.daily.temperature_2m_max, index),
    tempMin: at(forecast.daily.temperature_2m_min, index),
    feelsMax: at(forecast.daily.apparent_temperature_max, index),
    feelsMin: at(forecast.daily.apparent_temperature_min, index),
    uvMax: at(forecast.daily.uv_index_max, index),
    precipitation: at(forecast.daily.precipitation_sum, index),
    precipitationProbability: at(forecast.daily.precipitation_probability_max, index),
    precipitationHours: at(forecast.daily.precipitation_hours, index),
    sunshineDuration: at(forecast.daily.sunshine_duration, index),
    daylightDuration: at(forecast.daily.daylight_duration, index),
    windMax: at(forecast.daily.wind_speed_10m_max, index),
    windGustMax: at(forecast.daily.wind_gusts_10m_max, index),
    windDirection: at(forecast.daily.wind_direction_10m_dominant, index),
    radiationSum: at(forecast.daily.shortwave_radiation_sum, index),
    evapotranspiration: at(forecast.daily.et0_fao_evapotranspiration, index),
  }))

  return {
    place,
    current: currentMoment,
    minutely,
    hourly,
    daily,
    debug: {
      provider: 'Open-Meteo',
      requests: [forecast.__debugRequest, air.__debugRequest].filter(Boolean),
      series: [
        debugSeries('minutely_15', minutely),
        debugSeries('hourly', hourly),
        debugSeries('daily', daily),
      ],
    },
    units: {
      temp: forecast.current_units.temperature_2m,
      wind: forecast.current_units.wind_speed_10m,
      pressure: forecast.current_units.pressure_msl,
    },
    updatedAt: new Date().toISOString(),
  }
}

function normalizeOpenWeather(place, oneCall, air) {
  const data = oneCall.version === 4 ? normalizeOpenWeather4(oneCall) : normalizeOpenWeather3(oneCall.onecall)
  const airNow = pickOpenWeatherAir(air)
  const currentRaw = data.current || {}
  const currentWeather = firstWeather(currentRaw)
  const currentTime = toIso(currentRaw.dt || currentRaw.date || currentRaw.time || Date.now() / 1000)
  const currentMoment = buildMoment({
    time: currentTime,
    latitude: place.latitude,
    temp: numberFrom(currentRaw.temp, currentRaw.temperature),
    humidity: numberFrom(currentRaw.humidity),
    wind: numberFrom(currentRaw.wind_speed, currentRaw.wind?.speed, 0),
    windGust: numberFrom(currentRaw.wind_gust, currentRaw.wind?.gust, currentRaw.wind_speed, 0),
    dewPoint: numberFrom(currentRaw.dew_point),
    feelsLike: numberFrom(currentRaw.feels_like, currentRaw.apparent_temperature, currentRaw.temp),
    weatherCode: openWeatherIdToWmo(currentWeather.id),
    uvi: numberFrom(currentRaw.uvi, currentRaw.uv_index, 0),
    visibility: numberFrom(currentRaw.visibility, 0),
    cape: 0,
    radiation: 0,
    pressure: numberFrom(currentRaw.pressure),
    air: airNow,
    precipitation: precipitationAmount(currentRaw),
    precipitationProbability: probabilityPercent(currentRaw.pop ?? currentRaw.precipitation?.probability),
    isDay: isDayFromIcon(currentWeather.icon),
    cloudCover: numberFrom(currentRaw.clouds, currentRaw.cloud_cover, 0),
    windDirection: numberFrom(currentRaw.wind_deg, currentRaw.wind?.deg, 0),
  })

  const hourly = data.hourly.slice(0, 48).map((item) => buildMoment({
    time: toIso(item.dt || item.date || item.time),
    latitude: place.latitude,
    temp: numberFrom(item.temp, item.temperature),
    humidity: numberFrom(item.humidity),
    wind: numberFrom(item.wind_speed, item.wind?.speed, 0),
    windGust: numberFrom(item.wind_gust, item.wind?.gust, item.wind_speed, 0),
    dewPoint: numberFrom(item.dew_point),
    feelsLike: numberFrom(item.feels_like, item.apparent_temperature, item.temp),
    weatherCode: openWeatherIdToWmo(firstWeather(item).id),
    uvi: numberFrom(item.uvi, item.uv_index, 0),
    visibility: numberFrom(item.visibility, currentMoment.visibility, 0),
    cape: 0,
    radiation: 0,
    pressure: numberFrom(item.pressure, currentMoment.pressure),
    air: airNow,
    precipitation: precipitationAmount(item),
    precipitationProbability: probabilityPercent(item.pop ?? item.precipitation?.probability),
    isDay: isDayFromIcon(firstWeather(item).icon),
    cloudCover: numberFrom(item.clouds, item.cloud_cover, 0),
    windDirection: numberFrom(item.wind_deg, item.wind?.deg, 0),
  }))

  const minuteSupport = [currentMoment, ...hourly]
    .filter((item) => item?.time)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  const minutely = data.minutely.slice(0, 60).map((item) => {
    const time = toIso(item.dt || item.date || item.time)
    const support = interpolateMoment(minuteSupport, time) || currentMoment
    return {
      time,
      temp: null,
      humidity: null,
      precipitation: precipitationAmount(item),
      weatherCode: support.weatherCode,
      label: labelForWeather(support.weatherCode),
      wind: support.wind,
      windGust: support.windGust,
    }
  })

  const daily = data.daily.slice(0, 7).map((item) => {
    const temp = item.temp || item.temperature || {}
    const feels = item.feels_like || item.apparent_temperature || {}
    return {
      time: toIso(item.dt || item.date || item.time),
      code: openWeatherIdToWmo(firstWeather(item).id),
      label: labelForWeather(openWeatherIdToWmo(firstWeather(item).id)),
      sunrise: toIso(item.sunrise || item.sun?.rise || ''),
      sunset: toIso(item.sunset || item.sun?.set || ''),
      tempMax: numberFrom(temp.max, item.temp_max, item.temperature_max),
      tempMin: numberFrom(temp.min, item.temp_min, item.temperature_min),
      feelsMax: numberFrom(feels.day, feels.max, temp.max, item.temp_max),
      feelsMin: numberFrom(feels.night, feels.min, temp.min, item.temp_min),
      uvMax: numberFrom(item.uvi, item.uv_index_max, 0),
      precipitation: precipitationAmount(item),
      precipitationProbability: probabilityPercent(item.pop ?? item.precipitation?.probability),
      precipitationHours: null,
      sunshineDuration: null,
      daylightDuration: daylightSeconds(item),
      windMax: numberFrom(item.wind_speed, item.wind?.speed, 0) * 3.6,
      windGustMax: numberFrom(item.wind_gust, item.wind?.gust, item.wind_speed, 0) * 3.6,
      windDirection: numberFrom(item.wind_deg, item.wind?.deg, 0),
      cloudCover: numberFrom(item.clouds, item.cloud_cover, 0),
      radiationSum: null,
      evapotranspiration: null,
    }
  })

  return {
    place,
    current: currentMoment,
    minutely,
    hourly,
    daily,
    alerts: data.alerts,
    source: 'openweather',
    debug: {
      provider: `OpenWeatherMap One Call ${oneCall.version}`,
      requests: [...(oneCall.debug || []), air.__debugRequest].filter(Boolean),
      series: [
        debugSeries('minutely', minutely),
        debugSeries('hourly', hourly),
        debugSeries('daily', daily),
      ],
    },
    units: {
      temp: '°C',
      wind: 'm/s',
      pressure: 'hPa',
    },
    updatedAt: new Date().toISOString(),
  }
}

function normalizeOpenWeather4(oneCall) {
  return {
    current: flattenOpenWeatherCurrent(oneCall.current),
    minutely: unwrapOpenWeatherList(oneCall.minutely, ['list', 'data', 'timeline', 'forecast']),
    hourly: unwrapOpenWeatherList(oneCall.hourly, ['list', 'data', 'timeline', 'forecast']),
    daily: unwrapOpenWeatherList(oneCall.daily, ['list', 'data', 'timeline', 'forecast']),
    alerts: normalizeAlerts(oneCall.alerts),
    debug: oneCall.debug || [],
  }
}

function flattenOpenWeatherCurrent(payload = {}) {
  const item = payload.data?.[0] || payload.current || payload
  const weatherPayload = item.weather
  if (weatherPayload && !Array.isArray(weatherPayload) && typeof weatherPayload === 'object' && !('id' in weatherPayload)) {
    return { ...item, ...weatherPayload }
  }
  return item
}

function normalizeOpenWeather3(onecall) {
  return {
    current: onecall.current,
    minutely: onecall.minutely || [],
    hourly: onecall.hourly || [],
    daily: onecall.daily || [],
    alerts: normalizeAlerts(onecall.alerts || []),
  }
}

function unwrapOpenWeatherList(data, keys) {
  if (Array.isArray(data)) return data
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return []
}

function normalizeAlerts(alerts) {
  return (alerts || []).map((alert, index) => ({
    id: alert.id || alert.event || `alert-${index}`,
    title: alert.event || alert.title || alert.name || '天气警报',
    sender: alert.sender_name || alert.sender || alert.source || 'OpenWeatherMap',
    start: toIso(alert.start || alert.effective || alert.date || ''),
    end: toIso(alert.end || alert.expires || ''),
    description: alert.description || alert.summary || '',
    severity: alert.severity || alert.level || '',
  }))
}

function pickOpenWeatherAir(data) {
  const item = data?.list?.[0] || {}
  const components = item.components || {}
  const openWeatherAqi = item.main?.aqi || 0
  return {
    europeanAqi: 0,
    usAqi: 0,
    openWeatherAqi,
    pm10: numberFrom(components.pm10, 0),
    pm25: numberFrom(components.pm2_5, 0),
    co: numberFrom(components.co, 0),
    no2: numberFrom(components.no2, 0),
    so2: numberFrom(components.so2, 0),
    o3: numberFrom(components.o3, 0),
  }
}

function firstWeather(item = {}) {
  const weather = Array.isArray(item.weather) ? item.weather[0] : item.weather
  return weather || item.condition || {
    id: item.weather_id || item.condition_id,
    icon: item.icon || item.weather_icon,
  }
}

function openWeatherIdToWmo(id = 800) {
  const code = Number(id)
  if (code >= 200 && code < 300) return 95
  if (code >= 300 && code < 400) return 53
  if (code >= 500 && code < 600) return code >= 520 ? 80 : 61
  if (code >= 600 && code < 700) return 71
  if (code === 701 || code === 741) return 45
  if (code >= 700 && code < 800) return 48
  if (code === 800) return 0
  if (code === 801) return 1
  if (code === 802) return 2
  return 3
}

function numberFrom(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return 0
}

function precipitationAmount(item = {}) {
  return numberFrom(item.precipitation, item.rain?.['1h'], item.rain?.['3h'], item.rain, item.snow?.['1h'], item.snow?.['3h'], item.snow, 0)
}

function probabilityPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return number <= 1 ? number * 100 : number
}

function interpolateMoment(points, time) {
  if (!points.length || !time) return null
  const target = new Date(time).getTime()
  if (!Number.isFinite(target)) return points[0]

  let before = points[0]
  let after = points[points.length - 1]
  for (const point of points) {
    const pointTime = new Date(point.time).getTime()
    if (pointTime <= target) before = point
    if (pointTime >= target) {
      after = point
      break
    }
  }

  const beforeTime = new Date(before.time).getTime()
  const afterTime = new Date(after.time).getTime()
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime) || beforeTime === afterTime) {
    return nearestMoment(points, target)
  }

  const ratio = Math.max(0, Math.min(1, (target - beforeTime) / (afterTime - beforeTime)))
  const nearest = target - beforeTime <= afterTime - target ? before : after
  return {
    ...nearest,
    temp: lerpValue(before.temp, after.temp, ratio),
    humidity: lerpValue(before.humidity, after.humidity, ratio),
    wind: lerpValue(before.wind, after.wind, ratio),
    windGust: lerpValue(before.windGust, after.windGust, ratio),
  }
}

function nearestMoment(points, target) {
  return points.reduce((best, point) => {
    const delta = Math.abs(new Date(point.time).getTime() - target)
    const bestDelta = Math.abs(new Date(best.time).getTime() - target)
    return delta < bestDelta ? point : best
  }, points[0])
}

function lerpValue(start, end, ratio) {
  const startNumber = Number(start)
  const endNumber = Number(end)
  if (!Number.isFinite(startNumber)) return Number.isFinite(endNumber) ? endNumber : 0
  if (!Number.isFinite(endNumber)) return startNumber
  return startNumber + (endNumber - startNumber) * ratio
}

function daylightSeconds(item = {}) {
  const sunrise = Number(item.sunrise)
  const sunset = Number(item.sunset)
  return Number.isFinite(sunrise) && Number.isFinite(sunset) ? Math.max(0, sunset - sunrise) : 0
}

function isDayFromIcon(icon = '') {
  return String(icon).endsWith('n') ? 0 : 1
}

function toIso(value) {
  if (!value) return ''
  if (typeof value === 'string' && Number.isNaN(Number(value))) return value
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return new Date(number < 10000000000 ? number * 1000 : number).toISOString()
}

function buildMoment(payload) {
  const month = new Date(payload.time).getMonth() + 1
  const weatherId = wmoToOpenWeatherId(payload.weatherCode)
  const cei = computeCEI('metric', {
    temp: payload.temp,
    humidity: payload.humidity,
    wind_speed: payload.wind,
    wind_gust: payload.windGust,
    dew_point: payload.dewPoint,
    feels_like: payload.feelsLike,
    weather_id: weatherId,
    pm2_5: payload.air.pm25,
    pm10: payload.air.pm10,
    o3: payload.air.o3,
    co: payload.air.co,
    no2: payload.air.no2,
    so2: payload.air.so2,
    uvi: payload.uvi ?? 0,
    pressure: payload.pressure,
    ts: Math.floor(new Date(payload.time).getTime() / 1000),
  }, payload.latitude, month, weatherId)

  return {
    ...payload,
    weatherId,
    label: labelForWeather(payload.weatherCode),
    cei,
  }
}

function nearestIndex(times = [], target) {
  if (!times.length) return 0
  const targetMs = new Date(target).getTime()
  let best = 0
  let bestDelta = Infinity
  times.forEach((time, index) => {
    const delta = Math.abs(new Date(time).getTime() - targetMs)
    if (delta < bestDelta) {
      best = index
      bestDelta = delta
    }
  })
  return best
}

function firstIndexAtOrAfter(times = [], target) {
  if (!times.length) return 0
  const targetMs = new Date(target).getTime()
  const index = times.findIndex((time) => new Date(time).getTime() >= targetMs)
  return index >= 0 ? index : 0
}

function boundedStartIndex(times = [], index = 0) {
  if (!times.length) return 0
  return Math.max(0, Math.min(index, times.length - 1))
}

function pickAir(hourly, index) {
  return {
    europeanAqi: at(hourly.european_aqi, index, 0),
    usAqi: at(hourly.us_aqi, index, 0),
    pm10: at(hourly.pm10, index, 0),
    pm25: at(hourly.pm2_5, index, 0),
    co: at(hourly.carbon_monoxide, index, 0),
    no2: at(hourly.nitrogen_dioxide, index, 0),
    so2: at(hourly.sulphur_dioxide, index, 0),
    o3: at(hourly.ozone, index, 0),
  }
}

function at(values, index, fallback = 0) {
  const value = values?.[index]
  return Number.isFinite(value) ? value : fallback
}
