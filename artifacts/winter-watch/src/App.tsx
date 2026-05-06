import { useState, useEffect, useCallback, useRef } from "react";

const MOCK_MODE = true;

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

interface SnowData {
  soFar: number;
  stillToCome: number;
  totalLow: number;
  totalHigh: number;
  peakHour: string | null;
  points: HourPoint[];
  lastUpdated: Date;
}

const PRECIP_COLORS: Record<PrecipType, string> = {
  snow:  "#60a5fa",
  ice:   "#94a3b8",
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

const MOCK_POINTS: HourPoint[] = [
  { label: "12AM", temp: 38, precip: 0.10, type: "rain",  isPast: true  },
  { label: "1AM",  temp: 37, precip: 0.15, type: "rain",  isPast: true  },
  { label: "2AM",  temp: 36, precip: 0.20, type: "rain",  isPast: true  },
  { label: "3AM",  temp: 35, precip: 0.15, type: "mixed", isPast: true  },
  { label: "4AM",  temp: 34, precip: 0.22, type: "mixed", isPast: true  },
  { label: "5AM",  temp: 33, precip: 0.28, type: "mixed", isPast: true  },
  { label: "6AM",  temp: 32, precip: 0.38, type: "snow",  isPast: true  },
  { label: "7AM",  temp: 31, precip: 0.48, type: "snow",  isPast: true  },
  { label: "8AM",  temp: 30, precip: 0.55, type: "snow",  isPast: true  },
  { label: "9AM",  temp: 29, precip: 0.60, type: "snow",  isPast: true  },
  { label: "10AM", temp: 28, precip: 0.55, type: "snow",  isPast: false },
  { label: "11AM", temp: 27, precip: 0.45, type: "snow",  isPast: false },
  { label: "12PM", temp: 26, precip: 0.22, type: "ice",   isPast: false },
  { label: "1PM",  temp: 26, precip: 0.18, type: "ice",   isPast: false },
  { label: "2PM",  temp: 27, precip: 0.38, type: "snow",  isPast: false },
  { label: "3PM",  temp: 28, precip: 0.42, type: "snow",  isPast: false },
  { label: "4PM",  temp: 29, precip: 0.32, type: "snow",  isPast: false },
  { label: "5PM",  temp: 30, precip: 0.22, type: "snow",  isPast: false },
  { label: "6PM",  temp: 31, precip: 0.12, type: "snow",  isPast: false },
  { label: "7PM",  temp: 32, precip: 0.06, type: "snow",  isPast: false },
  { label: "8PM",  temp: 33, precip: 0.02, type: "snow",  isPast: false },
  { label: "9PM",  temp: 34, precip: 0.00, type: "none",  isPast: false },
  { label: "10PM", temp: 35, precip: 0.00, type: "none",  isPast: false },
  { label: "11PM", temp: 36, precip: 0.00, type: "none",  isPast: false },
];

function computeStats(points: HourPoint[]): SnowData {
  let soFar = 0, stillToCome = 0;
  for (const p of points) {
    if (p.isPast) soFar += p.precip;
    else stillToCome += p.precip;
  }
  const total = soFar + stillToCome;
  const peak = points.filter((p) => !p.isPast && p.precip > 0).sort((a, b) => b.precip - a.precip)[0];
  return {
    soFar:       round1(soFar),
    stillToCome: round1(stillToCome),
    totalLow:    round1(Math.max(0, total * 0.85)),
    totalHigh:   round1(total * 1.15),
    peakHour:    peak?.label ?? null,
    points,
    lastUpdated: new Date(),
  };
}

async function fetchSnowData(): Promise<SnowData> {
  if (MOCK_MODE) {
    await new Promise((r) => setTimeout(r, 500));
    return computeStats(MOCK_POINTS);
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(CAMP_LAT));
  url.searchParams.set("longitude", String(CAMP_LON));
  url.searchParams.set("hourly", "snowfall,temperature_2m,precipitation,weathercode");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("past_days", "1");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Weather API failed");
  const json = await res.json();

  const times: string[]  = json.hourly?.time ?? [];
  const snowCm: number[] = json.hourly?.snowfall ?? [];
  const temps: number[]  = json.hourly?.temperature_2m ?? [];
  const codes: number[]  = json.hourly?.weathercode ?? [];

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfTomorrow = new Date(startOfToday); endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);

  let soFar = 0, stillToCome = 0;
  const points: HourPoint[] = [];

  for (let i = 0; i < times.length; i++) {
    const time = new Date(times[i]);
    if (time < startOfToday || time >= endOfTomorrow) continue;
    const inches = cmToInches(snowCm[i] ?? 0);
    const temp   = temps[i] ?? 32;
    const isPast = time <= now;
    if (isPast) soFar += inches; else stillToCome += inches;
    points.push({ label: formatHour(time), temp, precip: inches, type: wmoToPrecipType(codes[i] ?? 0, temp), isPast });
  }

  const total = soFar + stillToCome;
  const peak = points.filter((p) => !p.isPast && p.precip > 0).sort((a, b) => b.precip - a.precip)[0];
  return { soFar: round1(soFar), stillToCome: round1(stillToCome), totalLow: round1(Math.max(0, total * 0.8)), totalHigh: round1(total * 1.2), peakHour: peak?.label ?? null, points, lastUpdated: new Date() };
}

