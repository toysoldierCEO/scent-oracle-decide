import { useState, useEffect, useRef, useCallback } from 'react';

const DEV_FALLBACK_TEMPERATURE = 75;
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const REFETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export type WeatherByDate = Record<string, number>; // "YYYY-MM-DD" → °F

export interface WeatherState {
  temperature_f: number | null;
  fetchedAt: number | null;     // Date.now() of last successful fetch
  source: 'live' | 'fallback' | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
}

interface UseWeatherResult {
  weatherByDate: WeatherByDate;
  weather: WeatherState;
  /** Resolved temperature for a specific date. Returns null only if no data at all. */
  getTemperature: (dateStr: string) => number;
  /** Force-refresh weather now */
  refresh: () => void;
}

/**
 * Fetches 7-day weather forecast with auto-refresh and freshness tracking.
 * - Fetches on mount
 * - Refreshes every 10 minutes
 * - Refreshes on window focus (if stale)
 * - Uses browser geolocation, falls back to NYC
 */
export function useWeather(): UseWeatherResult {
  const [weatherByDate, setWeatherByDate] = useState<WeatherByDate>({});
  const [weather, setWeather] = useState<WeatherState>({
    temperature_f: null,
    fetchedAt: null,
    source: null,
    stale: false,
    loading: true,
    error: null,
  });

  const coordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchForecast = useCallback(async (lat: number, lon: number) => {
    setWeather(prev => ({ ...prev, loading: true, error: null }));

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

      // Today's temperature
      const today = new Date().toISOString().split('T')[0];
      const todayTemp = map[today] ?? (temps.length > 0 ? Math.round(temps[0]) : null);

      const now = Date.now();
      console.log('[Odara Weather] fetch success', { lat, lon, todayTemp, dates: dates.length, fetchedAt: now });

      setWeatherByDate(map);
      setWeather({
        temperature_f: todayTemp,
        fetchedAt: now,
        source: 'live',
        stale: false,
        loading: false,
        error: null,
      });
    } catch (e: any) {
      console.warn('[Odara Weather] fetch failed:', e?.message);
      setWeather(prev => ({
        ...prev,
        loading: false,
        error: e?.message ?? 'Weather fetch failed',
        stale: prev.fetchedAt != null, // mark stale if we had old data
        source: prev.source, // keep existing source designation
      }));
    }
  }, []);

  const doRefresh = useCallback(() => {
    const coords = coordsRef.current;
    if (coords) {
      fetchForecast(coords.lat, coords.lon);
    } else {
      // Try geolocation again, fall back to NYC
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
          { timeout: 5000 }
        );
      } else {
        coordsRef.current = { lat: 40.7128, lon: -74.006 };
        fetchForecast(40.7128, -74.006);
      }
    }
  }, [fetchForecast]);

  // Initial fetch
  useEffect(() => {
    doRefresh();
  }, [doRefresh]);

  // Auto-refresh interval
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      console.log('[Odara Weather] auto-refresh triggered');
      doRefresh();
    }, REFETCH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [doRefresh]);

  // Refresh on window focus if stale
  useEffect(() => {
    const handleFocus = () => {
      const { fetchedAt } = weather;
      if (!fetchedAt || (Date.now() - fetchedAt > STALE_THRESHOLD_MS)) {
        console.log('[Odara Weather] focus refresh (stale)');
        doRefresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleFocus();
    });

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [weather.fetchedAt, doRefresh]);

  const getTemperature = useCallback((dateStr: string): number => {
    if (weatherByDate[dateStr] != null) return weatherByDate[dateStr];

    const dates = Object.keys(weatherByDate);
    if (dates.length === 0) return DEV_FALLBACK_TEMPERATURE;

    const sorted = dates.sort();
    if (dateStr < sorted[0]) return weatherByDate[sorted[0]];
    if (dateStr > sorted[sorted.length - 1]) return weatherByDate[sorted[sorted.length - 1]];

    return DEV_FALLBACK_TEMPERATURE;
  }, [weatherByDate]);

  return { weatherByDate, weather, getTemperature, refresh: doRefresh };
}
