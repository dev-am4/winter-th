import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AirVent, Cloud, CloudFog, CloudLightning, CloudRain,
  Compass, Droplets, Gauge, LocateFixed, MapPinned, Pause, Play,
  Search as SearchIcon, Sparkles, Sun, ThermometerSun, Wind, X
} from "lucide-react";

type Coords = { lat: number; lon: number };
type LayerMode = "radar" | "sat-ir" | "sat-rgb";

const DEFAULT_COORDS: Coords = { lat: 15.2, lon: 101.2 };

function weatherMeta(code = 0) {
  if ([95, 96, 99].includes(code)) return { label: "พายุฝนฟ้าคะนอง", icon: CloudLightning, scene: "storm" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "มีฝน", icon: CloudRain, scene: "rain" };
  if ([45, 48].includes(code)) return { label: "หมอก", icon: CloudFog, scene: "fog" };
  if ([1, 2, 3].includes(code)) return { label: code === 3 ? "เมฆมาก" : "มีเมฆบางส่วน", icon: Cloud, scene: "cloud" };
  return { label: "ท้องฟ้าโปร่ง", icon: Sun, scene: "clear" };
}

function thaiTime(value: string | number | Date) {
  const d = new Date(value);
  return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(d);
}

function jmaDate(stamp: string) {
  if (!stamp || stamp.length < 12) return new Date();
  return new Date(Date.UTC(
    +stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
    +stamp.slice(8, 10), +stamp.slice(10, 12), +(stamp.slice(12, 14) || 0)
  ));
}

function levelAQI(aqi: number) {
  if (!Number.isFinite(aqi)) return { label: "—", level: 0 };
  if (aqi <= 50) return { label: "ดี", level: 1 };
  if (aqi <= 100) return { label: "ปานกลาง", level: 2 };
  if (aqi <= 150) return { label: "เริ่มมีผล", level: 3 };
  if (aqi <= 200) return { label: "ไม่ดี", level: 4 };
  return { label: "สูงมาก", level: 5 };
}

