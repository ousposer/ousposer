const fs = require("fs")
const { Pool } = require("pg")
const { FreshSpotAnalyzer } = require("../src/fresh-spot-algorithm.js")

// PostgreSQL connection
const pool = new Pool({
	user: "flow",
	host: "localhost",
	database: "ousposer",
	password: "",
	port: 5432,
})

/**
 * Point-in-polygon test using ray casting algorithm
 */
function isPointInPolygon(point, polygon) {
	const [x, y] = point
	let inside = false

	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i]
		const [xj, yj] = polygon[j]

		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside
		}
	}

	return inside
}

/**
 * Load Paris perimeter boundary from GeoJSON
 */
function loadParisBoundaries() {
	console.log("📍 Loading Paris perimeter boundary...")
	const geojson = JSON.parse(
		fs.readFileSync("../data/paris-perimeter.geojson", "utf8")
	)

	// Extract the single perimeter polygon
	const coords = geojson.features[0].geometry.coordinates[0]
	const polygon = coords.map((coord) => [coord[0], coord[1]]) // [lon, lat]

	console.log(`✅ Loaded Paris perimeter with ${polygon.length} points`)
	return [polygon] // Return as array for compatibility with existing code
}

/**
 * Generate optimized grid points only within Paris perimeter
 */
function generateParisGrid(parisPolygons, resolution = 100) {
	console.log(
		`🗺️  Generating ${resolution}m resolution grid within Paris boundaries...`
	)

	const parisPerimeter = parisPolygons[0] // Single perimeter polygon

	// Calculate precise bounds from perimeter
	const lats = parisPerimeter.map((coord) => coord[1])
	const lons = parisPerimeter.map((coord) => coord[0])
	const bounds = {
		north: Math.max(...lats),
		south: Math.min(...lats),
		east: Math.max(...lons),
		west: Math.min(...lons),
	}

	console.log(
		`📐 Paris bounds: ${bounds.south.toFixed(4)}°N to ${bounds.north.toFixed(
			4
		)}°N, ${bounds.west.toFixed(4)}°E to ${bounds.east.toFixed(4)}°E`
	)

	// Convert resolution from meters to degrees (approximate)
	const latStep = resolution / 111000 // ~111km per degree latitude
	const lonStep = resolution / (111000 * Math.cos((48.8566 * Math.PI) / 180)) // Adjust for Paris latitude

	const gridPoints = []
	let totalChecked = 0
	let insideParis = 0

	for (let lat = bounds.south; lat <= bounds.north; lat += latStep) {
		for (let lon = bounds.west; lon <= bounds.east; lon += lonStep) {
			totalChecked++

			if (isPointInPolygon([lon, lat], parisPerimeter)) {
				gridPoints.push({ lat, lon })
				insideParis++
			}

			// Progress indicator
			if (totalChecked % 1000 === 0) {
				process.stdout.write(
					`\r🔍 Checked ${totalChecked} points, ${insideParis} inside Paris...`
				)
			}
		}
	}

	console.log(
		`\n✅ Generated ${gridPoints.length} grid points within Paris (${(
			(insideParis / totalChecked) *
			100
		).toFixed(1)}% efficiency)`
	)
	return gridPoints
}

/**
 * Main heatmap generation function
 */
async function generateOptimizedHeatmap() {
	console.log("🚀 Starting optimized Paris heatmap generation...")
	console.log("")

	try {
		// Load Paris boundaries
		const parisPolygons = loadParisBoundaries()

		// Generate grid points only within Paris
		const gridPoints = generateParisGrid(parisPolygons, 100) // 100m resolution

		// Initialize fresh spot analyzer
		const analyzer = new FreshSpotAnalyzer(pool)

		// Clear existing heatmap data from production schema
		console.log("🗑️  Clearing existing heatmap data...")
		await pool.query("DELETE FROM ousposer.heatmap_grid")

		// Process grid points in batches
		const batchSize = 10
		const totalBatches = Math.ceil(gridPoints.length / batchSize)
		let processed = 0

		console.log(
			`📊 Processing ${gridPoints.length} points in ${totalBatches} batches...`
		)
		console.log("")

		for (let i = 0; i < gridPoints.length; i += batchSize) {
			const batch = gridPoints.slice(i, i + batchSize)
			const batchNumber = Math.floor(i / batchSize) + 1

			// Process batch in parallel
			const promises = batch.map(async (point) => {
				const analysis = await analyzer.analyzeFreshSpot(point.lat, point.lon)
				return {
					lat: point.lat,
					lon: point.lon,
					score: analysis.scoring.overall_score,
					rating: analysis.scoring.rating,
					shade_score: analysis.analysis.shade.score,
					seating_score: analysis.analysis.seating.score,
					convenience_score: analysis.analysis.convenience.score,
					water_cooling_bonus: analysis.analysis.water_cooling?.bonus || 0,
					tree_count: analysis.analysis.shade.tree_count,
					bench_count: analysis.analysis.seating.bench_count,
					trash_count: analysis.analysis.convenience.trash_can_count,
					fountain_count: analysis.analysis.water_cooling?.fountain_count || 0,
				}
			})

			const results = await Promise.all(promises)

			// Insert batch results into production schema
			for (const result of results) {
				await pool.query(
					`
                    INSERT INTO ousposer.heatmap_grid (
                        latitude, longitude, overall_score, rating, shade_score, seating_score,
                        convenience_score, tree_count, bench_count, trash_can_count, location
                    ) VALUES ($1::numeric, $2::numeric, $3::numeric, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10, ST_SetSRID(ST_MakePoint($2, $1), 4326))
                `,
					[
						result.lat,
						result.lon,
						result.score,
						result.rating,
						result.shade_score,
						result.seating_score,
						result.convenience_score,
						result.tree_count,
						result.bench_count,
						result.trash_count,
					]
				)
			}

			processed += results.length
			const progress = ((processed / gridPoints.length) * 100).toFixed(1)
			const avgScore = (
				results.reduce((sum, r) => sum + r.score, 0) / results.length
			).toFixed(2)

			console.log(
				`✅ Batch ${batchNumber}/${totalBatches} (${progress}%) - Avg score: ${avgScore}`
			)
		}

		// Generate final statistics
		const stats = await pool.query(`
            SELECT
                COUNT(*) as total_points,
                ROUND(AVG(overall_score)::numeric, 2) as avg_score,
                ROUND(MAX(overall_score)::numeric, 2) as max_score,
                COUNT(*) FILTER (WHERE overall_score >= 7.0) as excellent_spots,
                COUNT(*) FILTER (WHERE overall_score >= 5.0) as good_spots,
                COUNT(*) FILTER (WHERE tree_count > 0 OR bench_count > 0) as amenity_spots
            FROM ousposer.heatmap_grid
        `)

		const result = stats.rows[0]

		console.log("")
		console.log("🎉 Optimized heatmap generation complete!")
		console.log("")
		console.log("📊 Final Statistics:")
		console.log(`   Total points: ${result.total_points}`)
		console.log(`   Average score: ${result.avg_score}/10`)
		console.log(`   Maximum score: ${result.max_score}/10`)
		console.log(`   Excellent spots (≥7.0): ${result.excellent_spots}`)
		console.log(`   Good spots (≥5.0): ${result.good_spots}`)
		console.log(`   Amenity spots: ${result.amenity_spots}`)
		console.log("")

		await analyzer.close()
		await pool.end()
	} catch (error) {
		console.error("❌ Error generating heatmap:", error)
		process.exit(1)
	}
}

// Run if called directly
if (require.main === module) {
	generateOptimizedHeatmap()
}

module.exports = { generateOptimizedHeatmap }
