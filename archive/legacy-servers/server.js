#!/usr/bin/env node

/**
 * Express server for OusPoser street furniture visualization
 * Serves the frontend and provides API endpoints for database queries
 */

const express = require("express")
const sqlite3 = require("sqlite3").verbose()
const path = require("path")

const app = express()
const PORT = process.env.PORT || 3000
const DB_FILE = "street_furniture.db"

// Middleware
app.use(express.static("public"))
app.use(express.json())

// Serve detection results JSON files
app.use(
	express.static(".", {
		setHeaders: (res, path) => {
			if (path.endsWith(".json")) {
				res.setHeader("Content-Type", "application/json")
			}
		},
	})
)

// Database connection
const db = new sqlite3.Database(DB_FILE, (err) => {
	if (err) {
		console.error("❌ Error opening database:", err.message)
		process.exit(1)
	}
	console.log("✅ Connected to SQLite database")
})

/**
 * API endpoint to get street furniture data with filtering
 * Query parameters:
 * - arrondissement: Filter by arrondissement (1-20)
 * - minLength: Minimum length in meters
 * - maxLength: Maximum length in meters
 * - benchesOnly: Show only potential benches (true/false)
 * - limit: Maximum number of results (default: 1000)
 */
app.get("/api/furniture", (req, res) => {
	try {
		const {
			arrondissement,
			minLength,
			maxLength,
			benchesOnly,
			// limit = 1000
		} = req.query

		// Build SQL query
		let sql = `
      SELECT 
        objectid,
        latitude,
        longitude,
        arrondissement,
        geo_shape,
        point_count,
        total_length_m,
        aspect_ratio
      FROM street_furniture
      WHERE 1=1
    `

		const params = []

		// Add filters
		if (arrondissement) {
			sql += " AND arrondissement = ?"
			params.push(parseInt(arrondissement))
		}

		if (minLength) {
			sql += " AND total_length_m >= ?"
			params.push(parseFloat(minLength))
		}

		if (maxLength) {
			sql += " AND total_length_m <= ?"
			params.push(parseFloat(maxLength))
		}

		if (benchesOnly === "true") {
			// Filter for potential benches based on our analysis
			sql += " AND total_length_m BETWEEN 4 AND 10"
			sql += " AND point_count BETWEEN 4 AND 20"
			sql += " AND aspect_ratio > 1.5"
		}

		// Add ordering and limit
		sql += " ORDER BY total_length_m DESC"
		// sql += " LIMIT ?"
		// params.push(parseInt(limit))

		console.log(`🔍 Query: ${sql.replace(/\s+/g, " ").trim()}`)
		console.log(`📊 Params: ${JSON.stringify(params)}`)

		// Execute query
		db.all(sql, params, (err, rows) => {
			if (err) {
				console.error("❌ Database query error:", err.message)
				res.status(500).json({ error: "Database query failed" })
				return
			}

			console.log(`✅ Found ${rows.length} objects`)
			res.json(rows)
		})
	} catch (error) {
		console.error("❌ API error:", error.message)
		res.status(500).json({ error: "Internal server error" })
	}
})

/**
 * API endpoint to get database statistics
 */
app.get("/api/stats", (req, res) => {
	const queries = {
		total: "SELECT COUNT(*) as count FROM street_furniture",
		totalPieces: "SELECT COUNT(*) as count FROM furniture_pieces",
		byArrondissement: `
      SELECT arrondissement, COUNT(*) as count, AVG(total_length_m) as avg_length
      FROM street_furniture
      WHERE arrondissement IS NOT NULL
      GROUP BY arrondissement
      ORDER BY arrondissement
    `,
		piecesByType: `
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
    `,
		piecesByArrondissement: `
      SELECT
        arrondissement,
        COUNT(*) as total_pieces,
        SUM(CASE WHEN estimated_type = 'poubelles' THEN 1 ELSE 0 END) as poubelles,
        SUM(CASE WHEN estimated_type = 'benches' THEN 1 ELSE 0 END) as benches,
        SUM(CASE WHEN estimated_type LIKE 'jardinieres%' THEN 1 ELSE 0 END) as jardinieres
      FROM furniture_pieces
      GROUP BY arrondissement
      ORDER BY arrondissement
    `,
		byLengthRange: `
      SELECT
        CASE
          WHEN total_length_m < 0.5 THEN 'Tiny (0-0.5m)'
          WHEN total_length_m < 1 THEN 'Very Short (0.5-1m)'
          WHEN total_length_m < 2 THEN 'Short (1-2m)'
          WHEN total_length_m < 5 THEN 'Medium (2-5m)'
          WHEN total_length_m < 8 THEN 'Bench Range (5-8m)'
          WHEN total_length_m < 15 THEN 'Long (8-15m)'
          WHEN total_length_m < 50 THEN 'Very Long (15-50m)'
          ELSE 'Huge (50m+)'
        END as range_name,
        COUNT(*) as count,
        AVG(total_length_m) as avg_length,
        AVG(point_count) as avg_points
      FROM street_furniture
      GROUP BY range_name
      ORDER BY AVG(total_length_m)
    `,
		potentialBenches: `
      SELECT COUNT(*) as count, AVG(total_length_m) as avg_length
      FROM street_furniture
      WHERE total_length_m BETWEEN 4 AND 10
        AND point_count BETWEEN 4 AND 20
        AND aspect_ratio > 1.5
    `,
	}

	const results = {}
	let completed = 0
	const totalQueries = Object.keys(queries).length

	Object.entries(queries).forEach(([key, sql]) => {
		db.all(sql, [], (err, rows) => {
			if (err) {
				console.error(`❌ Stats query error (${key}):`, err.message)
				results[key] = { error: err.message }
			} else {
				results[key] = rows
			}

			completed++
			if (completed === totalQueries) {
				res.json(results)
			}
		})
	})
})

