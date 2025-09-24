#!/usr/bin/env node

/**
 * PostgreSQL-based Express server for OusPoser street furniture visualization
 * Serves benches and poubelles data from PostgreSQL + PostGIS database
 */

const express = require("express")
const { Client } = require("pg")
const path = require("path")
const { FreshSpotAnalyzer } = require("./src/fresh-spot-algorithm")

const app = express()
const PORT = process.env.PORT || 3000

// PostgreSQL configuration
const DB_CONFIG = {
	host: process.env.POSTGRES_HOST || "localhost",
	port: process.env.POSTGRES_PORT || 5432,
	database: process.env.POSTGRES_DB || "ousposer",
	user: process.env.POSTGRES_USER || "postgres",
	password: process.env.POSTGRES_PASSWORD || "password",
}

// Middleware
app.use(express.static("public"))
app.use(express.json())

// Database connection pool
const { Pool } = require("pg")
const pool = new Pool(DB_CONFIG)

// Test database connection on startup
pool.query("SELECT NOW()", (err, result) => {
	if (err) {
		console.error("❌ PostgreSQL connection failed:", err.message)
		process.exit(1)
	}
	console.log("✅ Connected to PostgreSQL database")
})

/**
 * API endpoint to get benches with spatial filtering
 * Query parameters:
 * - arrondissement: Filter by arrondissement (1-20)
 * - type: Filter by bench type (single-component, 5-component, 6-component)
 * - near: lat,lon,radius_km for proximity search
 * - limit: Maximum number of results (default: 1000)
 */
app.get("/api/benches", async (req, res) => {
	try {
		const { arrondissement, type, near, limit = 1000 } = req.query

		let sql = `
            SELECT 
                bench_id,
                arrondissement,
                bench_type,
                component_ids,
                total_components,
                total_length_m,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                detection_confidence,
                detected_at
            FROM ousposer.benches
            WHERE 1=1
        `

		const params = []
		let paramCount = 0

		// Add filters
		if (arrondissement) {
			sql += ` AND arrondissement = $${++paramCount}`
			params.push(parseInt(arrondissement))
		}

		if (type) {
			sql += ` AND bench_type = $${++paramCount}`
			params.push(type)
		}

		// Proximity search
		if (near) {
			const [lat, lon, radius] = near.split(",").map(parseFloat)
			if (lat && lon && radius) {
				sql += ` AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($${++paramCount}, $${++paramCount}), 4326), $${++paramCount})`
				params.push(lon, lat, radius / 111) // Convert km to degrees (rough)
			}
		}

		sql += ` ORDER BY detected_at DESC LIMIT $${++paramCount}`
		params.push(parseInt(limit))

		console.log(`🪑 Benches query: ${sql.replace(/\s+/g, " ").trim()}`)
		console.log(`📊 Params: ${JSON.stringify(params)}`)

		const result = await pool.query(sql, params)
		console.log(`✅ Found ${result.rows.length} benches`)

		res.json(result.rows)
	} catch (error) {
		console.error("❌ Benches API error:", error.message)
		res.status(500).json({ error: "Database query failed" })
	}
})

/**
 * API endpoint to get poubelles with spatial filtering
 * Query parameters:
 * - arrondissement: Filter by arrondissement (1-20)
 * - near: lat,lon,radius_km for proximity search
 * - minLength, maxLength: Filter by length range
 * - limit: Maximum number of results (default: 1000)
 */
app.get("/api/poubelles", async (req, res) => {
	try {
		const {
			arrondissement,
			near,
			minLength,
			maxLength,
			limit = 1000,
		} = req.query

		let sql = `
            SELECT 
                poubelle_id,
                arrondissement,
                component_id,
                total_length_m,
                point_count,
                aspect_ratio,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                detection_confidence,
                detected_at
            FROM ousposer.poubelles
            WHERE 1=1
        `

		const params = []
		let paramCount = 0

		// Add filters
		if (arrondissement) {
			sql += ` AND arrondissement = $${++paramCount}`
			params.push(parseInt(arrondissement))
		}

		if (minLength) {
			sql += ` AND total_length_m >= $${++paramCount}`
			params.push(parseFloat(minLength))
		}

		if (maxLength) {
			sql += ` AND total_length_m <= $${++paramCount}`
			params.push(parseFloat(maxLength))
		}

		// Proximity search
		if (near) {
			const [lat, lon, radius] = near.split(",").map(parseFloat)
			if (lat && lon && radius) {
				sql += ` AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($${++paramCount}, $${++paramCount}), 4326), $${++paramCount})`
				params.push(lon, lat, radius / 111) // Convert km to degrees (rough)
			}
		}

		sql += ` ORDER BY detected_at DESC LIMIT $${++paramCount}`
		params.push(parseInt(limit))

		console.log(`🗑️ Poubelles query: ${sql.replace(/\s+/g, " ").trim()}`)
		console.log(`📊 Params: ${JSON.stringify(params)}`)

		const result = await pool.query(sql, params)
		console.log(`✅ Found ${result.rows.length} poubelles`)

		res.json(result.rows)
	} catch (error) {
		console.error("❌ Poubelles API error:", error.message)
		res.status(500).json({ error: "Database query failed" })
	}
})

