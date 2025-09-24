#!/usr/bin/env node

/**
 * Tree Data Processing Script for OusPoser
 * Cleans, filters, and processes Paris trees data for integration with cool spots system
 */

const fs = require("fs")
const { extractArrondissementEnhanced } = require("./arrondissement-detector")

console.log("🌳 Processing Paris Trees Dataset...\n")

// Load the full trees dataset (WGS84 coordinates)
console.log("📂 Loading trees data...")
const treesData = JSON.parse(
	fs.readFileSync("data/les-arbres-full-wgs84.json", "utf8")
)
console.log(`✅ Loaded ${treesData.length.toLocaleString()} trees\n`)

/**
 * Extract coordinates from WGS84 geo_point_2d field
 */
function extractCoordinates(geo_point_2d) {
	if (!geo_point_2d || !geo_point_2d.lat || !geo_point_2d.lon) {
		return null
	}

	return {
		lat: geo_point_2d.lat,
		lon: geo_point_2d.lon,
	}
}

/**
 * Normalize height values to meters (handles mixed units in source data)
 */
function normalizeHeight(rawHeight) {
	if (!rawHeight || rawHeight === 0) return null

	const height = Number(rawHeight)
	if (isNaN(height)) return null

	// Handle different unit encodings based on realistic tree heights (2-40m)
	if (height > 200) {
		// Likely in centimeters (810 → 8.1m, 577 → 5.77m)
		return height / 100
	} else if (height > 60) {
		// Likely in decimeters (109 → 10.9m, 149 → 14.9m)
		return height / 10
	} else {
		// Already in meters (reasonable range 2-60m)
		return height
	}
}

/**
 * Normalize circumference values to centimeters (handles mixed units in source data)
 */
function normalizeCircumference(rawCircumference) {
	if (!rawCircumference || rawCircumference === 0) return null

	const circumference = Number(rawCircumference)
	if (isNaN(circumference)) return null

	// Handle different unit encodings based on realistic circumferences (10-500cm)
	if (circumference > 1000) {
		// Likely in millimeters (1550 → 155cm, 1103 → 110.3cm)
		return circumference / 10
	} else {
		// Already in centimeters (reasonable range 10-1000cm)
		return circumference
	}
}

/**
 * Parse arrondissement from text to number, with special handling for Bois areas
 */
function parseArrondissement(arrText) {
	if (!arrText) return null

	// Handle Bois areas - assign to their administrative arrondissements
	if (arrText.includes("BOIS DE BOULOGNE")) {
		return 16 // Bois de Boulogne belongs to 16th arrondissement
	}
	if (arrText.includes("BOIS DE VINCENNES")) {
		return 12 // Bois de Vincennes belongs to 12th arrondissement
	}

	// Handle different arrondissement formats
	let match = arrText.match(/PARIS (\d+)(?:E|ER)? ARRDT/i)
	if (match) {
		const arrNum = parseInt(match[1])
		return arrNum >= 1 && arrNum <= 20 ? arrNum : null
	}

	return null
}

/**
 * Estimate canopy radius based on tree characteristics
 */
