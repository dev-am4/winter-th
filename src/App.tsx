import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Cloud, CloudLightning, CloudRain, Compass, Droplets,
  Layers3, LocateFixed, MapPinned, Pause, Play, Search, Wind, X
} from "lucide-react";

type OverlayMode = "none" | "radar" | "sat-ir" | "sat-rgb";
type SignalFilter = "all" | "active" | "rain" | "wind" | "reports";
type FocusPoint = { lon: number; lat: number; zoom?: number } | null;

function jmaDate(stamp: string) {
  if (!stamp || stamp.length < 12) return new Date();
  return new Date(Date.UTC(
    +stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
    +stamp.slice(8, 10), +stamp.slice(10, 12), +(stamp.slice(12, 14) || 0)
  ));
}

function timeLabel(value: string | number | Date) {
  const d = new Date(value);
  return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(d);
}

function signalIcon(type: string) {
  if (type === "storm") return CloudLightning;
  if (["heavy-rain", "rain", "drizzle"].includes(type)) return CloudRain;
  if (type === "wind") return Wind;
  return Cloud;
}

function filterFeatures(collection: any, filter: SignalFilter) {
  const source = collection?.features || [];
  if (filter === "all") return source;
  if (filter === "reports") return source.filter((f: any) => f.properties?.fieldReport);
  if (filter === "active") return source.filter((f: any) => Number(f.properties?.severity || 0) > 0);
  if (filter === "rain") return source.filter((f: any) => ["storm","heavy-rain","rain","drizzle"].includes(f.properties?.eventType));
  if (filter === "wind") return source.filter((f: any) => f.properties?.eventType === "wind");
  return source;
}

