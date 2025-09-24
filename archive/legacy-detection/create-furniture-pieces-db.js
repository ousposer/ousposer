#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

/**
 * Calculate cluster-level features from component objects
 */
function calculateClusterFeatures(components) {
    if (components.length === 0) return null;
    
    // Basic statistics
    const totalLength = components.reduce((sum, comp) => sum + comp.total_length_m, 0);
    const totalPoints = components.reduce((sum, comp) => sum + comp.point_count, 0);
    const avgAspectRatio = components.reduce((sum, comp) => sum + comp.aspect_ratio, 0) / components.length;
    
    // Geographic center (centroid)
    const centerLat = components.reduce((sum, comp) => sum + comp.latitude, 0) / components.length;
    const centerLon = components.reduce((sum, comp) => sum + comp.longitude, 0) / components.length;
    
    // Bounding box
    const minLat = Math.min(...components.map(c => c.latitude));
    const maxLat = Math.max(...components.map(c => c.latitude));
    const minLon = Math.min(...components.map(c => c.longitude));
    const maxLon = Math.max(...components.map(c => c.longitude));
    
    // Calculate span in meters
    const latSpan = calculateDistance(minLat, centerLon, maxLat, centerLon);
    const lonSpan = calculateDistance(centerLat, minLon, centerLat, maxLon);
    const maxSpan = Math.max(latSpan, lonSpan);
    
    // Calculate cluster compactness (average distance from centroid)
    const avgDistanceFromCenter = components.reduce((sum, comp) => {
        return sum + calculateDistance(centerLat, centerLon, comp.latitude, comp.longitude);
    }, 0) / components.length;
    
    // Calculate inter-component distances for cohesion metrics
    let totalDistances = 0;
    let distanceCount = 0;
    let maxIntraDistance = 0;
    
    for (let i = 0; i < components.length; i++) {
        for (let j = i + 1; j < components.length; j++) {
            const dist = calculateDistance(
                components[i].latitude, components[i].longitude,
                components[j].latitude, components[j].longitude
            );
            totalDistances += dist;
            distanceCount++;
            maxIntraDistance = Math.max(maxIntraDistance, dist);
        }
    }
    
    const avgIntraDistance = distanceCount > 0 ? totalDistances / distanceCount : 0;
    
    // Complexity score based on number of components and their arrangement
    const complexityScore = components.length * (1 + avgIntraDistance / 10); // Normalized complexity
    
    return {
        component_count: components.length,
        total_length_m: totalLength,
        total_points: totalPoints,
        avg_aspect_ratio: avgAspectRatio,
        center_latitude: centerLat,
        center_longitude: centerLon,
        bounding_box_lat_span_m: latSpan,
        bounding_box_lon_span_m: lonSpan,
        max_span_m: maxSpan,
        avg_distance_from_center_m: avgDistanceFromCenter,
        avg_intra_distance_m: avgIntraDistance,
        max_intra_distance_m: maxIntraDistance,
        complexity_score: complexityScore,
        min_latitude: minLat,
        max_latitude: maxLat,
        min_longitude: minLon,
        max_longitude: maxLon
    };
}

/**
 * Create furniture pieces database table
 */
