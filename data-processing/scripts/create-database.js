#!/usr/bin/env node

/**
 * Database creation and data processing script for OusPoser street furniture
 * Processes JSON data and populates SQLite database with geometric features
 */

const fs = require("fs")
const path = require("path")
const sqlite3 = require("sqlite3").verbose()
const { extractArrondissementEnhanced } = require("./arrondissement-detector")

// Configuration
const JSON_FILE =
	"data/plan-de-voirie-mobiliers-urbains-jardinieres-bancs-corbeilles-de-rue.json"
const DB_FILE = "data/street_furniture.db"
const BATCH_SIZE = 1000 // Process in batches to manage memory

console.log("🏗️  Creating OusPoser Street Furniture Database...\n")

// Database schema
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS street_furniture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objectid INTEGER UNIQUE NOT NULL,
  
  -- Location data
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  arrondissement INTEGER,
  
  -- Geometry data
  geo_shape TEXT NOT NULL,
  coordinates TEXT NOT NULL,
  
  -- Geometric features for ML
  point_count INTEGER NOT NULL,
  total_length_m REAL NOT NULL,
  bounding_width_m REAL NOT NULL,
  bounding_height_m REAL NOT NULL,
  aspect_ratio REAL NOT NULL,
  angle_changes_sum REAL NOT NULL,
  
  -- Classification
  predicted_type TEXT,
  confidence REAL,
  manual_label TEXT,
  
  -- Metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const CREATE_INDEXES_SQL = [
	"CREATE INDEX IF NOT EXISTS idx_location ON street_furniture(latitude, longitude);",
	"CREATE INDEX IF NOT EXISTS idx_arrondissement ON street_furniture(arrondissement);",
	"CREATE INDEX IF NOT EXISTS idx_length ON street_furniture(total_length_m);",
	"CREATE INDEX IF NOT EXISTS idx_predicted_type ON street_furniture(predicted_type);",
	"CREATE INDEX IF NOT EXISTS idx_point_count ON street_furniture(point_count);",
]

/**
 * Calculate distance between two GPS coordinates in meters
 * Uses Haversine formula for accuracy
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
	const R = 6371000 // Earth's radius in meters
	const φ1 = (lat1 * Math.PI) / 180
	const φ2 = (lat2 * Math.PI) / 180
	const Δφ = ((lat2 - lat1) * Math.PI) / 180
	const Δλ = ((lon2 - lon1) * Math.PI) / 180

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

	return R * c
}

/**
 * Calculate centroid of a LineString
 */
function calculateCentroid(coordinates) {
	let sumLat = 0,
		sumLon = 0
	coordinates.forEach(([lon, lat]) => {
		sumLat += lat
		sumLon += lon
	})
	return {
		latitude: sumLat / coordinates.length,
		longitude: sumLon / coordinates.length,
	}
}

/**
 * Calculate total length of LineString in meters
 */
function calculateTotalLength(coordinates) {
	let totalLength = 0
	for (let i = 1; i < coordinates.length; i++) {
		const [lon1, lat1] = coordinates[i - 1]
		const [lon2, lat2] = coordinates[i]
		totalLength += calculateDistance(lat1, lon1, lat2, lon2)
	}
	return totalLength
}

/**
 * Calculate bounding box dimensions in meters
 */
function calculateBoundingBox(coordinates) {
	const lats = coordinates.map(([lon, lat]) => lat)
	const lons = coordinates.map(([lon, lat]) => lon)

	const minLat = Math.min(...lats)
	const maxLat = Math.max(...lats)
	const minLon = Math.min(...lons)
	const maxLon = Math.max(...lons)

	const width = calculateDistance(minLat, minLon, minLat, maxLon)
	const height = calculateDistance(minLat, minLon, maxLat, minLon)

	return { width, height }
}

/**
 * Calculate sum of angle changes along the path
 */