/**
 * API endpoint to get all street furniture (combined view)
 * Query parameters:
 * - arrondissement: Filter by arrondissement (1-20)
 * - type: Filter by furniture type (bench, poubelle)
 * - near: lat,lon,radius_km for proximity search
 * - limit: Maximum number of results (default: 1000)
 */
app.get("/api/furniture", async (req, res) => {
	try {
		const { arrondissement, type, near, limit = 1000 } = req.query

		let sql = `
            SELECT 
                furniture_type,
                furniture_id,
                arrondissement,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                subtype,
                component_count,
                detection_confidence,
                detected_at
            FROM ousposer.street_furniture_overview
            WHERE 1=1
        `

		const params = []
		let paramCount = 0

		// Add filters
		if (arrondissement) {
			sql += ` AND arrondissement = $${++paramCount}`
			params.push(parseInt(arrondissement))
		}

		if (type) {
			sql += ` AND furniture_type = $${++paramCount}`
			params.push(type)
		}

		// Proximity search
		if (near) {
			const [lat, lon, radius] = near.split(",").map(parseFloat)
			if (lat && lon && radius) {
				sql += ` AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($${++paramCount}, $${++paramCount}), 4326), $${++paramCount})`
				params.push(lon, lat, radius / 111) // Convert km to degrees (rough)
			}
		}

		sql += ` ORDER BY detected_at DESC LIMIT $${++paramCount}`
		params.push(parseInt(limit))

		console.log(`🏛️ Furniture query: ${sql.replace(/\s+/g, " ").trim()}`)
		console.log(`📊 Params: ${JSON.stringify(params)}`)

		const result = await pool.query(sql, params)
		console.log(`✅ Found ${result.rows.length} furniture items`)

		res.json(result.rows)
	} catch (error) {
		console.error("❌ Furniture API error:", error.message)
		res.status(500).json({ error: "Database query failed" })
	}
})

/**
 * API endpoint to get database statistics
 */
app.get("/api/stats", async (req, res) => {
	try {
		const queries = {
			// Overall counts
			totalBenches: "SELECT COUNT(*) as count FROM ousposer.benches",
			totalPoubelles: "SELECT COUNT(*) as count FROM ousposer.poubelles",
			totalComponents:
				"SELECT COUNT(*) as count FROM ousposer.street_furniture_components",

			// Arrondissement breakdown
			byArrondissement: `
                SELECT * FROM ousposer.arrondissement_stats
                ORDER BY arrondissement
            `,

			// Bench type distribution
			benchTypes: `
                SELECT bench_type, COUNT(*) as count, AVG(detection_confidence) as avg_confidence
                FROM ousposer.benches
                GROUP BY bench_type
                ORDER BY count DESC
            `,

			// Component classification
			componentTypes: `
                SELECT classified_as, COUNT(*) as count
                FROM ousposer.street_furniture_components
                GROUP BY classified_as
                ORDER BY count DESC
            `,

			// Detection quality
			detectionQuality: `
                SELECT 
                    'benches' as type,
                    AVG(detection_confidence) as avg_confidence,
                    MIN(detection_confidence) as min_confidence,
                    MAX(detection_confidence) as max_confidence
                FROM ousposer.benches
                UNION ALL
                SELECT 
                    'poubelles' as type,
                    AVG(detection_confidence) as avg_confidence,
                    MIN(detection_confidence) as min_confidence,
                    MAX(detection_confidence) as max_confidence
                FROM ousposer.poubelles
            `,
		}

		const results = {}

		for (const [key, sql] of Object.entries(queries)) {
			try {
				const result = await pool.query(sql)
				results[key] = result.rows
			} catch (error) {
				console.error(`❌ Stats query error (${key}):`, error.message)
				results[key] = { error: error.message }
			}
		}

		res.json(results)
	} catch (error) {
		console.error("❌ Stats API error:", error.message)
		res.status(500).json({ error: "Database query failed" })
	}
})

