import { PROVINCES } from "./provinces";

type Env = { ASSETS: Fetcher; POSTS_DB: any; YOUTUBE_API_KEY?: string };

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

async function cachedText(url: string, ttl: number, ctx: any) {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.text();

  const response = await fetch(url, {
    headers: { "user-agent": "winter-th/0.1 public-situation-map" }
  });
  if (!response.ok) throw new Error(`Upstream ${response.status}: ${url}`);

  const body = await response.text();
  const stored = new Response(body, {
    headers: {
      "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8",
      "cache-control": `public, max-age=${ttl}`
    }
  });
  ctx.waitUntil(cache.put(key, stored.clone()));
  return body;
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


type PublicReport = {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceType: "official" | "news";
  publishedAt: string;
  timeKind?: "published" | "detected";
  image?: string;
  province: string;
  lon: number;
  lat: number;
  eventType: string;
  severity: number;
  label: string;
};

function xmlValue(block: string, tag: string) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseRss(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const block = m[1];
    const description = xmlValue(block, "description");
    const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i)?.[1] || "";
    const imageTag = xmlValue(block, "image");
    const imageInHtml = description.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    const sourceBlock = block.match(/<source(?:\s+url=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title: stripHtml(xmlValue(block, "title")),
      link: decodeEntities(stripHtml(xmlValue(block, "link"))),
      guid: stripHtml(xmlValue(block, "guid")),
      pubDate: stripHtml(xmlValue(block, "pubDate")),
      description: stripHtml(description),
      image: decodeEntities(imageTag || enclosure || imageInHtml),
      source: sourceBlock ? stripHtml(sourceBlock[2]) : "",
      sourceUrl: sourceBlock?.[1] || ""
    };
  });
}

function reportHash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const PLACE_HINTS = [
  { keys: ["กทม.", "กรุงเทพ", "บางกะปิ", "ลาดพร้าว", "ร่มเกล้า", "หลักสี่", "จตุจักร", "มีนบุรี", "หนองจอก", "ลาดกระบัง", "คลองสามวา"], province: "กรุงเทพมหานคร" },
  { keys: ["บ้านค่าย"], province: "ระยอง" },
  { keys: ["โคราช"], province: "นครราชสีมา" },
  { keys: ["อยุธยา"], province: "พระนครศรีอยุธยา" }
] as const;

function findProvince(text: string) {
  const normalized = text.toLowerCase();
  for (const hint of PLACE_HINTS) {
    if (hint.keys.some((x) => normalized.includes(x.toLowerCase()))) {
      const p = PROVINCES.find((x) => x.th === hint.province);
      if (p) return p;
    }
  }
  for (const p of PROVINCES) {
    const names = [p.th, p.en, ...p.aliases].filter(Boolean);
    if (names.some((x) => normalized.includes(String(x).toLowerCase()))) return p;
  }
  return null;
}

function reportKind(text: string) {
  const t = text.toLowerCase();
  if (/น้ำป่า|flash flood|น้ำหลาก/.test(t)) return { eventType: "flash-flood", severity: 3, label: "น้ำป่า/น้ำหลาก" };
  if (/น้ำท่วม|น้ำขัง|ท่วมหนัก|อุทกภัย|flood/.test(t)) return { eventType: "flood", severity: 3, label: "รายงานน้ำท่วม" };
  if (/ดินถล่ม|landslide/.test(t)) return { eventType: "landslide", severity: 3, label: "เสี่ยงดินถล่ม" };
  if (/ฝนตกหนัก|ฝนหนัก|heavy rain/.test(t)) return { eventType: "heavy-rain-report", severity: 2, label: "รายงานฝนหนัก" };
  if (/พายุ|storm|ลมแรง/.test(t)) return { eventType: "storm-report", severity: 2, label: "รายงานพายุ/ลมแรง" };
  return null;
}

function parseDate(value: string) {
  const raw = (value || "").trim();
  if (!raw) return null;

  const gdelt = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (gdelt) {
    return new Date(Date.UTC(+gdelt[1], +gdelt[2] - 1, +gdelt[3], +gdelt[4], +gdelt[5], +gdelt[6]));
  }

  const thai = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (thai) {
    let year = +thai[3];
    if (year > 2400) year -= 543;
    return new Date(`${year}-${String(+thai[2]).padStart(2, "0")}-${String(+thai[1]).padStart(2, "0")}T${String(+thai[4]).padStart(2, "0")}:${thai[5]}:${thai[6]}+07:00`);
  }

  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toFeature(r: PublicReport) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: {
      id: r.id,
      name: r.province,
      kind: "public-report",
      eventType: r.eventType,
      severity: r.severity,
      label: r.label,
      title: r.title,
      source: r.source,
      sourceType: r.sourceType,
      sourceUrl: r.url,
      image: r.image || "",
      publishedAt: r.publishedAt,
      timeKind: r.timeKind || "published",
      fieldReport: true,
      locationAccuracy: "province"
    }
  };
}

