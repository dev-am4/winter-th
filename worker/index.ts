type Env = { ASSETS: Fetcher };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*"
};

function json(data: unknown, status = 200, browserTtl = 60) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": `public, max-age=${browserTtl}`
    }
  });
}

function n(value: string | null, fallback: number) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function coords(url: URL) {
  return {
    lat: Math.max(-90, Math.min(90, n(url.searchParams.get("lat"), 13.7563))),
    lon: Math.max(-180, Math.min(180, n(url.searchParams.get("lon"), 100.5018)))
  };
}

async function cachedJson(url: string, ttl: number, ctx: any) {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const response = await fetch(url, {
    headers: {
      "user-agent": "winter-th/0.1 weather-intelligence"
    }
  });

  if (!response.ok) {
    throw new Error(`Upstream ${response.status}: ${url}`);
  }

  const body = await response.text();
  const stored = new Response(body, {
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": `public, max-age=${ttl}`
    }
  });

  ctx.waitUntil(cache.put(key, stored.clone()));
  return JSON.parse(body);
}

async function weather(url: URL, ctx: any) {
  const { lat, lon } = coords(url);
  const base = new URL("https://api.open-meteo.com/v1/forecast");
  base.searchParams.set("latitude", String(lat));
  base.searchParams.set("longitude", String(lon));
  base.searchParams.set("timezone", "auto");
  base.searchParams.set("forecast_days", "10");
  base.searchParams.set("current", [
    "temperature_2m","relative_humidity_2m","apparent_temperature","is_day",
    "precipitation","rain","weather_code","cloud_cover","pressure_msl",
    "wind_speed_10m","wind_direction_10m","wind_gusts_10m"
  ].join(","));
  base.searchParams.set("hourly", [
    "temperature_2m","apparent_temperature","precipitation_probability",
    "precipitation","rain","weather_code","cloud_cover","visibility",
    "wind_speed_10m","wind_direction_10m","wind_gusts_10m","uv_index"
  ].join(","));
  base.searchParams.set("daily", [
    "weather_code","temperature_2m_max","temperature_2m_min",
    "apparent_temperature_max","apparent_temperature_min","sunrise","sunset",
    "uv_index_max","precipitation_sum","rain_sum","precipitation_probability_max",
    "wind_speed_10m_max","wind_gusts_10m_max"
  ].join(","));

  const air = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  air.searchParams.set("latitude", String(lat));
  air.searchParams.set("longitude", String(lon));
  air.searchParams.set("timezone", "auto");
  air.searchParams.set("forecast_days", "5");
  air.searchParams.set("current", "pm2_5,pm10,us_aqi,european_aqi,ozone,nitrogen_dioxide");
  air.searchParams.set("hourly", "pm2_5,pm10,us_aqi,european_aqi");

  function model(name: string) {
    const m = new URL("https://api.open-meteo.com/v1/forecast");
    m.searchParams.set("latitude", String(lat));
    m.searchParams.set("longitude", String(lon));
    m.searchParams.set("timezone", "auto");
    m.searchParams.set("forecast_days", "2");
    m.searchParams.set("models", name);
    m.searchParams.set("hourly", "temperature_2m,precipitation,cloud_cover");
    return m.toString();
  }

  const [forecast, airQuality, ecmwf, gfs] = await Promise.all([
    cachedJson(base.toString(), 300, ctx),
    cachedJson(air.toString(), 600, ctx),
    cachedJson(model("ecmwf_ifs025"), 900, ctx).catch(() => null),
    cachedJson(model("gfs_seamless"), 900, ctx).catch(() => null)
  ]);

  return json({
    location: { lat, lon, timezone: forecast.timezone, elevation: forecast.elevation },
    forecast,
    airQuality,
    models: { ecmwf, gfs },
    sources: [
      { id: "open-meteo", label: "Open-Meteo", role: "Forecast aggregation" },
      { id: "ecmwf", label: "ECMWF IFS", role: "Model comparison" },
      { id: "gfs", label: "NOAA GFS", role: "Model comparison" },
      { id: "cams", label: "CAMS", role: "Air quality" }
    ],
    updatedAt: new Date().toISOString()
  }, 200, 60);
}

async function geocode(url: URL, ctx: any) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ results: [] }, 200, 60);
  const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  endpoint.searchParams.set("name", q);
  endpoint.searchParams.set("count", "8");
  endpoint.searchParams.set("language", "th");
  endpoint.searchParams.set("format", "json");
  const data = await cachedJson(endpoint.toString(), 86400, ctx);
  return json(data, 200, 3600);
}

async function radar(ctx: any) {
  const data = await cachedJson("https://api.rainviewer.com/public/weather-maps.json", 300, ctx);
  return json({
    generated: data.generated,
    host: data.host,
    frames: (data.radar?.past || []).slice(-12),
    source: "RainViewer"
  }, 200, 120);
}

