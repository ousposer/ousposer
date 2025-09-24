#!/usr/bin/env node

// Calibrate canonical single-bench envelope dimensions (length/width) from manual labels
// Usage: node src/calibrate-single-bench.js /absolute/path/to/manual_clusters.json [arrondissement]
// Reads manual clusters JSON, filters benches with component_count=1, queries PG for each objectid's
// oriented envelope, and outputs median length/width. Use the printed values to set CONFIG.singleBench.*.

const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function queryClient() {
  const { DB_CONFIG } = require('../scripts/setup-postgresql')
  const client = new Client(DB_CONFIG)
  await client.connect()
  return client
}

function median(arr) {
  if (!arr.length) return null
  const a = arr.slice().sort((x,y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

async function getEnvelope(client, objectid) {
  const q = `
    WITH env AS (
      SELECT ST_OrientedEnvelope(shape) AS e
      FROM ousposer.street_furniture_components WHERE objectid = $1
    ), ring AS (
      SELECT ST_ExteriorRing(e) AS r FROM env
    )
    SELECT
      ST_Length(ST_MakeLine(ST_PointN(r,1), ST_PointN(r,2))::geography) s1,
      ST_Length(ST_MakeLine(ST_PointN(r,2), ST_PointN(r,3))::geography) s2,
      ST_Length(ST_MakeLine(ST_PointN(r,3), ST_PointN(r,4))::geography) s3,
      ST_Length(ST_MakeLine(ST_PointN(r,4), ST_PointN(r,1))::geography) s4
    FROM ring
  `
  const { rows } = await client.query(q, [objectid])
  if (!rows.length) return null
  const { s1, s2, s3, s4 } = rows[0]
  const sides = [Number(s1), Number(s2), Number(s3), Number(s4)].sort((a,b)=>a-b)
  return { short: sides[0], long: sides[3] }
}

async function main() {
  const file = process.argv[2]
  const arrFilter = process.argv[3] ? parseInt(process.argv[3]) : null
  if (!file) {
    console.error('Usage: node src/calibrate-single-bench.js /path/to/manual_clusters.json [arrondissement]')
    process.exit(1)
  }
  const raw = fs.readFileSync(path.resolve(file), 'utf-8')
  const data = JSON.parse(raw)

  // Accept both formats: array or object with benches key
  const items = Array.isArray(data) ? data : (data.arrondissements ? data.arrondissements.flatMap(a => a.benches || []) : [])

  const singleBenchIds = []
  for (const it of items) {
    // Only manual labels: require type === 'benches' (when coming from manual UI export)
    // and exactly 1 component
    const type = it.type || it.bench_type || ''
    const arr = it.arrondissement ? parseInt(it.arrondissement) : null
    if (arrFilter && arr !== arrFilter) continue
    if ((type === 'benches' || type === 'single-component') && Array.isArray(it.component_ids) && it.component_ids.length === 1) {
      singleBenchIds.push(it.component_ids[0])
    }
  }

  if (!singleBenchIds.length) {
    console.error('No single-component bench examples found in the provided file.')
    process.exit(2)
  }

  const client = await queryClient()
  const longs = []
  const shorts = []
  try {
    for (const id of singleBenchIds) {
      const env = await getEnvelope(client, id)
      if (env) { longs.push(env.long); shorts.push(env.short) }
    }
  } finally {
    await client.end()
  }

  if (!longs.length) {
    console.error('Failed to compute any envelopes. Are objectids valid in PostGIS?')
    process.exit(3)
  }

  const medLong = median(longs)
  const medShort = median(shorts)

  const result = {
    examples: singleBenchIds.length,
    median_length_m: medLong,
    median_width_m: medShort,
    suggestion: {
      'CONFIG.singleBench.lengthCanonicalMeters': medLong,
      'CONFIG.singleBench.widthCanonicalMeters': medShort,
      'CONFIG.singleBench.similarityToleranceRatio': 0.02,
    }
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