function estimateCanopyRadius(
	height_m,
	circumference_cm,
	development_stage,
	common_name
) {
	if (!height_m || height_m <= 0) return 1.0 // Default small canopy

	// Base canopy ratio by species type (canopy radius / height)
	const speciesMultipliers = {
		Platane: 0.4, // Wide spreading canopy
		Tilleul: 0.35, // Broad canopy (Linden)
		Marronnier: 0.3, // Medium-wide canopy
		Erable: 0.3, // Medium canopy
		Chêne: 0.4, // Wide canopy (Oak)
		Sophora: 0.25, // Moderate canopy
		Frêne: 0.3, // Medium canopy (Ash)
		"Cerisier à fleurs": 0.25, // Ornamental, moderate
		"Poirier à fleurs": 0.2, // Small ornamental
		Pin: 0.15, // Narrow canopy (Pine)
		If: 0.2, // Compact canopy (Yew)
		Peuplier: 0.2, // Narrow upright (Poplar)
		default: 0.25,
	}

	// Development stage multiplier
	const stageMultipliers = {
		"Jeune (arbre)": 0.6,
		Adulte: 1.0,
		"Jeune (arbre)Adulte": 0.8,
		Mature: 1.2,
		default: 0.8,
	}

	const speciesMultiplier =
		speciesMultipliers[common_name] || speciesMultipliers.default
	const stageMultiplier =
		stageMultipliers[development_stage] || stageMultipliers.default

	// Size factor based on circumference (larger trunk = larger canopy)
	let sizeFactor = 1.0
	if (circumference_cm) {
		if (circumference_cm > 150) sizeFactor = 1.3 // Very large tree
		else if (circumference_cm > 100) sizeFactor = 1.1 // Large tree
		else if (circumference_cm < 30) sizeFactor = 0.7 // Small/young tree
	}

	// Calculate estimated canopy radius
	const canopyRadius =
		height_m * speciesMultiplier * stageMultiplier * sizeFactor

	// Reasonable bounds (0.5m to 15m radius)
	return Math.max(0.5, Math.min(15, canopyRadius))
}

/**
 * Calculate shade score based on tree characteristics
 */
function calculateShadeScore(
	common_name,
	height_m,
	canopy_radius,
	location_type
) {
	let baseScore = 5 // Base shade value

	// Species-specific shade quality
	const shadeQuality = {
		Platane: 9, // Excellent shade
		Tilleul: 8, // Very good shade
		Marronnier: 8, // Very good shade
		Chêne: 9, // Excellent shade
		Erable: 7, // Good shade
		Frêne: 6, // Moderate shade
		Pin: 4, // Light shade (evergreen but sparse)
		If: 7, // Good dense shade
		"Cerisier à fleurs": 5, // Light ornamental shade
		default: 6,
	}

	baseScore = shadeQuality[common_name] || shadeQuality.default

	// Size bonus (larger trees = better shade)
	const sizeBonus = Math.min(canopy_radius / 5, 2) // Max +2 for 10m+ canopy

	// Height bonus (taller = better overhead shade)
	const heightBonus = height_m > 8 ? 1 : 0

	// Location context bonus
	const locationBonus = location_type === "Jardin" ? 1.5 : 1.0

	return Math.min(10, (baseScore + sizeBonus + heightBonus) * locationBonus)
}

/**
 * Process and clean a single tree record
 */
function processTree(tree, index) {
	try {
		// Filter out non-Paris trees
		const arrondissement = parseArrondissement(tree.arrondissement)
		if (!arrondissement) {
			return null // Skip non-Paris trees
		}

		// Extract coordinates (already in WGS84)
		const coords = extractCoordinates(tree.geo_point_2d)

		// Basic validation
		if (!coords.lat || !coords.lon || isNaN(coords.lat) || isNaN(coords.lon)) {
			console.warn(`⚠️  Invalid coordinates for tree ${tree.idbase}`)
			return null
		}

		// Paris bounds check (approximate)
		if (
			coords.lat < 48.815 ||
			coords.lat > 48.902 ||
			coords.lon < 2.224 ||
			coords.lon > 2.47
		) {
			return null // Outside Paris bounds
		}

		// Normalize numeric values (handles mixed units in source data)
		const height_m = normalizeHeight(tree.hauteurenm)
		const circumference_cm = normalizeCircumference(tree.circonferenceencm)

		// Estimate canopy
		const canopy_radius = estimateCanopyRadius(
			height_m,
			circumference_cm,
			tree.stadedeveloppement,
			tree.libellefrancais
		)

		// Calculate shade score
		const shade_score = calculateShadeScore(
			tree.libellefrancais,
			height_m || 5, // Default height if missing
			canopy_radius,
			tree.domanialite
		)

		return {
			id: tree.idbase,
			arrondissement: arrondissement,
			latitude: coords.lat,
			longitude: coords.lon,
			common_name: tree.libellefrancais || null,
			genus: tree.genre || null,
			species: tree.espece || null,
			variety: tree.varieteoucultivar || null,
			height_m: height_m,
			circumference_cm: circumference_cm,
			development_stage: tree.stadedeveloppement || null,
			location_type: tree.domanialite || null,
			is_remarkable: tree.remarquable === "OUI",
			estimated_canopy_radius_m: canopy_radius,
			shade_score: Math.round(shade_score * 10) / 10, // Round to 1 decimal place
		}
	} catch (error) {
		console.warn(`⚠️  Error processing tree ${tree.idbase}:`, error.message)
		return null
	}
}

