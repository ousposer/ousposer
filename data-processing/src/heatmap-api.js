/**
 * Heatmap API for serving pre-computed grid data
 */

const { Pool } = require("pg")
const { DB_CONFIG } = require("../scripts/setup-postgresql")

class HeatmapAPI {
	constructor() {
		this.pool = new Pool(DB_CONFIG)
	}

	/**
	 * Get heatmap grid data with optional filtering
	 */
	async getHeatmapData(options = {}) {
		const {
			bounds = null, // { north, south, east, west }
			minScore = 0, // Minimum overall score
			maxScore = 10, // Maximum overall score
			resolution = 100, // Grid resolution in meters
			limit = 10000, // Maximum points to return
		} = options

		let query = `
            SELECT 
                latitude,
                longitude,
                overall_score,
                shade_score,
                seating_score,
                convenience_score,
                rating,
                tree_count,
                bench_count,
                trash_can_count
            FROM ousposer.heatmap_grid
            WHERE grid_resolution_m = $1
            AND overall_score BETWEEN $2 AND $3
        `

		const params = [resolution, minScore, maxScore]
		let paramIndex = 4

		// Add spatial bounds filtering if provided
		if (bounds) {
			query += ` AND latitude BETWEEN $${paramIndex} AND $${paramIndex + 1}`
			query += ` AND longitude BETWEEN $${paramIndex + 2} AND $${
				paramIndex + 3
			}`
			params.push(bounds.south, bounds.north, bounds.west, bounds.east)
			paramIndex += 4
		}

		query += ` ORDER BY overall_score DESC LIMIT $${paramIndex}`
		params.push(limit)

		try {
			const result = await this.pool.query(query, params)
			return {
				success: true,
				data: result.rows,
				count: result.rows.length,
				metadata: {
					resolution_m: resolution,
					bounds: bounds,
					score_range: [minScore, maxScore],
					generated_at: new Date().toISOString(),
				},
			}
		} catch (error) {
			console.error("Heatmap query error:", error)
			return {
				success: false,
				error: error.message,
				data: [],
			}
		}
	}

	/**
	 * Get heatmap statistics
	 */
	async getHeatmapStats(resolution = 100) {
		const query = `
            SELECT 
                COUNT(*) as total_points,
                AVG(overall_score) as avg_score,
                MIN(overall_score) as min_score,
                MAX(overall_score) as max_score,
                COUNT(CASE WHEN overall_score >= 8 THEN 1 END) as excellent_count,
                COUNT(CASE WHEN overall_score >= 6 AND overall_score < 8 THEN 1 END) as good_count,
                COUNT(CASE WHEN overall_score >= 4 AND overall_score < 6 THEN 1 END) as fair_count,
                COUNT(CASE WHEN overall_score >= 2 AND overall_score < 4 THEN 1 END) as poor_count,
                COUNT(CASE WHEN overall_score < 2 THEN 1 END) as inadequate_count,
                SUM(tree_count) as total_trees,
                SUM(bench_count) as total_benches,
                SUM(trash_can_count) as total_trash_cans,
                MAX(analyzed_at) as last_updated
            FROM ousposer.heatmap_grid
            WHERE grid_resolution_m = $1
        `

		try {
			const result = await this.pool.query(query, [resolution])
			const stats = result.rows[0]

			return {
				success: true,
				stats: {
					total_points: parseInt(stats.total_points),
					coverage: {
						avg_score: stats.avg_score
							? parseFloat(parseFloat(stats.avg_score).toFixed(2))
							: 0,
						min_score: parseFloat(stats.min_score) || 0,
						max_score: parseFloat(stats.max_score) || 0,
					},
					distribution: {
						excellent: parseInt(stats.excellent_count),
						good: parseInt(stats.good_count),
						fair: parseInt(stats.fair_count),
						poor: parseInt(stats.poor_count),
						inadequate: parseInt(stats.inadequate_count),
					},
					amenities: {
						total_trees: parseInt(stats.total_trees),
						total_benches: parseInt(stats.total_benches),
						total_trash_cans: parseInt(stats.total_trash_cans),
					},
					metadata: {
						resolution_m: resolution,
						last_updated: stats.last_updated,
					},
				},
			}
		} catch (error) {
			console.error("Heatmap stats error:", error)
			return {
				success: false,
				error: error.message,
			}
		}
	}

	/**
	 * Calculate meters per pixel at given zoom level and latitude
	 */
	calculateMetersPerPixel(zoom, latitude = 48.8566) {
		// Web Mercator projection formula
		// Earth circumference at equator: 40,075,016.686 meters
		return (
			(40075016.686 * Math.abs(Math.cos((latitude * Math.PI) / 180))) /
			Math.pow(2, zoom + 8)
		)
	}

	/**
	 * Get heatmap data optimized for specific zoom level with spatial aggregation
	 */
	async getHeatmapForZoom(zoom, bounds = null) {
		try {
			const baseResolution = 100 // Our base data resolution in meters

			// Calculate how many pixels a 100m square would be at this zoom
			const centerLat = bounds ? (bounds.north + bounds.south) / 2 : 48.8566
			const metersPerPixel = this.calculateMetersPerPixel(zoom, centerLat)
			const pixelsFor100m = baseResolution / metersPerPixel

			console.log(`🔍 Zoom ${zoom}: 100m = ${pixelsFor100m.toFixed(1)} pixels`)

			// If 100m squares are >= 4 pixels, show original data
			if (pixelsFor100m >= 4) {
				console.log(
					`✅ Using original 100m resolution (${pixelsFor100m.toFixed(
						1
					)}px per square)`
				)
				return this.getHeatmapData({ bounds, resolution: baseResolution })
			}

			// Calculate aggregation factor to make squares at least 4 pixels
			const aggregationFactor = Math.ceil(4 / pixelsFor100m)
			const effectiveGridSize = baseResolution * aggregationFactor

			console.log(
				`📊 Aggregating ${aggregationFactor}x${aggregationFactor} squares (${effectiveGridSize}m effective grid)`
			)

			return this.getAggregatedHeatmapData(
				bounds,
				aggregationFactor,
				baseResolution
			)
		} catch (error) {
			console.error("Zoom-optimized heatmap error:", error)
			return {
				success: false,
				error: error.message,
			}
		}
	}

