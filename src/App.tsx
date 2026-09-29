import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Cloud, CloudLightning, CloudRain, Compass, Droplets, ExternalLink,
  Layers3, LocateFixed, MapPinned, Pause, Play, Plus, Search, Send, Users, Wind, X
} from "lucide-react";

type OverlayMode = "none" | "radar" | "sat-ir" | "sat-rgb";
type SignalFilter = "all" | "active" | "rain" | "wind" | "reports" | "community";
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
  if (filter === "community") return [];
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
  const postMarkersRef = useRef<any[]>([]);
  const refreshPostsRef = useRef<null | (() => void)>(null);
  const filterRef = useRef<SignalFilter>(filter);
  const [mapReady, setMapReady] = useState(false);
  const [frame, setFrame] = useState(0);

  filterRef.current = filter;

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

    Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")
    ]).then(([{ Map, Marker, NavigationControl, AttributionControl, setWorkerUrl }, workerModule]) => {
      if (disposed || !hostRef.current || mapRef.current) return;
      setWorkerUrl(workerModule.default);
      const map = new Map({
        container: hostRef.current,
        center: [100.75, 13.35],
        zoom: 4.55,
        minZoom: 4,
        maxZoom: 12,
        attributionControl: false,
        style: {
          version: 8,
          glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          sources: {
            region: {
              type: "geojson",
              data: "/data/region-countries.geojson",
              attribution: "Natural Earth"
            },
            provinces: {
              type: "geojson",
              data: "/data/thailand-provinces.geojson",
              attribution: "Thailand ADM1 polygons · CC BY 4.0"
            }
          },
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#06101a" }
            },
            {
              id: "region-fill",
              type: "fill",
              source: "region",
              paint: {
                "fill-color": "#0d1b25",
                "fill-opacity": 0.92
              }
            },
            {
              id: "region-line",
              type: "line",
              source: "region",
              paint: {
                "line-color": "#243846",
                "line-width": 0.8,
                "line-opacity": 0.8
              }
            },
            {
              id: "thailand-fill",
              type: "fill",
              source: "provinces",
              paint: {
                "fill-color": "#143347",
                "fill-opacity": 0.84
              }
            },
            {
              id: "province-lines",
              type: "line",
              source: "provinces",
              paint: {
                "line-color": "#4f7185",
                "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 8, 1.2],
                "line-opacity": 0.72
              }
            }
          ]
        } as any
      });

      map.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");
      map.addControl(new AttributionControl({ compact: true }), "bottom-left");

      map.on("load", () => {
        if (disposed) return;

        map.fitBounds([[97.0, 5.2], [106.0, 20.7]], {
          padding: 28,
          duration: 0
        });

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
            "text-font": ["Noto Sans Regular"]
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
              "case",
              ["==", ["get", "fieldReport"], true],
              ["match", ["get", "sourceType"], "official", "#ff5f78", "news", "#ffad63", "#78e3c0"],
              [
                "match", ["get", "eventType"],
                "storm", "#ff6d8f",
                "heavy-rain", "#ff9c6b",
                "rain", "#70b7ff",
                "drizzle", "#7fd6e7",
                "wind", "#c49cff",
                "#6f8190"
              ]
            ],
            "circle-opacity": ["case", [">", ["get", "severity"], 0], 0.98, 0.64],
            "circle-stroke-color": "rgba(255,255,255,.9)",
            "circle-stroke-width": ["case", [">", ["get", "severity"], 0], 1.5, 0.7]
          }
        });

        map.addSource("community-posts", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });

        map.addLayer({
          id: "community-clusters",
          type: "circle",
          source: "community-posts",
          filter: ["==", ["get", "kind"], "post-cluster"],
          paint: {
            "circle-color": "#78e3c0",
            "circle-opacity": 0.96,
            "circle-radius": ["step", ["get", "count"], 18, 10, 23, 50, 29, 200, 36],
            "circle-stroke-color": "#06101a",
            "circle-stroke-width": 4
          }
        });

        map.addLayer({
          id: "community-cluster-count",
          type: "symbol",
          source: "community-posts",
          filter: ["==", ["get", "kind"], "post-cluster"],
          layout: {
            "text-field": ["to-string", ["get", "count"]],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"]
          },
          paint: { "text-color": "#06101a" }
        });

        const clearPostMarkers = () => {
          for (const marker of postMarkersRef.current) marker.remove();
          postMarkersRef.current = [];
        };

        const refreshCommunityPosts = async () => {
          const show = ["all", "reports", "community"].includes(filterRef.current);
          const postSource: any = map.getSource("community-posts");
          if (!show || !postSource) {
            clearPostMarkers();
            postSource?.setData({ type: "FeatureCollection", features: [] });
            return;
          }

          const bounds = map.getBounds();
          const zoom = map.getZoom();
          const params = new URLSearchParams({
            bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","),
            zoom: String(zoom),
            hours: "168"
          });

          try {
            const response = await fetch(`/api/posts?${params.toString()}`);
            if (!response.ok) return;
            const payload = await response.json();
            clearPostMarkers();

            if (payload.mode === "clusters") {
              postSource.setData({ type: "FeatureCollection", features: payload.features || [] });
              return;
            }

            postSource.setData({ type: "FeatureCollection", features: [] });
            for (const feature of (payload.features || []).slice(0, 120)) {
              const props = feature.properties || {};
              const [lon, lat] = feature.geometry?.coordinates || [];
              if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) continue;

              const el = document.createElement("button");
              el.type = "button";
              el.className = "community-marker";
              el.title = props.title || props.locationLabel || "โพสต์จากพื้นที่";

              if (props.thumbnail) {
                const img = document.createElement("img");
                img.src = props.thumbnail;
                img.alt = "";
                img.loading = "lazy";
                img.referrerPolicy = "no-referrer";
                img.onerror = () => { img.style.display = "none"; };
                el.appendChild(img);
              }

              const badge = document.createElement("span");
              badge.textContent = props.platform === "youtube" ? "▶" : props.platform === "tiktok" ? "♪" : "●";
              el.appendChild(badge);

              el.addEventListener("click", (event) => {
                event.stopPropagation();
                onSelect({ ...props, coordinates: [lon, lat], communityPost: true });
              });

              const marker = new Marker({ element: el, anchor: "bottom" })
                .setLngLat([Number(lon), Number(lat)])
                .addTo(map);
              postMarkersRef.current.push(marker);
            }
          } catch {}
        };

        refreshPostsRef.current = refreshCommunityPosts;
        map.on("moveend", refreshCommunityPosts);

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

        map.on("click", "community-clusters", (e: any) => {
          const feature = e.features?.[0];
          if (!feature) return;
          map.easeTo({
            center: feature.geometry.coordinates,
            zoom: Math.min(12, map.getZoom() + 2),
            duration: 650
          });
        });

        map.on("click", "signal-points", (e: any) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const coordinates = feature.geometry.coordinates.slice();
          onSelect({ ...feature.properties, coordinates });
          map.easeTo({ center: coordinates, zoom: Math.max(map.getZoom(), 7), duration: 600 });
        });

        for (const layer of ["clusters", "signal-points", "community-clusters"]) {
          map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        }

        localMap = map;
        mapRef.current = map;
        setMapReady(true);
        refreshCommunityPosts();
      });
    });

    return () => {
      disposed = true;
      for (const marker of postMarkersRef.current) marker.remove();
      postMarkersRef.current = [];
      localMap?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const source: any = mapRef.current?.getSource("signals");
    source?.setData(visibleCollection);
    refreshPostsRef.current?.();
  }, [mapReady, visibleCollection, filter]);

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
      tile = `${radar.host}${current.path}/256/{z}/{x}/{y}/2/1_0.png`;
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
          "raster-opacity": overlay === "radar" ? 0.68 : 0.6,
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
  const [reports, setReports] = useState<any>({ type: "FeatureCollection", features: [], meta: {} });
  const [radar, setRadar] = useState<any>(null);
  const [satellite, setSatellite] = useState<any>(null);
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [overlay, setOverlay] = useState<OverlayMode>("sat-rgb");
  const [playing, setPlaying] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [focus, setFocus] = useState<FocusPoint>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [postStats, setPostStats] = useState<any>({ total: 0, active: 0, pending: 0 });
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitNote, setSubmitNote] = useState("");
  const [submitPlace, setSubmitPlace] = useState("");
  const [submitPlaces, setSubmitPlaces] = useState<any[]>([]);
  const [submitCoords, setSubmitCoords] = useState<any>(null);
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    Promise.all([
      fetch("/api/signals").then(r => r.json()),
      fetch("/api/reports").then(r => r.json()).catch(() => ({ type: "FeatureCollection", features: [], meta: {} })),
      fetch("/api/radar").then(r => r.json()),
      fetch("/api/satellite").then(r => r.json()),
      fetch("/api/posts/stats").then(r => r.json()).catch(() => ({ total: 0, active: 0, pending: 0 }))
    ]).then(([s, rep, r, sat, ps]) => {
      setSignals(s);
      setReports(rep);
      setRadar(r);
      setSatellite(sat);
      setPostStats(ps);
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

  useEffect(() => {
    if (!submitOpen || submitCoords || submitPlace.trim().length < 2) {
      setSubmitPlaces([]);
      return;
    }
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(submitPlace.trim())}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(x => setSubmitPlaces((x.results || []).filter((r: any) => r.country_code === "TH" || r.country === "ประเทศไทย" || r.country === "Thailand").slice(0, 5)))
        .catch(() => {});
    }, 280);
    return () => { window.clearTimeout(id); ctrl.abort(); };
  }, [submitOpen, submitPlace, submitCoords]);

  const combined = useMemo(() => ({
    type: "FeatureCollection",
    features: [...(signals.features || []), ...(reports.features || [])],
    meta: {
      weather: signals.meta || {},
      reports: reports.meta || {}
    }
  }), [signals, reports]);

  const activeCount = useMemo(() =>
    (signals.features || []).filter((f: any) => Number(f.properties?.severity || 0) > 0).length
  , [signals]);

  const reportCount = reports.features?.length || 0;

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
    setSelected(null);
  };

  const submitPost = async () => {
    if (!submitUrl.trim() || !submitCoords) return;
    setSubmitState("sending");
    try {
      const r = await fetch("/api/posts/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: submitUrl.trim(),
          note: submitNote.trim(),
          lat: submitCoords.lat,
          lon: submitCoords.lon,
          locationLabel: submitCoords.label || submitPlace.trim()
        })
      });
      if (!r.ok) throw new Error("submit failed");
      const result = await r.json();
      setSubmitState("sent");
      setPostStats((s: any) => ({ ...s, pending: Number(s.pending || 0) + 1, total: Number(s.total || 0) + 1 }));
      if (result?.preview?.title && !submitNote) setSubmitNote(result.preview.title);
    } catch {
      setSubmitState("error");
    }
  };

  const resetSubmit = () => {
    setSubmitOpen(false);
    setSubmitUrl("");
    setSubmitNote("");
    setSubmitPlace("");
    setSubmitPlaces([]);
    setSubmitCoords(null);
    setSubmitState("idle");
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><span>W</span><div><strong>WINTER</strong><small>LIVE WEATHER MAP</small></div></div>
        <div className="top-actions">
          <button className="glass-button submit-trigger" onClick={() => setSubmitOpen(true)}><Plus size={17} /><span>เพิ่มโพสต์</span></button>
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
            <div><strong>{(signals.meta?.total || 0) + reportCount + Number(postStats.active || 0)}</strong><span>จุดบนแผนที่</span></div>
            <div><strong>{activeCount}</strong><span>สัญญาณอากาศเด่น</span></div>
            <div><strong>{reportCount}</strong><span>รายงาน/ข่าว</span></div>
            <div><strong>{Number(postStats.active || 0)}</strong><span>โพสต์ประชาชน</span></div>
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
              <button className={filter === "community" ? "active community-pill" : "community-pill"} onClick={() => { setFilter("community"); setSelected(null); }}><Users size={14} /> POSTS คนทั่วไป</button>
              <button className={filter === "community" ? "active community-pill" : "community-pill"} onClick={() => { setFilter("community"); setSelected(null); }}><Users size={14} /> โพสต์ประชาชน</button>
              <button className="submit-pill" onClick={() => setSubmitOpen(true)}><Plus size={14} /> เพิ่มโพสต์</button>
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
            collection={combined}
            filter={filter}
            overlay={overlay}
            radar={radar}
            satellite={satellite}
            playing={playing}
            focus={focus}
            onSelect={setSelected}
          />

          <div className="legend">
            {filter === "community" ? (
              <>
                <span><i className="dot community" /> โพสต์ประชาชน</span>
                <span>ซูมเข้าเพื่อดู thumbnail</span>
              </>
            ) : filter === "reports" ? (
              <>
                <span><i className="dot official" /> Official report</span>
                <span><i className="dot news" /> ข่าวสาธารณะ</span>
                <span><i className="dot community" /> โพสต์ประชาชน</span>
              </>
            ) : (
              <>
                <span><i className="dot storm" /> พายุ</span>
                <span><i className="dot rain" /> ฝน</span>
                <span><i className="dot wind" /> ลมแรง</span>
                <span><i className="dot normal" /> ปกติ/เมฆ</span>
              </>
            )}
          </div>

          {selected && (
            <aside className="event-panel">
              <button className="panel-close" onClick={() => setSelected(null)}><X size={18} /></button>
              {selected.communityPost || selected.kind === "community-post" ? (
                <>
                  <div className="event-kicker">PUBLIC POST · {(selected.platform || "WEB").toUpperCase()}</div>
                  <h2>{selected.locationLabel || "โพสต์จากพื้นที่"}</h2>
                  <div className="event-label">{selected.label || "โพสต์สาธารณะ"}</div>
                  {selected.thumbnail && (
                    <div className="report-media">
                      <img src={selected.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.parentElement!.style.display = "none"; }} />
                    </div>
                  )}
                  <p className="report-title">{selected.title || "เปิดโพสต์ต้นฉบับเพื่อดูรายละเอียด"}</p>
                  <div className="report-meta">
                    {selected.authorName && <span>{selected.authorName}</span>}
                    <span>{selected.platform || "web"}</span>
                    <span>{selected.timeKind === "published" && selected.postedAt ? timeLabel(selected.postedAt) : "พบในระบบล่าสุด"}</span>
                    <span>{selected.locationAccuracy || "approximate"}</span>
                  </div>
                  {selected.sourceUrl && (
                    <a className="source-link" href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
                      ไปที่โพสต์ต้นฉบับ <ExternalLink size={14} />
                    </a>
                  )}
                  <div className="source-note">
                    <Users size={15} />
                    <span>แสดงเพียง metadata/thumbnail และลิงก์กลับไปยังโพสต์ต้นฉบับ ไม่ได้คัดลอกวิดีโอมาเก็บใน WINTER</span>
                  </div>
                </>
              ) : selected.fieldReport ? (
                <>
                  <div className="event-kicker">{selected.sourceType === "official" ? "OFFICIAL REPORT" : "PUBLIC NEWS REPORT"}</div>
                  <h2>{selected.name}</h2>
                  <div className="event-label">{selected.label}</div>
                  {selected.image && (
                    <div className="report-media">
                      <img src={selected.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.parentElement!.style.display = "none"; }} />
                    </div>
                  )}
                  <p className="report-title">{selected.title}</p>
                  <div className="report-meta">
                    <span>{selected.source || "Public source"}</span>
                    <span>{selected.timeKind === "detected" ? "พบในรอบล่าสุด" : selected.publishedAt ? timeLabel(selected.publishedAt) : "—"}</span>
                    <span>ตำแหน่งระดับจังหวัด</span>
                  </div>
                  {selected.sourceUrl && (
                    <a className="source-link" href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
                      เปิดต้นฉบับ <ExternalLink size={14} />
                    </a>
                  )}
                  <div className="source-note">
                    <MapPinned size={15} />
                    <span>หมุดนี้อ้างอิงตำแหน่งจากชื่อจังหวัด/สถานที่ในข่าว ไม่ใช่ GPS ของผู้รายงาน</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="event-kicker">WEATHER SIGNAL</div>
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
        <span><MapPinned size={15} /> LIVE REPORTS: DWR · TMD · PRD · GDELT</span>
        <span><Users size={15} /> Community Posts · Cloudflare D1</span>
      </section>

      {submitOpen && (
        <div className="search-overlay" onMouseDown={e => e.currentTarget === e.target && resetSubmit()}>
          <div className="submit-panel">
            <div className="submit-head">
              <div><small>COMMUNITY POST</small><h3>เพิ่มโพสต์สาธารณะลงแผนที่</h3></div>
              <button onClick={resetSubmit}><X size={19} /></button>
            </div>

            {submitState === "sent" ? (
              <div className="submit-success">
                <Send size={24} />
                <strong>รับโพสต์แล้ว</strong>
                <span>รายการถูกเก็บเป็น pending เพื่อป้องกันสแปม/ตำแหน่งผิด ก่อนนำขึ้นแผนที่จริง</span>
                <button onClick={resetSubmit}>ปิด</button>
              </div>
            ) : (
              <>
                <label className="submit-field">
                  <span>ลิงก์โพสต์</span>
                  <input value={submitUrl} onChange={e => setSubmitUrl(e.target.value)} placeholder="TikTok / YouTube / X / Facebook / Reddit..." />
                </label>

                <label className="submit-field">
                  <span>พื้นที่เกิดเหตุ</span>
                  <input
                    value={submitCoords ? submitCoords.label : submitPlace}
                    onChange={e => { setSubmitCoords(null); setSubmitPlace(e.target.value); }}
                    placeholder="เช่น ปากช่อง, นครราชสีมา"
                  />
                </label>

                {!submitCoords && submitPlaces.length > 0 && (
                  <div className="submit-place-results">
                    {submitPlaces.map(r => (
                      <button key={r.id || `${r.latitude}-${r.longitude}`} onClick={() => {
                        setSubmitCoords({
                          lat: r.latitude,
                          lon: r.longitude,
                          label: [r.name, r.admin1].filter(Boolean).join(", ")
                        });
                        setSubmitPlace([r.name, r.admin1].filter(Boolean).join(", "));
                        setSubmitPlaces([]);
                      }}>
                        <MapPinned size={15} />
                        <span>{r.name}<small>{[r.admin1, r.country].filter(Boolean).join(" · ")}</small></span>
                      </button>
                    ))}
                  </div>
                )}

                <label className="submit-field">
                  <span>คำอธิบายสั้น ๆ (ไม่บังคับ)</span>
                  <textarea value={submitNote} onChange={e => setSubmitNote(e.target.value)} placeholder="เช่น น้ำสูงประมาณครึ่งล้อ รถเล็กเริ่มผ่านยาก" />
                </label>

                <div className="submit-note">
                  ระบบจะเก็บ URL + metadata + ตำแหน่ง ไม่ดาวน์โหลดวิดีโอต้นฉบับมาเก็บ
                </div>

                <button
                  className="submit-action"
                  disabled={!submitUrl.trim() || !submitCoords || submitState === "sending"}
                  onClick={submitPost}
                >
                  {submitState === "sending" ? "กำลังส่ง..." : submitState === "error" ? "ส่งไม่สำเร็จ — ลองอีกครั้ง" : "ส่งโพสต์เข้าระบบ"}
                  <Send size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      )}


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
