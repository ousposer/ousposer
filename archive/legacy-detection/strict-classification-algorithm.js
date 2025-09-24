#!/usr/bin/env node

const sqlite3 = require("sqlite3").verbose()
const fs = require("fs")

/**
 * Strict classification algorithm based on manual clustering analysis
 */

// Strict thresholds based on manual analysis
const CLASSIFICATION_RULES = {
	poubelles: {
		length_min: 2.255,
		length_max: 2.262,
		component_count: 1,
		tolerance: 0.003,
	},
	single_bench: {
		length_min: 7.175,
		length_max: 7.2,
		component_count: 1,
		tolerance: 0.01,
	},
	five_component_bench: {
		total_length_min: 7.725,
		total_length_max: 7.755,
		component_count: 5,
		max_distance: 2.5,
		tolerance: 0.015,
	},
	six_component_bench: {
		total_length_min: 10.765,
		total_length_max: 10.8,
		component_count: 6,
		max_distance: 2.5,
		tolerance: 0.02,
	},
}

/**
 * Calculate distance between two points using Haversine formula
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
 * Calculate bearing/angle between two points
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
	const φ1 = (lat1 * Math.PI) / 180
	const φ2 = (lat2 * Math.PI) / 180
	const Δλ = ((lon2 - lon1) * Math.PI) / 180

	const y = Math.sin(Δλ) * Math.cos(φ2)
	const x =
		Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

	const bearing = Math.atan2(y, x)
	return ((bearing * 180) / Math.PI + 360) % 360 // Convert to degrees 0-360
}

/**
 * Calculate bench orientation from component coordinates
 */
function calculateBenchOrientation(components) {
	if (components.length === 1) {
		// For single component benches, parse the coordinates to get orientation
		try {
			const geoShape = JSON.parse(components[0].geo_shape)
			const coords = geoShape.geometry.coordinates

			if (coords.length >= 2) {
				const [lon1, lat1] = coords[0]
				const [lon2, lat2] = coords[coords.length - 1]
				return calculateBearing(lat1, lon1, lat2, lon2)
			}
		} catch (error) {
			console.warn("Error parsing coordinates for single bench:", error)
		}
		return null
	}

	// For multi-component benches, calculate orientation from component positions
	if (components.length < 2) return null

	// Find the two components that are furthest apart (likely the main axis)
	let maxDistance = 0
	let point1 = null,
		point2 = null

	for (let i = 0; i < components.length; i++) {
		for (let j = i + 1; j < components.length; j++) {
			const dist = calculateDistance(
				components[i].latitude,
				components[i].longitude,
				components[j].latitude,
				components[j].longitude
			)

			if (dist > maxDistance) {
				maxDistance = dist
				point1 = components[i]
				point2 = components[j]
			}
		}
	}

	if (point1 && point2) {
		return calculateBearing(
			point1.latitude,
			point1.longitude,
			point2.latitude,
			point2.longitude
		)
	}

	return null
}

/**
 * Calculate centroid of components
 */
function calculateCentroid(components) {
	const lat =
		components.reduce((sum, comp) => sum + comp.latitude, 0) / components.length
	const lon =
		components.reduce((sum, comp) => sum + comp.longitude, 0) /
		components.length
	return { latitude: lat, longitude: lon }
}

/**
 * Classify single component based on strict rules
 */
function classifySingleComponent(component) {
	const length = component.total_length_m

	// Check for poubelle
	if (
		length >= CLASSIFICATION_RULES.poubelles.length_min &&
		length <= CLASSIFICATION_RULES.poubelles.length_max
	) {
		return {
			type: "poubelles",
			confidence: 1.0,
			reason: "Length matches poubelle signature",
			location: {
				latitude: component.latitude,
				longitude: component.longitude,
			},
			orientation: null, // Poubelles don't have meaningful orientation
		}
	}

	// Check for single bench
	if (
		length >= CLASSIFICATION_RULES.single_bench.length_min &&
		length <= CLASSIFICATION_RULES.single_bench.length_max
	) {
		const orientation = calculateBenchOrientation([component])

		return {
			type: "benches",
			subtype: "single_component",
			confidence: 1.0,
			reason: "Length matches single bench signature",
			location: {
				latitude: component.latitude,
				longitude: component.longitude,
			},
			orientation: orientation,
		}
	}

	return null // No classification
}

/**
 * Classify component cluster based on strict rules
 */