function WeatherMap({
  coords, mode, radar, satellite, playing
}: {
  coords: Coords; mode: LayerMode; radar: any; satellite: any; playing: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [frame, setFrame] = useState(0);
  const [mapReady, setMapReady] = useState(false);

  const frames = mode === "radar" ? (radar?.frames || []) : (satellite?.frames || []);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let disposed = false;
    let localMap: any = null;

    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (disposed || !hostRef.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: hostRef.current,
        center: [coords.lon, coords.lat],
        zoom: 5.2,
        minZoom: 3,
        maxZoom: 11,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap © CARTO"
            }
          },
          layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-opacity": 0.72 } }]
        } as any
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      markerRef.current = new maplibregl.Marker({ color: "#8ef6ff" }).setLngLat([coords.lon, coords.lat]).addTo(map);
      localMap = map;
      mapRef.current = map;
      map.on("load", () => {
        if (!disposed) setMapReady(true);
      });
    });

    return () => {
      disposed = true;
      localMap?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.easeTo({ center: [coords.lon, coords.lat], duration: 900 });
    markerRef.current?.setLngLat([coords.lon, coords.lat]);
  }, [coords.lat, coords.lon]);

  useEffect(() => {
    setFrame(Math.max(0, frames.length - 1));
  }, [mode, frames.length]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = window.setInterval(() => setFrame(v => (v + 1) % frames.length), mode === "radar" ? 700 : 850);
    return () => window.clearInterval(id);
  }, [playing, mode, frames.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !frames.length) return;
    const current = frames[Math.min(frame, frames.length - 1)];
    let tile = "";
    let maxzoom = 7;

    if (mode === "radar") {
      tile = `${radar.host}${current.path}/256/{z}/{x}/{y}/4/1_1.png`;
      maxzoom = 7;
    } else {
      const p = mode === "sat-rgb" ? satellite.products.rgb : satellite.products.ir;
      tile = `${satellite.tileBase}/${current.basetime}/fd/${current.validtime}/${p.band}/${p.product}/{z}/{x}/{y}.jpg`;
      maxzoom = 5;
    }

    const apply = () => {
      const source = map.getSource("weather-overlay") as any;
      if (source?.setTiles) {
        source.setTiles([tile]);
        return;
      }
      if (map.getLayer("weather-overlay")) map.removeLayer("weather-overlay");
      if (map.getSource("weather-overlay")) map.removeSource("weather-overlay");
      map.addSource("weather-overlay", {
        type: "raster", tiles: [tile], tileSize: 256, minzoom: 3, maxzoom
      });
      map.addLayer({
        id: "weather-overlay", type: "raster", source: "weather-overlay",
        paint: {
          "raster-opacity": mode === "radar" ? 0.84 : 0.72,
          "raster-fade-duration": 0,
          "raster-contrast": mode === "sat-ir" ? 0.18 : 0.04,
          "raster-saturation": mode === "sat-ir" ? -0.65 : 0.08
        }
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [mapReady, mode, frame, radar, satellite, frames.length]);

  const frameLabel = useMemo(() => {
    const f = frames[Math.min(frame, Math.max(0, frames.length - 1))];
    if (!f) return "กำลังโหลดข้อมูล";
    if (mode === "radar") return thaiTime(f.time * 1000);
    return thaiTime(jmaDate(f.validtime));
  }, [frames, frame, mode]);

  return (
    <div className="map-shell">
      <div ref={hostRef} className="weather-map" />
      <div className="map-vignette" />
      <div className="map-status">
        <span className="live-dot" />
        <span>{mode === "radar" ? "RADAR" : mode === "sat-ir" ? "HIMAWARI IR" : "HIMAWARI RGB"}</span>
        <strong>{frameLabel}</strong>
      </div>
      <div className="frame-track">
        {frames.map((_: any, i: number) => (
          <button key={i} onClick={() => setFrame(i)} className={i === frame ? "active" : ""} aria-label={`frame ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint }: any) {
  return (
    <div className="stat-card">
      <Icon size={19} strokeWidth={1.7} />
      <div><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
    </div>
  );
}

function App() {
  const [coords, setCoords] = useState<Coords>(DEFAULT_COORDS);
  const [place, setPlace] = useState("ประเทศไทย");
  const [data, setData] = useState<any>(null);
  const [radar, setRadar] = useState<any>(null);
  const [satellite, setSatellite] = useState<any>(null);
  const [mode, setMode] = useState<LayerMode>("radar");
  const [playing, setPlaying] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/weather?lat=${coords.lat}&lon=${coords.lon}`).then(r => r.json()),
      fetch("/api/radar").then(r => r.json()),
      fetch("/api/satellite").then(r => r.json())
    ]).then(([w, r, s]) => {
      if (cancelled) return;
      setData(w); setRadar(r); setSatellite(s); setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coords.lat, coords.lon]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal })
        .then(r => r.json()).then(x => setResults(x.results || [])).catch(() => {});
    }, 300);
    return () => { window.clearTimeout(id); ctrl.abort(); };
  }, [query]);

  const f = data?.forecast;
  const current = f?.current || {};
  const meta = weatherMeta(current.weather_code);
  const CurrentIcon = meta.icon;
  const hourly = f?.hourly || {};
  const daily = f?.daily || {};
  const air = data?.airQuality?.current || {};
  const aqi = levelAQI(Number(air.us_aqi));

  const nowIndex = useMemo(() => {
    if (!hourly.time?.length || !current.time) return 0;
    const i = hourly.time.findIndex((t: string) => t >= current.time);
    return i < 0 ? 0 : i;
  }, [hourly.time, current.time]);

  const insight = useMemo(() => {
    if (!f) return null;
    const probs = (hourly.precipitation_probability || []).slice(nowIndex, nowIndex + 6).map(Number);
    const rain = (hourly.precipitation || []).slice(nowIndex, nowIndex + 6).reduce((a: number, b: number) => a + (+b || 0), 0);
    const peak = probs.length ? Math.max(...probs) : 0;
    const uv = Number(hourly.uv_index?.[nowIndex] || 0);
    let title = "สภาพอากาศค่อนข้างนิ่ง";
    let note = "ยังไม่พบสัญญาณเด่นในช่วง 6 ชั่วโมงข้างหน้า";
    let risk = 24;

    if (peak >= 75 || rain >= 8) {
      title = "ฝนมีแนวโน้มเข้าพื้นที่";
      note = `ช่วง 6 ชม. ข้างหน้าโอกาสฝนสูงสุด ${Math.round(peak)}% · ปริมาณรวมประมาณ ${rain.toFixed(1)} มม.`;
      risk = Math.min(96, Math.round(peak * 0.9 + rain));
    } else if (peak >= 45) {
      title = "จับตากลุ่มฝน";
      note = `มีโอกาสฝนสูงสุด ${Math.round(peak)}% ในช่วงไม่กี่ชั่วโมงข้างหน้า`;
      risk = Math.max(45, Math.round(peak));
    } else if (uv >= 8) {
      title = "แดดและ UV เด่น";
      note = `UV ประมาณ ${uv.toFixed(0)} ควรลดกิจกรรมกลางแจ้งช่วงแดดจัด`;
      risk = Math.min(85, Math.round(uv * 8));
    }

    const m1 = data?.models?.ecmwf?.hourly?.precipitation?.slice(0, 12);
    const m2 = data?.models?.gfs?.hourly?.precipitation?.slice(0, 12);
    let confidence = 72;
    if (m1?.length && m2?.length) {
      const a = m1.reduce((x: number, y: number) => x + (+y || 0), 0);
      const b = m2.reduce((x: number, y: number) => x + (+y || 0), 0);
      const delta = Math.abs(a - b);
      confidence = delta < 2 ? 91 : delta < 6 ? 80 : 66;
    }
    return { title, note, risk, confidence };
  }, [f, hourly, nowIndex, data?.models]);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        setCoords({ lat: p.coords.latitude, lon: p.coords.longitude });
        setPlace("ตำแหน่งของคุณ");
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 10 * 60 * 1000 }
    );
  };

  const choosePlace = (r: any) => {
    setCoords({ lat: r.latitude, lon: r.longitude });
    setPlace([r.name, r.admin1].filter(Boolean).join(", "));
    setQuery(""); setResults([]); setSearchOpen(false);
  };

  const todayUV = Number(hourly.uv_index?.[nowIndex] || daily.uv_index_max?.[0] || 0);

  return (
    <main className={`app scene-${meta.scene} ${current.is_day === 0 ? "night" : ""}`}>
      <div className="aurora aurora-a" /><div className="aurora aurora-b" />
      {(meta.scene === "rain" || meta.scene === "storm") && (
        <div className="rain-field">{Array.from({ length: 28 }).map((_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-(i % 9) * .17}s` }} />)}</div>
      )}

      <header className="topbar">
        <div className="brand"><span>W</span><div><strong>WINTER</strong><small>WEATHER INTELLIGENCE</small></div></div>
        <div className="top-actions">
          <button className="glass-button" onClick={() => setSearchOpen(true)}><SearchIcon size={17} /><span>ค้นหาพื้นที่</span></button>
          <button className="glass-button locate" onClick={locate}><LocateFixed size={17} className={locating ? "spin" : ""} /><span>ตำแหน่งฉัน</span></button>
        </div>
      </header>

      {searchOpen && (
        <div className="search-overlay" onMouseDown={e => e.currentTarget === e.target && setSearchOpen(false)}>
          <div className="search-panel">
            <SearchIcon size={20} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาจังหวัด อำเภอ เมือง..." />
            <button onClick={() => setSearchOpen(false)}><X size={20} /></button>
            <div className="search-results">
              {results.map(r => (
                <button key={r.id || `${r.latitude}-${r.longitude}`} onClick={() => choosePlace(r)}>
                  <MapPinned size={17} /><span><strong>{r.name}</strong><small>{[r.admin1, r.country].filter(Boolean).join(" · ")}</small></span>
                </button>
              ))}
              {query.length >= 2 && !results.length && <p>กำลังค้นหา...</p>}
            </div>
          </div>
        </div>
      )}

      <section className="hero">
        <div className="hero-main">
          <div className="eyebrow"><span className="live-dot" /> LIVE CONDITIONS · {place}</div>
          {loading ? <div className="hero-skeleton" /> : (
            <>
              <div className="temperature"><span>{Math.round(current.temperature_2m ?? 0)}</span><sup>°</sup></div>
              <div className="condition-line"><CurrentIcon size={28} /><strong>{meta.label}</strong><span>รู้สึกเหมือน {Math.round(current.apparent_temperature ?? 0)}°</span></div>
              {insight && (
                <div className="brain-callout">
                  <div className="brain-orb"><Sparkles size={19} /><span style={{ "--risk": `${insight.risk * 3.6}deg` } as any} /></div>
                  <div><small>WEATHER BRAIN</small><h2>{insight.title}</h2><p>{insight.note}</p></div>
                  <div className="confidence"><span>{insight.confidence}%</span><small>ความมั่นใจ</small></div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="hero-stats">
          <Stat icon={Droplets} label="ความชื้น" value={`${Math.round(current.relative_humidity_2m || 0)}%`} />
          <Stat icon={Wind} label="ลม" value={`${Math.round(current.wind_speed_10m || 0)} km/h`} hint={`กระโชก ${Math.round(current.wind_gusts_10m || 0)}`} />
          <Stat icon={Gauge} label="AQI" value={Number.isFinite(+air.us_aqi) ? Math.round(air.us_aqi) : "—"} hint={aqi.label} />
          <Stat icon={ThermometerSun} label="UV" value={todayUV.toFixed(0)} hint={todayUV >= 8 ? "สูง" : todayUV >= 5 ? "ปานกลาง" : "ต่ำ"} />
        </div>
      </section>

      <section className="visual-section">
        <div className="section-heading">
          <div><small>OBSERVATION</small><h2>มองอากาศจริง</h2></div>
          <div className="layer-switch">
            <button className={mode === "radar" ? "active" : ""} onClick={() => setMode("radar")}>RADAR</button>
            <button className={mode === "sat-ir" ? "active" : ""} onClick={() => setMode("sat-ir")}>SAT IR</button>
            <button className={mode === "sat-rgb" ? "active" : ""} onClick={() => setMode("sat-rgb")}>SAT RGB</button>
            <button className="play-button" onClick={() => setPlaying(v => !v)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          </div>
        </div>
        <WeatherMap coords={coords} mode={mode} radar={radar} satellite={satellite} playing={playing} />
        <div className="source-strip">
          <span><Activity size={14} /> RainViewer Radar</span>
          <span><Cloud size={14} /> JMA Himawari-9</span>
          <span><Compass size={14} /> ECMWF + GFS</span>
          <span><AirVent size={14} /> CAMS Air Quality</span>
        </div>
      </section>

      <section className="forecast-section">
        <div className="section-heading">
          <div><small>NEXT HOURS</small><h2>อีกไม่กี่ชั่วโมงจะเกิดอะไร</h2></div>
        </div>
        <div className="hour-grid">
          {(hourly.time || []).slice(nowIndex, nowIndex + 8).map((t: string, i: number) => {
            const idx = nowIndex + i;
            const M = weatherMeta(hourly.weather_code?.[idx]);
            const I = M.icon;
            const p = Number(hourly.precipitation_probability?.[idx] || 0);
            return (
              <div className="hour-card" key={t}>
                <span>{i === 0 ? "ตอนนี้" : t.slice(11, 16)}</span>
                <I size={24} />
                <strong>{Math.round(hourly.temperature_2m?.[idx] || 0)}°</strong>
                <div className="rain-meter"><i style={{ height: `${Math.max(4, p)}%` }} /></div>
                <small>{Math.round(p)}%</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="days-section">
        <div className="section-heading"><div><small>OUTLOOK</small><h2>แนวโน้ม 7 วัน</h2></div></div>
        <div className="days-list">
          {(daily.time || []).slice(0, 7).map((t: string, i: number) => {
            const M = weatherMeta(daily.weather_code?.[i]);
            const I = M.icon;
            return (
              <div className="day-row" key={t}>
                <div><strong>{i === 0 ? "วันนี้" : new Intl.DateTimeFormat("th-TH", { weekday: "short" }).format(new Date(t))}</strong><small>{M.label}</small></div>
                <I size={22} />
                <div className="day-rain"><CloudRain size={15} /><span>{Math.round(daily.precipitation_probability_max?.[i] || 0)}%</span></div>
                <div className="temp-range"><span>{Math.round(daily.temperature_2m_min?.[i] || 0)}°</span><i /><strong>{Math.round(daily.temperature_2m_max?.[i] || 0)}°</strong></div>
              </div>
            );
          })}
        </div>
      </section>

      <footer>
        <div className="brand mini"><span>W</span><div><strong>WINTER</strong><small>THAILAND</small></div></div>
        <p>ข้อมูลหลายแหล่งถูกนำมาประกอบเพื่อช่วยอ่านสถานการณ์ ไม่ใช่ประกาศเตือนภัยทางการ</p>
        <span>{data?.updatedAt ? `Updated ${thaiTime(data.updatedAt)}` : "Loading…"}</span>
      </footer>
    </main>
  );
}

export default App;