function calculateAngleChanges(coordinates) {
	if (coordinates.length < 3) return 0

	let totalAngleChange = 0

	for (let i = 1; i < coordinates.length - 1; i++) {
		const [lon1, lat1] = coordinates[i - 1]
		const [lon2, lat2] = coordinates[i]
		const [lon3, lat3] = coordinates[i + 1]

		// Calculate vectors
		const v1 = { x: lon2 - lon1, y: lat2 - lat1 }
		const v2 = { x: lon3 - lon2, y: lat3 - lat2 }

		// Calculate angle between vectors
		const dot = v1.x * v2.x + v1.y * v2.y
		const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y)
		const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y)

		if (mag1 > 0 && mag2 > 0) {
			const cosAngle = dot / (mag1 * mag2)
			const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)))
			totalAngleChange += angle
		}
	}

	return totalAngleChange
}

/**
 * Extract arrondissement from num_pave with improved pattern matching
 */
function extractArrondissement(numPave) {
	if (!numPave) {
		console.log("⚠️  Missing num_pave field")
		return null
	}

	// Handle special codes for Bois (parks)
	if (numPave.startsWith("B")) {
		if (numPave.startsWith("BFON") || numPave.startsWith("BNOG")) {
			return 16 // Bois de Boulogne is in 16e
		}
		if (numPave.startsWith("BMAN") || numPave.startsWith("BLEP")) {
			return 12 // Bois de Vincennes is in 12e
		}
		console.log(`⚠️  Unknown B-code: "${numPave}"`)
		return null
	}

	// Try to extract exactly 2 digits at the start
	const match = numPave.match(/^(\d{2})/)
	if (match) {
		const arr = Number(match[1])
		if (!isNaN(arr) && arr >= 1 && arr <= 20) {
			return arr
		} else {
			console.log(
				`⚠️  Invalid arrondissement: ${arr} from num_pave: "${numPave}"`
			)
			return null
		}
	} else {
		console.log(
			`⚠️  No match for arrondissement pattern in num_pave: "${numPave}"`
		)
		return null
	}
}

/**
 * Process a single street furniture object
 */
function processObject(obj) {
	try {
		// Validate required fields
		if (!obj.objectid || !obj.geo_shape?.geometry?.coordinates) {
			return null
		}

		const coordinates = obj.geo_shape.geometry.coordinates
		const geometryType = obj.geo_shape.geometry.type

		// Only process LineString geometries
		if (
			geometryType !== "LineString" ||
			!Array.isArray(coordinates) ||
			coordinates.length < 2
		) {
			return null
		}

		// Calculate all geometric features
		const centroid = calculateCentroid(coordinates)
		const totalLength = calculateTotalLength(coordinates)
		const boundingBox = calculateBoundingBox(coordinates)
		const aspectRatio =
			boundingBox.width > 0 ? boundingBox.width / boundingBox.height : 0
		const angleChanges = calculateAngleChanges(coordinates)
		const arrondissement = extractArrondissementEnhanced(
			obj.num_pave,
			centroid.latitude,
			centroid.longitude
		)

		return {
			objectid: obj.objectid,
			latitude: centroid.latitude,
			longitude: centroid.longitude,
			arrondissement: arrondissement,
			geo_shape: JSON.stringify(obj.geo_shape),
			coordinates: JSON.stringify(coordinates),
			point_count: coordinates.length,
			total_length_m: totalLength,
			bounding_width_m: boundingBox.width,
			bounding_height_m: boundingBox.height,
			aspect_ratio: aspectRatio,
			angle_changes_sum: angleChanges,
		}
	} catch (error) {
		console.warn(
			`⚠️  Error processing object ${obj.objectid}: ${error.message}`
		)
		return null
	}
}

/**
 * Main processing function
 */
