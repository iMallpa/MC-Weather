import { computeCEI } from './cei.js'

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const AIR_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const GEO_BASE = 'https://geocoding-api.open-meteo.com/v1/search'
const REVERSE_GEO_BASE = 'https://nominatim.openstreetmap.org/reverse'

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

export async function searchPlaces(query) {
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

export async function reverseGeocodePlace(latitude, longitude) {
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

export async function loadWeather(place) {
  const [forecast, air] = await Promise.all([fetchForecast(place), fetchAirQuality(place)])
  return normalizeWeather(place, forecast, air)
}

async function fetchForecast(place) {
  const url = new URL(FORECAST_BASE)
  url.searchParams.set('latitude', place.latitude)
  url.searchParams.set('longitude', place.longitude)
  url.searchParams.set('timezone', place.timezone || 'auto')
  url.searchParams.set('forecast_days', '7')
  url.searchParams.set('past_days', '1')
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

  return fetchJson(url)
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

  return fetchJson(url)
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
  const airHour = nearestIndex(air.hourly.time, currentTime)
  const hourlyAirByTime = new Map((air.hourly.time ?? []).map((time, index) => [time, pickAir(air.hourly, index)]))

  const airNow = pickAir(air.hourly, airHour)
  const hourly = (forecast.hourly.time ?? []).slice(0, 48).map((time, index) => {
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

  const minutely = (forecast.minutely_15?.time ?? []).slice(0, 16).map((time, index) => ({
    time,
    temp: at(forecast.minutely_15.temperature_2m, index),
    humidity: at(forecast.minutely_15.relative_humidity_2m, index),
    precipitation: at(forecast.minutely_15.precipitation, index),
    weatherCode: at(forecast.minutely_15.weather_code, index),
    label: labelForWeather(at(forecast.minutely_15.weather_code, index)),
    wind: at(forecast.minutely_15.wind_speed_10m, index) / 3.6,
    windGust: at(forecast.minutely_15.wind_gusts_10m, index) / 3.6,
  }))

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
    units: {
      temp: forecast.current_units.temperature_2m,
      wind: forecast.current_units.wind_speed_10m,
      pressure: forecast.current_units.pressure_msl,
    },
    updatedAt: new Date().toISOString(),
  }
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