async function publicReports(ctx: any) {
  const now = Date.now();
  const maxAge = 72 * 60 * 60 * 1000;
  const reports: PublicReport[] = [];

  const add = (candidate: {
    title: string; url: string; source: string; sourceType: "official" | "news";
    publishedAt: string; image?: string; description?: string;
  }) => {
    if (!candidate.title || !candidate.url) return;
    const date = parseDate(candidate.publishedAt);
    if (!date || now - date.getTime() > maxAge || date.getTime() - now > 6 * 60 * 60 * 1000) return;
    const text = `${candidate.title} ${candidate.description || ""}`;
    const kind = reportKind(text);
    const province = findProvince(text);
    if (!kind || !province) return;
    reports.push({
      id: `report-${reportHash(candidate.url + candidate.title)}`,
      title: candidate.title.slice(0, 240),
      url: candidate.url,
      source: candidate.source || "Public source",
      sourceType: candidate.sourceType,
      publishedAt: date?.toISOString() || new Date().toISOString(),
      image: candidate.image,
      province: province.th,
      lon: province.lon,
      lat: province.lat,
      ...kind
    });
  };

  const dwrUrl = "https://dwr.go.th/uploads/xml/rss_news_TH_2.xml";
  const tmdUrl = "https://tmd.go.th/api/xml/warning-news";
  const prdUrl = "https://www.prd.go.th/th/rss/page/contentjson/id/142/cid/33";
  const gdeltUrl = "https://api.gdeltproject.org/api/v2/geo/geo?query=(flood%20OR%20flooding%20OR%20%22heavy%20rain%22%20OR%20landslide)%20sourcecountry:thailand&mode=pointdata&format=geojson&timespan=72h&maxpoints=120&geores=1&sortby=date";

  const [dwrXml, tmdXml, prd, gdelt] = await Promise.all([
    cachedText(dwrUrl, 900, ctx).catch(() => ""),
    cachedText(tmdUrl, 1800, ctx).catch(() => ""),
    cachedJson(prdUrl, 600, ctx).catch(() => null),
    cachedJson(gdeltUrl, 1800, ctx).catch(() => null)
  ]);

  for (const item of parseRss(dwrXml).slice(0, 80)) {
    add({
      title: item.title,
      url: item.link,
      source: "กรมทรัพยากรน้ำ",
      sourceType: "official",
      publishedAt: item.pubDate,
      image: item.image,
      description: item.description
    });
  }

  for (const item of parseRss(tmdXml).slice(0, 30)) {
    add({
      title: item.title,
      url: "https://www.tmd.go.th/warning-and-events",
      source: "กรมอุตุนิยมวิทยา",
      sourceType: "official",
      publishedAt: item.pubDate,
      image: item.image,
      description: item.description
    });
  }

  for (const item of (prd?.items || []).slice(0, 40)) {
    const html = String(item.content_html || "");
    const rawImage = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    const image = rawImage
      ? (rawImage.startsWith("http") ? rawImage : `https://www.prd.go.th${rawImage.startsWith("/") ? "" : "/"}${rawImage}`)
      : "";

    add({
      title: String(item.title || ""),
      url: String(item.url || ""),
      source: "กรมประชาสัมพันธ์",
      sourceType: "official",
      publishedAt: String(item.date_published || ""),
      image,
      description: stripHtml(html).slice(0, 4000)
    });
  }

  for (const feature of (gdelt?.features || []).slice(0, 120)) {
    const coordinates = feature?.geometry?.coordinates || [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < 97 || lon > 106.5 || lat < 5 || lat > 21) continue;

    const props = feature?.properties || {};
    const html = String(props.html || "");
    const anchor = html.match(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = decodeEntities(anchor?.[1] || "");
    const title = stripHtml(anchor?.[2] || props.name || "รายงานสถานการณ์จากข่าว");
    const kind = reportKind(`${title} ${html}`) || { eventType: "flood", severity: 2, label: "รายงานสถานการณ์" };
    const sourceHost = (() => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "GDELT news source"; }
    })();

    reports.push({
      id: `report-geo-${reportHash(`${lon},${lat},${url},${props.name || ""}`)}`,
      title: title.slice(0, 240),
      url: url || "https://www.gdeltproject.org/",
      source: sourceHost,
      sourceType: "news",
      publishedAt: new Date().toISOString(),
      timeKind: "detected",
      image: String(props.shareimage || ""),
      province: String(props.name || "จุดรายงาน"),
      lon,
      lat,
      ...kind
    });
  }

  const deduped = [...new Map(reports.map((r) => [r.id, r])).values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 120);

  return json({
    type: "FeatureCollection",
    features: deduped.map(toFeature),
    meta: {
      total: deduped.length,
      official: deduped.filter((x) => x.sourceType === "official").length,
      news: deduped.filter((x) => x.sourceType === "news").length,
      locationAccuracy: "province-centroid",
      updatedAt: new Date().toISOString(),
      sources: ["กรมทรัพยากรน้ำ", "กรมอุตุนิยมวิทยา", "กรมประชาสัมพันธ์", "GDELT GEO 2.0"]
    }
  }, 200, 180);
}


