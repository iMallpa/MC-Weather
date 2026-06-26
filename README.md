# MC Weather

MC Weather is a Minecraft-inspired weather dashboard built with Vue and Open-Meteo. It combines current conditions, minute-level trends, forecasts, radar layers, location search, default-location storage, and a JavaScript port of CEI Comfort Environment Index.

## Features

- Current weather, minute trend chart, daily forecast, radar map, and weather advice views.
- Open-Meteo weather and geocoding data with optional OpenWeatherMap radar layers.
- CEI Comfort Environment Index summary and component scoring.
- Responsive Minecraft-style interface with light, dark, and automatic color modes.
- Custom Minecraft skin viewer in the header with local skin upload.

## Development

```bash
pnpm install
pnpm dev
```

Then open `http://127.0.0.1:5173/`.

Build for production:

```bash
pnpm build
```

## Credits

This project is inspired by and built with support from open-source and open-data projects including mcui-oreui, city-roads, CEI Comfort Environment Index, Open-Meteo, OpenWeatherMap, and OpenStreetMap.

Minecraft names and related trademarks belong to Mojang Studios, Microsoft, and their respective rights holders. This project is unofficial and is not affiliated with, endorsed by, or sponsored by Mojang Studios, Microsoft, or Minecraft.

## License

MIT
