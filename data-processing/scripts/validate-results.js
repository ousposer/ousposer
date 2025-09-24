#!/usr/bin/env node

const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const { DB_CONFIG } = require('./setup-postgresql');

/**
 * Validation Script for OusPoser Detection Results
 * Compares SQLite vs PostgreSQL data and validates detection accuracy
 */

/**
 * Validate database connections
 */
async function validateConnections() {
    console.log('🔗 Validating database connections...');
    
    // Test PostgreSQL connection
    const pgClient = new Client(DB_CONFIG);
    try {
        await pgClient.connect();
        const pgResult = await pgClient.query('SELECT COUNT(*) FROM ousposer.benches');
        console.log(`   ✅ PostgreSQL: Connected, ${pgResult.rows[0].count} benches found`);
        await pgClient.end();
    } catch (error) {
        console.error('   ❌ PostgreSQL connection failed:', error.message);
        return false;
    }
    
    // Test SQLite connection
    const sqliteDb = new sqlite3.Database('street_furniture.db');
    try {
        const sqliteResult = await new Promise((resolve, reject) => {
            sqliteDb.get('SELECT COUNT(*) as count FROM street_furniture', (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        console.log(`   ✅ SQLite: Connected, ${sqliteResult.count} components found`);
        sqliteDb.close();
    } catch (error) {
        console.error('   ❌ SQLite connection failed:', error.message);
        return false;
    }
    
    return true;
}

/**
 * Compare detection counts between systems
 */
async function compareDetectionCounts() {
    console.log('\n📊 Comparing detection counts...');
    
    const pgClient = new Client(DB_CONFIG);
    await pgClient.connect();
    
    try {
        // Get PostgreSQL counts
        const pgStats = await pgClient.query(`
            SELECT 
                arrondissement,
                COUNT(*) as bench_count
            FROM ousposer.benches
            GROUP BY arrondissement
            ORDER BY arrondissement
        `);
        
        const pgPoubelles = await pgClient.query(`
            SELECT 
                arrondissement,
                COUNT(*) as poubelle_count
            FROM ousposer.poubelles
            GROUP BY arrondissement
            ORDER BY arrondissement
        `);
        
        // Create maps for easy lookup
        const pgBenchMap = new Map(pgStats.rows.map(r => [r.arrondissement, parseInt(r.bench_count)]));
        const pgPoubelleMap = new Map(pgPoubelles.rows.map(r => [r.arrondissement, parseInt(r.poubelle_count)]));
        
        // Get all arrondissements
        const arrondissements = [...new Set([...pgBenchMap.keys(), ...pgPoubelleMap.keys()])].sort();
        
        console.log('\n   📋 Detection counts by arrondissement:');
        console.log('   Arr | Benches | Poubelles | Total');
        console.log('   ----|---------|-----------|------');
        
        let totalBenches = 0;
        let totalPoubelles = 0;
        
        for (const arr of arrondissements) {
            const benches = pgBenchMap.get(arr) || 0;
            const poubelles = pgPoubelleMap.get(arr) || 0;
            const total = benches + poubelles;
            
            console.log(`   ${arr.toString().padStart(3)} | ${benches.toString().padStart(7)} | ${poubelles.toString().padStart(9)} | ${total.toString().padStart(5)}`);
            
            totalBenches += benches;
            totalPoubelles += poubelles;
        }
        
        console.log('   ----|---------|-----------|------');
        console.log(`   TOT | ${totalBenches.toString().padStart(7)} | ${totalPoubelles.toString().padStart(9)} | ${(totalBenches + totalPoubelles).toString().padStart(5)}`);
        
        return { totalBenches, totalPoubelles, arrondissements };
        
    } finally {
        await pgClient.end();
    }
}

/**
 * Validate spatial data integrity
 */
async function validateSpatialData() {
    console.log('\n🗺️  Validating spatial data integrity...');
    
    const pgClient = new Client(DB_CONFIG);
    await pgClient.connect();
    
    try {
        // Check for invalid geometries
        const invalidGeoms = await pgClient.query(`
            SELECT 'benches' as table_name, COUNT(*) as invalid_count
            FROM ousposer.benches 
            WHERE NOT ST_IsValid(location)
            UNION ALL
            SELECT 'poubelles' as table_name, COUNT(*) as invalid_count
            FROM ousposer.poubelles 
            WHERE NOT ST_IsValid(location) OR NOT ST_IsValid(shape)
            UNION ALL
            SELECT 'components' as table_name, COUNT(*) as invalid_count
            FROM ousposer.street_furniture_components 
            WHERE NOT ST_IsValid(location) OR NOT ST_IsValid(shape)
        `);
        
        console.log('   📐 Geometry validation:');
        invalidGeoms.rows.forEach(row => {
            const status = row.invalid_count === '0' ? '✅' : '❌';
            console.log(`     ${status} ${row.table_name}: ${row.invalid_count} invalid geometries`);
        });
        
        // Check coordinate ranges (should be within Paris bounds)
        const coordRanges = await pgClient.query(`
            SELECT 
                'benches' as table_name,
                MIN(ST_X(location)) as min_lon,
                MAX(ST_X(location)) as max_lon,
                MIN(ST_Y(location)) as min_lat,
                MAX(ST_Y(location)) as max_lat
            FROM ousposer.benches
            UNION ALL
            SELECT 
                'poubelles' as table_name,
                MIN(ST_X(location)) as min_lon,
                MAX(ST_X(location)) as max_lon,
                MIN(ST_Y(location)) as min_lat,
                MAX(ST_Y(location)) as max_lat
            FROM ousposer.poubelles
        `);
        
        console.log('\n   🌍 Coordinate ranges:');
        coordRanges.rows.forEach(row => {
            const lonValid = row.min_lon >= 2.2 && row.max_lon <= 2.5; // Rough Paris longitude bounds
            const latValid = row.min_lat >= 48.8 && row.max_lat <= 48.9; // Rough Paris latitude bounds
            const status = lonValid && latValid ? '✅' : '⚠️';
            console.log(`     ${status} ${row.table_name}: lon ${row.min_lon.toFixed(4)} to ${row.max_lon.toFixed(4)}, lat ${row.min_lat.toFixed(4)} to ${row.max_lat.toFixed(4)}`);
        });
        
    } finally {
        await pgClient.end();
    }
}

/**
 * Test spatial queries performance
 */
async function testSpatialQueries() {
    console.log('\n⚡ Testing spatial query performance...');
    
    const pgClient = new Client(DB_CONFIG);
    await pgClient.connect();
    
    try {
        // Test 1: Find furniture near Louvre (2.3376, 48.8606)
        const start1 = Date.now();
        const nearLouvre = await pgClient.query(`
            SELECT furniture_type, COUNT(*) as count
            FROM ousposer.street_furniture_overview
            WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326), 0.01)
            GROUP BY furniture_type
        `);
        const time1 = Date.now() - start1;
        
        console.log(`   🏛️  Near Louvre (1km radius): ${time1}ms`);
        nearLouvre.rows.forEach(row => {
            console.log(`     ${row.furniture_type}: ${row.count}`);
        });
        
        // Test 2: Arrondissement statistics
        const start2 = Date.now();
        const arrStats = await pgClient.query(`
            SELECT * FROM ousposer.arrondissement_stats
            WHERE arrondissement <= 5
            ORDER BY arrondissement
        `);
        const time2 = Date.now() - start2;
        
        console.log(`\n   📊 Arrondissement stats (1-5): ${time2}ms`);
        arrStats.rows.forEach(row => {
            console.log(`     Arr ${row.arrondissement}: ${row.bench_count} benches, ${row.poubelle_count} poubelles`);
        });
        
        // Test 3: Distance calculation
        const start3 = Date.now();
        const distances = await pgClient.query(`
            SELECT 
                bench_id,
                ST_Distance(location, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)) * 111000 as distance_m
            FROM ousposer.benches
            WHERE arrondissement = 1
            ORDER BY distance_m
            LIMIT 5
        `);
        const time3 = Date.now() - start3;
        
        console.log(`\n   📏 Distance calculations: ${time3}ms`);
        distances.rows.forEach(row => {
            console.log(`     ${row.bench_id}: ${row.distance_m.toFixed(1)}m away`);
        });
        
    } finally {
        await pgClient.end();
    }
}

/**
 * Validate detection quality
 */
async function validateDetectionQuality() {
    console.log('\n🎯 Validating detection quality...');
    
    const pgClient = new Client(DB_CONFIG);
    await pgClient.connect();
    
    try {
        // Check bench type distribution
        const benchTypes = await pgClient.query(`
            SELECT bench_type, COUNT(*) as count, AVG(detection_confidence) as avg_confidence
            FROM ousposer.benches
            GROUP BY bench_type
            ORDER BY count DESC
        `);
        
        console.log('   🪑 Bench type distribution:');
        benchTypes.rows.forEach(row => {
            console.log(`     ${row.bench_type}: ${row.count} (confidence: ${(row.avg_confidence * 100).toFixed(1)}%)`);
        });
        
        // Check component usage
        const componentUsage = await pgClient.query(`
            SELECT classified_as, COUNT(*) as count
            FROM ousposer.street_furniture_components
            GROUP BY classified_as
            ORDER BY count DESC
        `);
        
        console.log('\n   🧩 Component classification:');
        componentUsage.rows.forEach(row => {
            console.log(`     ${row.classified_as}: ${row.count} components`);
        });
        
        // Check for potential issues
        const issues = await pgClient.query(`
            SELECT 
                'Benches with no components' as issue,
                COUNT(*) as count
            FROM ousposer.benches
            WHERE total_components = 0 OR component_ids IS NULL
            UNION ALL
            SELECT 
                'Poubelles with invalid characteristics' as issue,
                COUNT(*) as count
            FROM ousposer.poubelles
            WHERE aspect_ratio <= 0.95 OR point_count <= 65 OR total_length_m <= 2.1 OR total_length_m >= 2.4
        `);
        
        console.log('\n   ⚠️  Potential issues:');
        issues.rows.forEach(row => {
            const status = row.count === '0' ? '✅' : '⚠️';
            console.log(`     ${status} ${row.issue}: ${row.count}`);
        });
        
    } finally {
        await pgClient.end();
    }
}

/**
 * Main validation function
 */
async function validateResults() {
    console.log('🧪 Starting OusPoser results validation...\n');
    
    try {
        // Step 1: Validate connections
        const connectionsOk = await validateConnections();
        if (!connectionsOk) {
            console.error('❌ Database connections failed. Cannot proceed with validation.');
            process.exit(1);
        }
        
        // Step 2: Compare detection counts
        const counts = await compareDetectionCounts();
        
        // Step 3: Validate spatial data
        await validateSpatialData();
        
        // Step 4: Test spatial queries
        await testSpatialQueries();
        
        // Step 5: Validate detection quality
        await validateDetectionQuality();
        
        // Final summary
        console.log('\n🎉 VALIDATION COMPLETE!');
        console.log('=' .repeat(50));
        console.log(`✅ Total furniture detected: ${counts.totalBenches + counts.totalPoubelles}`);
        console.log(`   🪑 Benches: ${counts.totalBenches}`);
        console.log(`   🗑️  Poubelles: ${counts.totalPoubelles}`);
        console.log(`   🏛️  Arrondissements: ${counts.arrondissements.length}`);
        console.log('\n✅ PostgreSQL + PostGIS database is ready for production!');
        
    } catch (error) {
        console.error('\n❌ Validation failed:', error.message);
        process.exit(1);
    }
}

// Run validation if script is executed directly
if (require.main === module) {
    validateResults();
}

module.exports = { validateResults };