function postPlatform(sourceUrl: string) {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
    if (host.endsWith("tiktok.com")) return "tiktok";
    if (host === "x.com" || host.endsWith("twitter.com")) return "x";
    if (host.endsWith("reddit.com")) return "reddit";
    if (host.endsWith("facebook.com")) return "facebook";
    if (host.endsWith("instagram.com")) return "instagram";
    return "web";
  } catch {
    return "unknown";
  }
}

async function oembedForUrl(sourceUrl: string, platform: string) {
  try {
    let endpoint = "";
    if (platform === "youtube") {
      endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`;
    } else if (platform === "tiktok") {
      endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(sourceUrl)}`;
    } else if (platform === "x") {
      endpoint = `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(sourceUrl)}`;
    }
    if (!endpoint) return null;
    const r = await fetch(endpoint, { headers: { "user-agent": "winter-th/0.1 public-post-index" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function clampNumber(value: unknown, min: number, max: number) {
  const x = Number(value);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, x));
}

function postFeature(row: any) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [Number(row.lon), Number(row.lat)] },
    properties: {
      id: row.id,
      kind: "community-post",
      fieldReport: true,
      sourceType: "community",
      platform: row.platform,
      sourceUrl: row.source_url,
      authorName: row.author_name || "",
      title: row.content || "",
      thumbnail: row.thumbnail_url || "",
      mediaType: row.media_type || "post",
      locationLabel: row.location_label || "",
      locationAccuracy: row.location_accuracy || "approximate",
      eventType: row.event_type || "flood",
      confidence: Number(row.confidence || 0.5),
      postedAt: row.posted_at || "",
      detectedAt: row.ingested_at,
      timeKind: row.posted_at ? "published" : "detected",
      severity: 3,
      label: row.event_type === "flood" ? "โพสต์น้ำท่วม" : "โพสต์จากพื้นที่"
    }
  };
}

async function postsViewport(url: URL, env: Env) {
  const bbox = (url.searchParams.get("bbox") || "97,5,106.5,21").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some(x => !Number.isFinite(x))) {
    return json({ error: "BAD_BBOX" }, 400, 0);
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const zoom = Math.max(3, Math.min(14, Number(url.searchParams.get("zoom") || 5)));
  const hours = Math.max(1, Math.min(720, Number(url.searchParams.get("hours") || 168)));
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  if (zoom < 9) {
    const cell = zoom <= 4 ? 1.5 : zoom <= 6 ? 0.65 : 0.24;
    const q = await env.POSTS_DB.prepare(`
      SELECT
        CAST(lon / ? AS INTEGER) AS gx,
        CAST(lat / ? AS INTEGER) AS gy,
        COUNT(*) AS count,
        AVG(lon) AS lon,
        AVG(lat) AS lat,
        MAX(COALESCE(posted_at, ingested_at)) AS latest_at,
        MAX(thumbnail_url) AS sample_thumbnail
      FROM public_posts
      WHERE status = 'active'
        AND lon BETWEEN ? AND ?
        AND lat BETWEEN ? AND ?
        AND COALESCE(posted_at, ingested_at) >= ?
      GROUP BY gx, gy
      ORDER BY count DESC
      LIMIT 900
    `).bind(cell, cell, minLon, maxLon, minLat, maxLat, since).all();

    return json({
      mode: "clusters",
      features: (q.results || []).map((row: any, i: number) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(row.lon), Number(row.lat)] },
        properties: {
          id: `post-cluster-${i}`,
          kind: "post-cluster",
          count: Number(row.count || 0),
          latestAt: row.latest_at,
          thumbnail: row.sample_thumbnail || ""
        }
      })),
      meta: { zoom, hours }
    }, 200, 30);
  }

  const q = await env.POSTS_DB.prepare(`
    SELECT id, platform, source_url, author_name, content, thumbnail_url, media_type,
           lat, lon, location_label, location_accuracy, event_type, confidence,
           posted_at, ingested_at
    FROM public_posts
    WHERE status = 'active'
      AND lon BETWEEN ? AND ?
      AND lat BETWEEN ? AND ?
      AND COALESCE(posted_at, ingested_at) >= ?
    ORDER BY COALESCE(posted_at, ingested_at) DESC
    LIMIT 250
  `).bind(minLon, maxLon, minLat, maxLat, since).all();

  return json({
    mode: "points",
    features: (q.results || []).map(postFeature),
    meta: { zoom, hours, returned: q.results?.length || 0 }
  }, 200, 20);
}

