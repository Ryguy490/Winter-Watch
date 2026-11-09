import { useState, useEffect, useCallback, useRef } from "react";

const CAMP_LAT = 35.9771;
const CAMP_LON = -78.5097;
const LOCATION_LABEL = "Camp Kanata · Wake Forest, NC";

type PrecipType = "snow" | "ice" | "rain" | "mixed" | "none";

interface HourPoint {
  label: string;
  temp: number;
  precip: number;
  type: PrecipType;
  isPast: boolean;
}

type PrecipSelection = "rain" | "mixed" | "snow" | "ice" | "total";
type ChartMode = "precipitation" | "intensity";
type PrecipTotals = Record<PrecipSelection, number>;

interface DayOption {
  key: string;
  label: string;
}

interface DayForecast {
  key: string;
  points: HourPoint[];
  totals: PrecipTotals;
  peakHour: string | null;
}

interface SnowData {
  days: DayForecast[];
  lastUpdated: Date;
}

const PRECIP_COLORS: Record<PrecipType, string> = {
  snow:  "#60a5fa",
  ice:   "#f472b6",
  rain:  "#4ade80",
  mixed: "#c084fc",
  none:  "#1e3a5f",
};

const LEGEND_ITEMS: { type: PrecipType; label: string }[] = [
  { type: "rain",  label: "Rain"  },
  { type: "mixed", label: "Mixed" },
  { type: "snow",  label: "Snow"  },
  { type: "ice",   label: "Ice"   },
];

const PRECIP_SELECTIONS: { value: PrecipSelection; label: string }[] = [
  { value: "rain", label: "Rain" },
  { value: "mixed", label: "Mixed" },
  { value: "snow", label: "Snow" },
  { value: "ice", label: "Ice" },
  { value: "total", label: "Total" },
];

function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDayOptions(todayKey: string): DayOption[] {
  return Array.from({ length: 8 }, (_, index) => {
    const offset = index - 1;
    const date = dateFromKey(todayKey);
    date.setDate(date.getDate() + offset);
    return {
      key: getDateKey(date),
      label: offset === -1
        ? "Yesterday"
        : offset === 0
          ? "Today"
          : date.toLocaleDateString(undefined, { weekday: "long" }),
    };
  });
}

function createDayForecast(key: string, points: HourPoint[]): DayForecast {
  const totals: PrecipTotals = { rain: 0, mixed: 0, snow: 0, ice: 0, total: 0 };
  for (const point of points) {
    if (point.type === "none") continue;
    totals[point.type] += point.precip;
    totals.total += point.precip;
  }
  const peak = points
    .filter((point) => !point.isPast && point.type === "snow" && point.precip > 0)
    .sort((a, b) => b.precip - a.precip)[0];

  return {
    key,
    points,
    totals: {
      rain: round1(totals.rain),
      mixed: round1(totals.mixed),
      snow: round1(totals.snow),
      ice: round1(totals.ice),
      total: round1(totals.total),
    },
    peakHour: peak?.label ?? null,
  };
}

function getMetricStats(day: DayForecast | null, selection: PrecipSelection) {
  let soFar = 0;
  let stillToCome = 0;
  if (day) {
    for (const point of day.points) {
      const matches = selection === "total"
        ? point.type !== "none"
        : point.type === selection;
      if (!matches) continue;
      if (point.isPast) soFar += point.precip;
      else stillToCome += point.precip;
    }
  }
  const total = round1(soFar + stillToCome);
  return {
    total,
    soFar: round1(soFar),
    stillToCome: round1(stillToCome),
    totalLow: round1(Math.max(0, total * 0.85)),
    totalHigh: round1(total * 1.15),
  };
}