/**
 * API endpoint to get furniture pieces (clustered objects)
 * Query parameters:
 * - arrondissement: Filter by arrondissement (1-20)
 * - type: Filter by estimated type (poubelles, benches, jardinieres, jardinieres_single)
 * - minComponents: Minimum number of components
 * - maxComponents: Maximum number of components
 * - limit: Maximum number of results (default: 1000)
 */
app.get("/api/pieces", (req, res) => {
	try {
		const {
			arrondissement,
			type,
			minComponents,
			maxComponents,
			limit = 1000,
		} = req.query

		// Build SQL query
		let sql = `
      SELECT
        piece_id,
        arrondissement,
        estimated_type,
        component_count,
        total_length_m,
        max_span_m,
        complexity_score,
        center_latitude,
        center_longitude,
        min_latitude,
        max_latitude,
        min_longitude,
        max_longitude
      FROM furniture_pieces
      WHERE 1=1
    `

		const params = []

		// Add filters
		if (arrondissement) {
			sql += " AND arrondissement = ?"
			params.push(parseInt(arrondissement))
		}

		if (type) {
			sql += " AND estimated_type = ?"
			params.push(type)
		}

		if (minComponents) {
			sql += " AND component_count >= ?"
			params.push(parseInt(minComponents))
		}

		if (maxComponents) {
			sql += " AND component_count <= ?"
			params.push(parseInt(maxComponents))
		}

		// Add ordering and limit
		sql += " ORDER BY complexity_score DESC"
		sql += " LIMIT ?"
		params.push(parseInt(limit))

		console.log(`🔍 Pieces Query: ${sql.replace(/\s+/g, " ").trim()}`)
		console.log(`📊 Params: ${JSON.stringify(params)}`)

		// Execute query
		db.all(sql, params, (err, rows) => {
			if (err) {
				console.error("❌ Database query error:", err.message)
				res.status(500).json({ error: "Database query failed" })
				return
			}

			console.log(`✅ Found ${rows.length} furniture pieces`)
			res.json(rows)
		})
	} catch (error) {
		console.error("❌ API error:", error.message)
		res.status(500).json({ error: "Internal server error" })
	}
})

/**
 * API endpoint to get a specific furniture piece by ID with its components
 */
app.get("/api/pieces/:id", (req, res) => {
	const pieceId = req.params.id

	// Get the furniture piece
	db.get(
		`SELECT * FROM furniture_pieces WHERE piece_id = ?`,
		[pieceId],
		(err, piece) => {
			if (err) {
				console.error("❌ Database query error:", err.message)
				res.status(500).json({ error: "Database query failed" })
				return
			}

			if (!piece) {
				res.status(400).json({ error: "Furniture piece not found" })
				return
			}

			// Get the component objects
			const componentIds = JSON.parse(piece.component_ids)
			const placeholders = componentIds.map(() => "?").join(",")

			db.all(
				`SELECT * FROM street_furniture WHERE objectid IN (${placeholders})`,
				componentIds,
				(err, components) => {
					if (err) {
						console.error("❌ Database query error:", err.message)
						res.status(500).json({ error: "Database query failed" })
						return
					}

					res.json({
						...piece,
						components: components,
					})
				}
			)
		}
	)
})