function createFurniturePiecesTable(db) {
    return new Promise((resolve, reject) => {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS furniture_pieces (
                piece_id TEXT PRIMARY KEY,
                arrondissement INTEGER,
                estimated_type TEXT,
                component_count INTEGER,
                component_ids TEXT, -- JSON array of component object IDs
                
                -- Geometric features
                total_length_m REAL,
                total_points INTEGER,
                avg_aspect_ratio REAL,
                center_latitude REAL,
                center_longitude REAL,
                bounding_box_lat_span_m REAL,
                bounding_box_lon_span_m REAL,
                max_span_m REAL,
                avg_distance_from_center_m REAL,
                avg_intra_distance_m REAL,
                max_intra_distance_m REAL,
                complexity_score REAL,
                
                -- Bounding box
                min_latitude REAL,
                max_latitude REAL,
                min_longitude REAL,
                max_longitude REAL,
                
                -- Metadata
                clustering_method TEXT,
                created_at TEXT
            )
        `;
        
        db.run(createTableSQL, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/**
 * Process and insert furniture pieces from clustering results
 */
async function createFurniturePiecesDatabase() {
    console.log('🔄 Creating furniture pieces database from clustering results...\n');
    
    // Load clustering results
    const clusteringResults = JSON.parse(fs.readFileSync('improved_clustering_results.json', 'utf8'));
    console.log(`Loaded ${clusteringResults.clusters.length} clusters from clustering results`);
    
    const db = new sqlite3.Database('street_furniture.db');
    
    try {
        // Create furniture pieces table
        await createFurniturePiecesTable(db);
        console.log('✅ Created furniture_pieces table');
        
        // Clear existing data
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM furniture_pieces', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        let processedCount = 0;
        const totalClusters = clusteringResults.clusters.length;
        
        // Process each cluster
        for (const cluster of clusteringResults.clusters) {
            // Get component data from street_furniture table
            const componentIds = cluster.object_ids.join(',');
            const components = await new Promise((resolve, reject) => {
                const query = `
                    SELECT objectid, latitude, longitude, total_length_m, point_count, aspect_ratio
                    FROM street_furniture 
                    WHERE objectid IN (${componentIds})
                `;
                
                db.all(query, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            if (components.length === 0) {
                console.warn(`⚠️  No components found for cluster ${cluster.cluster_id}`);
                continue;
            }
            
            // Calculate cluster features
            const features = calculateClusterFeatures(components);
            
            if (!features) {
                console.warn(`⚠️  Could not calculate features for cluster ${cluster.cluster_id}`);
                continue;
            }
            
            // Insert furniture piece
            await new Promise((resolve, reject) => {
                const insertSQL = `
                    INSERT INTO furniture_pieces (
                        piece_id, arrondissement, estimated_type, component_count, component_ids,
                        total_length_m, total_points, avg_aspect_ratio, center_latitude, center_longitude,
                        bounding_box_lat_span_m, bounding_box_lon_span_m, max_span_m,
                        avg_distance_from_center_m, avg_intra_distance_m, max_intra_distance_m,
                        complexity_score, min_latitude, max_latitude, min_longitude, max_longitude,
                        clustering_method, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                
                const values = [
                    cluster.cluster_id,
                    cluster.arrondissement,
                    cluster.estimated_type,
                    features.component_count,
                    JSON.stringify(cluster.object_ids),
                    features.total_length_m,
                    features.total_points,
                    features.avg_aspect_ratio,
                    features.center_latitude,
                    features.center_longitude,
                    features.bounding_box_lat_span_m,
                    features.bounding_box_lon_span_m,
                    features.max_span_m,
                    features.avg_distance_from_center_m,
                    features.avg_intra_distance_m,
                    features.max_intra_distance_m,
                    features.complexity_score,
                    features.min_latitude,
                    features.max_latitude,
                    features.min_longitude,
                    features.max_longitude,
                    'adaptive_dbscan',
                    new Date().toISOString()
                ];
                
                db.run(insertSQL, values, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            processedCount++;
            
            // Progress reporting
            if (processedCount % 1000 === 0) {
                const progress = (processedCount / totalClusters * 100).toFixed(1);
                console.log(`  Processed ${processedCount}/${totalClusters} clusters (${progress}%)`);
            }
        }
        
        console.log(`\n✅ Successfully created ${processedCount} furniture pieces`);
        
        // Generate summary statistics
        const stats = await new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    estimated_type,
                    COUNT(*) as count,
                    AVG(component_count) as avg_components,
                    AVG(total_length_m) as avg_length,
                    AVG(max_span_m) as avg_span,
                    AVG(complexity_score) as avg_complexity
                FROM furniture_pieces 
                GROUP BY estimated_type
                ORDER BY count DESC
            `;
            
            db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        console.log('\n=== FURNITURE PIECES STATISTICS ===');
        stats.forEach(stat => {
            console.log(`${stat.estimated_type}:`);
            console.log(`  Count: ${stat.count}`);
            console.log(`  Avg components: ${stat.avg_components.toFixed(1)}`);
            console.log(`  Avg length: ${stat.avg_length.toFixed(2)}m`);
            console.log(`  Avg span: ${stat.avg_span.toFixed(2)}m`);
            console.log(`  Avg complexity: ${stat.avg_complexity.toFixed(2)}`);
            console.log('');
        });
        
        // Test queries on our validation examples
        console.log('=== VALIDATION EXAMPLES ===');
        const testQueries = [
            { name: 'Single bench', ids: [160796, 42627, 187191, 203438, 125710] },
            { name: 'Double bench', ids: [69244, 190138, 81001, 66358, 158911, 111067] },
            { name: 'Small jardiniere 1', ids: [49568, 237463] },
            { name: 'Small jardiniere 2', ids: [228762, 87489] }
        ];
        
        for (const test of testQueries) {
            const pieces = await new Promise((resolve, reject) => {
                const query = `
                    SELECT piece_id, estimated_type, component_count, total_length_m, max_span_m, complexity_score
                    FROM furniture_pieces 
                    WHERE component_ids LIKE '%${test.ids[0]}%'
                `;
                
                db.all(query, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            
            console.log(`${test.name}:`);
            pieces.forEach(piece => {
                console.log(`  ${piece.piece_id}: ${piece.estimated_type}, ${piece.component_count} components, ${piece.total_length_m.toFixed(2)}m total, ${piece.max_span_m.toFixed(2)}m span, complexity ${piece.complexity_score.toFixed(2)}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error creating furniture pieces database:', error);
    } finally {
        db.close();
    }
}

// Run the database creation if this script is executed directly
if (require.main === module) {
    createFurniturePiecesDatabase();
}

module.exports = {
    calculateClusterFeatures,
    createFurniturePiecesDatabase
};