// Main processing
console.log("🔄 Processing trees...")

const processedTrees = []
const errors = []
let processed = 0

for (let i = 0; i < treesData.length; i++) {
	const tree = treesData[i]
	const processedTree = processTree(tree, i)

	if (processedTree) {
		processedTrees.push(processedTree)
	} else {
		errors.push(i)
	}

	processed++
	if (processed % 10000 === 0) {
		console.log(
			`   Progress: ${processed.toLocaleString()} / ${treesData.length.toLocaleString()} trees processed`
		)
	}
}

console.log("\n📊 Processing Results:")
console.log(
	`✅ Successfully processed: ${processedTrees.length.toLocaleString()} trees`
)
console.log(`❌ Filtered out/errors: ${errors.length.toLocaleString()} trees`)
console.log(
	`📈 Success rate: ${(
		(processedTrees.length / treesData.length) *
		100
	).toFixed(1)}%`
)

// Analyze processed data
console.log("\n📈 Processed Data Analysis:")

// Arrondissement distribution
const arrCounts = {}
processedTrees.forEach((tree) => {
	arrCounts[tree.arrondissement] = (arrCounts[tree.arrondissement] || 0) + 1
})

console.log("\nTrees by arrondissement (after filtering):")
for (let i = 1; i <= 20; i++) {
	const count = arrCounts[i] || 0
	console.log(
		`  Arr ${i.toString().padStart(2)}: ${count.toLocaleString()} trees`
	)
}

// Species distribution (top 10)
const speciesCounts = {}
processedTrees.forEach((tree) => {
	if (tree.common_name) {
		speciesCounts[tree.common_name] = (speciesCounts[tree.common_name] || 0) + 1
	}
})

console.log("\nTop 10 tree species:")
Object.entries(speciesCounts)
	.sort(([, a], [, b]) => b - a)
	.slice(0, 10)
	.forEach(([species, count], index) => {
		console.log(`  ${index + 1}. ${species}: ${count.toLocaleString()}`)
	})

// Save processed data
const outputFile = "data/processed-trees.json"
console.log(`\n💾 Saving processed data to ${outputFile}...`)
fs.writeFileSync(outputFile, JSON.stringify(processedTrees, null, 2))
console.log(
	`✅ Saved ${processedTrees.length.toLocaleString()} processed trees`
)

// Save sample for inspection
const sampleFile = "data/processed-trees-sample.json"
const sample = processedTrees.slice(0, 10)
fs.writeFileSync(sampleFile, JSON.stringify(sample, null, 2))
console.log(`📋 Saved sample of 10 trees to ${sampleFile}`)

console.log("\n🎯 Summary:")
console.log(`- Original dataset: ${treesData.length.toLocaleString()} trees`)
console.log(
	`- Filtered to Paris only: ${processedTrees.length.toLocaleString()} trees`
)
console.log(`- Coordinate conversion: Lambert 93 → WGS84`)
console.log(`- Added canopy estimation and shade scoring`)
console.log(`- Ready for PostgreSQL import`)

console.log("\n🚀 Next Steps:")
console.log("1. Review processed-trees-sample.json to verify data quality")
console.log("2. Create PostgreSQL trees table schema")
console.log("3. Import processed trees to database")
console.log("4. Update coolness scoring algorithm")
console.log("5. Add trees layer to frontend map")

console.log("\n✅ Tree processing complete!")
