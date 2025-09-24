// SQLite helpers: build coord_points with proper indexes and degree windows

const {
	haversineMeters,
	lonDegreesPerMeterAtLat,
	latDegreesPerMeter,
} = require("./geometry")
const { CONFIG } = require("./config")

async function createCoordPointsIndex(db, arrondissement) {
	console.log(
		`  🗺️  Rebuilding coord_points for arrondissement ${arrondissement}...`
	)
	await new Promise((resolve, reject) => {
		db.serialize(() => {
			db.run(`DROP TABLE IF EXISTS coord_points`)
			db.run(
				`CREATE TABLE coord_points (objectid INTEGER, lat REAL, lon REAL, coord_index INTEGER)`,
				(err) => {
					if (err) reject(err)
					else resolve()
				}
			)
		})
	})

	const components = await new Promise((resolve, reject) => {
		db.all(
			`
      SELECT objectid, geo_shape
      FROM street_furniture
      WHERE arrondissement = ?
        AND total_length_m BETWEEN ? AND ?
    `,
			[
				arrondissement,
				CONFIG.multiPiece.lengthMin,
				CONFIG.multiPiece.lengthMax,
			],
			(err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			}
		)
	})

	const insertStmt = db.prepare(
		`INSERT INTO coord_points (objectid, lat, lon, coord_index) VALUES (?, ?, ?, ?)`
	)
	let total = 0
	for (const comp of components) {
		const coords = extractCoordinates(comp)
		coords.forEach((c, i) => {
			insertStmt.run(comp.objectid, c.lat, c.lon, i)
			total++
		})
	}
	insertStmt.finalize()
	console.log(`    Indexed ${total} coordinate points`)
}

function extractCoordinates(component) {
	// Handle both SQLite (geo_shape) and PostGIS (geometry) formats
	const geoStr = component.geo_shape || component.geometry
	if (!geoStr) {
		console.warn(`Component ${component.objectid} has no geometry data`)
		return []
	}
	const geo = JSON.parse(geoStr)
	const coords = geo.geometry?.coordinates || geo.coordinates || []
	return coords.map(([lon, lat]) => ({ lat, lon }))
}

async function findNearbyComponentIds(db, component, toleranceMeters) {
	// Bounding-box prefilter per vertex, then exact distance filter
	const coords = extractCoordinates(component)
	const ids = new Set()
	for (const c of coords) {
		const latWin = toleranceMeters * latDegreesPerMeter()
		const lonWin = toleranceMeters * lonDegreesPerMeterAtLat(c.lat)
		const rows = await new Promise((resolve, reject) => {
			db.all(
				`
        SELECT DISTINCT objectid, lat, lon FROM coord_points
        WHERE objectid != ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
      `,
				[
					component.objectid,
					c.lat - latWin,
					c.lat + latWin,
					c.lon - lonWin,
					c.lon + lonWin,
				],
				(err, rows) => {
					if (err) reject(err)
					else resolve(rows)
				}
			)
		})
		// precise distance check
		rows.forEach((r) => {
			const d = haversineMeters(c.lat, c.lon, r.lat, r.lon)
			if (d <= toleranceMeters) ids.add(r.objectid)
		})
	}
	return Array.from(ids)
}

async function ensureCoordPointsIndexes(db) {
	await new Promise((resolve, reject) => {
		db.serialize(() => {
			db.run(
				`CREATE INDEX IF NOT EXISTS idx_coord_points_lat ON coord_points(lat)`
			)
			db.run(
				`CREATE INDEX IF NOT EXISTS idx_coord_points_lon ON coord_points(lon)`
			)
			db.run(
				`CREATE INDEX IF NOT EXISTS idx_coord_points_lat_lon ON coord_points(lat, lon)`,
				(err) => {
					if (err) reject(err)
					else resolve()
				}
			)
		})
	})
}

module.exports = {
	createCoordPointsIndex,
	ensureCoordPointsIndexes,
	findNearbyComponentIds,
	extractCoordinates,
}
