export function computeCEI(unit, data, latitude, month, weatherId = null) {
  if (!['imperial', 'metric', 'standard'].includes(unit)) {
    return { error: 'Invalid unit type' }
  }

  const required = ['temp', 'humidity', 'wind_speed', 'pm2_5', 'pm10', 'o3', 'co', 'no2', 'so2', 'uvi', 'pressure']
  for (const field of required) {
    if (!Number.isFinite(Number(data[field]))) {
      return { error: `Missing or invalid field: ${field}` }
    }
  }

  let T = Number(data.temp)
  const RH = Number(data.humidity)
  let wind = Number(data.wind_speed)
  const pm25 = Number(data.pm2_5)
  const pm10 = Number(data.pm10)
  const o3 = Number(data.o3)
  const co = Number(data.co)
  const no2 = Number(data.no2)
  const so2 = Number(data.so2)
  const uvi = Number(data.uvi)
  const pressure = Number(data.pressure)
  let windGust = numberOrNull(data.wind_gust)
  let dewPoint = numberOrNull(data.dew_point)
  let feelsLike = numberOrNull(data.feels_like)

  if (unit === 'imperial') {
    T = (T - 32) * 5 / 9
    dewPoint = dewPoint === null ? null : (dewPoint - 32) * 5 / 9
    feelsLike = feelsLike === null ? null : (feelsLike - 32) * 5 / 9
    wind /= 2.237
    windGust = windGust === null ? null : windGust / 2.237
  } else if (unit === 'standard') {
    T -= 273.15
    dewPoint = dewPoint === null ? null : dewPoint - 273.15
    feelsLike = feelsLike === null ? null : feelsLike - 273.15
  }

  const wxId = Number.isFinite(Number(weatherId)) ? Number(weatherId) : Number(data.weather_id ?? 800)
  const climate = getClimateContext(latitude, month)
  const weights = dynamicWeightAdjustment(T, pm25, uvi, wind)
  const heatIndex = calculateHeatIndex(T, RH)
  const windChill = calculateWindChill(T, Math.max(wind, windGust ?? wind))
  const effectiveTemp = T >= 20 ? heatIndex : windChill
  const heatScore = calculateThermalComfort(T, RH, wind, heatIndex, wxId, climate.comfortTemp, dewPoint)
  const airScore = calculateAirQualityScoreInternational(pm25, pm10, o3, co, no2, so2)
  const uvScore = calculateUVScore(uvi)
  const pressureScore = calculatePressureScore(pressure)

  let comfortCEI = weights.heat * heatScore + weights.air * airScore + weights.uv * uvScore + weights.press * pressureScore
  comfortCEI = clamp(comfortCEI * climate.factor, 0, 100)

  const riskLayer = computeRiskLayer({
    T,
    RH,
    wind,
    windGust,
    dewPoint,
    heatIndex,
    weatherId: wxId,
    pm25,
    pm10,
    o3,
    co,
    no2,
    so2,
  })

  const final = clamp(Math.min(comfortCEI, riskLayer.risk_cap), 0, 100)
  const components = { heat: heatScore, air: airScore, uv: uvScore, pressure: pressureScore }
  const minComponent = Object.entries(components).sort((a, b) => a[1] - b[1])[0][0]

  return {
    cei: Math.round(final),
    level: getCEILevel(final),
    components: {
      heat: Math.round(heatScore),
      air: Math.round(airScore),
      uv: Math.round(uvScore),
      pressure: Math.round(pressureScore),
      risk: Math.round(riskLayer.risk_score),
    },
    weights: {
      heat: round(weights.heat, 3),
      air: round(weights.air, 3),
      uv: round(weights.uv, 3),
      pressure: round(weights.press, 3),
    },
    detail: {
      comfort_cei: round(comfortCEI, 1),
      risk_cap: round(riskLayer.risk_cap, 1),
      risk_hint: Math.round(riskLayer.risk_hint_score),
      risk_focus: Math.round(riskLayer.risk_focus_score),
      main_effect: riskLayer.risk_cap < comfortCEI ? 'risk' : minComponent,
      climate,
      thermal: {
        effective_temp: round(effectiveTemp, 1),
        heat_index: round(heatIndex, 1),
        wind_chill: round(windChill, 1),
      },
      risk: {
        overall: Math.round(riskLayer.risk_score),
        cap: round(riskLayer.risk_cap, 1),
        hint: Math.round(riskLayer.risk_hint_score),
        focus: Math.round(riskLayer.risk_focus_score),
        from_temp: Math.round(riskLayer.from_temp),
        from_weather: Math.round(riskLayer.from_weather),
        from_alerts: 0,
        factors: riskLayer.factors,
        debug_flags: riskLayer.debug_flags,
        hazards: riskLayer.hazards,
      },
    },
  }
}