async function fetchSnowData(todayKey: string): Promise<SnowData> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(CAMP_LAT));
  url.searchParams.set("longitude", String(CAMP_LON));
  url.searchParams.set("hourly", "snowfall,temperature_2m,precipitation,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("past_days", "1");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather API failed");
  const json = await res.json();

  const times: string[]  = json.hourly?.time ?? [];
  const snowCm: number[] = json.hourly?.snowfall ?? [];
  const precipMm: number[] = json.hourly?.precipitation ?? [];
  const temps: number[]  = json.hourly?.temperature_2m ?? [];
  const codes: number[]  = json.hourly?.weather_code ?? [];

  const now = new Date();
  const dayKeys = new Set(getDayOptions(todayKey).map((day) => day.key));
  const groupedPoints = new Map<string, HourPoint[]>();

  for (let i = 0; i < times.length; i++) {
    const key = times[i].slice(0, 10);
    if (!dayKeys.has(key)) continue;
    // Open-Meteo returns wall-clock timestamps in the requested timezone without an offset.
    // Parse them as local time instead of letting Date treat them as UTC.
    const time = parseApiLocalTime(times[i]);
    const temp   = temps[i] ?? 32;
    const type = wmoToPrecipType(codes[i] ?? 0, temp);
    const inches = type === "snow"
      ? cmToInches(snowCm[i] ?? 0)
      : type === "none"
        ? 0
        : mmToInches(precipMm[i] ?? 0);
    const isPast = time <= now;
    const points = groupedPoints.get(key) ?? [];
    points.push({ label: formatHour(time), temp, precip: inches, type, isPast });
    groupedPoints.set(key, points);
  }

  const days = getDayOptions(todayKey).map((day) =>
    createDayForecast(day.key, groupedPoints.get(day.key) ?? [])
  );
  return { days, lastUpdated: new Date() };
}

function wmoToPrecipType(code: number, temp: number): PrecipType {
  if ([0,1,2,3].includes(code)) return "none";
  if ([56, 57, 66, 67].includes(code)) return "ice";
  if (code >= 71 && code <= 77)  return "snow";
  if (code >= 85 && code <= 86)  return "snow";
  if (code >= 51 && code <= 67)  return temp <= 32 ? "mixed" : "rain";
  if (code >= 80 && code <= 82)  return temp <= 32 ? "mixed" : "rain";
  return "none";
}

function cmToInches(cm: number)  { return cm * 0.393701; }
function mmToInches(mm: number)  { return mm * 0.0393701; }
function round1(n: number)       { return Math.round(n * 10) / 10; }
function parseApiLocalTime(value: string): Date {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function formatHour(d: Date)     { return d.toLocaleTimeString([], { hour: "numeric", hour12: true }); }
function formatTime(d: Date)     { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }); }

// ── Chart layout ─────────────────────────────────────────────────────────────
const VW = 320, VH = 158;
const LP = 56, RP = 34, TP = 10, BP = 28;
const CW = VW - LP - RP;
const CH = VH - TP - BP;
const MAX_PRECIP = 0.7;

function ptX(i: number, n: number) { return LP + (i / (n - 1)) * CW; }
function tempY(t: number, min: number, max: number) {
  return TP + (1 - (t - min) / (max - min)) * CH;
}
function precipY(p: number)         { return TP + (1 - p / MAX_PRECIP) * CH; }

// Catmull-Rom control points for smooth bezier segments
function catmullControlPoints(pts: {x:number; y:number}[], i: number) {
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  // Keep each curve between its hourly endpoints so smoothing never creates
  // exaggerated peaks or dips beyond the actual forecast values.
  const lowY = Math.min(p1.y, p2.y);
  const highY = Math.max(p1.y, p2.y);
  const clampY = (value: number) => Math.max(lowY, Math.min(highY, value));
  return {
    cp1: {
      x: p1.x + (p2.x - p0.x) / 6,
      y: clampY(p1.y + (p2.y - p0.y) / 6),
    },
    cp2: {
      x: p2.x - (p3.x - p1.x) / 6,
      y: clampY(p2.y - (p3.y - p1.y) / 6),
    },
  };
}

function smoothPath(pts: {x:number; y:number}[]): string {
  if (pts.length < 2) return "";
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const { cp1, cp2 } = catmullControlPoints(pts, i);
    d += ` C ${f(cp1.x)} ${f(cp1.y)}, ${f(cp2.x)} ${f(cp2.y)}, ${f(pts[i+1].x)} ${f(pts[i+1].y)}`;
  }
  return d;
}