const WEATHER_POINTS = [
  ["เชียงใหม่",18.7883,98.9853],["เชียงราย",19.9072,99.8325],["แม่ฮ่องสอน",19.3013,97.9685],
  ["น่าน",18.7756,100.7730],["ลำปาง",18.2888,99.4909],["พิษณุโลก",16.8211,100.2659],
  ["ตาก",16.8839,99.1258],["นครสวรรค์",15.7047,100.1372],["อยุธยา",14.3532,100.5689],
  ["กรุงเทพฯ",13.7563,100.5018],["นครปฐม",13.8199,100.0622],["กาญจนบุรี",14.0228,99.5328],
  ["ราชบุรี",13.5283,99.8134],["เพชรบุรี",13.1112,99.9391],["ประจวบคีรีขันธ์",11.8124,99.7973],
  ["นครราชสีมา",14.9799,102.0978],["บุรีรัมย์",14.9930,103.1029],["สุรินทร์",14.8829,103.4937],
  ["ขอนแก่น",16.4322,102.8236],["อุดรธานี",17.4138,102.7872],["หนองคาย",17.8783,102.7413],
  ["เลย",17.4860,101.7223],["สกลนคร",17.1546,104.1348],["นครพนม",17.3920,104.7696],
  ["อุบลราชธานี",15.2447,104.8473],["ศรีสะเกษ",15.1186,104.3220],["มุกดาหาร",16.5453,104.7235],
  ["ชลบุรี",13.3611,100.9847],["ระยอง",12.6814,101.2816],["จันทบุรี",12.6113,102.1039],
  ["ตราด",12.2428,102.5175],["ชุมพร",10.4930,99.1800],["สุราษฎร์ธานี",9.1382,99.3217],
  ["ภูเก็ต",7.8804,98.3923],["กระบี่",8.0863,98.9063],["นครศรีธรรมราช",8.4304,99.9631],
  ["ตรัง",7.5563,99.6114],["สงขลา",7.1898,100.5954],["ปัตตานี",6.8695,101.2505],
  ["ยะลา",6.5411,101.2804],["นราธิวาส",6.4255,101.8253]
] as const;

function weatherSignal(code: number, precipitation: number, gust: number) {
  if ([95,96,99].includes(code)) return { type: "storm", severity: 3, label: "พายุฝนฟ้าคะนอง" };
  if (precipitation >= 5 || [65,67,82].includes(code)) return { type: "heavy-rain", severity: 3, label: "ฝนหนัก" };
  if (precipitation >= 0.5 || [61,63,80,81].includes(code)) return { type: "rain", severity: 2, label: "มีฝน" };
  if (precipitation > 0 || [51,53,55,56,57].includes(code)) return { type: "drizzle", severity: 1, label: "ฝนเล็กน้อย" };
  if (gust >= 45) return { type: "wind", severity: 2, label: "ลมกระโชกแรง" };
  if ([1,2,3,45,48].includes(code)) return { type: "cloud", severity: 0, label: code >= 45 ? "หมอก/เมฆต่ำ" : "มีเมฆ" };
  return { type: "clear", severity: 0, label: "สภาพอากาศปกติ" };
}

async function nationalSignals(ctx: any) {
  const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
  endpoint.searchParams.set("latitude", WEATHER_POINTS.map(x => x[1]).join(","));
  endpoint.searchParams.set("longitude", WEATHER_POINTS.map(x => x[2]).join(","));
  endpoint.searchParams.set("timezone", "Asia/Bangkok");
  endpoint.searchParams.set("current", "temperature_2m,precipitation,weather_code,wind_gusts_10m");
  const raw = await cachedJson(endpoint.toString(), 300, ctx);
  const rows = Array.isArray(raw) ? raw : [raw];

  const features = WEATHER_POINTS.map((point, i) => {
    const c = rows[i]?.current || {};
    const code = Number(c.weather_code || 0);
    const precipitation = Number(c.precipitation || 0);
    const gust = Number(c.wind_gusts_10m || 0);
    const signal = weatherSignal(code, precipitation, gust);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [point[2], point[1]] },
      properties: {
        id: `weather-${i}`,
        name: point[0],
        kind: "weather-signal",
        eventType: signal.type,
        severity: signal.severity,
        label: signal.label,
        temperature: Number(c.temperature_2m || 0),
        precipitation,
        windGust: gust,
        weatherCode: code,
        observedAt: c.time || new Date().toISOString(),
        source: "Open-Meteo",
        fieldReport: false
      }
    };
  });

  const active = features.filter((f: any) => f.properties.severity > 0).length;
  return json({
    type: "FeatureCollection",
    features,
    meta: {
      total: features.length,
      active,
      fieldReports: 0,
      note: "Weather signals are model-derived and are not eyewitness reports.",
      updatedAt: new Date().toISOString()
    }
  }, 200, 90);
}

async function satellite(ctx: any) {
  const endpoint = "https://www.jma.go.jp/bosai/himawari/data/satimg/targetTimes_fd.json";
  const data = await cachedJson(endpoint, 300, ctx);
  return json({
    frames: Array.isArray(data) ? data.slice(-12) : [],
    products: {
      ir: { band: "B13", product: "TBB", label: "Himawari IR" },
      rgb: { band: "REP", product: "ETC", label: "Himawari RGB" }
    },
    tileBase: "https://www.jma.go.jp/bosai/himawari/data/satimg",
    source: "JMA Himawari"
  }, 200, 120);
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "winter-th", time: new Date().toISOString() }, 200, 0);
      }
      if (url.pathname === "/api/weather") return await weather(url, ctx);
      if (url.pathname === "/api/geocode") return await geocode(url, ctx);
      if (url.pathname === "/api/radar") return await radar(ctx);
      if (url.pathname === "/api/signals") return await nationalSignals(ctx);
      if (url.pathname === "/api/satellite") return await satellite(ctx);
      return new Response("Not found", { status: 404 });
    } catch (error: any) {
      return json({
        error: "UPSTREAM_ERROR",
        message: error?.message || "Unknown upstream error"
      }, 502, 0);
    }
  }
};