	/**
	 * Get spatially aggregated heatmap data using SQL
	 */
	async getAggregatedHeatmapData(
		bounds = null,
		aggregationFactor = 2,
		baseResolution = 100
	) {
		try {
			// Calculate grid step sizes for aggregation
			// At Paris latitude (~48.8°), 1 degree lat ≈ 111,320m, 1 degree lon ≈ 78,847m
			const latDegreesPerMeter = 1 / 111320
			const lonDegreesPerMeter =
				1 / (111320 * Math.cos((48.8566 * Math.PI) / 180))

			// Grid step in degrees for the aggregated grid
			const aggregatedGridMeters = baseResolution * aggregationFactor
			const latStep = aggregatedGridMeters * latDegreesPerMeter
			const lonStep = aggregatedGridMeters * lonDegreesPerMeter

			// Convert to integer multipliers for SQL (using 1,000,000 precision)
			const latMultiplier = Math.round(latStep * 1000000)
			const lonMultiplier = Math.round(lonStep * 1000000)

			console.log(
				`🗺️  SQL Aggregation: ${aggregationFactor}x${aggregationFactor} (${aggregatedGridMeters}m grid)`
			)
			console.log(
				`📐 Grid steps: ${latStep.toFixed(6)}° lat, ${lonStep.toFixed(6)}° lon`
			)
			console.log(
				`🔢 SQL multipliers: ${latMultiplier} lat, ${lonMultiplier} lon`
			)

			// Build the SQL query with spatial aggregation
			let query = `
				SELECT
					-- Calculate aggregated grid cell coordinates (center of cell)
					(FLOOR(latitude * 1000000 / $1) * $1 + $1/2) / 1000000 as latitude,
					(FLOOR(longitude * 1000000 / $2) * $2 + $2/2) / 1000000 as longitude,

					-- Use PERCENTILE_CONT for true median (handles even/odd counts properly)
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY overall_score) as overall_score,
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY shade_score) as shade_score,
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY seating_score) as seating_score,
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY convenience_score) as convenience_score,

					-- Sum counts for the aggregated area
					SUM(tree_count) as tree_count,
					SUM(bench_count) as bench_count,
					SUM(trash_can_count) as trash_can_count,

					-- Metadata about aggregation
					COUNT(*) as aggregated_from,
					$3 as effective_grid_size_m,

					-- Most common rating in the aggregated cell
					MODE() WITHIN GROUP (ORDER BY rating) as rating

				FROM ousposer.heatmap_grid
				WHERE grid_resolution_m = $4
			`

			const params = [
				latMultiplier,
				lonMultiplier,
				aggregatedGridMeters,
				baseResolution,
			]
			let paramIndex = 5

			// Add bounds filtering if provided
			if (bounds) {
				query += ` AND latitude BETWEEN $${paramIndex} AND $${paramIndex + 1}`
				query += ` AND longitude BETWEEN $${paramIndex + 2} AND $${
					paramIndex + 3
				}`
				params.push(bounds.south, bounds.north, bounds.west, bounds.east)
				paramIndex += 4
			}

			// Group by the aggregated grid coordinates
			query += `
				GROUP BY
					FLOOR(latitude * 1000000 / $1),
					FLOOR(longitude * 1000000 / $2)
				ORDER BY latitude, longitude
			`

			console.log(`🔍 Executing aggregated heatmap query...`)
			const startTime = Date.now()

			const result = await this.pool.query(query, params)

			const duration = Date.now() - startTime
			console.log(`✅ SQL aggregation completed in ${duration}ms`)
			console.log(
				`📊 Aggregated ${result.rows.length} grid cells from original data`
			)

			// Log sample for debugging
			if (result.rows.length > 0) {
				const sample = result.rows[0]
				console.log(`📍 Sample aggregated cell:`, {
					lat: sample.latitude,
					lon: sample.longitude,
					score: sample.overall_score,
					aggregated_from: sample.aggregated_from,
					grid_size: sample.effective_grid_size_m,
				})
			}

			return {
				success: true,
				data: result.rows,
				metadata: {
					aggregation_factor: aggregationFactor,
					effective_grid_size_m: aggregatedGridMeters,
					base_resolution_m: baseResolution,
					query_duration_ms: duration,
					aggregated_cells: result.rows.length,
				},
			}
		} catch (error) {
			console.error("Aggregated heatmap error:", error)
			return {
				success: false,
				error: error.message,
			}
		}
	}

	/**
	 * Check if heatmap data exists
	 */
	async checkHeatmapExists(resolution = 100) {
		const query = `
            SELECT COUNT(*) as count, MAX(analyzed_at) as last_updated
            FROM ousposer.heatmap_grid 
            WHERE grid_resolution_m = $1
        `

		try {
			const result = await this.pool.query(query, [resolution])
			const count = parseInt(result.rows[0].count)

			return {
				exists: count > 0,
				count: count,
				last_updated: result.rows[0].last_updated,
			}
		} catch (error) {
			return {
				exists: false,
				count: 0,
				error: error.message,
			}
		}
	}
}

module.exports = { HeatmapAPI }