export function getCEILevel(cei) {
  if (cei >= 90) return 'CEI Level 1 - Excellent'
  if (cei >= 75) return 'CEI Level 2 - Comfortable'
  if (cei >= 60) return 'CEI Level 3 - Acceptable'
  if (cei >= 45) return 'CEI Level 4 - Uncomfortable'
  if (cei >= 30) return 'CEI Level 5 - Poor'
  return 'Severe'
}

function getClimateContext(latitude, month) {
  const absLat = Math.abs(latitude)
  let zone = 'polar'
  let comfortTemp = 18
  if (absLat < 10) {
    zone = 'equatorial'
    comfortTemp = 26
  } else if (absLat < 23.5) {
    zone = 'tropical'
    comfortTemp = 25
  } else if (absLat < 35) {
    zone = 'subtropical'
    comfortTemp = 24
  } else if (absLat < 55) {
    zone = 'temperate'
    comfortTemp = 22
  } else if (absLat < 66.5) {
    zone = 'cold_temperate'
    comfortTemp = 20
  }

  const normalizedMonth = normalizeMonth(latitude, month)
  if ([6, 7, 8].includes(normalizedMonth)) comfortTemp += 1
  if ([12, 1, 2].includes(normalizedMonth)) comfortTemp -= 1

  return { zone, factor: adjustForClimate(latitude, month), comfortTemp }
}

function adjustForClimate(latitude, month) {
  const absLat = Math.abs(latitude)
  const normalizedMonth = normalizeMonth(latitude, month)
  const isSummer = [6, 7, 8].includes(normalizedMonth)
  const isWinter = [12, 1, 2].includes(normalizedMonth)
  const tropical = absLat >= 10 && absLat < 23.5
  const cold = absLat >= 55
  if (isSummer && tropical) return 1.1
  if (isSummer && cold) return 0.9
  if (isWinter && tropical) return 0.9
  if (isWinter && cold) return 1.1
  return 1
}

function normalizeMonth(latitude, month) {
  const safeMonth = month >= 1 && month <= 12 ? Math.trunc(month) : 1
  return latitude < 0 ? ((safeMonth + 5) % 12) + 1 : safeMonth
}

function dynamicWeightAdjustment(T, pm25, uvi, wind) {
  const weights = { heat: 0.4, air: 0.4, uv: 0.1, press: 0.1 }
  if (T > 30) weights.heat = 0.5
  else if (T < 15) weights.heat = 0.6
  if (wind > 8) weights.heat += 0.05
  if (wind > 12) weights.heat += 0.05
  if (pm25 > 35) weights.air = 0.5
  if (uvi > 8) weights.uv = 0.2
  const sum = Object.values(weights).reduce((acc, item) => acc + Math.max(0.05, item), 0)
  for (const key of Object.keys(weights)) weights[key] = Math.max(0.05, weights[key]) / sum
  return weights
}

function calculateHeatIndex(T, RH) {
  if (T < 20) return T
  return -8.78469475556 + 1.61139411 * T + 2.33854883889 * RH - 0.14611605 * T * RH
    - 0.012308094 * T ** 2 - 0.0164248277778 * RH ** 2 + 0.002211732 * T ** 2 * RH
    + 0.00072546 * T * RH ** 2 - 0.000003582 * T ** 2 * RH ** 2
}

function calculateWindChill(T, wind) {
  if (T >= 10 || wind <= 1.3) return T
  const windKmh = wind * 3.6
  return 13.12 + 0.6215 * T - 11.37 * windKmh ** 0.16 + 0.3965 * T * windKmh ** 0.16
}

function thermalComfortCurve(effectiveTemp, comfortTemp) {
  const absDelta = Math.abs(effectiveTemp - comfortTemp)
  if (absDelta <= 2) return 100
  if (absDelta <= 5) return Math.max(90, 100 - absDelta * 2)
  if (absDelta <= 15) return Math.max(60, 90 - (absDelta - 5) * 3)
  if (absDelta <= 25) return Math.max(30, 60 - (absDelta - 15) * 3)
  return Math.max(5, 30 - (absDelta - 25) * 2)
}

