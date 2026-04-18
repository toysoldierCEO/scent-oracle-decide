import { useState, useEffect, useRef, useCallback } from 'react';

const DEV_FALLBACK_TEMPERATURE = 75;
const STALE_MS = 10 * 60 * 1000; // 10 minutes

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export type WeatherByDate = Record<string, number>; // "YYYY-MM-DD" → °F (daily max)

/** Local YYYY-MM-DD (matches selectedDate format produced via toISOString().split('T')[0] callers,
 *  but we also expose a local-tz variant since Open-Meteo `daily.time` is in the requested timezone). */
function todayLocalKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface UseWeatherResult {
  weatherByDate: WeatherByDate;
  /** Live current temperature (°F) — apparent_temperature preferred, falls back to temperature_2m. */
  currentTemperature: number | null;
  /** timestamp of last successful fetch, or null */
  fetchedAt: number | null;
  weatherLoading: boolean;
  weatherError: string | null;
  /**
   * Resolved temperature for a date.
   * - Today (local) → live `currentTemperature` (NOT daily max).
   * - Other dates → daily max for that date.
   * - Falls back to nearest date, then DEV_FALLBACK.
   */
  getTemperature: (dateStr: string) => number;
  /** True when data exists but is older than STALE_MS */
  isStale: boolean;
}

/**
 * Lightweight weather hook — single fetch on mount, re-fetch on visibility
 * return when stale. No polling interval. Minimal state.
 */
export function useWeather(): UseWeatherResult {
  const [weatherByDate, setWeatherByDate] = useState<WeatherByDate>({});
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const fetchedAtRef = useRef<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const coordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const fetchingRef = useRef(false);

  const fetchForecast = useCallback(async (lat: number, lon: number) => {
    if (fetchingRef.current) return; // prevent concurrent fetches
    fetchingRef.current = true;
    setWeatherLoading(true);

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
        if (dates[i] && temps[i] != null) map[dates[i]] = Math.round(temps[i]);
      }

      const now = Date.now();
      fetchedAtRef.current = now;
      setFetchedAt(now);
      setWeatherByDate(map);
      setWeatherError(null);
      console.log('[Odara Weather] OK', { lat, lon, days: dates.length, fetchedAt: now });
    } catch (e: any) {
      console.warn('[Odara Weather] fail:', e?.message);
      setWeatherError(e?.message ?? 'Weather fetch failed');
    } finally {
      setWeatherLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  const doRefresh = useCallback(() => {
    const c = coordsRef.current;
    if (c) {
      fetchForecast(c.lat, c.lon);
      return;
    }
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          coordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          fetchForecast(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          coordsRef.current = { lat: 40.7128, lon: -74.006 };
          fetchForecast(40.7128, -74.006);
        },
        { timeout: 5000 },
      );
    } else {
      coordsRef.current = { lat: 40.7128, lon: -74.006 };
      fetchForecast(40.7128, -74.006);
    }
  }, [fetchForecast]);

  // Fetch once on mount
  useEffect(() => {
    doRefresh();
  }, [doRefresh]);

  // Re-fetch on visibility return when stale — no interval, no polling
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const age = fetchedAtRef.current ? Date.now() - fetchedAtRef.current : Infinity;
      if (age > STALE_MS) {
        console.log('[Odara Weather] visibility refresh (stale)');
        doRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [doRefresh]);

  const isStale = fetchedAt != null && Date.now() - fetchedAt > STALE_MS;

  const getTemperature = useCallback((dateStr: string): number => {
    if (weatherByDate[dateStr] != null) return weatherByDate[dateStr];
    const keys = Object.keys(weatherByDate);
    if (keys.length === 0) return DEV_FALLBACK_TEMPERATURE;
    const sorted = keys.sort();
    if (dateStr < sorted[0]) return weatherByDate[sorted[0]];
    if (dateStr > sorted[sorted.length - 1]) return weatherByDate[sorted[sorted.length - 1]];
    return DEV_FALLBACK_TEMPERATURE;
  }, [weatherByDate]);

  return { weatherByDate, fetchedAt, weatherLoading, weatherError, getTemperature, isStale };
}
