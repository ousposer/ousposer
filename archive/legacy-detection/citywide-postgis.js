#!/usr/bin/env node

const fs = require('fs');
const { Client } = require('pg');
const { detectArrondissementPG } = require('./postgis-detection');

async function getArrondissementsPG(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT arrondissement FROM ousposer.street_furniture_components WHERE arrondissement IS NOT NULL ORDER BY arrondissement`
  );
  return rows.map(r => r.arrondissement);
}

async function runCitywidePostGIS() {
  console.log('🚀 Starting citywide detection (PostGIS)…');
  const { DB_CONFIG } = require('../scripts/setup-postgresql');
  const client = new Client(DB_CONFIG);
  await client.connect();

  try {
    const arrs = await getArrondissementsPG(client);
    console.log(`📍 Arrondissements: [${arrs.join(', ')}]`);

    const allResults = [];
    let totalBenches = 0;
    let totalPoubelles = 0;
    const start = Date.now();

    for (const arr of arrs) {
      const result = await detectArrondissementPG(arr);
      allResults.push(result);
      totalBenches += result.benches.length;
      totalPoubelles += result.poubelles.length;
      console.log(`  ✅ Arr ${arr}: ${result.benches.length} benches, ${result.poubelles.length} poubelles`);
    }

    const totalTime = Date.now() - start;
    const finalResults = {
      timestamp: new Date().toISOString(),
      detection_method: 'postgis_topology_and_rectangle_validation',
      coverage: 'all_paris_arrondissements',
      total_arrondissements: arrs.length,
      total_benches: totalBenches,
      total_poubelles: totalPoubelles,
      processing_time_ms: totalTime,
      arrondissements: allResults,
      benches: allResults.flatMap(r => r.benches),
      poubelles: allResults.flatMap(r => r.poubelles),
    };

    const outputFile = 'citywide_detection_results_postgis.json';
    fs.writeFileSync(outputFile, JSON.stringify(finalResults, null, 2));
    console.log(`\n💾 Results saved to ${outputFile}`);

    return finalResults;
  } catch (e) {
    console.error('❌ Error in PostGIS citywide detection:', e);
    throw e;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runCitywidePostGIS()
    .then(() => { console.log('\n✅ PostGIS citywide detection completed!'); process.exit(0); })
    .catch(() => process.exit(1));
}

module.exports = { runCitywidePostGIS };

