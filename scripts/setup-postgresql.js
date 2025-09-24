#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * PostgreSQL + PostGIS Database Setup Script for OusPoser
 * Creates production database with spatial tables for benches and poubelles
 */

// Database configuration
const DB_CONFIG = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'ousposer',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'password'
};

/**
 * Create database if it doesn't exist
 */
async function createDatabase() {
    console.log('🗄️  Creating database if needed...');
    
    // Connect to postgres database to create our database
    const adminClient = new Client({
        ...DB_CONFIG,
        database: 'postgres' // Connect to default postgres database
    });
    
    try {
        await adminClient.connect();
        
        // Check if database exists
        const result = await adminClient.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [DB_CONFIG.database]
        );
        
        if (result.rows.length === 0) {
            console.log(`   Creating database '${DB_CONFIG.database}'...`);
            await adminClient.query(`CREATE DATABASE ${DB_CONFIG.database}`);
            console.log('   ✅ Database created successfully');
        } else {
            console.log(`   ✅ Database '${DB_CONFIG.database}' already exists`);
        }
        
    } catch (error) {
        console.error('❌ Error creating database:', error.message);
        throw error;
    } finally {
        await adminClient.end();
    }
}

/**
 * Execute SQL schema file
 */
async function executeSchemaFile() {
    console.log('📋 Setting up database schema...');
    
    const client = new Client(DB_CONFIG);
    
    try {
        await client.connect();
        
        // Read SQL schema file
        const schemaPath = path.join(__dirname, 'setup-postgresql.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('   Executing schema SQL...');
        await client.query(schemaSql);
        
        console.log('   ✅ Schema created successfully');
        
        // Verify tables were created
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'ousposer'
            ORDER BY table_name
        `);
        
        console.log('   📊 Tables created:');
        tablesResult.rows.forEach(row => {
            console.log(`      - ${row.table_name}`);
        });
        
        // Verify PostGIS extension
        const postgisResult = await client.query(`
            SELECT extname, extversion 
            FROM pg_extension 
            WHERE extname IN ('postgis', 'postgis_topology')
        `);
        
        console.log('   🗺️  PostGIS extensions:');
        postgisResult.rows.forEach(row => {
            console.log(`      - ${row.extname} v${row.extversion}`);
        });
        
    } catch (error) {
        console.error('❌ Error setting up schema:', error.message);
        throw error;
    } finally {
        await client.end();
    }
}

/**
 * Test database connection and spatial functionality
 */
async function testDatabase() {
    console.log('🧪 Testing database functionality...');
    
    const client = new Client(DB_CONFIG);
    
    try {
        await client.connect();
        
        // Test basic connection
        const versionResult = await client.query('SELECT version()');
        console.log('   ✅ PostgreSQL connection successful');
        
        // Test PostGIS functionality
        const spatialResult = await client.query(`
            SELECT ST_AsText(ST_MakePoint(2.3522, 48.8566)) as louvre_point
        `);
        console.log('   ✅ PostGIS spatial functions working');
        console.log(`      Sample point: ${spatialResult.rows[0].louvre_point}`);
        
        // Test schema access
        const schemaResult = await client.query(`
            SELECT COUNT(*) as table_count 
            FROM information_schema.tables 
            WHERE table_schema = 'ousposer'
        `);
        console.log(`   ✅ Schema access working (${schemaResult.rows[0].table_count} tables)`);
        
        // Test sample insert and spatial query
        console.log('   🧪 Testing sample data operations...');
        
        // Insert sample bench
        await client.query(`
            INSERT INTO ousposer.benches (
                bench_id, arrondissement, bench_type, component_ids, total_components,
                total_length_m, location, detection_method, detection_confidence
            ) VALUES (
                'test_bench_1', 1, 'single-component', ARRAY[12345], 1,
                7.2, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326),
                'geometric_topology', 0.98
            )
            ON CONFLICT (bench_id) DO NOTHING
        `);
        
        // Insert sample poubelle
        await client.query(`
            INSERT INTO ousposer.poubelles (
                poubelle_id, arrondissement, component_id, total_length_m,
                point_count, aspect_ratio, location, shape, detection_method
            ) VALUES (
                'test_poubelle_1', 1, 67890, 2.2, 72, 0.98,
                ST_SetSRID(ST_MakePoint(2.3525, 48.8568), 4326),
                ST_SetSRID(ST_MakeLine(ST_MakePoint(2.3525, 48.8568), ST_MakePoint(2.3526, 48.8569)), 4326),
                'geometric_characteristics'
            )
            ON CONFLICT (poubelle_id) DO NOTHING
        `);
        
        // Test spatial query
        const spatialQueryResult = await client.query(`
            SELECT furniture_type, furniture_id, arrondissement,
                   ST_AsText(location) as location_text,
                   ST_Distance(location, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)) as distance_degrees
            FROM ousposer.street_furniture_overview
            WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326), 0.001)
            ORDER BY distance_degrees
        `);
        
        console.log('   ✅ Spatial queries working:');
        spatialQueryResult.rows.forEach(row => {
            console.log(`      ${row.furniture_type}: ${row.furniture_id} (${row.distance_degrees.toFixed(6)} degrees away)`);
        });
        
        // Clean up test data
        await client.query(`DELETE FROM ousposer.benches WHERE bench_id = 'test_bench_1'`);
        await client.query(`DELETE FROM ousposer.poubelles WHERE poubelle_id = 'test_poubelle_1'`);
        
        console.log('   🧹 Test data cleaned up');
        
    } catch (error) {
        console.error('❌ Error testing database:', error.message);
        throw error;
    } finally {
        await client.end();
    }
}

/**
 * Display connection information
 */
function displayConnectionInfo() {
    console.log('\n📋 DATABASE CONNECTION INFO:');
    console.log('=' .repeat(40));
    console.log(`Host: ${DB_CONFIG.host}`);
    console.log(`Port: ${DB_CONFIG.port}`);
    console.log(`Database: ${DB_CONFIG.database}`);
    console.log(`User: ${DB_CONFIG.user}`);
    console.log(`Schema: ousposer`);
    console.log('\n🔗 Connection string:');
    console.log(`postgresql://${DB_CONFIG.user}:***@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    console.log('\n📊 Tables created:');
    console.log('  - ousposer.benches');
    console.log('  - ousposer.poubelles');
    console.log('  - ousposer.street_furniture_components');
    console.log('\n👁️  Views available:');
    console.log('  - ousposer.street_furniture_overview');
    console.log('  - ousposer.arrondissement_stats');
}

/**
 * Main setup function
 */
async function setupPostgreSQL() {
    console.log('🚀 Setting up PostgreSQL + PostGIS for OusPoser...\n');
    
    try {
        // Step 1: Create database
        await createDatabase();
        
        // Step 2: Execute schema
        await executeSchemaFile();
        
        // Step 3: Test functionality
        await testDatabase();
        
        // Step 4: Display info
        displayConnectionInfo();
        
        console.log('\n🎉 PostgreSQL + PostGIS setup complete!');
        console.log('✅ Ready for data import from citywide detection results');
        
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('1. Ensure PostgreSQL is running');
        console.error('2. Check connection parameters in environment variables:');
        console.error('   - POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB');
        console.error('   - POSTGRES_USER, POSTGRES_PASSWORD');
        console.error('3. Ensure user has CREATE DATABASE privileges');
        console.error('4. Install PostGIS extension if not available');
        process.exit(1);
    }
}

// Export configuration for other scripts
module.exports = {
    DB_CONFIG,
    setupPostgreSQL
};

// Run setup if script is executed directly
if (require.main === module) {
    setupPostgreSQL();
}