function calculateThermalComfort(T, RH, wind, heatIndex, weatherId, comfortTemp, dewPoint = null) {
  const effectiveTemp = T >= 20 ? heatIndex : calculateWindChill(T, wind)
  const tempComfort = thermalComfortCurve(effectiveTemp, comfortTemp)
  let humidityComfort = 100 - Math.min(60, Math.abs(RH - 50) * 1.2)
  if (dewPoint !== null && T >= 20 && dewPoint >= 24) {
    humidityComfort = Math.max(20, humidityComfort - Math.min(15, (dewPoint - 23) * 1.5))
  }
  const windComfort = wind <= 3 ? 100 : Math.max(20, 100 - (wind - 3) * 10)
  const heatComfort = heatIndex <= 27 ? 100 : Math.max(20, 100 - (heatIndex - 27) * 8)
  const score = 0.5 * tempComfort + 0.25 * humidityComfort + 0.15 * windComfort + 0.1 * heatComfort
  return clamp(score - getWeatherDiscomfortPenalty(weatherId), 0, 100)
}

function getWeatherDiscomfortPenalty(weatherId) {
  if (weatherId >= 200 && weatherId < 300) return [212, 221, 232].includes(weatherId) ? 20 : 15
  if (weatherId >= 300 && weatherId < 400) return 6
  if (weatherId >= 500 && weatherId < 600) {
    if ([500, 520].includes(weatherId)) return 8
    if ([501, 521, 531].includes(weatherId)) return 12
    if ([502, 503, 504, 522].includes(weatherId)) return 16
    if (weatherId === 511) return 20
    return 12
  }
  if (weatherId >= 600 && weatherId < 700) return [600, 615, 620].includes(weatherId) ? 12 : [601, 612, 621].includes(weatherId) ? 16 : 20
  if (weatherId >= 700 && weatherId < 800) {
    if ([701, 711, 721, 741].includes(weatherId)) return 10
    if ([731, 751, 761, 762, 771].includes(weatherId)) return 18
    if (weatherId === 781) return 25
    return 12
  }
  if (weatherId >= 801 && weatherId <= 804) return [0, 1, 2, 4, 6][weatherId - 800] ?? 0
  return 0
}

function calculateAirQualityScoreInternational(pm25, pm10, o3, co, no2, so2) {
  return Math.min(
    pollutantScore(pm25, [[15, 100], [25, 90], [35, 80], [50, 65], [75, 50]]),
    pollutantScore(pm10, [[15, 100], [45, 80], [60, 60], [90, 40], [120, 20]]),
    pollutantScore(o3, [[60, 100], [100, 80], [130, 60], [160, 40], [200, 20]]),
    pollutantScore(co / 1000, [[1, 100], [4, 80], [7, 60], [10, 40], [15, 20]]),
    pollutantScore(no2, [[10, 100], [25, 80], [40, 60], [60, 40], [80, 20]]),
    pollutantScore(so2, [[20, 100], [40, 80], [60, 60], [80, 40], [100, 20]]),
  )
}

function pollutantScore(concentration, thresholds) {
  for (const [limit, score] of thresholds) {
    if (concentration <= limit) return score
  }
  return 10
}

function calculateUVScore(uvi) {
  if (uvi <= 2) return 100
  if (uvi <= 5) return 85
  if (uvi <= 7) return 70
  if (uvi <= 10) return 55
  return 40
}

function calculatePressureScore(pressure) {
  const deviation = Math.abs(pressure - 1013.25)
  if (deviation <= 5) return 100
  if (deviation <= 10) return 90
  if (deviation <= 15) return 80
  if (deviation <= 20) return 70
  if (deviation <= 25) return 60
  return Math.max(40, 100 - deviation * 2)
}