/**
 * API endpoint for spatial search around a point
 */
app.get("/api/search/near", async (req, res) => {
	try {
		const { lat, lon, radius = 0.5, type } = req.query

		if (!lat || !lon) {
			return res
				.status(400)
				.json({ error: "lat and lon parameters are required" })
		}

		let sql = `
            SELECT 
                furniture_type,
                furniture_id,
                arrondissement,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                subtype,
                component_count,
                detection_confidence,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) * 111000 as distance_m
            FROM ousposer.street_furniture_overview
            WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)
        `

		const params = [parseFloat(lon), parseFloat(lat), parseFloat(radius) / 111]
		let paramCount = 3

		if (type) {
			sql += ` AND furniture_type = $${++paramCount}`
			params.push(type)
		}

		sql += ` ORDER BY distance_m LIMIT 100`

		const result = await pool.query(sql, params)

		res.json({
			center: { lat: parseFloat(lat), lon: parseFloat(lon) },
			radius_km: parseFloat(radius),
			count: result.rows.length,
			furniture: result.rows,
		})
	} catch (error) {
		console.error("❌ Spatial search error:", error.message)
		res.status(500).json({ error: "Spatial search failed" })
	}
})

/**
 * API endpoint to get a specific bench by ID
 */
app.get("/api/benches/:id", async (req, res) => {
	try {
		const benchId = req.params.id

		const result = await pool.query(
			`
            SELECT
                b.*,
                ST_X(b.location) as longitude,
                ST_Y(b.location) as latitude,
                ST_AsText(b.bounding_box) as bounding_box_wkt
            FROM ousposer.benches b
            WHERE bench_id = $1
        `,
			[benchId]
		)

		if (result.rows.length === 0) {
			return res.status(404).json({ error: "Bench not found" })
		}

		res.json(result.rows[0])
	} catch (error) {
		console.error("❌ Bench detail error:", error.message)
		res.status(500).json({ error: "Database query failed" })
	}
})

/**
 * API endpoint to get a specific poubelle by ID
 */
app.get("/api/poubelles/:id", async (req, res) => {
	try {
		const poubelleId = req.params.id

		const result = await pool.query(
			`
            SELECT
                p.*,
                ST_X(p.location) as longitude,
                ST_Y(p.location) as latitude,
                ST_AsText(p.shape) as shape_wkt
            FROM ousposer.poubelles p
            WHERE poubelle_id = $1
        `,
			[poubelleId]
		)

		if (result.rows.length === 0) {
			return res.status(404).json({ error: "Poubelle not found" })
		}

		res.json(result.rows[0])
	} catch (error) {
		console.error("❌ Poubelle detail error:", error.message)
		res.status(500).json({ error: "Database query failed" })
	}
})

/**
 * Fresh Spot Detection API endpoint
 * Analyzes a location for fresh spot potential using trees, benches, and trash cans
 * Query parameters:
 * - lat: Latitude (required)
 * - lon: Longitude (required)
 */
