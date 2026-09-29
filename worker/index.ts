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