function computeRiskLayer(ctx) {
  const hazards = {}
  const temp = computeTemperatureRiskScore(ctx.T, ctx.RH, ctx.wind, ctx.windGust, ctx.dewPoint, ctx.heatIndex)
  if (temp.cold_score > 0) hazards.extreme_cold = { P: temp.cold_score / 100, A: 0, Q: 0 }
  if (temp.heat_score > 0) hazards.extreme_heat = { P: temp.heat_score / 100, A: 0, Q: 0 }

  const wx = computeWeatherRiskScore(ctx.weatherId, ctx.windGust, ctx.T, ctx.wind)
  for (const [key, value] of Object.entries(wx.hazards)) {
    hazards[key] = { P: Math.max(hazards[key]?.P ?? 0, value), A: 0, Q: 0 }
  }

  const air = computeAirHealthRisk(ctx.pm25, ctx.pm10, ctx.o3)
  if (air.risk_01 > 0) hazards.air_quality = { P: air.risk_01, A: 0, Q: 0 }

  for (const info of Object.values(hazards)) {
    info.R = clamp01(info.P + info.Q * Math.max(0, info.A - info.P))
    info.Focus = clamp01(Math.max(info.P, info.A) * (0.75 + info.Q * 0.25))
  }

  const weights = hazardImpactWeights()
  const risk01 = combineHazardsNoisyOR(hazards, weights, 'R')
  const hint01 = computeHintOverall(hazards, weights)
  const focus01 = combineHazardsNoisyOR(hazards, weights, 'Focus')

  return {
    risk_score: risk01 * 100,
    risk_cap: mapOverallRiskToCap(risk01),
    risk_hint_score: hint01 * 100,
    risk_focus_score: focus01 * 100,
    from_temp: temp.score,
    from_weather: wx.score,
    factors: pickUserFactors(hazards),
    debug_flags: [...temp.debug_flags, ...wx.debug_flags, ...temp.flags, ...wx.flags],
    hazards,
  }
}

function computeTemperatureRiskScore(T, RH, wind, windGust = null, dewPoint = null, heatIndex = null) {
  const flags = []
  const debug_flags = []
  const windEff = windGust !== null && windGust > wind ? windGust : wind
  if (windEff !== wind) debug_flags.push('temp_use_gust')
  const windChill = calculateWindChill(T, windEff)
  let cold = 0
  if (windChill <= -45) cold = 95
  else if (windChill <= -40) cold = 90
  else if (windChill <= -35) cold = 80
  else if (windChill <= -30) cold = 65
  else if (windChill <= -25) cold = 50
  else if (windChill <= -20) cold = 35
  if (cold) flags.push('extreme_cold')

  let hi = heatIndex ?? calculateHeatIndex(T, RH)
  if (dewPoint !== null && dewPoint >= 26) {
    hi += dewPoint >= 29 ? 4 : 2
    debug_flags.push('heat_dp_boost')
  }
  let heat = 0
  if (hi >= 52) heat = 90
  else if (hi >= 41) heat = 80
  else if (hi >= 35) heat = 60
  else if (hi >= 32) heat = 40
  else if (hi >= 30) heat = 28
  if (heat) flags.push('extreme_heat')

  return { score: Math.max(cold, heat), cold_score: cold, heat_score: heat, flags, debug_flags }
}

function computeWeatherRiskScore(weatherId, windGust = null, T = null, wind = null) {
  let score = 0
  const flags = []
  const debug_flags = []
  const hazards = {}

  if (weatherId >= 200 && weatherId < 300) {
    hazards.thunderstorm = [212, 221, 232].includes(weatherId) ? 0.85 : 0.75
    score = 75
    flags.push('wx_thunderstorm')
  } else if (weatherId >= 300 && weatherId < 400) {
    hazards.heavy_rain = 0.25
    score = 20
  } else if (weatherId >= 500 && weatherId < 600) {
    if ([500, 520].includes(weatherId)) hazards.heavy_rain = 0.35
    else if ([501, 521, 531].includes(weatherId)) hazards.heavy_rain = 0.55
    else if ([502, 503, 504, 522].includes(weatherId)) hazards.heavy_rain = 0.7
    else if (weatherId === 511) hazards.snow_ice = 0.8
    else hazards.heavy_rain = 0.5
    score = Math.round(Math.max(...Object.values(hazards)) * 100)
    flags.push('wx_rain')
  } else if (weatherId >= 600 && weatherId < 700) {
    hazards.snow_ice = [600, 615, 620].includes(weatherId) ? 0.55 : [601, 612, 621].includes(weatherId) ? 0.7 : 0.78
    score = Math.round(hazards.snow_ice * 100)
    flags.push('wx_snow')
  } else if (weatherId >= 700 && weatherId < 800) {
    if ([701, 721, 741].includes(weatherId)) hazards.fog = 0.55
    else if (weatherId === 711) hazards.air_quality = 0.45
    else if ([731, 751, 761, 762, 771].includes(weatherId)) hazards.dust_sand = 0.7
    else if (weatherId === 781) hazards.tornado = 0.98
    else hazards.fog = 0.45
    score = Math.round(Math.max(...Object.values(hazards)) * 100)
    flags.push('wx_atmosphere')
  }

  const gust = Number.isFinite(windGust) ? windGust : wind
  if (Number.isFinite(gust)) {
    const windRisk = mapGustToRisk01(gust)
    if (windRisk > 0.01) {
      hazards.wind = Math.max(hazards.wind ?? 0, windRisk)
      score = Math.max(score, Math.round(windRisk * 100))
      debug_flags.push('wind_from_gust_or_wind')
    }
  }

  if (Number.isFinite(T) && hazards.snow_ice && T >= -3 && T <= 1) {
    hazards.snow_ice = clamp01(hazards.snow_ice + 0.08)
    debug_flags.push('snow_ice_temp_band')
  }

  return { score, hazards, flags, debug_flags }
}