function wmoToPrecipType(code: number, temp: number): PrecipType {
  if ([0,1,2,3].includes(code)) return "none";
  if (code === 56 || code === 57) return "ice";
  if (code >= 71 && code <= 77)  return "snow";
  if (code >= 85 && code <= 86)  return "snow";
  if (code >= 51 && code <= 67)  return temp <= 32 ? "mixed" : "rain";
  if (code >= 80 && code <= 82)  return temp <= 32 ? "mixed" : "rain";
  return "none";
}

function cmToInches(cm: number)  { return cm * 0.393701; }
function round1(n: number)       { return Math.round(n * 10) / 10; }
function formatHour(d: Date)     { return d.toLocaleTimeString([], { hour: "numeric", hour12: true }); }
function formatTime(d: Date)     { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }); }

// ── Chart layout ─────────────────────────────────────────────────────────────
const VW = 320, VH = 158;
const LP = 34, RP = 34, TP = 10, BP = 28;
const CW = VW - LP - RP;
const CH = VH - TP - BP;
const MIN_TEMP = 22, MAX_TEMP = 44;
const MAX_PRECIP = 0.7;

function ptX(i: number, n: number) { return LP + (i / (n - 1)) * CW; }
function tempY(t: number)           { return TP + (1 - (t - MIN_TEMP) / (MAX_TEMP - MIN_TEMP)) * CH; }
function precipY(p: number)         { return TP + (1 - p / MAX_PRECIP) * CH; }

