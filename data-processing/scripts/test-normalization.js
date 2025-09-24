#!/usr/bin/env node

const fs = require("fs")

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

console.log("🧪 Testing Height & Circumference Normalization\n")

// Test height normalization
const heightTests = [
	{ input: 810, expected: 8.1, description: "810 (cm) → 8.1m" },
	{ input: 577, expected: 5.77, description: "577 (cm) → 5.77m" },
	{ input: 109, expected: 10.9, description: "109 (dm) → 10.9m" },
	{ input: 149, expected: 14.9, description: "149 (dm) → 14.9m" },
	{ input: 8, expected: 8, description: "8 (m) → 8m" },
	{ input: 25, expected: 25, description: "25 (m) → 25m" },
	{ input: 0, expected: null, description: "0 → null" },
	{ input: null, expected: null, description: "null → null" },
]

console.log("📏 Height Normalization Tests:")
heightTests.forEach((test) => {
	const result = normalizeHeight(test.input)
	const status = result === test.expected ? "✅" : "❌"
	console.log(`  ${status} ${test.description} → ${result}`)
})

// Test circumference normalization
const circumferenceTests = [
	{ input: 1550, expected: 155, description: "1550 (mm) → 155cm" },
	{ input: 1103, expected: 110.3, description: "1103 (mm) → 110.3cm" },
	{ input: 740, expected: 740, description: "740 (cm) → 740cm" },
	{ input: 118, expected: 118, description: "118 (cm) → 118cm" },
	{ input: 45, expected: 45, description: "45 (cm) → 45cm" },
	{ input: 0, expected: null, description: "0 → null" },
	{ input: null, expected: null, description: "null → null" },
]

console.log("\n📐 Circumference Normalization Tests:")
circumferenceTests.forEach((test) => {
	const result = normalizeCircumference(test.input)
	const status = result === test.expected ? "✅" : "❌"
	console.log(`  ${status} ${test.description} → ${result}`)
})

// Load sample data and test on real values
console.log("\n🌳 Testing on Real Tree Data Sample:")
const treesData = JSON.parse(
	fs.readFileSync("data/les-arbres-full-wgs84.json", "utf8")
)

// Find some extreme values to test
const extremeHeights = treesData
	.filter((tree) => tree.hauteurenm > 100)
	.slice(0, 5)
	.map((tree) => ({
		id: tree.idbase,
		original: tree.hauteurenm,
		normalized: normalizeHeight(tree.hauteurenm),
	}))

const extremeCircumferences = treesData
	.filter((tree) => tree.circonferenceencm > 800)
	.slice(0, 5)
	.map((tree) => ({
		id: tree.idbase,
		original: tree.circonferenceencm,
		normalized: normalizeCircumference(tree.circonferenceencm),
	}))

console.log("\nExtreme Heights (>100):")
extremeHeights.forEach((tree) => {
	console.log(`  Tree ${tree.id}: ${tree.original} → ${tree.normalized}m`)
})

console.log("\nExtreme Circumferences (>800):")
extremeCircumferences.forEach((tree) => {
	console.log(`  Tree ${tree.id}: ${tree.original} → ${tree.normalized}cm`)
})

console.log("\n✅ Normalization testing complete!")