/**
 * API endpoint to get a specific object by ID
 */
app.get("/api/furniture/:id", (req, res) => {
	const objectId = req.params.id

	db.get(
		`
    SELECT * FROM street_furniture WHERE objectid = ?
  `,
		[objectId],
		(err, row) => {
			if (err) {
				console.error("❌ Database query error:", err.message)
				res.status(500).json({ error: "Database query failed" })
				return
			}

			if (!row) {
				res.status(400).json({ error: "Object not found" })
				return
			}

			res.json(row)
		}
	)
})

/**
 * Health check endpoint
 */
app.get("/api/health", (req, res) => {
	db.get("SELECT COUNT(*) as count FROM street_furniture", [], (err, row) => {
		if (err) {
			res.status(500).json({
				status: "error",
				database: "disconnected",
				error: err.message,
			})
			return
		}

		res.json({
			status: "ok",
			database: "connected",
			totalObjects: row.count,
			timestamp: new Date().toISOString(),
		})
	})
})

// Serve the main page
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"))
})

// Error handling middleware
app.use((err, req, res, next) => {
	console.error("❌ Unhandled error:", err.stack)
	res.status(500).json({ error: "Something went wrong!" })
})

/**
 * API endpoint to save manual classifications for training data
 */
app.post("/api/classifications", (req, res) => {
	try {
		const { piece_id, original_type, manual_type, confidence, notes } = req.body

		if (!piece_id || !manual_type) {
			return res
				.status(400)
				.json({ error: "piece_id and manual_type are required" })
		}

		// Create classifications table if it doesn't exist
		db.run(
			`
			CREATE TABLE IF NOT EXISTS manual_classifications (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				piece_id TEXT NOT NULL,
				original_type TEXT,
				manual_type TEXT NOT NULL,
				confidence INTEGER DEFAULT 5,
				notes TEXT,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP,
				UNIQUE(piece_id)
			)
		`,
			(err) => {
				if (err) {
					console.error("❌ Error creating classifications table:", err.message)
					return res.status(500).json({ error: "Database error" })
				}

				// Insert or update classification
				db.run(
					`
				INSERT OR REPLACE INTO manual_classifications
				(piece_id, original_type, manual_type, confidence, notes, created_at)
				VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			`,
					[piece_id, original_type, manual_type, confidence || 5, notes || ""],
					(err) => {
						if (err) {
							console.error("❌ Error saving classification:", err.message)
							return res
								.status(500)
								.json({ error: "Failed to save classification" })
						}

						console.log(
							`✅ Saved classification: ${piece_id} -> ${manual_type}`
						)
						res.json({ success: true, piece_id, manual_type })
					}
				)
			}
		)
	} catch (error) {
		console.error("❌ Classification API error:", error.message)
		res.status(500).json({ error: "Internal server error" })
	}
})

/**
 * API endpoint to get manual classifications
 */
app.get("/api/classifications", (req, res) => {
	const { limit = 100 } = req.query

	db.all(
		`
		SELECT * FROM manual_classifications
		ORDER BY created_at DESC
		LIMIT ?
	`,
		[parseInt(limit)],
		(err, rows) => {
			if (err) {
				console.error("❌ Error fetching classifications:", err.message)
				return res.status(500).json({ error: "Database query failed" })
			}

			res.json(rows)
		}
	)
})

/**
 * API endpoint to export training data
 */
app.get("/api/training-data", (req, res) => {
	const query = `
		SELECT
			fp.*,
			mc.manual_type,
			mc.confidence,
			mc.notes,
			mc.created_at as classification_date
		FROM furniture_pieces fp
		JOIN manual_classifications mc ON fp.piece_id = mc.piece_id
		ORDER BY mc.created_at DESC
	`

	db.all(query, (err, rows) => {
		if (err) {
			console.error("❌ Error fetching training data:", err.message)
			return res.status(500).json({ error: "Database query failed" })
		}

		res.json({
			count: rows.length,
			data: rows,
			exported_at: new Date().toISOString(),
		})
	})
})

/**
 * API endpoint to save manual clusters for training data (now stores richer metadata)
 */
