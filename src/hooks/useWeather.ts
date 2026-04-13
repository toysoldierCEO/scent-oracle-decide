import { useState, useEffect, useRef } from 'react';

const FALLBACK_TEMPERATURE = 75;

// Open-Meteo free API — no key required
// Returns daily max temperatures for 7 days in Fahrenheit
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export type WeatherByDate = Record<string, number>; // "YYYY-MM-DD" → °F

interface UseWeatherResult {
  weatherByDate: WeatherByDate;
  weatherLoading: boolean;
  weatherError: string | null;
  /** Resolved temperature for a specific date. Falls back gracefully. */
  getTemperature: (dateStr: string) => number;
}

/**
 * Fetches a 7-day weather forecast once per session/location.
 * Uses browser geolocation if available, otherwise falls back to a default location.
 */
export function useWeather(): UseWeatherResult {
  const [weatherByDate, setWeatherByDate] = useState<WeatherByDate>({});
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchForecast = async (lat: number, lon: number) => {
      try {
        const params = new URLSearchParams({
          latitude: lat.toFixed(4),
          longitude: lon.toFixed(4),
          daily: 'temperature_2m_max',
          temperature_unit: 'fahrenheit',
          forecast_days: '7',
          timezone: 'auto',
        });

        const res = await fetch(`${OPEN_METEO_URL}?${params}`);
        if (!res.ok) throw new Error(`Weather API ${res.status}`);

        const json = await res.json();
        const dates: string[] = json.daily?.time ?? [];
        const temps: number[] = json.daily?.temperature_2m_max ?? [];

        const map: WeatherByDate = {};
        for (let i = 0; i < dates.length; i++) {
          if (dates[i] && temps[i] != null) {
            map[dates[i]] = Math.round(temps[i]);
          }
        }

        setWeatherByDate(map);
        setWeatherError(null);
      } catch (e: any) {
        console.warn('[Odara Weather] Forecast fetch failed, using fallback:', e?.message);
        setWeatherError(e?.message ?? 'Weather fetch failed');
      } finally {
        setWeatherLoading(false);
      }
    };

    // Try geolocation, fall back to NYC coordinates
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchForecast(pos.coords.latitude, pos.coords.longitude),
        () => {
          console.warn('[Odara Weather] Geolocation denied, using default location');
          fetchForecast(40.7128, -74.006); // NYC fallback
        },
        { timeout: 5000 }
      );
    } else {
      fetchForecast(40.7128, -74.006);
    }
  }, []);

  const getTemperature = (dateStr: string): number => {
    // Direct match
    if (weatherByDate[dateStr] != null) return weatherByDate[dateStr];

    // No data loaded — use fallback
    const dates = Object.keys(weatherByDate);
    if (dates.length === 0) return FALLBACK_TEMPERATURE;

    // Outside range — use closest available date
    const sorted = dates.sort();
    if (dateStr < sorted[0]) return weatherByDate[sorted[0]];
    if (dateStr > sorted[sorted.length - 1]) return weatherByDate[sorted[sorted.length - 1]];

    return FALLBACK_TEMPERATURE;
  };

  return { weatherByDate, weatherLoading, weatherError, getTemperature };
}
