#!/usr/bin/env node

/**
 * Tree Data Analysis Script for OusPoser
 * Analyzes the full Paris trees dataset to understand field values and data quality
 */

const fs = require("fs")

console.log("🌳 Analyzing Paris Trees Dataset...\n")

// Load the full trees dataset
console.log("📂 Loading trees data...")
const treesData = JSON.parse(
	fs.readFileSync("data/les-arbres-full-wgs84.json", "utf8")
)
console.log(`✅ Loaded ${treesData.length.toLocaleString()} trees\n`)

// Analysis functions
function analyzeField(fieldName, trees) {
	console.log(`\n📊 Analysis of field: ${fieldName}`)
	console.log("=".repeat(50))

	const values = trees.map((tree) => tree[fieldName])
	const uniqueValues = [
		...new Set(values.filter((v) => v !== null && v !== undefined)),
	]
	const nullCount = values.filter((v) => v === null || v === undefined).length

	console.log(`Total values: ${values.length}`)
	console.log(`Unique values: ${uniqueValues.length}`)
	console.log(
		`Null/undefined: ${nullCount} (${(
			(nullCount / values.length) *
			100
		).toFixed(1)}%)`
	)

	if (uniqueValues.length <= 50) {
		console.log("\nAll unique values:")
		uniqueValues.sort().forEach((value, index) => {
			const count = values.filter((v) => v === value).length
			const percentage = ((count / values.length) * 100).toFixed(1)
			console.log(`  ${index + 1}. "${value}" - ${count} (${percentage}%)`)
		})
	} else {
		console.log("\nTop 20 most common values:")
		const valueCounts = {}
		values.forEach((v) => {
			if (v !== null && v !== undefined) {
				valueCounts[v] = (valueCounts[v] || 0) + 1
			}
		})

		const sortedValues = Object.entries(valueCounts)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 20)

		sortedValues.forEach(([value, count], index) => {
			const percentage = ((count / values.length) * 100).toFixed(1)
			console.log(`  ${index + 1}. "${value}" - ${count} (${percentage}%)`)
		})
	}
}

function analyzeNumericField(fieldName, trees) {
	console.log(`\n📊 Numeric analysis of field: ${fieldName}`)
	console.log("=".repeat(50))

	const values = trees
		.map((tree) => tree[fieldName])
		.filter((v) => v !== null && v !== undefined && !isNaN(v))
		.map((v) => Number(v))

	if (values.length === 0) {
		console.log("No valid numeric values found")
		return
	}

	values.sort((a, b) => a - b)

	const min = values[0]
	const max = values[values.length - 1]
	const median = values[Math.floor(values.length / 2)]
	const mean = values.reduce((sum, v) => sum + v, 0) / values.length

	console.log(
		`Valid values: ${values.length} / ${trees.length} (${(
			(values.length / trees.length) *
			100
		).toFixed(1)}%)`
	)
	console.log(`Min: ${min}`)
	console.log(`Max: ${max}`)
	console.log(`Mean: ${mean.toFixed(2)}`)
	console.log(`Median: ${median}`)
	console.log(`25th percentile: ${values[Math.floor(values.length * 0.25)]}`)
	console.log(`75th percentile: ${values[Math.floor(values.length * 0.75)]}`)
}

function analyzeGeographicDistribution(trees) {
	console.log("\n🗺️  Geographic Distribution Analysis")
	console.log("=".repeat(50))

	// Analyze arrondissement field
	const arrondissements = {}
	const outsideParis = []

	trees.forEach((tree, index) => {
		const arr = tree.arrondissement
		if (!arr) {
			outsideParis.push({ index, tree, reason: "No arrondissement" })
			return
		}

		// Try to extract arrondissement number (handle both "1E" and "1ER" formats)
		const match = arr.match(/PARIS (\d+)(?:E|ER)? ARRDT/i)
		if (match) {
			const arrNum = parseInt(match[1])
			arrondissements[arrNum] = (arrondissements[arrNum] || 0) + 1
		} else {
			outsideParis.push({ index, tree, reason: `Non-Paris: ${arr}` })
		}
	})

	console.log("\nTrees by arrondissement:")
	for (let i = 1; i <= 20; i++) {
		const count = arrondissements[i] || 0
		console.log(
			`  Arr ${i.toString().padStart(2)}: ${count.toLocaleString()} trees`
		)
	}

	console.log(
		`\n🚨 Trees outside Paris: ${outsideParis.length.toLocaleString()}`
	)

	if (outsideParis.length > 0) {
		console.log("\nSample of non-Paris locations:")
		const sampleSize = Math.min(10, outsideParis.length)
		for (let i = 0; i < sampleSize; i++) {
			const item = outsideParis[i]
			console.log(`  - ${item.tree.arrondissement} (${item.reason})`)
		}

		// Group by reason
		const reasonCounts = {}
		outsideParis.forEach((item) => {
			const reason = item.tree.arrondissement || "null"
			reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
		})

		console.log("\nNon-Paris locations breakdown:")
		Object.entries(reasonCounts)
			.sort(([, a], [, b]) => b - a)
			.forEach(([reason, count]) => {
				console.log(`  "${reason}": ${count} trees`)
			})
	}

	return outsideParis
}