function NationalMap({
  collection, filter, overlay, radar, satellite, playing, focus, onSelect
}: {
  collection: any; filter: SignalFilter; overlay: OverlayMode; radar: any; satellite: any;
  playing: boolean; focus: FocusPoint; onSelect: (x: any) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [frame, setFrame] = useState(0);

  const visibleCollection = useMemo(() => ({
    type: "FeatureCollection",
    features: filterFeatures(collection, filter)
  }), [collection, filter]);

  const frames = overlay === "radar"
    ? (radar?.frames || [])
    : overlay === "sat-ir" || overlay === "sat-rgb"
      ? (satellite?.frames || [])
      : [];

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let disposed = false;
    let localMap: any = null;

    import("maplibre-gl").then((maplibregl) => {
      if (disposed || !hostRef.current || mapRef.current) return;
      const map = new maplibregl.Map({
        container: hostRef.current,
        center: [100.75, 13.35],
        zoom: 4.55,
        minZoom: 4,
        maxZoom: 12,
        attributionControl: false,
        style: {
          version: 8,
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          sources: {
            base: {
              type: "raster",
              tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap © CARTO"
            }
          },
          layers: [{
            id: "base",
            type: "raster",
            source: "base",
            paint: { "raster-opacity": 0.82, "raster-saturation": -0.2 }
          }]
        } as any
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

      map.on("load", () => {
        if (disposed) return;

        map.addSource("signals", {
          type: "geojson",
          data: visibleCollection as any,
          cluster: true,
          clusterMaxZoom: 8,
          clusterRadius: 46
        });

        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "signals",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#d8f7ff",
            "circle-opacity": 0.95,
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 23, 25, 29],
            "circle-stroke-color": "rgba(4,14,24,.9)",
            "circle-stroke-width": 4
          }
        });

        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "signals",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 11,
            "text-font": ["Open Sans Bold"]
          },
          paint: { "text-color": "#07131f" }
        });

        map.addLayer({
          id: "signal-points",
          type: "circle",
          source: "signals",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "severity"], 0, 6, 1, 8, 2, 10, 3, 12],
            "circle-color": [
              "match", ["get", "eventType"],
              "storm", "#ff6d8f",
              "heavy-rain", "#ff9c6b",
              "rain", "#70b7ff",
              "drizzle", "#7fd6e7",
              "wind", "#c49cff",
              "#6f8190"
            ],
            "circle-opacity": ["case", [">", ["get", "severity"], 0], 0.98, 0.64],
            "circle-stroke-color": "rgba(255,255,255,.9)",
            "circle-stroke-width": ["case", [">", ["get", "severity"], 0], 1.5, 0.7]
          }
        });

        map.on("click", "clusters", async (e: any) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
          const clusterId = features?.[0]?.properties?.cluster_id;
          const source: any = map.getSource("signals");
          if (clusterId == null || !source) return;
          try {
            const zoom = await source.getClusterExpansionZoom(clusterId);
            map.easeTo({ center: features[0].geometry.coordinates, zoom, duration: 650 });
          } catch {}
        });

        map.on("click", "signal-points", (e: any) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const coordinates = feature.geometry.coordinates.slice();
          onSelect({ ...feature.properties, coordinates });
          map.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 7), duration: 600 });
        });

        for (const layer of ["clusters", "signal-points"]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }

        localMap = map;
        mapRef.current = map;
        setMapReady(true);
      });
    });

    return () => {
      disposed = true;
      localMap?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const source: any = mapRef.current?.getSource("signals");
    source?.setData(visibleCollection);
  }, [mapReady, visibleCollection]);

  useEffect(() => {
    if (!mapReady || !focus) return;
    mapRef.current?.easeTo({
      center: [focus.lon, focus.lat],
      zoom: focus.zoom ?? 8,
      duration: 900
    });
  }, [mapReady, focus?.lon, focus?.lat, focus?.zoom]);

  useEffect(() => {
    setFrame(Math.max(0, frames.length - 1));
  }, [overlay, frames.length]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = window.setInterval(() => setFrame(v => (v + 1) % frames.length), overlay === "radar" ? 700 : 850);
    return () => window.clearInterval(id);
  }, [playing, overlay, frames.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (overlay === "none" || !frames.length) {
      if (map.getLayer("weather-overlay")) map.removeLayer("weather-overlay");
      if (map.getSource("weather-overlay")) map.removeSource("weather-overlay");
      return;
    }

    const current = frames[Math.min(frame, frames.length - 1)];
    let tile = "";
    let maxzoom = 7;

    if (overlay === "radar") {
      tile = `${radar.host}${current.path}/256/{z}/{x}/{y}/4/1_1.png`;
      maxzoom = 7;
    } else {
      const p = overlay === "sat-rgb" ? satellite.products.rgb : satellite.products.ir;
      tile = `${satellite.tileBase}/${current.basetime}/fd/${current.validtime}/${p.band}/${p.product}/{z}/{x}/{y}.jpg`;
      maxzoom = 5;
    }

    const source: any = map.getSource("weather-overlay");
    if (source?.setTiles) {
      source.setTiles([tile]);
    } else {
      map.addSource("weather-overlay", { type: "raster", tiles: [tile], tileSize: 256, minzoom: 3, maxzoom });
      map.addLayer({
        id: "weather-overlay",
        type: "raster",
        source: "weather-overlay",
        paint: {
          "raster-opacity": overlay === "radar" ? 0.82 : 0.6,
          "raster-fade-duration": 0,
          "raster-saturation": overlay === "sat-ir" ? -0.75 : 0
        }
      }, "clusters");
    }
  }, [mapReady, overlay, frame, radar, satellite, frames.length]);

  const currentFrameLabel = useMemo(() => {
    const current = frames[Math.min(frame, Math.max(0, frames.length - 1))];
    if (!current) return null;
    return overlay === "radar" ? timeLabel(current.time * 1000) : timeLabel(jmaDate(current.validtime));
  }, [frames, frame, overlay]);

  return (
    <div className="national-map-shell">
      <div ref={hostRef} className="national-map" />
      <div className="map-vignette" />
      {overlay !== "none" && (
        <div className="map-time"><span className="live-dot" />{overlay === "radar" ? "RADAR" : "HIMAWARI"} <strong>{currentFrameLabel || "—"}</strong></div>
      )}
      {frames.length > 0 && overlay !== "none" && (
        <div className="map-frame-track">
          {frames.map((_: any, i: number) => (
            <button key={i} className={i === frame ? "active" : ""} onClick={() => setFrame(i)} aria-label={`เฟรม ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [signals, setSignals] = useState<any>({ type: "FeatureCollection", features: [], meta: {} });
  const [radar, setRadar] = useState<any>(null);
  const [satellite, setSatellite] = useState<any>(null);
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [overlay, setOverlay] = useState<OverlayMode>("radar");
  const [playing, setPlaying] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [focus, setFocus] = useState<FocusPoint>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/signals").then(r => r.json()),
      fetch("/api/radar").then(r => r.json()),
      fetch("/api/satellite").then(r => r.json())
    ]).then(([s, r, sat]) => {
      setSignals(s);
      setRadar(r);
      setSatellite(sat);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(x => setResults((x.results || []).filter((r: any) => r.country_code === "TH" || r.country === "ประเทศไทย" || r.country === "Thailand")))
        .catch(() => {});
    }, 250);
    return () => { window.clearTimeout(id); ctrl.abort(); };
  }, [query]);

  const activeCount = useMemo(() =>
    (signals.features || []).filter((f: any) => Number(f.properties?.severity || 0) > 0).length
  , [signals]);

  const rainCount = useMemo(() =>
    (signals.features || []).filter((f: any) => ["storm","heavy-rain","rain","drizzle"].includes(f.properties?.eventType)).length
  , [signals]);

  const topSignals = useMemo(() =>
    [...(signals.features || [])]
      .sort((a: any, b: any) => Number(b.properties?.severity || 0) - Number(a.properties?.severity || 0) || Number(b.properties?.precipitation || 0) - Number(a.properties?.precipitation || 0))
      .slice(0, 8)
  , [signals]);

  const choosePlace = (r: any) => {
    setFocus({ lon: r.longitude, lat: r.latitude, zoom: 8.5 });
    setSearchOpen(false);
    setQuery("");
    setResults([]);
  };

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        setFocus({ lon: p.coords.longitude, lat: p.coords.latitude, zoom: 9 });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  };

  const openReports = () => {
    setFilter("reports");
    setSelected({
      reportsEmpty: true,
      name: "LIVE REPORTS",
      label: "ยังไม่มีรายงานภาคสนามที่เชื่อมเข้าระบบ",
      detail: "Layer นี้เตรียมไว้สำหรับโพสต์/ข่าวสาธารณะและ Community Report โดยจะแยกจากสัญญาณโมเดลอากาศชัดเจน"
    });
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span>W</span><div><strong>WINTER</strong><small>LIVE WEATHER MAP</small></div></div>
        <div className="top-actions">
          <button className="glass-button" onClick={() => setSearchOpen(true)}><Search size={17} /><span>ค้นหาพื้นที่</span></button>
          <button className="glass-button" onClick={locate}><LocateFixed size={17} className={locating ? "spin" : ""} /><span>ตำแหน่งฉัน</span></button>
        </div>
      </header>

      <section className="map-hero">
        <div className="map-copy">
          <div>
            <span className="eyebrow"><span className="live-dot" /> THAILAND · LIVE</span>
            <h1>ตอนนี้<br />ที่ไหนกำลังเกิดอะไร</h1>
          </div>
          <div className="national-stats">
            <div><strong>{signals.meta?.total || 0}</strong><span>จุดทั่วประเทศ</span></div>
            <div><strong>{activeCount}</strong><span>สัญญาณเด่น</span></div>
            <div><strong>{rainCount}</strong><span>พื้นที่มีฝน</span></div>
          </div>
        </div>

        <div className="map-toolbar">
          <div className="toolbar-group">
            <small>สถานการณ์</small>
            <div className="pill-row">
              <button className={filter === "all" ? "active" : ""} onClick={() => { setFilter("all"); setSelected(null); }}>ทั้งหมด</button>
              <button className={filter === "active" ? "active" : ""} onClick={() => { setFilter("active"); setSelected(null); }}>เด่นตอนนี้</button>
              <button className={filter === "rain" ? "active" : ""} onClick={() => { setFilter("rain"); setSelected(null); }}><Droplets size={14} /> ฝน</button>
              <button className={filter === "wind" ? "active" : ""} onClick={() => { setFilter("wind"); setSelected(null); }}><Wind size={14} /> ลม</button>
              <button className={filter === "reports" ? "active report-pill" : "report-pill"} onClick={openReports}><MapPinned size={14} /> LIVE REPORTS</button>
            </div>
          </div>

          <div className="toolbar-group align-end">
            <small>เลเยอร์แผนที่</small>
            <div className="pill-row">
              <button className={overlay === "none" ? "active" : ""} onClick={() => setOverlay("none")}><Layers3 size={14} /> Map</button>
              <button className={overlay === "radar" ? "active" : ""} onClick={() => setOverlay("radar")}>Radar</button>
              <button className={overlay === "sat-ir" ? "active" : ""} onClick={() => setOverlay("sat-ir")}>Sat IR</button>
              <button className={overlay === "sat-rgb" ? "active" : ""} onClick={() => setOverlay("sat-rgb")}>Sat RGB</button>
              {overlay !== "none" && (
                <button className="icon-pill" onClick={() => setPlaying(v => !v)} aria-label={playing ? "หยุดภาพเคลื่อนไหว" : "เล่นภาพเคลื่อนไหว"}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="map-stage">
          <NationalMap
            collection={signals}
            filter={filter}
            overlay={overlay}
            radar={radar}
            satellite={satellite}
            playing={playing}
            focus={focus}
            onSelect={setSelected}
          />

          <div className="legend">
            <span><i className="dot storm" /> พายุ</span>
            <span><i className="dot rain" /> ฝน</span>
            <span><i className="dot wind" /> ลมแรง</span>
            <span><i className="dot normal" /> ปกติ/เมฆ</span>
          </div>

          {selected && (
            <aside className="event-panel">
              <button className="panel-close" onClick={() => setSelected(null)}><X size={18} /></button>
              {selected.reportsEmpty ? (
                <>
                  <div className="event-kicker">FIELD REPORT LAYER</div>
                  <h2>{selected.name}</h2>
                  <p>{selected.label}</p>
                  <div className="empty-report-box">
                    <MapPinned size={22} />
                    <span>{selected.detail}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="event-kicker">{selected.fieldReport ? "FIELD REPORT" : "WEATHER SIGNAL"}</div>
                  <h2>{selected.name}</h2>
                  <div className="event-label">{selected.label}</div>
                  <div className="event-metrics">
                    <div><span>อุณหภูมิ</span><strong>{Math.round(Number(selected.temperature || 0))}°</strong></div>
                    <div><span>ฝนปัจจุบัน</span><strong>{Number(selected.precipitation || 0).toFixed(1)} mm</strong></div>
                    <div><span>ลมกระโชก</span><strong>{Math.round(Number(selected.windGust || 0))} km/h</strong></div>
                  </div>
                  <div className="source-note">
                    <Activity size={15} />
                    <span>แหล่งข้อมูล: {selected.source || "—"} · เป็นสัญญาณจากโมเดล ไม่ใช่รายงานผู้เห็นเหตุการณ์</span>
                  </div>
                </>
              )}
            </aside>
          )}
        </div>
      </section>

      <section className="signal-feed">
        <div className="section-title">
          <div><small>LIVE SIGNALS</small><h2>จุดที่ควรจับตาตอนนี้</h2></div>
          <span>อัปเดตอัตโนมัติจากข้อมูลล่าสุด</span>
        </div>
        <div className="signal-grid">
          {topSignals.map((f: any) => {
            const p = f.properties;
            const Icon = signalIcon(p.eventType);
            return (
              <button key={p.id} className={`signal-card severity-${p.severity}`} onClick={() => {
                setSelected({ ...p, coordinates: f.geometry.coordinates });
                setFocus({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], zoom: 7.5 });
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>
                <div className="signal-card-icon"><Icon size={20} /></div>
                <div><strong>{p.name}</strong><span>{p.label}</span></div>
                <div className="signal-card-value">{Math.round(Number(p.temperature || 0))}°</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="source-band">
        <span><CloudRain size={15} /> RainViewer Radar</span>
        <span><Cloud size={15} /> JMA Himawari-9</span>
        <span><Compass size={15} /> Open-Meteo weather signals</span>
        <span><MapPinned size={15} /> Public reports layer ready</span>
      </section>

      {searchOpen && (
        <div className="search-overlay" onMouseDown={e => e.currentTarget === e.target && setSearchOpen(false)}>
          <div className="search-panel">
            <Search size={20} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหาจังหวัด อำเภอ เมือง..." />
            <button onClick={() => setSearchOpen(false)}><X size={20} /></button>
            <div className="search-results">
              {results.map(r => (
                <button key={r.id || `${r.latitude}-${r.longitude}`} onClick={() => choosePlace(r)}>
                  <MapPinned size={17} />
                  <span><strong>{r.name}</strong><small>{[r.admin1, r.country].filter(Boolean).join(" · ")}</small></span>
                </button>
              ))}
              {query.trim().length >= 2 && !results.length && <p>กำลังค้นหา...</p>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