function classifyCluster(components) {
	const totalLength = components.reduce(
		(sum, comp) => sum + comp.total_length_m,
		0
	)
	const componentCount = components.length

	// Calculate max distance between components
	let maxDistance = 0
	for (let i = 0; i < components.length; i++) {
		for (let j = i + 1; j < components.length; j++) {
			const dist = calculateDistance(
				components[i].latitude,
				components[i].longitude,
				components[j].latitude,
				components[j].longitude
			)
			maxDistance = Math.max(maxDistance, dist)
		}
	}

	// Check for 5-component bench
	if (
		componentCount === 5 &&
		totalLength >= CLASSIFICATION_RULES.five_component_bench.total_length_min &&
		totalLength <= CLASSIFICATION_RULES.five_component_bench.total_length_max &&
		maxDistance <= CLASSIFICATION_RULES.five_component_bench.max_distance
	) {
		const centroid = calculateCentroid(components)
		const orientation = calculateBenchOrientation(components)

		return {
			type: "benches",
			subtype: "five_component",
			confidence: 1.0,
			reason: "Matches 5-component bench signature",
			location: centroid,
			orientation: orientation,
			component_count: componentCount,
			total_length: totalLength,
			max_span: maxDistance,
		}
	}

	// Check for 6-component bench
	if (
		componentCount === 6 &&
		totalLength >= CLASSIFICATION_RULES.six_component_bench.total_length_min &&
		totalLength <= CLASSIFICATION_RULES.six_component_bench.total_length_max &&
		maxDistance <= CLASSIFICATION_RULES.six_component_bench.max_distance
	) {
		const centroid = calculateCentroid(components)
		const orientation = calculateBenchOrientation(components)

		return {
			type: "benches",
			subtype: "six_component",
			confidence: 1.0,
			reason: "Matches 6-component bench signature",
			location: centroid,
			orientation: orientation,
			component_count: componentCount,
			total_length: totalLength,
			max_span: maxDistance,
		}
	}

	return null // No classification
}

/**
 * DBSCAN clustering for multi-component furniture
 */
function dbscanClustering(components, eps, minPts) {
	const clusters = []
	const visited = new Set()
	const noise = new Set()

	for (let i = 0; i < components.length; i++) {
		if (visited.has(i)) continue

		visited.add(i)
		const neighbors = getNeighbors(components, i, eps)

		if (neighbors.length < minPts) {
			noise.add(i)
		} else {
			const cluster = []
			expandCluster(components, i, neighbors, cluster, visited, eps, minPts)
			if (cluster.length > 0) {
				clusters.push(cluster)
			}
		}
	}

	return clusters
}

function getNeighbors(components, pointIndex, eps) {
	const neighbors = []
	const point = components[pointIndex]

	for (let i = 0; i < components.length; i++) {
		if (i === pointIndex) continue

		const distance = calculateDistance(
			point.latitude,
			point.longitude,
			components[i].latitude,
			components[i].longitude
		)

		if (distance <= eps) {
			neighbors.push(i)
		}
	}

	return neighbors
}

function expandCluster(
	components,
	pointIndex,
	neighbors,
	cluster,
	visited,
	eps,
	minPts
) {
	cluster.push(pointIndex)

	for (let i = 0; i < neighbors.length; i++) {
		const neighborIndex = neighbors[i]

		if (!visited.has(neighborIndex)) {
			visited.add(neighborIndex)
			const neighborNeighbors = getNeighbors(components, neighborIndex, eps)

			if (neighborNeighbors.length >= minPts) {
				neighbors.push(...neighborNeighbors)
			}
		}

		if (!cluster.includes(neighborIndex)) {
			cluster.push(neighborIndex)
		}
	}
}

/**
 * Main strict classification function
 */