async function submitPublicPost(request: Request, env: Env) {
  const body: any = await request.json().catch(() => null);
  if (!body) return json({ error: "BAD_JSON" }, 400, 0);

  const sourceUrl = String(body.url || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad");
  } catch {
    return json({ error: "BAD_URL" }, 400, 0);
  }

  const lat = clampNumber(body.lat, 5, 21);
  const lon = clampNumber(body.lon, 97, 106.5);
  if (lat == null || lon == null) return json({ error: "BAD_LOCATION" }, 400, 0);

  const platform = postPlatform(sourceUrl);
  const meta: any = await oembedForUrl(sourceUrl, platform);
  const title = String(body.note || meta?.title || "").trim().slice(0, 1200);
  const thumbnail = String(meta?.thumbnail_url || "").slice(0, 1500);
  const author = String(meta?.author_name || "").slice(0, 200);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.POSTS_DB.prepare(`
    INSERT INTO post_submissions
      (id, source_url, platform, lat, lon, location_label, submitted_note, submitted_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    id, sourceUrl, platform, lat, lon,
    String(body.locationLabel || "").slice(0, 240),
    title, now
  ).run();

  return json({
    ok: true,
    id,
    status: "pending",
    preview: {
      platform,
      title,
      thumbnail,
      author
    }
  }, 201, 0);
}

async function postsStats(env: Env) {
  const q = await env.POSTS_DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM (
      SELECT status FROM public_posts
      UNION ALL
      SELECT status FROM post_submissions
    )
  `).all();
  const row: any = q.results?.[0] || {};
  return json({
    total: Number(row.total || 0),
    active: Number(row.active || 0),
    pending: Number(row.pending || 0)
  }, 200, 30);
}

async function youtubeDiscover(url: URL, env: Env) {
  if (!env.YOUTUBE_API_KEY) {
    return json({ error: "YOUTUBE_API_KEY_REQUIRED", enabled: false }, 503, 0);
  }
  const q = (url.searchParams.get("q") || "น้ำท่วม").slice(0, 80);
  const publishedAfter = new Date(Date.now() - 48 * 3600_000).toISOString();
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("maxResults", "25");
  endpoint.searchParams.set("order", "date");
  endpoint.searchParams.set("regionCode", "TH");
  endpoint.searchParams.set("relevanceLanguage", "th");
  endpoint.searchParams.set("publishedAfter", publishedAfter);
  endpoint.searchParams.set("q", q);
  endpoint.searchParams.set("key", env.YOUTUBE_API_KEY);
  const r = await fetch(endpoint);
  if (!r.ok) return json({ error: "YOUTUBE_UPSTREAM", status: r.status }, 502, 0);
  const data: any = await r.json();
  return json({
    enabled: true,
    items: (data.items || []).map((x: any) => ({
      id: x.id?.videoId,
      title: x.snippet?.title,
      description: x.snippet?.description,
      channelTitle: x.snippet?.channelTitle,
      publishedAt: x.snippet?.publishedAt,
      thumbnail: x.snippet?.thumbnails?.medium?.url || x.snippet?.thumbnails?.default?.url,
      url: x.id?.videoId ? `https://www.youtube.com/watch?v=${x.id.videoId}` : ""
    }))
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
      if (url.pathname === "/api/signals") return await nationalSignals(ctx);
      if (url.pathname === "/api/reports") return await publicReports(ctx);
      if (url.pathname === "/api/posts" && request.method === "GET") return await postsViewport(url, env);
      if (url.pathname === "/api/posts/submit" && request.method === "POST") return await submitPublicPost(request, env);
      if (url.pathname === "/api/posts/stats") return await postsStats(env);
      if (url.pathname === "/api/posts/discover/youtube") return await youtubeDiscover(url, env);
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
