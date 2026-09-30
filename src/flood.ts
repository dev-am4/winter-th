export type FloodFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, any>;
};

function isoLocal(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? raw.replace(" ", "T") + "+07:00"
    : raw;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : raw;
}

function fresh(value: string, maxAgeHours = 30) {
  const t = Date.parse(value);
  return Number.isFinite(t) && Date.now() - t <= maxAgeHours * 3600_000;
}

function point(lon: number, lat: number, properties: Record<string, any>): FloodFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties
  };
}

export function parseThaiWaterLevel(raw: any): FloodFeature[] {
  const rows = raw?.waterlevel_data?.data;
  if (!Array.isArray(rows)) return [];

  const out: FloodFeature[] = [];
  for (const row of rows) {
    const st = row?.station;
    const lon = Number(st?.tele_station_long);
    const lat = Number(st?.tele_station_lat);
    const observedAt = isoLocal(row?.waterlevel_datetime);
    const value = Number(row?.waterlevel_msl);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(value) || !fresh(observedAt)) continue;
    if (lon < 97 || lon > 106.7 || lat < 5 || lat > 21) continue;

    const situation = Number(row?.situation_level || 0);
    const overflow = String(row?.diff_wl_bank_text || "").includes("ล้น");
    const severity = situation === 5 || overflow ? 3 : situation === 4 ? 2 : situation === 3 ? 1 : 0;
    const diff = Number(row?.diff_wl_bank);
    const detail = Number.isFinite(diff)
      ? `${overflow ? "ล้นตลิ่ง" : "ต่ำกว่าตลิ่ง"} ${Math.abs(diff).toFixed(2)} ม.`
      : "";

    out.push(point(lon, lat, {
      id: `tw-water-${st?.id ?? row?.id ?? out.length}`,
      kind: "water-station",
      eventType: "water-level",
      sourceType: "official",
      source: "ThaiWater / HII",
      fieldReport: false,
      name: st?.tele_station_name?.th || st?.tele_station_name?.en || st?.tele_station_oldcode || "สถานีวัดระดับน้ำ",
      province: row?.geocode?.province_name?.th || "",
      district: row?.geocode?.amphoe_name?.th || "",
      label: severity >= 3 ? "ระดับน้ำวิกฤต" : severity === 2 ? "ระดับน้ำเฝ้าระวัง" : "สถานีระดับน้ำ",
      severity,
      value,
      unit: "ม.รทก.",
      situationLevel: situation,
      detail,
      observedAt,
      agency: row?.agency?.agency_shortname?.th || "สสน.",
      sourceUrl: "https://www.thaiwater.net/new4all"
    }));
  }
  return out;
}

export function parseThaiWaterRain(raw: any, minMm = 35): FloodFeature[] {
  const rows = raw?.data;
  if (!Array.isArray(rows)) return [];

  const out: FloodFeature[] = [];
  for (const row of rows) {
    const st = row?.station;
    const lon = Number(st?.tele_station_long);
    const lat = Number(st?.tele_station_lat);
    const mm = Number(row?.rain_24h);
    const observedAt = isoLocal(row?.rainfall_datetime);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(mm) || mm < minMm || !fresh(observedAt)) continue;
    if (lon < 97 || lon > 106.7 || lat < 5 || lat > 21) continue;

    const severity = mm > 150 ? 3 : mm > 90 ? 3 : mm > 35 ? 2 : 1;
    out.push(point(lon, lat, {
      id: `tw-rain-${st?.id ?? row?.id ?? out.length}`,
      kind: "rain-station",
      eventType: "rain-gauge",
      sourceType: "official",
      source: "ThaiWater / HII",
      fieldReport: false,
      name: st?.tele_station_name?.th || st?.tele_station_name?.en || "สถานีวัดฝน",
      province: row?.geocode?.province_name?.th || "",
      district: row?.geocode?.amphoe_name?.th || "",
      label: mm > 90 ? "ฝนหนักมาก 24 ชม." : "ฝนหนัก 24 ชม.",
      severity,
      value: mm,
      unit: "มม./24ชม.",
      observedAt,
      agency: row?.agency?.agency_shortname?.th || "สสน.",
      sourceUrl: "https://www.thaiwater.net/new4all"
    }));
  }

  return out.sort((a, b) => Number(b.properties.value || 0) - Number(a.properties.value || 0)).slice(0, 900);
}

export function parseThaiWaterRoad(raw: any): FloodFeature[] {
  const rows = raw?.data;
  if (!Array.isArray(rows)) return [];

  const out: FloodFeature[] = [];
  for (const row of rows) {
    const st = row?.station;
    const lon = Number(st?.floodroad_long);
    const lat = Number(st?.floodroad_lat);
    const cm = Number(row?.floodroad_value);
    const observedAt = isoLocal(row?.floodroad_datetime);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(cm) || !fresh(observedAt, 8)) continue;

    const severity = cm >= 20 ? 3 : cm >= 10 ? 2 : cm > 0 ? 1 : 0;
    out.push(point(lon, lat, {
      id: `tw-road-${st?.floodroad_oldcode || st?.id || out.length}`,
      kind: "road-flood-sensor",
      eventType: "road-flood",
      sourceType: "official",
      source: "BMA / ThaiWater relay",
      fieldReport: false,
      name: st?.floodroad_name?.th || "จุดวัดน้ำท่วมถนน",
      province: row?.geocode?.province_name?.th || "กรุงเทพมหานคร",
      district: row?.geocode?.amphoe_name?.th || "",
      label: severity >= 3 ? "น้ำท่วมถนนสูง" : severity === 2 ? "น้ำท่วมถนน" : "เซนเซอร์ถนน",
      severity,
      value: cm,
      unit: "ซม.",
      observedAt,
      agency: "สนน. กทม. / สสน.",
      sourceUrl: st?.floodroad_oldcode
        ? `https://floodbangkok.bangkok.go.th/device-info?sensor_profile_id=${encodeURIComponent(st.floodroad_oldcode)}`
        : "https://weather.bangkok.go.th/flood/"
    }));
  }
  return out;
}

export function hydroStats(features: FloodFeature[]) {
  const water = features.filter((f) => f.properties.kind === "water-station").length;
  const rain = features.filter((f) => f.properties.kind === "rain-station").length;
  const road = features.filter((f) => f.properties.kind === "road-flood-sensor").length;
  const alerts = features.filter((f) => Number(f.properties.severity || 0) >= 2).length;
  const critical = features.filter((f) => Number(f.properties.severity || 0) >= 3).length;
  return { water, rain, road, alerts, critical, total: features.length };
}