async function performStrictClassification(arrondissement = null) {
	console.log(
		"🎯 Starting strict classification based on manual analysis patterns...\n"
	)

	const db = new sqlite3.Database("street_furniture.db")

	try {
		// Get components to classify
		let query = `
            SELECT objectid, latitude, longitude, total_length_m, point_count, aspect_ratio, geo_shape, arrondissement
            FROM street_furniture 
            WHERE 1=1
        `
		const params = []

		if (arrondissement) {
			query += " AND arrondissement = ?"
			params.push(arrondissement)
		}

		query += " ORDER BY total_length_m"

		const components = await new Promise((resolve, reject) => {
			db.all(query, params, (err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			})
		})

		console.log(
			`📊 Processing ${components.length} components${
				arrondissement ? ` in arrondissement ${arrondissement}` : ""
			}...`
		)

		const results = {
			poubelles: [],
			single_benches: [],
			five_component_benches: [],
			six_component_benches: [],
			unclassified: [],
		}

		const classified = new Set()

		// Step 1: Classify single components (poubelles and single benches)
		console.log("\n🔍 Step 1: Classifying single components...")

		for (const component of components) {
			const classification = classifySingleComponent(component)

			if (classification) {
				classified.add(component.objectid)

				if (classification.type === "poubelles") {
					results.poubelles.push({
						...classification,
						component_ids: [component.objectid],
					})
				} else if (classification.subtype === "single_component") {
					results.single_benches.push({
						...classification,
						component_ids: [component.objectid],
					})
				}
			}
		}

		console.log(`  Found ${results.poubelles.length} poubelles`)
		console.log(
			`  Found ${results.single_benches.length} single-component benches`
		)

		// Step 2: Cluster remaining components for multi-component benches
		console.log("\n🔍 Step 2: Clustering remaining components...")

		const unclassifiedComponents = components.filter(
			(comp) => !classified.has(comp.objectid)
		)
		console.log(
			`  ${unclassifiedComponents.length} components remaining for clustering`
		)

		// Use optimized clustering parameters based on manual analysis
		// Components 158911 & 69244 analysis showed 1.213m distance for connected bench parts
		// Nearby separate benches are 0.300m+ away, so eps=1.35m provides optimal separation
		const clusters = dbscanClustering(unclassifiedComponents, 1.35, 2)
		console.log(`  Generated ${clusters.length} clusters`)

		// Step 3: Classify clusters
		console.log("\n🔍 Step 3: Classifying clusters...")

		for (const clusterIndices of clusters) {
			const clusterComponents = clusterIndices.map(
				(i) => unclassifiedComponents[i]
			)
			const classification = classifyCluster(clusterComponents)

			if (classification) {
				const componentIds = clusterComponents.map((comp) => comp.objectid)

				if (classification.subtype === "five_component") {
					results.five_component_benches.push({
						...classification,
						component_ids: componentIds,
					})
				} else if (classification.subtype === "six_component") {
					results.six_component_benches.push({
						...classification,
						component_ids: componentIds,
					})
				}

				// Mark components as classified
				componentIds.forEach((id) => classified.add(id))
			}
		}

		console.log(
			`  Found ${results.five_component_benches.length} five-component benches`
		)
		console.log(
			`  Found ${results.six_component_benches.length} six-component benches`
		)

		// Step 4: Handle unclassified components
		const finalUnclassified = components.filter(
			(comp) => !classified.has(comp.objectid)
		)
		results.unclassified = finalUnclassified.map((comp) => ({
			objectid: comp.objectid,
			length: comp.total_length_m,
			location: { latitude: comp.latitude, longitude: comp.longitude },
			reason: "Does not match any known pattern",
		}))

		console.log(
			`  ${results.unclassified.length} components remain unclassified`
		)

		// Summary
		const totalClassified =
			results.poubelles.length +
			results.single_benches.length +
			results.five_component_benches.length +
			results.six_component_benches.length

		console.log("\n=== STRICT CLASSIFICATION RESULTS ===")
		console.log(`📊 Total components: ${components.length}`)
		console.log(
			`✅ Classified: ${totalClassified} (${(
				(totalClassified / components.length) *
				100
			).toFixed(1)}%)`
		)
		console.log(
			`❓ Unclassified: ${results.unclassified.length} (${(
				(results.unclassified.length / components.length) *
				100
			).toFixed(1)}%)`
		)
		console.log("")
		console.log(`🗑️  Poubelles: ${results.poubelles.length}`)
		console.log(`🪑 Single benches: ${results.single_benches.length}`)
		console.log(
			`🪑 Five-component benches: ${results.five_component_benches.length}`
		)
		console.log(
			`🪑 Six-component benches: ${results.six_component_benches.length}`
		)

		// Save results
		const outputFile = `strict_classification_${arrondissement || "all"}_${
			new Date().toISOString().split("T")[0]
		}.json`
		fs.writeFileSync(outputFile, JSON.stringify(results, null, 2))
		console.log(`\n💾 Results saved to ${outputFile}`)

		return results
	} catch (error) {
		console.error("❌ Error in strict classification:", error)
		throw error
	} finally {
		db.close()
	}
}

// Run if executed directly
if (require.main === module) {
	const arrondissement = process.argv[2] ? parseInt(process.argv[2]) : null
	performStrictClassification(arrondissement)
}

module.exports = { performStrictClassification, CLASSIFICATION_RULES }
