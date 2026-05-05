import { useState, useEffect, useCallback, useRef } from "react";

const CAMP_LAT = 35.9771;
const CAMP_LON = -78.5097;
const LOCATION_LABEL = "Camp Kanata · Wake Forest, NC";

interface SnowData {
  soFar: number;
  stillToCome: number;
  totalLow: number;
  totalHigh: number;
  peakHour: string | null;
  hourly: HourlySnow[];
  lastUpdated: Date;
}

interface HourlySnow {
  hour: string;
  amount: number;
  isPast: boolean;
}

async function fetchSnowData(): Promise<SnowData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(CAMP_LAT));
  url.searchParams.set("longitude", String(CAMP_LON));
  url.searchParams.set("hourly", "snowfall");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("past_days", "1");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather API failed");
  const json = await res.json();

  const times: string[] = json.hourly?.time ?? [];
  const snowfallCm: number[] = json.hourly?.snowfall ?? [];

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(startOfToday);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);

  let soFar = 0;
  let stillToCome = 0;
  const hourly: HourlySnow[] = [];

  for (let i = 0; i < times.length; i++) {
    const time = new Date(times[i]);
    if (time < startOfToday || time >= endOfTomorrow) continue;

    const inches = cmToInches(snowfallCm[i] ?? 0);
    const isPast = time <= now;

    if (isPast) {
      soFar += inches;
    } else {
      stillToCome += inches;
    }

    hourly.push({
      hour: formatHour(time),
      amount: inches,
      isPast,
    });
  }

  const totalLow = round1(Math.max(0, soFar + stillToCome * 0.8));
  const totalHigh = round1(soFar + stillToCome * 1.2);

  const futurePeak = hourly.filter((h) => !h.isPast && h.amount > 0).sort((a, b) => b.amount - a.amount)[0];

  return {
    soFar: round1(soFar),
    stillToCome: round1(stillToCome),
    totalLow,
    totalHigh,
    peakHour: futurePeak?.hour ?? null,
    hourly,
    lastUpdated: new Date(),
  };
}

function cmToInches(cm: number): number {
  return cm * 0.393701;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatHour(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", hour12: true });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}

const MAX_BAR_INCHES = 1.5;

export default function App() {
  const [data, setData] = useState<SnowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSnowData();
      setData(result);
    } catch {
      setError("Data unavailable – try again");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(load, 10 * 60 * 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, load]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 py-10 max-w-md mx-auto">
      {/* Header */}
      <div className="w-full mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <SnowflakeIcon />
          <h1 className="text-2xl font-bold tracking-tight">Winter Watch</h1>
        </div>
        <p className="text-sm text-muted-foreground">{LOCATION_LABEL}</p>
      </div>

      {/* Snow Stats Card */}
      <div className="w-full rounded-2xl bg-card border border-border p-6 mb-5 shadow-sm">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <AlertIcon />
            <p className="text-destructive text-sm font-medium">{error}</p>
          </div>
        ) : loading && !data ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner />
            <p className="text-muted-foreground text-sm">Fetching snow data…</p>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <StatRow label="Snow so far" value={data.soFar} />
            <div className="h-px bg-border" />
            <StatRow label="Still to come" value={data.stillToCome} />
            <div className="h-px bg-border" />

            {/* Total range */}
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-sm font-medium">Total expected</span>
              <span className="text-3xl font-bold text-primary tabular-nums">
                {data.totalLow}–{data.totalHigh}
                <span className="text-base font-normal text-muted-foreground ml-1">in</span>
              </span>
            </div>

            {/* Peak time badge */}
            {data.peakHour && (
              <div className="rounded-xl bg-muted px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Peak snow time</span>
                <span className="text-xs font-semibold text-foreground">{data.peakHour}</span>
              </div>
            )}

            {/* Hourly graph */}
            {data.hourly.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Hour-by-hour forecast</p>
                <div className="flex items-end gap-[3px] h-16 overflow-x-auto">
                  {data.hourly.map((h, i) => {
                    const pct = h.amount > 0
                      ? Math.max(10, Math.min(100, (h.amount / MAX_BAR_INCHES) * 100))
                      : 3;
                    return (
                      <div key={i} className="flex flex-col items-center flex-1 min-w-[18px] gap-[3px]">
                        <div className="w-full flex items-end" style={{ height: "44px" }}>
                          <div
                            className={`w-full rounded-sm transition-all ${
                              h.isPast ? "bg-muted-foreground/35" : "bg-primary/75"
                            }`}
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                        {i % 4 === 0 && (
                          <span className="text-[9px] text-muted-foreground leading-none whitespace-nowrap">
                            {h.hour.replace(" ", "")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/70 text-right">
              Updated {formatTime(data.lastUpdated)}
            </p>
          </div>
        ) : null}
      </div>

      {/* Check Again button */}
      <button
        onClick={load}
        disabled={loading}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base tracking-wide transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 mb-4 shadow-md"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner small />
            Checking…
          </span>
        ) : (
          "Check Again"
        )}
      </button>

      {/* Auto Refresh toggle */}
      <div className="w-full flex items-center justify-between px-1">
        <div>
          <p className="text-sm font-medium">Auto Refresh</p>
          <p className="text-xs text-muted-foreground">Updates every 10 minutes</p>
        </div>
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${
            autoRefresh ? "bg-primary" : "bg-muted"
          }`}
          role="switch"
          aria-checked={autoRefresh}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${
              autoRefresh ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {autoRefresh && (
        <p className="text-xs text-primary/80 w-full px-1 mt-1.5">
          Auto-refresh is on
        </p>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <span className="text-3xl font-bold text-foreground tabular-nums">
        {value.toFixed(1)}
        <span className="text-base font-normal text-muted-foreground ml-1">in</span>
      </span>
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg
      className={`animate-spin text-primary-foreground ${small ? "w-4 h-4" : "w-6 h-6 text-primary"}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary"
    >
      <line x1="2" x2="22" y1="12" y2="12" />
      <line x1="12" x2="12" y1="2" y2="22" />
      <path d="m20 16-4-4 4-4" />
      <path d="m4 8 4 4-4 4" />
      <path d="m16 4-4 4-4-4" />
      <path d="m8 20 4-4 4 4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-destructive"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