app.get("/api/fresh-spots/analyze", async (req, res) => {
	try {
		const { lat, lon } = req.query

		// Validate required parameters
		if (!lat || !lon) {
			return res.status(400).json({
				error: "Missing required parameters",
				message: "Both 'lat' and 'lon' query parameters are required",
				example: "/api/fresh-spots/analyze?lat=48.8566&lon=2.3522",
			})
		}

		// Validate coordinate format
		const latitude = parseFloat(lat)
		const longitude = parseFloat(lon)

		if (isNaN(latitude) || isNaN(longitude)) {
			return res.status(400).json({
				error: "Invalid coordinates",
				message: "Latitude and longitude must be valid numbers",
			})
		}

		// Validate Paris bounds
		if (
			latitude < 48.81 ||
			latitude > 48.91 ||
			longitude < 2.2 ||
			longitude > 2.5
		) {
			return res.status(400).json({
				error: "Coordinates outside Paris bounds",
				message:
					"This service only covers Paris (lat: 48.81-48.91, lon: 2.2-2.5)",
			})
		}

		console.log(
			`🔍 Fresh spot analysis requested for: ${latitude}, ${longitude}`
		)

		// Perform fresh spot analysis
		const analyzer = new FreshSpotAnalyzer()
		const startTime = Date.now()

		try {
			const analysis = await analyzer.analyzeFreshSpot(latitude, longitude)
			const duration = Date.now() - startTime

			console.log(
				`✅ Fresh spot analysis completed in ${duration}ms - Score: ${analysis.scoring.overall_score}/10 (${analysis.scoring.rating})`
			)

			// Add performance metadata
			analysis.metadata.response_time_ms = duration
			analysis.metadata.api_version = "1.0"

			res.json(analysis)
		} finally {
			await analyzer.close()
		}
	} catch (error) {
		console.error("❌ Fresh spot analysis error:", error.message)
		res.status(500).json({
			error: "Fresh spot analysis failed",
			message: error.message,
		})
	}
})

/**
 * Fresh Spot Configuration endpoint
 * Returns the current algorithm configuration for transparency
 */
app.get("/api/fresh-spots/config", (req, res) => {
	const { FRESH_SPOT_CONFIG } = require("./src/fresh-spot-algorithm")

	res.json({
		algorithm: "Fresh Spot Detection v1.0",
		description: "Analyzes locations for hot weather relief potential",
		configuration: FRESH_SPOT_CONFIG,
		factors: {
			shade:
				"Trees within search radius, weighted by proximity and shade score",
			seating: "Benches within search radius, weighted by proximity and length",
			convenience: "Trash cans within search radius, weighted by proximity",
		},
		usage: {
			analyze: "/api/fresh-spots/analyze?lat=48.8566&lon=2.3522",
			config: "/api/fresh-spots/config",
		},
	})
})

/**
 * Health check endpoint
 */
app.get("/api/health", async (req, res) => {
	try {
		const result = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM ousposer.benches) as bench_count,
                (SELECT COUNT(*) FROM ousposer.poubelles) as poubelle_count,
                (SELECT COUNT(*) FROM ousposer.street_furniture_components) as component_count,
                NOW() as timestamp
        `)

		const stats = result.rows[0]

		res.json({
			status: "ok",
			database: "postgresql",
			benches: parseInt(stats.bench_count),
			poubelles: parseInt(stats.poubelle_count),
			components: parseInt(stats.component_count),
			total_furniture:
				parseInt(stats.bench_count) + parseInt(stats.poubelle_count),
			timestamp: stats.timestamp,
		})
	} catch (error) {
		console.error("❌ Health check error:", error.message)
		res.status(500).json({
			status: "error",
			database: "postgresql",
			error: error.message,
		})
	}
})

// Serve the main page
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"))
})

// Serve the citywide map
app.get("/citywide", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "citywide-map.html"))
})

// Error handling middleware
app.use((err, req, res, next) => {
	console.error("❌ Unhandled error:", err.stack)
	res.status(500).json({ error: "Something went wrong!" })
})

// 404 handler - must be last
app.use((req, res) => {
	res.status(404).json({ error: "Endpoint not found" })
})

// Start server
if (require.main === module) {
	app.listen(PORT, () => {
		console.log(
			`🚀 OusPoser PostgreSQL server running on http://localhost:${PORT}`
		)
		console.log(`📊 Database: PostgreSQL (${DB_CONFIG.database})`)
		console.log(`🗺️  Frontend: http://localhost:${PORT}`)
		console.log(`🏙️  Citywide Map: http://localhost:${PORT}/citywide`)
		console.log(`🔗 API Endpoints:`)
		console.log(`   🪑 Benches: http://localhost:${PORT}/api/benches`)
		console.log(`   🗑️  Poubelles: http://localhost:${PORT}/api/poubelles`)
		console.log(`   🏛️  All Furniture: http://localhost:${PORT}/api/furniture`)
		console.log(`   📊 Statistics: http://localhost:${PORT}/api/stats`)
		console.log(
			`   🔍 Spatial Search: http://localhost:${PORT}/api/search/near?lat=48.8566&lon=2.3522&radius=1`
		)
	})
}

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down server...")
	pool.end(() => {
		console.log("✅ Database pool closed")
		process.exit(0)
	})
})

module.exports = { app, pool }
