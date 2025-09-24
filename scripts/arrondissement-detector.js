#!/usr/bin/env node

/**
 * Arrondissement detection using polygon boundaries
 * Provides point-in-polygon functionality for Paris arrondissements
 */

const fs = require("fs")

// Load arrondissement boundaries
let arrondissementBoundaries = null

/**
 * Load the arrondissement boundaries from GeoJSON file
 */
function loadArrondissementBoundaries() {
	if (arrondissementBoundaries) return arrondissementBoundaries

	try {
		const geojsonData = fs.readFileSync("data/arrondissements.geojson", "utf8")
		const data = JSON.parse(geojsonData)

		arrondissementBoundaries = {}

		data.features.forEach((feature) => {
			const arrondissement = feature.properties.c_ar // arrondissement number
			const geometry = feature.geometry

			if (geometry.type === "Polygon") {
				arrondissementBoundaries[arrondissement] = {
					coordinates: geometry.coordinates,
					name: feature.properties.l_ar,
					officialName: feature.properties.l_aroff,
				}
			}
		})

		console.log(
			`✅ Loaded ${
				Object.keys(arrondissementBoundaries).length
			} arrondissement boundaries`
		)
		return arrondissementBoundaries
	} catch (error) {
		console.error("❌ Error loading arrondissement boundaries:", error.message)
		return null
	}
}

/**
 * Point-in-polygon algorithm using ray casting
 * @param {number} lat - Latitude of the point
 * @param {number} lon - Longitude of the point
 * @param {Array} polygon - Array of [lon, lat] coordinates defining the polygon
 * @returns {boolean} - True if point is inside polygon
 */
function pointInPolygon(lat, lon, polygon) {
	let inside = false

	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i]
		const [xj, yj] = polygon[j]

		if (
			yi > lat !== yj > lat &&
			lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
		) {
			inside = !inside
		}
	}

	return inside
}

/**
 * Find which arrondissement contains the given coordinates
 * @param {number} latitude - Latitude of the point
 * @param {number} longitude - Longitude of the point
 * @returns {number|null} - Arrondissement number (1-20) or null if not found
 */
function getArrondissementFromCoordinates(latitude, longitude) {
	const boundaries = loadArrondissementBoundaries()
	if (!boundaries) return null

	// Check each arrondissement
	for (const [arrNum, boundary] of Object.entries(boundaries)) {
		// Handle polygon coordinates (first array is outer ring)
		const outerRing = boundary.coordinates[0]

		if (pointInPolygon(latitude, longitude, outerRing)) {
			return parseInt(arrNum)
		}
	}

	return null
}

/**
 * Enhanced arrondissement extraction with coordinate fallback
 * @param {string} numPave - The num_pave field from the data
 * @param {number} latitude - Latitude for fallback detection
 * @param {number} longitude - Longitude for fallback detection
 * @returns {number|null} - Arrondissement number or null
 */
function extractArrondissementEnhanced(numPave, latitude, longitude) {
	// First try the num_pave extraction
	const fromNumPave = extractArrondissementFromNumPave(numPave)
	if (fromNumPave !== null) {
		return fromNumPave
	}

	// Fallback to coordinate-based detection
	if (latitude && longitude) {
		const fromCoords = getArrondissementFromCoordinates(latitude, longitude)
		if (fromCoords !== null) {
			console.log(
				`📍 Coordinate fallback: ${latitude.toFixed(6)}, ${longitude.toFixed(
					6
				)} → ${fromCoords}e`
			)
			return fromCoords
		}
	}

	return null
}

/**
 * Extract arrondissement from num_pave (original logic)
 */
function extractArrondissementFromNumPave(numPave) {
	if (!numPave) {
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
		return null
	}

	// Try to extract exactly 2 digits at the start
	const match = numPave.match(/^(\d{2})/)
	if (match) {
		const arr = Number(match[1])
		return !isNaN(arr) && arr >= 1 && arr <= 20 ? arr : null
	}
	return null
}

/**
 * Test the arrondissement detection with sample coordinates
 */
function testArrondissementDetection() {
	console.log("🧪 Testing arrondissement detection...\n")

	const testPoints = [
		{ lat: 48.8566, lon: 2.3522, expected: 1, name: "Louvre area" },
		{ lat: 48.8738, lon: 2.295, expected: 16, name: "Arc de Triomphe" },
		{ lat: 48.8584, lon: 2.2945, expected: 7, name: "Eiffel Tower" },
		{ lat: 48.8606, lon: 2.3376, expected: 2, name: "Opéra" },
		{ lat: 48.8529, lon: 2.3499, expected: 5, name: "Panthéon" },
		{ lat: 48.8467, lon: 2.377, expected: 12, name: "Bastille" },
		{ lat: 48.8848, lon: 2.3188, expected: 18, name: "Montmartre" },
	]

	testPoints.forEach((point) => {
		const detected = getArrondissementFromCoordinates(point.lat, point.lon)
		const status = detected === point.expected ? "✅" : "❌"
		console.log(
			`${status} ${point.name}: Expected ${point.expected}e, Got ${detected}e`
		)
	})
}

module.exports = {
	loadArrondissementBoundaries,
	getArrondissementFromCoordinates,
	extractArrondissementEnhanced,
	extractArrondissementFromNumPave,
	testArrondissementDetection,
}

// If run directly, perform tests
if (require.main === module) {
	testArrondissementDetection()
}
