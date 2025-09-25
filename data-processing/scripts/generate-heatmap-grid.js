#!/usr/bin/env node

/**
 * Paris Heatmap Grid Generator
 * 
 * Generates a grid of points across Paris and analyzes each point
 * for fresh spot scoring to create a comprehensive heatmap.
 */

const { Pool } = require('pg')
const { DB_CONFIG } = require('./setup-postgresql')
const { FreshSpotAnalyzer } = require('../src/fresh-spot-algorithm')

// Paris boundaries (approximate)
const PARIS_BOUNDS = {
    north: 48.9021,
    south: 48.8155,
    east: 2.4697,
    west: 2.2242
}

// Grid configuration
const GRID_CONFIG = {
    resolution_m: 100, // 100 meter grid spacing
    concurrency: 10,   // Number of parallel API calls
    batch_size: 100,   // Points to process before saving progress
}

class HeatmapGridGenerator {
    constructor() {
        this.pool = new Pool(DB_CONFIG)
        this.analyzer = new FreshSpotAnalyzer()
        this.processed = 0
        this.total = 0
        this.startTime = Date.now()
    }

    /**
     * Convert meters to approximate latitude/longitude degrees
     */
    metersToLatLon(meters, latitude) {
        const latDegree = meters / 111320 // 1 degree lat ≈ 111.32 km
        const lonDegree = meters / (111320 * Math.cos(latitude * Math.PI / 180))
        return { latDegree, lonDegree }
    }

    /**
     * Generate grid points across Paris
     */
    generateGridPoints() {
        const points = []
        const { resolution_m } = GRID_CONFIG
        
        // Calculate step size in degrees
        const centerLat = (PARIS_BOUNDS.north + PARIS_BOUNDS.south) / 2
        const { latDegree, lonDegree } = this.metersToLatLon(resolution_m, centerLat)
        
        console.log(`📐 Grid resolution: ${resolution_m}m`)
        console.log(`📐 Step size: ${latDegree.toFixed(6)}° lat, ${lonDegree.toFixed(6)}° lon`)
        
        // Generate grid points
        for (let lat = PARIS_BOUNDS.south; lat <= PARIS_BOUNDS.north; lat += latDegree) {
            for (let lon = PARIS_BOUNDS.west; lon <= PARIS_BOUNDS.east; lon += lonDegree) {
                points.push({
                    latitude: Math.round(lat * 1000000) / 1000000, // 6 decimal precision
                    longitude: Math.round(lon * 1000000) / 1000000
                })
            }
        }
        
        this.total = points.length
        console.log(`🗺️  Generated ${this.total} grid points`)
        console.log(`⏱️  Estimated time: ${Math.round(this.total * 0.02 / 60 * 100) / 100} minutes`)
        
        return points
    }