function mapGustToRisk01(gust) {
  if (gust < 12) return 0
  if (gust < 15) return lerp01((gust - 12) / 3, 0.15, 0.35)
  if (gust < 20) return lerp01((gust - 15) / 5, 0.35, 0.55)
  if (gust < 25) return lerp01((gust - 20) / 5, 0.55, 0.75)
  if (gust < 32) return lerp01((gust - 25) / 7, 0.75, 0.92)
  return 0.95
}

function computeAirHealthRisk(pm25, _pm10, o3) {
  let rPm25 = 0
  if (pm25 <= 35) rPm25 = 0
  else if (pm25 <= 55) rPm25 = lerp01((pm25 - 35) / 20, 0.15, 0.35)
  else if (pm25 <= 75) rPm25 = lerp01((pm25 - 55) / 20, 0.35, 0.55)
  else if (pm25 <= 150) rPm25 = lerp01((pm25 - 75) / 75, 0.55, 0.8)
  else if (pm25 <= 250) rPm25 = lerp01((pm25 - 150) / 100, 0.8, 0.95)
  else rPm25 = 0.98

  let rO3 = 0
  if (o3 <= 100) rO3 = 0
  else if (o3 <= 160) rO3 = lerp01((o3 - 100) / 60, 0.15, 0.35)
  else if (o3 <= 200) rO3 = lerp01((o3 - 160) / 40, 0.35, 0.55)
  else if (o3 <= 300) rO3 = lerp01((o3 - 200) / 100, 0.55, 0.8)
  else rO3 = 0.9

  return { risk_01: clamp01(Math.max(rPm25, rO3)) }
}

function hazardImpactWeights() {
  return {
    extreme_cold: 1,
    extreme_heat: 1,
    wind: 0.9,
    snow_ice: 0.95,
    heavy_rain: 0.8,
    thunderstorm: 0.85,
    fog: 0.6,
    dust_sand: 0.7,
    tornado: 1,
    air_quality: 0.85,
    other: 0.55,
  }
}

function combineHazardsNoisyOR(hazards, impactWeights, field) {
  let product = 1
  for (const [hazard, info] of Object.entries(hazards)) {
    const value = clamp01(info[field] ?? 0)
    const weight = impactWeights[hazard] ?? 0.6
    product *= 1 - clamp01(value * weight)
  }
  return clamp01(1 - product)
}

function computeHintOverall(hazards, impactWeights) {
  let product = 1
  for (const [hazard, info] of Object.entries(hazards)) {
    const value = Math.max(info.P ?? 0, info.A ?? 0)
    const weight = impactWeights[hazard] ?? 0.6
    product *= 1 - clamp01(value * weight)
  }
  return clamp01(1 - product)
}

function mapOverallRiskToCap(risk01) {
  return clamp(100 * (1 - clamp01(risk01) ** 1.35), 0, 100)
}

function pickUserFactors(hazards) {
  return Object.entries(hazards)
    .filter(([, info]) => (info.R ?? 0) >= 0.35 || (info.Focus ?? 0) >= 0.45)
    .sort((a, b) => (b[1].Focus ?? 0) - (a[1].Focus ?? 0) || (b[1].R ?? 0) - (a[1].R ?? 0))
    .map(([hazard]) => hazard)
    .slice(0, 8)
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

function lerp01(t, a, b) {
  return a + (b - a) * clamp01(t)
}

function round(value, digits) {
  return Number(value.toFixed(digits))
}
