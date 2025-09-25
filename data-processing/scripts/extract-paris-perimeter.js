const fs = require("fs")

/**
 * Extract the outer perimeter of Paris by removing internal boundaries
 * This creates a single polygon representing the city boundary
 */

/**
 * Calculate distance between two points in meters
 */
function getDistance(lat1, lon1, lat2, lon2) {
	const R = 6371000 // Earth's radius in meters
	const dLat = ((lat2 - lat1) * Math.PI) / 180
	const dLon = ((lon2 - lon1) * Math.PI) / 180
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2)
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
	return R * c
}

/**
 * Include all Paris arrondissements (1-20) to avoid the "donut" problem
 * Previously we only included outer arrondissements (12-20) which excluded central Paris
 */
function findPerimeterArrondissements(features) {
	console.log("🔍 Including all Paris arrondissements...")

	// Include ALL arrondissements (1-20) to cover the entire city
	// This fixes the "donut" issue where inner arrondissements were excluded
	const allParisIds = [
		1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
	]

	const allParisFeatures = features.filter((f) =>
		allParisIds.includes(f.properties.c_ar)
	)

	console.log(
		`✅ Found ${allParisFeatures.length} Paris arrondissements (should be 20)`
	)
	return allParisFeatures
}

/**
 * Extract all coordinate points from perimeter arrondissements
 */
function extractAllCoordinates(perimeterFeatures) {
	console.log("📍 Extracting all perimeter coordinates...")

	const allPoints = []

	perimeterFeatures.forEach((feature) => {
		const coords = feature.geometry.coordinates[0] // Exterior ring
		const arrId = feature.properties.c_ar

		coords.forEach((coord, index) => {
			allPoints.push({
				lon: coord[0],
				lat: coord[1],
				arrondissement: arrId,
				originalIndex: index,
			})
		})
	})

	console.log(`✅ Extracted ${allPoints.length} coordinate points`)
	return allPoints
}

/**
 * Remove internal points that are close to points from other arrondissements
 */
function removeInternalPoints(allPoints, threshold = 50) {
	console.log(`🧹 Removing internal points (threshold: ${threshold}m)...`)

	const externalPoints = []
	let removedCount = 0

	for (let i = 0; i < allPoints.length; i++) {
		const point = allPoints[i]
		let isExternal = true

		// Check if this point is close to any point from a different arrondissement
		for (let j = 0; j < allPoints.length; j++) {
			if (i === j) continue

			const otherPoint = allPoints[j]

			// Skip if same arrondissement
			if (point.arrondissement === otherPoint.arrondissement) continue

			const distance = getDistance(
				point.lat,
				point.lon,
				otherPoint.lat,
				otherPoint.lon
			)

			// If close to another arrondissement's point, it's internal
			if (distance < threshold) {
				isExternal = false
				removedCount++
				break
			}
		}

		if (isExternal) {
			externalPoints.push(point)
		}

		// Progress indicator
		if (i % 1000 === 0) {
			process.stdout.write(`\r🔍 Processed ${i}/${allPoints.length} points...`)
		}
	}

	console.log(
		`\n✅ Kept ${externalPoints.length} external points, removed ${removedCount} internal points`
	)
	return externalPoints
}

/**
 * Sort points to form a continuous perimeter
 */
function sortPerimeterPoints(externalPoints) {
	console.log("🔄 Sorting points to form continuous perimeter...")

	if (externalPoints.length === 0) return []

	const sortedPoints = []
	const remaining = [...externalPoints]

	// Start with the westernmost point
	let current = remaining.reduce((west, point) =>
		point.lon < west.lon ? point : west
	)

	sortedPoints.push(current)
	remaining.splice(remaining.indexOf(current), 1)

	// Connect nearest points to form perimeter
	while (remaining.length > 0) {
		let nearestIndex = 0
		let nearestDistance = Infinity

		for (let i = 0; i < remaining.length; i++) {
			const distance = getDistance(
				current.lat,
				current.lon,
				remaining[i].lat,
				remaining[i].lon
			)

			if (distance < nearestDistance) {
				nearestDistance = distance
				nearestIndex = i
			}
		}

		current = remaining[nearestIndex]
		sortedPoints.push(current)
		remaining.splice(nearestIndex, 1)

		// Progress indicator
		if (sortedPoints.length % 100 === 0) {
			process.stdout.write(`\r🔗 Connected ${sortedPoints.length} points...`)
		}
	}

	console.log(
		`\n✅ Created continuous perimeter with ${sortedPoints.length} points`
	)
	return sortedPoints
}

/**
 * Create GeoJSON for the Paris perimeter
 */
function createPerimeterGeoJSON(sortedPoints) {
	console.log("📄 Creating Paris perimeter GeoJSON...")

	// Convert back to coordinate array format
	const coordinates = sortedPoints.map((point) => [point.lon, point.lat])

	// Close the polygon by adding first point at the end
	if (coordinates.length > 0) {
		coordinates.push(coordinates[0])
	}

	const geojson = {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				geometry: {
					type: "Polygon",
					coordinates: [coordinates],
				},
				properties: {
					name: "Paris Perimeter",
					description: "Outer boundary of Paris extracted from arrondissements",
					total_points: coordinates.length - 1, // Excluding duplicate closing point
					extraction_method: "perimeter_extraction",
				},
			},
		],
	}

	console.log(
		`✅ Created GeoJSON with ${coordinates.length - 1} perimeter points`
	)
	return geojson
}

/**
 * Main function to extract Paris perimeter
 */
function extractParisPerimeter() {
	console.log("🚀 Starting Paris perimeter extraction...")
	console.log("")

	try {
		// Load arrondissements data
		console.log("📂 Loading arrondissements data...")
		const data = JSON.parse(
			fs.readFileSync("../data/arrondissements.geojson", "utf8")
		)

		// Find perimeter arrondissements
		const perimeterFeatures = findPerimeterArrondissements(data.features)

		// Extract all coordinates
		const allPoints = extractAllCoordinates(perimeterFeatures)

		// Remove internal points
		const externalPoints = removeInternalPoints(allPoints, 50) // 50m threshold

		// Sort to form continuous perimeter
		const sortedPoints = sortPerimeterPoints(externalPoints)

		// Create GeoJSON
		const perimeterGeoJSON = createPerimeterGeoJSON(sortedPoints)

		// Save the result
		const outputPath = "../data/paris-perimeter.geojson"
		fs.writeFileSync(outputPath, JSON.stringify(perimeterGeoJSON, null, 2))

		console.log("")
		console.log("🎉 Paris perimeter extraction complete!")
		console.log(`📁 Saved to: ${outputPath}`)
		console.log("")
		console.log("📊 Summary:")
		console.log(`   Original points: ${allPoints.length}`)
		console.log(`   External points: ${externalPoints.length}`)
		console.log(`   Final perimeter: ${sortedPoints.length} points`)
		console.log(
			`   Efficiency gain: ${(
				(1 - externalPoints.length / allPoints.length) *
				100
			).toFixed(1)}% reduction`
		)
	} catch (error) {
		console.error("❌ Error extracting perimeter:", error)
		process.exit(1)
	}
}

// Run if called directly
if (require.main === module) {
	extractParisPerimeter()
}

module.exports = { extractParisPerimeter }