async function main() {
	try {
		// Remove existing database
		if (fs.existsSync(DB_FILE)) {
			fs.unlinkSync(DB_FILE)
			console.log("🗑️  Removed existing database")
		}

		// Create database
		console.log("📊 Creating SQLite database...")
		const db = new sqlite3.Database(DB_FILE)

		// Create table and indexes
		await new Promise((resolve, reject) => {
			db.serialize(() => {
				db.run(CREATE_TABLE_SQL, (err) => {
					if (err) reject(err)
				})

				CREATE_INDEXES_SQL.forEach((sql) => {
					db.run(sql, (err) => {
						if (err) console.warn(`Index creation warning: ${err.message}`)
					})
				})

				resolve()
			})
		})

		console.log("✅ Database schema created")

		// Read and process JSON data
		console.log("📖 Reading JSON file...")
		const jsonContent = fs.readFileSync(JSON_FILE, "utf8")
		const data = JSON.parse(jsonContent)

		if (!Array.isArray(data)) {
			throw new Error("Expected JSON array format")
		}

		console.log(`📊 Processing ${data.length} objects...`)

		// Process in batches with proper async handling
		let processed = 0
		let inserted = 0
		let errors = 0

		const insertSQL = `
      INSERT INTO street_furniture (
        objectid, latitude, longitude, arrondissement, geo_shape, coordinates,
        point_count, total_length_m, bounding_width_m, bounding_height_m,
        aspect_ratio, angle_changes_sum
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

		for (let i = 0; i < data.length; i += BATCH_SIZE) {
			const batch = data.slice(i, i + BATCH_SIZE)

			await new Promise((resolve, reject) => {
				db.serialize(() => {
					db.run("BEGIN TRANSACTION")

					let batchProcessed = 0
					const batchSize = batch.length

					batch.forEach((obj) => {
						const processedObj = processObject(obj)
						processed++

						if (processedObj) {
							db.run(
								insertSQL,
								[
									processedObj.objectid,
									processedObj.latitude,
									processedObj.longitude,
									processedObj.arrondissement,
									processedObj.geo_shape,
									processedObj.coordinates,
									processedObj.point_count,
									processedObj.total_length_m,
									processedObj.bounding_width_m,
									processedObj.bounding_height_m,
									processedObj.aspect_ratio,
									processedObj.angle_changes_sum,
								],
								function (err) {
									if (err) {
										errors++
										console.warn(
											`⚠️  Insert error for object ${processedObj.objectid}: ${err.message}`
										)
									} else {
										inserted++
									}

									batchProcessed++
									if (batchProcessed === batchSize) {
										db.run("COMMIT", resolve)
									}
								}
							)
						} else {
							errors++
							batchProcessed++
							if (batchProcessed === batchSize) {
								db.run("COMMIT", resolve)
							}
						}
					})
				})
			})

			// Progress update
			if (i % (BATCH_SIZE * 10) === 0) {
				console.log(
					`📈 Processed ${processed}/${data.length} objects (${inserted} inserted, ${errors} errors)`
				)
			}
		}

		console.log("\n✅ Processing complete!")
		console.log(
			`📊 Final stats: ${inserted} objects inserted, ${errors} errors`
		)

		// Display sample statistics
		db.all(
			`
      SELECT 
        COUNT(*) as total,
        AVG(total_length_m) as avg_length,
        MIN(total_length_m) as min_length,
        MAX(total_length_m) as max_length,
        AVG(point_count) as avg_points
      FROM street_furniture
    `,
			(err, rows) => {
				if (!err && rows[0]) {
					const stats = rows[0]
					console.log("\n📏 GEOMETRIC STATISTICS:")
					console.log(`   Total objects: ${stats.total}`)
					console.log(`   Average length: ${stats.avg_length.toFixed(2)}m`)
					console.log(
						`   Length range: ${stats.min_length.toFixed(
							2
						)}m - ${stats.max_length.toFixed(2)}m`
					)
					console.log(`   Average points: ${stats.avg_points.toFixed(1)}`)
				}

				db.close()
			}
		)
	} catch (error) {
		console.error("❌ Error:", error.message)
		process.exit(1)
	}
}

// Run the script
main()