    /**
     * Create heatmap grid table if it doesn't exist
     */
    async createHeatmapTable() {
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS ousposer.heatmap_grid (
                id SERIAL PRIMARY KEY,
                location GEOMETRY(POINT, 4326),
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                overall_score DECIMAL(4, 2),
                shade_score DECIMAL(4, 2),
                seating_score DECIMAL(4, 2),
                convenience_score DECIMAL(4, 2),
                rating VARCHAR(20),
                tree_count INTEGER DEFAULT 0,
                bench_count INTEGER DEFAULT 0,
                trash_can_count INTEGER DEFAULT 0,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                grid_resolution_m INTEGER DEFAULT 100,
                UNIQUE(latitude, longitude, grid_resolution_m)
            );
            
            CREATE INDEX IF NOT EXISTS idx_heatmap_grid_location 
            ON ousposer.heatmap_grid USING GIST (location);
            
            CREATE INDEX IF NOT EXISTS idx_heatmap_grid_score 
            ON ousposer.heatmap_grid (overall_score);
        `
        
        await this.pool.query(createTableQuery)
        console.log('✅ Heatmap grid table ready')
    }

    /**
     * Analyze a single grid point
     */
    async analyzeGridPoint(point) {
        try {
            const analysis = await this.analyzer.analyzeFreshSpot(
                point.latitude, 
                point.longitude
            )
            
            return {
                ...point,
                overall_score: analysis.scoring.overall_score,
                shade_score: analysis.analysis.shade.score,
                seating_score: analysis.analysis.seating.score,
                convenience_score: analysis.analysis.convenience.score,
                rating: analysis.scoring.rating,
                tree_count: analysis.analysis.shade.tree_count,
                bench_count: analysis.analysis.seating.bench_count,
                trash_can_count: analysis.analysis.convenience.trash_can_count
            }
        } catch (error) {
            console.error(`❌ Error analyzing point ${point.latitude}, ${point.longitude}:`, error.message)
            return {
                ...point,
                overall_score: 0,
                shade_score: 0,
                seating_score: 0,
                convenience_score: 0,
                rating: 'error',
                tree_count: 0,
                bench_count: 0,
                trash_can_count: 0
            }
        }
    }

    /**
     * Save analyzed points to database
     */
    async saveGridPoints(points) {
        const insertQuery = `
            INSERT INTO ousposer.heatmap_grid (
                location, latitude, longitude, overall_score, shade_score, 
                seating_score, convenience_score, rating, tree_count, 
                bench_count, trash_can_count, grid_resolution_m
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (latitude, longitude, grid_resolution_m) 
            DO UPDATE SET
                overall_score = EXCLUDED.overall_score,
                shade_score = EXCLUDED.shade_score,
                seating_score = EXCLUDED.seating_score,
                convenience_score = EXCLUDED.convenience_score,
                rating = EXCLUDED.rating,
                tree_count = EXCLUDED.tree_count,
                bench_count = EXCLUDED.bench_count,
                trash_can_count = EXCLUDED.trash_can_count,
                analyzed_at = CURRENT_TIMESTAMP
        `
        
        for (const point of points) {
            const location = `POINT(${point.longitude} ${point.latitude})`
            await this.pool.query(insertQuery, [
                location, point.latitude, point.longitude, point.overall_score,
                point.shade_score, point.seating_score, point.convenience_score,
                point.rating, point.tree_count, point.bench_count, 
                point.trash_can_count, GRID_CONFIG.resolution_m
            ])
        }
    }

    /**
     * Process grid points with concurrency control
     */
    async processGridConcurrently(points) {
        const { concurrency, batch_size } = GRID_CONFIG
        const results = []
        
        for (let i = 0; i < points.length; i += batch_size) {
            const batch = points.slice(i, i + batch_size)
            const batchPromises = []
            
            // Process batch with concurrency limit
            for (let j = 0; j < batch.length; j += concurrency) {
                const chunk = batch.slice(j, j + concurrency)
                const chunkPromises = chunk.map(point => this.analyzeGridPoint(point))
                
                const chunkResults = await Promise.all(chunkPromises)
                batchPromises.push(...chunkResults)
                
                this.processed += chunk.length
                this.logProgress()
            }
            
            // Save batch to database
            await this.saveGridPoints(batchPromises)
            results.push(...batchPromises)
            
            console.log(`💾 Saved batch ${Math.floor(i / batch_size) + 1}`)
        }
        
        return results
    }

    /**
     * Log progress with time estimates
     */
    logProgress() {
        const elapsed = (Date.now() - this.startTime) / 1000
        const rate = this.processed / elapsed
        const remaining = this.total - this.processed
        const eta = remaining / rate
        
        const progress = (this.processed / this.total * 100).toFixed(1)
        
        console.log(`🔄 Progress: ${this.processed}/${this.total} (${progress}%) - ETA: ${Math.round(eta)}s`)
    }

    /**
     * Generate complete heatmap grid
     */
    async generateHeatmap() {
        console.log('🚀 Starting Paris heatmap generation...')
        
        try {
            // Setup
            await this.createHeatmapTable()
            
            // Generate grid points
            const points = this.generateGridPoints()
            
            // Process all points
            console.log('🔄 Starting grid analysis...')
            const results = await this.processGridConcurrently(points)
            
            // Summary
            const elapsed = (Date.now() - this.startTime) / 1000
            const avgScore = results.reduce((sum, r) => sum + r.overall_score, 0) / results.length
            
            console.log('\n✅ Heatmap generation complete!')
            console.log(`⏱️  Total time: ${Math.round(elapsed)}s (${Math.round(elapsed/60*100)/100} minutes)`)
            console.log(`📊 Average score: ${avgScore.toFixed(2)}/10`)
            console.log(`📈 Points processed: ${results.length}`)
            console.log(`💾 Data size: ~${Math.round(results.length * 70 / 1024)} KB`)
            
        } catch (error) {
            console.error('❌ Heatmap generation failed:', error)
        } finally {
            await this.pool.end()
        }
    }
}

// Run if called directly
if (require.main === module) {
    const generator = new HeatmapGridGenerator()
    generator.generateHeatmap()
}

module.exports = { HeatmapGridGenerator }