app.post("/api/manual-clusters", (req, res) => {
	try {
		const {
			id,
			type,
			component_ids,
			component_count,
			total_length,
			avg_length,
			arrondissement,
			bench_subtype,
			notes,
			confidence,
			map_center_lat,
			map_center_lon,
			map_zoom,
		} = req.body

		if (!id || !type || !component_ids || !Array.isArray(component_ids)) {
			return res
				.status(400)
				.json({ error: "id, type, and component_ids array are required" })
		}

		// Create manual_clusters table if it doesn't exist
		db.run(
			`
			CREATE TABLE IF NOT EXISTS manual_clusters (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				component_ids TEXT NOT NULL,
				component_count INTEGER NOT NULL,
				total_length REAL,
				avg_length REAL,
				arrondissement INTEGER,
				bench_subtype TEXT,
				notes TEXT,
				confidence INTEGER,
				map_center_lat REAL,
				map_center_lon REAL,
				map_zoom REAL,
				bbox TEXT,
				centroid_lat REAL,
				centroid_lon REAL,
				components_detail TEXT,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP
			)
		`,
			(err) => {
				if (err) {
					console.error("❌ Error creating manual_clusters table:", err.message)
					return res.status(500).json({ error: "Database error" })
				}

				// Ensure new columns exist (for upgrades on existing DBs)
				db.all(`PRAGMA table_info(manual_clusters)`, (e2, cols) => {
					const has = (name) => cols && cols.some((c) => c.name === name)
					const addCol = (name, type) =>
						db.run(`ALTER TABLE manual_clusters ADD COLUMN ${name} ${type}`)
					;[
						["bench_subtype", "TEXT"],
						["notes", "TEXT"],
						["confidence", "INTEGER"],
						["map_center_lat", "REAL"],
						["map_center_lon", "REAL"],
						["map_zoom", "REAL"],
						["bbox", "TEXT"],
						["centroid_lat", "REAL"],
						["centroid_lon", "REAL"],
						["components_detail", "TEXT"],
					].forEach(([n, t]) => {
						if (!has(n)) addCol(n, t)
					})

					// Load component details to compute bbox/centroid
					const placeholders = component_ids.map(() => "?").join(",")
					db.all(
						`SELECT objectid, latitude, longitude, point_count, total_length_m, aspect_ratio, geo_shape FROM street_furniture WHERE objectid IN (${placeholders})`,
						component_ids,
						(err3, rows) => {
							if (err3) {
								console.error("❌ Error loading components:", err3.message)
								return res
									.status(500)
									.json({ error: "Failed to load components for cluster" })
							}

							let minLat = Infinity,
								maxLat = -Infinity,
								minLon = Infinity,
								maxLon = -Infinity
							let sumLat = 0,
								sumLon = 0
							rows.forEach((r) => {
								minLat = Math.min(minLat, r.latitude)
								maxLat = Math.max(maxLat, r.latitude)
								minLon = Math.min(minLon, r.longitude)
								maxLon = Math.max(maxLon, r.longitude)
								sumLat += r.latitude
								sumLon += r.longitude
							})

							const centroid_lat = rows.length ? sumLat / rows.length : null
							const centroid_lon = rows.length ? sumLon / rows.length : null
							const bbox = JSON.stringify({ minLat, minLon, maxLat, maxLon })
							const components_detail = JSON.stringify(
								rows.map((r) => ({
									objectid: r.objectid,
									point_count: r.point_count,
									total_length_m: r.total_length_m,
									aspect_ratio: r.aspect_ratio,
								}))
							)

							// Insert manual cluster (extended)
							db.run(
								`
							INSERT OR REPLACE INTO manual_clusters
							(id, type, component_ids, component_count, total_length, avg_length, arrondissement, bench_subtype, notes, confidence, map_center_lat, map_center_lon, map_zoom, bbox, centroid_lat, centroid_lon, components_detail, created_at)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
						`,
								[
									id,
									type,
									JSON.stringify(component_ids),
									component_count,
									total_length,
									avg_length,
									arrondissement,
									bench_subtype || null,
									notes || null,
									Number.isFinite(confidence) ? confidence : null,
									Number.isFinite(map_center_lat) ? map_center_lat : null,
									Number.isFinite(map_center_lon) ? map_center_lon : null,
									Number.isFinite(map_zoom) ? map_zoom : null,
									bbox,
									centroid_lat,
									centroid_lon,
									components_detail,
								],
								(err4) => {
									if (err4) {
										console.error(
											"❌ Error saving manual cluster:",
											err4.message
										)
										return res
											.status(500)
											.json({ error: "Failed to save manual cluster" })
									}
									console.log(
										`✅ Saved manual cluster: ${id} (${type}, ${component_count} components)`
									)
									res.json({ success: true, id, type, component_count })
								}
							)
						}
					)
				})
			}
		)
	} catch (error) {
		console.error("❌ Manual cluster API error:", error.message)
		res.status(500).json({ error: "Internal server error" })
	}
})