function analyzeCoordinates(trees) {
	console.log("\n📍 Coordinate Analysis")
	console.log("=".repeat(50))

	const validCoords = trees.filter(
		(tree) =>
			tree.geo_point_2d &&
			tree.geo_point_2d.lat &&
			tree.geo_point_2d.lon &&
			!isNaN(tree.geo_point_2d.lat) &&
			!isNaN(tree.geo_point_2d.lon)
	)

	console.log(
		`Valid coordinates: ${validCoords.length} / ${trees.length} (${(
			(validCoords.length / trees.length) *
			100
		).toFixed(1)}%)`
	)

	if (validCoords.length > 0) {
		const lats = validCoords.map((t) => t.geo_point_2d.lat)
		const lons = validCoords.map((t) => t.geo_point_2d.lon)

		lats.sort((a, b) => a - b)
		lons.sort((a, b) => a - b)

		console.log(
			`Latitude range: ${lats[0].toFixed(6)} to ${lats[lats.length - 1].toFixed(
				6
			)}`
		)
		console.log(
			`Longitude range: ${lons[0].toFixed(6)} to ${lons[
				lons.length - 1
			].toFixed(6)}`
		)

		// Paris bounds check (approximate)
		const parisLatMin = 48.815,
			parisLatMax = 48.902
		const parisLonMin = 2.224,
			parisLonMax = 2.47

		const outsideBounds = validCoords.filter(
			(tree) =>
				tree.geo_point_2d.lat < parisLatMin ||
				tree.geo_point_2d.lat > parisLatMax ||
				tree.geo_point_2d.lon < parisLonMin ||
				tree.geo_point_2d.lon > parisLonMax
		)

		console.log(
			`Trees outside Paris coordinate bounds: ${outsideBounds.length}`
		)

		if (outsideBounds.length > 0 && outsideBounds.length <= 10) {
			console.log("Sample of trees outside bounds:")
			outsideBounds.slice(0, 5).forEach((tree) => {
				console.log(
					`  - ${tree.arrondissement}: ${tree.geo_point_2d.lat}, ${tree.geo_point_2d.lon}`
				)
			})
		}
	}
}

// Main analysis
console.log("🔍 Starting comprehensive tree data analysis...\n")

// Basic dataset info
console.log("📋 Dataset Overview")
console.log("=".repeat(50))
console.log(`Total trees: ${treesData.length.toLocaleString()}`)

// Sample tree structure
if (treesData.length > 0) {
	console.log("\nSample tree structure:")
	console.log(JSON.stringify(treesData[0], null, 2))

	console.log("\nAll available fields:")
	Object.keys(treesData[0]).forEach((key, index) => {
		console.log(`  ${index + 1}. ${key}`)
	})
}

// Analyze key fields
const fieldsToAnalyze = [
	"arrondissement",
	"domanialite",
	"libellefrancais",
	"genre",
	"espece",
	"stadedeveloppement",
	"remarquable",
	"typeemplacement",
]

fieldsToAnalyze.forEach((field) => {
	analyzeField(field, treesData)
})

// Analyze numeric fields
const numericFields = ["hauteurenm", "circonferenceencm"]
numericFields.forEach((field) => {
	analyzeNumericField(field, treesData)
})

// Geographic analysis
const outsideParis = analyzeGeographicDistribution(treesData)
analyzeCoordinates(treesData)

// Summary and recommendations
console.log("\n\n🎯 ANALYSIS SUMMARY & RECOMMENDATIONS")
console.log("=".repeat(60))
console.log(`✅ Total trees in dataset: ${treesData.length.toLocaleString()}`)
console.log(
	`🚨 Trees to exclude (outside Paris): ${outsideParis.length.toLocaleString()}`
)
console.log(
	`✅ Trees to keep: ${(
		treesData.length - outsideParis.length
	).toLocaleString()}`
)

console.log("\n📝 Data Quality Notes:")
console.log("- Coordinate data appears clean and complete")
console.log("- Arrondissement field needs parsing for numeric values")
console.log("- Some trees are outside Paris proper (Bois de Boulogne, etc.)")
console.log("- Height and circumference data available for canopy estimation")
console.log("- Rich botanical classification (genus, species, common name)")
console.log("- Location context available (domanialite field)")

console.log("\n🚀 Next Steps:")
console.log("1. Create tree processing script to clean and import data")
console.log("2. Filter out non-Paris trees based on arrondissement field")
console.log("3. Implement canopy estimation algorithm")
console.log("4. Add trees table to PostgreSQL schema")
console.log("5. Update coolness scoring to include tree proximity")

console.log("\n✅ Tree analysis complete!")
