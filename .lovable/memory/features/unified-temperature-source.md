---
name: Live Weather Temperature Source
description: Temperature comes from live Open-Meteo weather API, not hardcoded 75°F
type: feature
---
The application uses the `useWeather` hook (src/hooks/useWeather.ts) to fetch live weather from Open-Meteo API.

- `getTemperature(selectedDate)` returns the live forecast temperature for the selected date
- The same `liveTemperature` value is used for both UI display AND oracle RPC `p_temperature`
- Auto-refreshes every 10 minutes and on window focus when stale
- Uses browser geolocation; falls back to NYC coordinates if denied
- 75°F exists only as a dev fallback when no weather data is available at all
- No hardcoded static temperature in production flow