/**
 * API endpoint to get manual clusters (optional arrondissement filter)
 */
app.get("/api/manual-clusters", (req, res) => {
	const { limit = 100, arrondissement } = req.query

	let sql = `SELECT * FROM manual_clusters`
	const params = []
	if (arrondissement) {
		sql += ` WHERE arrondissement = ?`
		params.push(parseInt(arrondissement))
	}
	sql += ` ORDER BY created_at DESC LIMIT ?`
	params.push(parseInt(limit))

	db.all(sql, params, (err, rows) => {
		if (err) {
			console.error("❌ Error fetching manual clusters:", err.message)
			return res.status(500).json({ error: "Database query failed" })
		}

		// Parse component_ids back to arrays and JSON fields
		const clusters = rows.map((row) => ({
			...row,
			component_ids: JSON.parse(row.component_ids),
			components_detail: row.components_detail
				? JSON.parse(row.components_detail)
				: undefined,
			bbox: row.bbox ? JSON.parse(row.bbox) : undefined,
		}))

		res.json(clusters)
	})
})

/**
 * Drop manual_clusters table (DANGER: clears all manual labels)
 */
app.delete("/api/manual-clusters", (req, res) => {
	db.run(`DROP TABLE IF EXISTS manual_clusters`, (err) => {
		if (err) {
			console.error("❌ Error dropping manual_clusters:", err.message)
			return res.status(500).json({ error: "Failed to drop manual_clusters" })
		}
		console.warn("⚠️  manual_clusters table dropped by request")
		res.json({ success: true })
	})
})

/**
 * Delete a single manual cluster by ID (undo)
 */
app.delete("/api/manual-clusters/:id", (req, res) => {
	const { id } = req.params
	db.run(`DELETE FROM manual_clusters WHERE id = ?`, [id], function (err) {
		if (err) {
			console.error("❌ Error deleting manual cluster:", err.message)
			return res.status(500).json({ error: "Failed to delete manual cluster" })
		}
		return res.json({ success: true, deleted: this.changes })
	})
})

/**
 * Manual classification interface route
 */
app.get("/classify", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "classify.html"))
})

/**
 * Manual clustering interface route
 */
app.get("/manual-cluster", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "manual-cluster.html"))
})

/**
 * Geolocation map interface route
 */
app.get("/geolocations", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "geolocation-map.html"))
})

/**
 * Bench verification interface route
 */
app.get("/verify-benches", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "bench-verification.html"))
})

/**
 * API endpoint for strict classification results
 */
app.get("/api/strict-classification/:arrondissement", (req, res) => {
	const { arrondissement } = req.params

	try {
		// Look for the most recent strict classification file
		const fs = require("fs")
		const files = fs
			.readdirSync(".")
			.filter(
				(f) =>
					f.startsWith(`strict_classification_${arrondissement}_`) &&
					f.endsWith(".json")
			)

		if (files.length === 0) {
			return res.status(404).json({
				error: `No strict classification results found for arrondissement ${arrondissement}`,
				suggestion: `Run: node scripts/strict-classification-algorithm.js ${arrondissement}`,
			})
		}

		// Get the most recent file
		const latestFile = files.sort().reverse()[0]
		const data = JSON.parse(fs.readFileSync(latestFile, "utf8"))

		res.json(data)
	} catch (error) {
		console.error("❌ Error loading strict classification:", error.message)
		res
			.status(500)
			.json({ error: "Failed to load strict classification results" })
	}
})

// 404 handler - must be last
app.use((req, res) => {
	res.status(404).json({ error: "Endpoint not found" })
})

// Start server
app.listen(PORT, () => {
	console.log(`🚀 OusPoser server running on http://localhost:${PORT}`)
	console.log(`📊 Database: ${DB_FILE}`)
	console.log(`🗺️  Frontend: http://localhost:${PORT}`)
	console.log(`🔗 API: http://localhost:${PORT}/api/furniture`)
	console.log(`🎯 Classification: http://localhost:${PORT}/classify`)
	console.log(`🎯 Manual Clustering: http://localhost:${PORT}/manual-cluster`)
	console.log(`📍 Geolocations: http://localhost:${PORT}/geolocations`)
})

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("\n🛑 Shutting down server...")
	db.close((err) => {
		if (err) {
			console.error("❌ Error closing database:", err.message)
		} else {
			console.log("✅ Database connection closed")
		}
		process.exit(0)
	})
})