// Map Fahrenheit temperatures to a cool-to-warm color scale.
function temperatureColor(temp: number): string {
  const stops = [
    { temp: 10, color: [59, 130, 246] },
    { temp: 25, color: [34, 211, 238] },
    { temp: 40, color: [45, 212, 191] },
    { temp: 55, color: [250, 204, 21] },
    { temp: 70, color: [251, 146, 60] },
    { temp: 85, color: [239, 68, 68] },
  ];
  const bounded = Math.max(stops[0].temp, Math.min(stops[stops.length - 1].temp, temp));
  const upperIndex = stops.findIndex((stop) => stop.temp >= bounded);
  if (upperIndex <= 0) return `rgb(${stops[0].color.join(",")})`;
  const lower = stops[upperIndex - 1];
  const upper = stops[upperIndex];
  const ratio = (bounded - lower.temp) / (upper.temp - lower.temp);
  const rgb = lower.color.map((channel, index) => Math.round(channel + (upper.color[index] - channel) * ratio));
  return `rgb(${rgb.join(",")})`;
}

function f(n: number) { return n.toFixed(2); }

// ── Weather Chart ─────────────────────────────────────────────────────────────
function WeatherChart({ points, mode }: { points: HourPoint[]; mode: ChartMode }) {
  const n = points.length;
  const hasGraphData = n >= 2;

  // Fit the temperature axis to this selected day's forecast high and low.
  // A little padding keeps the line away from the chart edges, even on mild days.
  const dayLow = points.length ? Math.min(...points.map((point) => point.temp)) : 0;
  const dayHigh = points.length ? Math.max(...points.map((point) => point.temp)) : 1;
  const rawRange = Math.max(dayHigh - dayLow, 2);
  const padding = Math.max(2, rawRange * 0.15);
  const tempMin = Math.floor((dayLow - padding) / 2) * 2;
  const tempMax = Math.ceil((dayHigh + padding) / 2) * 2;
  const tempTicks = Array.from({ length: 5 }, (_, index) =>
    tempMin + ((tempMax - tempMin) * index) / 4
  );
  const tempPts = hasGraphData
    ? points.map((p, i) => ({ x: ptX(i, n), y: tempY(p.temp, tempMin, tempMax) }))
    : [];
  // Lift zero values slightly above the baseline so a dry-weather line remains visible.
  const precipPts = hasGraphData ? points.map((p, i) => ({ x: ptX(i, n), y: precipY(p.precip === 0 ? 0.015 : p.precip) })) : [];
  const noPrecipitationColor = "#a1a1aa";
  // Hourly precipitation amount (inches) determines the intensity tier.
  // The tiers are fixed so different selected days remain comparable.
  const intensityFor = (amount: number): { level: number; label: string } | null => {
    if (amount <= 0) return null;
    if (amount > 0.3) return { level: 4, label: "Extreme" };
    if (amount > 0.15) return { level: 3, label: "Heavy" };
    if (amount > 0.05) return { level: 2, label: "Medium" };
    return { level: 1, label: "Light" };
  };

  const lastPastIdx = points.reduce((acc, p, i) => (p.isPast ? i : acc), -1);
  const nowX = lastPastIdx >= 0 && lastPastIdx < n - 1
    ? ptX(lastPastIdx + 0.5, n)
    : -1;
  const pastEndX = lastPastIdx >= 0
    ? (nowX > LP ? nowX : LP + CW)
    : LP;

  const xAxisTicks = [0, 4, 8, 12, 16, 20].filter((i) => i < n);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ overflow: "visible" }}>
      <defs>
        <pattern id="no-graph-hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="#9ca3af" strokeWidth="2" opacity="0.42" />
        </pattern>
      </defs>

      {/* Shade the historical chart area without changing either line color */}
      {pastEndX > LP && (
        <rect x={LP} y={TP} width={pastEndX - LP} height={CH}
          fill="#94a3b8" opacity="0.18" />
      )}

      {/* Horizontal grid lines */}
      {tempTicks.map((t) => (
        <line key={t} x1={LP} y1={tempY(t, tempMin, tempMax)} x2={LP + CW} y2={tempY(t, tempMin, tempMax)}
          stroke="#1e3a5f" strokeWidth="0.75" strokeDasharray="4,4" />
      ))}

      {/* "Now" divider */}
      {nowX > 0 && (
        <>
          <line x1={nowX} y1={TP - 4} x2={nowX} y2={TP + CH + 4}
            stroke="#cbd5e1" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.35" />
          <text x={nowX + 3} y={TP + 8} fontSize="6.5" fill="#94a3b8" opacity="0.9">Now</text>
        </>
      )}

      {/* Precipitation line or hourly intensity bars */}
      {mode === "precipitation" && hasGraphData && points.map((p, i) => {
        if (i === n - 1) return null;
        const next = points[i + 1];
        const segmentType: PrecipType = p.precip > 0 ? p.type : next.precip > 0 ? next.type : "none";
        const { cp1, cp2 } = catmullControlPoints(precipPts, i);
        const segPath = `M ${f(precipPts[i].x)} ${f(precipPts[i].y)} C ${f(cp1.x)} ${f(cp1.y)}, ${f(cp2.x)} ${f(cp2.y)}, ${f(precipPts[i+1].x)} ${f(precipPts[i+1].y)}`;
        return <path key={`pr-${i}`} d={segPath} fill="none"
          stroke={segmentType === "none" ? noPrecipitationColor : PRECIP_COLORS[segmentType]}
          strokeWidth="2.4" strokeLinecap="round" />;
      })}
      {mode === "intensity" && hasGraphData && points.map((point, i) => {
        const intensity = intensityFor(point.precip);
        if (!intensity) return null;
        const barHeight = CH * (intensity.level / 4);
        const barWidth = Math.max(3, Math.min(8, CW / n * 0.58));
        return <rect key={`intensity-${i}`}
          x={ptX(i, n) - barWidth / 2} y={TP + CH - barHeight}
          width={barWidth} height={barHeight} rx="1.2"
          fill={PRECIP_COLORS[point.type]} opacity="0.95" />;
      })}
      {mode === "intensity" && ["Extreme", "Heavy", "Medium", "Light"].map((label, index) => {
        const y = TP + (index * CH / 4) + 2.5;
        return <text key={label} x={LP - 5} y={y} textAnchor="end"
          fontSize="6.5" fill="#cbd5e1" opacity="0.9">{label}</text>;
      })}

      {/* Temperature — dark halo plus per-segment cool-to-warm colors.
          The halo keeps this line distinct where it crosses precipitation. */}
      {mode === "precipitation" && hasGraphData && <path d={smoothPath(tempPts)}
        fill="none" stroke="#071426" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" opacity="0.95" />}
      {mode === "precipitation" && hasGraphData && points.map((point, i) => {
        if (i === n - 1) return null;
        const { cp1, cp2 } = catmullControlPoints(tempPts, i);
        const segmentPath = `M ${f(tempPts[i].x)} ${f(tempPts[i].y)} C ${f(cp1.x)} ${f(cp1.y)}, ${f(cp2.x)} ${f(cp2.y)}, ${f(tempPts[i + 1].x)} ${f(tempPts[i + 1].y)}`;
        return <path key={`temp-${i}`} d={segmentPath} fill="none"
          stroke={temperatureColor((point.temp + points[i + 1].temp) / 2)}
          strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" />;
      })}

      {/* Left Y axis — temperature */}
      {mode === "precipitation" && tempTicks.map((t) => (
        <text key={`tl-${t}`} x={LP - 4} y={tempY(t, tempMin, tempMax) + 2.5}
          textAnchor="end" fontSize="7" fill="#bae6fd" opacity="0.9">{Math.round(t)}°</text>
      ))}

      {/* Right Y axis — precipitation */}
      {mode === "precipitation" && [0, 0.3, 0.6].map((p) => (
        <text key={`pr-${p}`} x={LP + CW + 4} y={precipY(p) + 2.5}
          textAnchor="start" fontSize="7" fill="#60a5fa" opacity="0.7">{p}"</text>
      ))}

      {/* X axis labels */}
      {hasGraphData && xAxisTicks.map((i) => (
        <text key={`xl-${i}`} x={f(ptX(i, n))} y={VH - 4}
          textAnchor="middle" fontSize="7" fill="#64748b">{points[i].label}</text>
      ))}

      {!hasGraphData && (
        <>
          <rect x={LP} y={TP} width={CW} height={CH} fill="#64748b" opacity="0.18" />
          <rect x={LP} y={TP} width={CW} height={CH} fill="url(#no-graph-hatch)" />
          <text x={LP + CW / 2} y={TP + CH / 2} textAnchor="middle" dominantBaseline="middle"
            fontSize="10" fontWeight="700" fill="#e2e8f0" stroke="#0b1628" strokeWidth="2.5" paintOrder="stroke">
            No Graph Data Available
          </text>
        </>
      )}

      {/* Axes */}
      <line x1={LP} y1={TP} x2={LP} y2={TP + CH} stroke="#1e3a5f" strokeWidth="1" />
      <line x1={LP + CW} y1={TP} x2={LP + CW} y2={TP + CH} stroke="#1e3a5f" strokeWidth="1" />
      <line x1={LP} y1={TP + CH} x2={LP + CW} y2={TP + CH} stroke="#1e3a5f" strokeWidth="1" />
    </svg>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState<SnowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todayKey, setTodayKey] = useState(() => getDateKey(new Date()));
  const [selectedDayKey, setSelectedDayKey] = useState(() => getDateKey(new Date()));
  const [precipSelection, setPrecipSelection] = useState<PrecipSelection>("snow");
  const [chartMode, setChartMode] = useState<ChartMode>("precipitation");
  const requestInProgressRef = useRef(false);

  const dayOptions = getDayOptions(todayKey);
  const selectedDay = data?.days.find((day) => day.key === selectedDayKey) ?? null;
  const metrics = getMetricStats(selectedDay, precipSelection);
  const isTodaySelected = selectedDayKey === todayKey;
  const yesterdayDate = dateFromKey(todayKey);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const isYesterdaySelected = selectedDayKey === getDateKey(yesterdayDate);
  const metricName = precipSelection === "total"
    ? "Precipitation"
    : PRECIP_SELECTIONS.find((option) => option.value === precipSelection)?.label ?? "Snow";

  const load = useCallback(async (showLoading = true) => {
    if (requestInProgressRef.current) return;
    requestInProgressRef.current = true;
    if (showLoading) setLoading(true);
    try {
      setData(await fetchSnowData(todayKey));
      setError(null);
    } catch {
      setError("Data unavailable – showing the last successful update");
    } finally {
      requestInProgressRef.current = false;
      if (showLoading) setLoading(false);
    }
  }, [todayKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      const nextTodayKey = getDateKey(new Date());
      if (nextTodayKey === todayKey) return;
      setTodayKey(nextTodayKey);
      setSelectedDayKey((current) => current === todayKey ? nextTodayKey : current);
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [todayKey]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(false), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10 max-w-md mx-auto">

      {/* Header */}
      <div className="w-full mb-7 text-center">
        <div className="inline-flex flex-col items-center gap-1 rounded-2xl px-6 py-4"
          style={{ background: "rgba(8,18,38,0.72)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <div className="flex items-center gap-2.5 mb-0.5">
            <img
              src="/winter-watch-icon.png"
              alt=""
              width={40}
              height={40}
              className="rounded-[22%] object-cover"
              aria-hidden="true"
            />
            <h1 className="text-2xl font-bold tracking-tight text-white">Winter Watch</h1>
          </div>
          <p className="text-sm" style={{ color: "#93c5fd" }}>{LOCATION_LABEL}</p>
        </div>
      </div>

      {/* Stats card */}
      <div className="w-full rounded-2xl border border-border p-6 mb-5 shadow-lg"
        style={{ background: "rgba(10,22,44,0.88)", backdropFilter: "blur(8px)" }}>
        {error && !data ? (
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
          <div className="space-y-4">
            {error && (
              <p className="text-xs text-amber-200/80 text-center">{error}</p>
            )}

            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Day
                </p>
                <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Choose forecast day">
                  {dayOptions.map(({ key, label }) => {
                    const selected = selectedDayKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedDayKey(key)}
                        className={`min-w-0 rounded-lg border px-1 py-2 text-[10px] font-semibold leading-tight transition-colors ${
                          selected
                            ? "border-blue-300/70 bg-blue-400/25 text-white"
                            : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Precipitation type
                </p>
                <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Choose precipitation type">
                  {PRECIP_SELECTIONS.map(({ value, label }) => {
                    const selected = precipSelection === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setPrecipSelection(value)}
                        className={`rounded-lg border px-1 py-2 text-[10px] font-semibold transition-colors ${
                          selected
                            ? "border-blue-300/70 bg-blue-400/25 text-white"
                            : "border-white/10 bg-white/[0.04] text-muted-foreground hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {isTodaySelected && (
              <>
                <StatRow label={`${metricName} so far`} value={metrics.soFar} />
                <div className="h-px bg-border" />
                <StatRow label={`${metricName} to come`} value={metrics.stillToCome} />
                <div className="h-px bg-border" />
              </>
            )}

            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-sm font-medium">
                {isTodaySelected ? "Total expected" : "Total"}
              </span>
              <span className="text-3xl font-bold text-primary tabular-nums">
                {metrics.total === 0
                  ? "0"
                  : isYesterdaySelected
                    ? metrics.total.toFixed(1)
                    : `${metrics.totalLow}–${metrics.totalHigh}`}
                <span className="text-base font-normal text-muted-foreground ml-1">in</span>
              </span>
            </div>

            {selectedDay?.peakHour && (
              <div className="rounded-xl px-4 py-2.5 flex items-center justify-between"
                style={{ background: "rgba(30,58,95,0.55)" }}>
                <span className="text-xs text-muted-foreground">Peak snow time</span>
                <span className="text-xs font-semibold">{selectedDay.peakHour}</span>
              </div>
            )}

            {/* Selected-day hourly chart, with a totals-only fallback */}
            {(
              <div className="mt-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Hour-by-hour</p>
                  <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.04] p-0.5" role="group" aria-label="Graph display">
                    {(["precipitation", "intensity"] as const).map((mode) => (
                      <button key={mode} type="button" aria-pressed={chartMode === mode}
                        onClick={() => setChartMode(mode)}
                        className={`rounded-md px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${
                          chartMode === mode ? "bg-blue-400/25 text-white" : "text-muted-foreground hover:text-white"
                        }`}>
                        {mode}
                      </button>
                    ))}
                  </div>
                  <div className="hidden sm:flex items-center gap-3">
                    {chartMode === "precipitation" && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="inline-block w-5 h-[3px] rounded-full" style={{ background: "linear-gradient(90deg, #3b82f6, #22d3ee, #2dd4bf, #facc15, #fb923c, #ef4444)", boxShadow: "0 0 0 1px rgba(7,20,38,0.9)" }} />
                        Temp
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="inline-block w-4 h-[3px] rounded-full" style={{ background: "linear-gradient(90deg, #4ade80 0 25%, #c084fc 25% 50%, #60a5fa 50% 75%, #f472b6 75%)" }} />
                      Precip
                    </span>
                  </div>
                </div>

                <WeatherChart points={selectedDay?.points ?? []} mode={chartMode} />

                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                  {LEGEND_ITEMS.map(({ type, label }) => (
                    <div key={type} className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PRECIP_COLORS[type] }} />
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-right" style={{ color: "#cbd5e1" }}>
              Updated {formatTime(data.lastUpdated)}
            </p>
          </div>
        ) : null}
      </div>

      {/* Check Again */}
      <button onClick={() => void load()} disabled={loading}
        className="w-full py-4 rounded-2xl font-bold text-base tracking-wide transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 mb-4 shadow-md"
        style={{ background: "hsl(210 82% 58%)", color: "hsl(220 30% 7%)" }}>
        {loading ? (
          <span className="flex items-center justify-center gap-2"><Spinner small />Checking…</span>
        ) : "Check Again"}
      </button>

      <p className="w-full px-1 text-xs text-muted-foreground text-center">
        Updates automatically every 5 minutes
      </p>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <span className="text-3xl font-bold tabular-nums">
        {value === 0 ? "0" : value.toFixed(1)}
        <span className="text-base font-normal text-muted-foreground ml-1">in</span>
      </span>
    </div>
  );
}

function PrecipitationTotals({ day }: { day: DayForecast | null }) {
  const categories = [
    { type: "snow", label: "Snow" },
    { type: "mixed", label: "Mixed" },
    { type: "ice", label: "Ice" },
    { type: "rain", label: "Rain" },
  ] as const;

  return (
    <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Hourly graph unavailable · daily totals
      </p>
      {day ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {categories.map(({ type, label }) => (
            <div key={type} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: PRECIP_COLORS[type] }} />
                {label}
              </span>
              <span className="text-xs font-semibold tabular-nums">
                {day.totals[type].toFixed(1)} in
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No daily totals are available for this date.</p>
      )}
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg className={`animate-spin ${small ? "w-4 h-4" : "w-6 h-6 text-primary"}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="text-destructive">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
