import fs from "node:fs";
const src=fs.readFileSync("worker/provinces.ts","utf8");
const provinces=JSON.parse(src.replace(/^export const PROVINCES = /,"").replace(/ as const;\s*$/,"").trim());
const patterns=[
  p=>`${p} น้ำท่วม`,
  p=>`${p} น้ำขัง`,
  p=>`${p} น้ำป่า`,
  p=>`${p} ฝนตกหนัก`,
  p=>`${p} พายุ`
];
const esc=s=>String(s).replaceAll("'","''");
const now="2026-09-29T00:00:00.000Z";
const rows=[];
for(const p of provinces){
  for(let i=0;i<patterns.length;i++){
    const id=`lemon8-${p.en.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${i+1}`;
    rows.push(`('${esc(id)}','lemon8','${esc(patterns[i](p.th))}','${esc(p.th)}',${p.lat},${p.lon},'pm',110,1,NULL,'${now}',0,'${now}')`);
  }
}
const chunks=[];
for(let i=0;i<rows.length;i+=75){
  chunks.push([
    "INSERT OR IGNORE INTO discovery_queries",
    "(id,provider,query_text,province,lat,lon,freshness,priority,enabled,last_run_at,next_run_at,last_result_count,created_at)",
    "VALUES",
    rows.slice(i,i+75).join(",\n")+";"
  ].join("\n"));
}
fs.writeFileSync("migrations/0004_seed_lemon8_queries.sql",chunks.join("\n\n"));
console.log("lemon8 queries",rows.length,"statements",chunks.length);