// Catmull-Rom control points for smooth bezier segments
function catmullControlPoints(pts: {x:number; y:number}[], i: number) {
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  return {
    cp1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    cp2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
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

function f(n: number) { return n.toFixed(2); }

// ── Weather Chart ─────────────────────────────────────────────────────────────
function WeatherChart({ points }: { points: HourPoint[] }) {
  const n = points.length;
  if (n < 2) return null;

  const tempPts  = points.map((p, i) => ({ x: ptX(i, n), y: tempY(p.temp) }));
  const precipPts = points.map((p, i) => ({ x: ptX(i, n), y: precipY(p.precip) }));

  const lastPastIdx = points.reduce((acc, p, i) => (p.isPast ? i : acc), -1);
  const nowX = lastPastIdx >= 0 && lastPastIdx < n - 1
    ? ptX(lastPastIdx + 0.5, n)
    : -1;

  const xAxisTicks = [0, 4, 8, 12, 16, 20].filter((i) => i < n);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ overflow: "visible" }}>
      {/* Horizontal grid lines */}
      {[24, 30, 36, 42].map((t) => (
        <line key={t} x1={LP} y1={tempY(t)} x2={LP + CW} y2={tempY(t)}
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

      {/* Precipitation — smooth colored segments */}
      {points.map((p, i) => {
        if (i === n - 1) return null;
        const { cp1, cp2 } = catmullControlPoints(precipPts, i);
        const segPath = `M ${f(precipPts[i].x)} ${f(precipPts[i].y)} C ${f(cp1.x)} ${f(cp1.y)}, ${f(cp2.x)} ${f(cp2.y)}, ${f(precipPts[i+1].x)} ${f(precipPts[i+1].y)}`;
        return (
          <path key={`pr-${i}`} d={segPath}
            fill="none" stroke={PRECIP_COLORS[p.type]} strokeWidth="2.4" strokeLinecap="round" />
        );
      })}

      {/* Precip dots */}
      {points.map((p, i) =>
        p.type !== "none" ? (
          <circle key={`pd-${i}`} cx={f(precipPts[i].x)} cy={f(precipPts[i].y)}
            r="2.2" fill={PRECIP_COLORS[p.type]} />
        ) : null
      )}

      {/* Temperature — single smooth path */}
      <path d={smoothPath(tempPts)}
        fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.88" />

      {/* Temp dots (every 4 hrs) */}
      {tempPts.filter((_, i) => i % 4 === 0).map((pt, k) => (
        <circle key={`td-${k}`} cx={f(pt.x)} cy={f(pt.y)} r="2.2" fill="#fbbf24" opacity="0.9" />
      ))}

      {/* Left Y axis — temperature */}
      {[24, 30, 36, 42].map((t) => (
        <text key={`tl-${t}`} x={LP - 4} y={tempY(t) + 2.5}
          textAnchor="end" fontSize="7" fill="#fbbf24" opacity="0.7">{t}°</text>
      ))}

      {/* Right Y axis — precipitation */}
      {[0, 0.3, 0.6].map((p) => (
        <text key={`pr-${p}`} x={LP + CW + 4} y={precipY(p) + 2.5}
          textAnchor="start" fontSize="7" fill="#60a5fa" opacity="0.7">{p}"</text>
      ))}

      {/* X axis labels */}
      {xAxisTicks.map((i) => (
        <text key={`xl-${i}`} x={f(ptX(i, n))} y={VH - 4}
          textAnchor="middle" fontSize="7" fill="#64748b">{points[i].label}</text>
      ))}

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
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fetchSnowData()); }
    catch { setError("Data unavailable – try again"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (autoRefresh) { intervalRef.current = setInterval(load, 10 * 60 * 1000); }
    else { if (intervalRef.current) clearInterval(intervalRef.current); }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load]);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10 max-w-md mx-auto">

      {/* Header */}
      <div className="w-full mb-7 text-center">
        {MOCK_MODE && (
          <div className="inline-block mb-3 px-3 py-1 rounded-full text-[10px] font-semibold tracking-widest uppercase"
            style={{ background: "rgba(10,22,44,0.70)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.30)", backdropFilter: "blur(6px)" }}>
            Preview · Mock Storm Data
          </div>
        )}
        <div className="inline-flex flex-col items-center gap-1 rounded-2xl px-6 py-4"
          style={{ background: "rgba(8,18,38,0.72)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.10)" }}>
          <div className="flex items-center gap-2.5 mb-0.5">
            <SwirlIcon />
            <h1 className="text-2xl font-bold tracking-tight text-white">Winter Watch</h1>
          </div>
          <p className="text-sm" style={{ color: "#93c5fd" }}>{LOCATION_LABEL}</p>
        </div>
      </div>

      {/* Stats card */}
      <div className="w-full rounded-2xl border border-border p-6 mb-5 shadow-lg"
        style={{ background: "rgba(10,22,44,0.88)", backdropFilter: "blur(8px)" }}>
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
          <div className="space-y-4">
            <StatRow label="Snow so far"   value={data.soFar} />
            <div className="h-px bg-border" />
            <StatRow label="Still to come" value={data.stillToCome} />
            <div className="h-px bg-border" />

            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-sm font-medium">Total expected</span>
              <span className="text-3xl font-bold text-primary tabular-nums">
                {data.totalLow}–{data.totalHigh}
                <span className="text-base font-normal text-muted-foreground ml-1">in</span>
              </span>
            </div>

            {data.peakHour && (
              <div className="rounded-xl px-4 py-2.5 flex items-center justify-between"
                style={{ background: "rgba(30,58,95,0.55)" }}>
                <span className="text-xs text-muted-foreground">Peak snow time</span>
                <span className="text-xs font-semibold">{data.peakHour}</span>
              </div>
            )}

            {/* Chart */}
            {data.points.length > 0 && (
              <div className="mt-1">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">Hour-by-hour</p>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="inline-block w-4 h-[2px] rounded" style={{ background: "#fbbf24", opacity: 0.85 }} />
                      Temp
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="inline-block w-4 h-[2px] rounded" style={{ background: "#60a5fa" }} />
                      Precip
                    </span>
                  </div>
                </div>

                <WeatherChart points={data.points} />

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

            <p className="text-[10px] text-muted-foreground/60 text-right">
              Updated {formatTime(data.lastUpdated)}
            </p>
          </div>
        ) : null}
      </div>

      {/* Check Again */}
      <button onClick={load} disabled={loading}
        className="w-full py-4 rounded-2xl font-bold text-base tracking-wide transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 mb-4 shadow-md"
        style={{ background: "hsl(210 82% 58%)", color: "hsl(220 30% 7%)" }}>
        {loading ? (
          <span className="flex items-center justify-center gap-2"><Spinner small />Checking…</span>
        ) : "Check Again"}
      </button>

      {/* Auto Refresh */}
      <div className="w-full flex items-center justify-between px-1">
        <div>
          <p className="text-sm font-medium">Auto Refresh</p>
          <p className="text-xs text-muted-foreground">Updates every 10 minutes</p>
        </div>
        <button onClick={() => setAutoRefresh((v) => !v)}
          className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none ${autoRefresh ? "bg-primary" : "bg-muted"}`}
          role="switch" aria-checked={autoRefresh}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${autoRefresh ? "translate-x-6" : "translate-x-0"}`} />
        </button>
      </div>
      {autoRefresh && <p className="text-xs text-primary/80 w-full px-1 mt-1.5">Auto-refresh is on</p>}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      <span className="text-3xl font-bold tabular-nums">
        {value.toFixed(1)}
        <span className="text-base font-normal text-muted-foreground ml-1">in</span>
      </span>
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

// Blue/gray swirl logo — concentric arcs spiraling inward
function SwirlIcon() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none"
      strokeLinecap="round" strokeLinejoin="round">
      {/* Outer arc — deep blue, ~300° sweep */}
      <path d="M 14 3 A 11 11 0 1 1 5.5 19.5" stroke="#2563eb" strokeWidth="2.4" />
      {/* Middle arc — medium blue, ~270° sweep, smaller radius */}
      <path d="M 14 7 A 7 7 0 1 1 8.5 18.6" stroke="#60a5fa" strokeWidth="2" />
      {/* Inner arc — blue-gray, ~240° sweep */}
      <path d="M 14 10.5 A 3.5 3.5 0 1 1 10.9 17" stroke="#93c5fd" strokeWidth="1.7" />
      {/* Center dot — slate gray */}
      <circle cx="14" cy="14" r="1.4" fill="#94a3b8" />
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
