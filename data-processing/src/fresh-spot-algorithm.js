/**
 * Fresh Spot Detection Algorithm for OusPoser
 *
 * Determines if a location qualifies as a "fresh spot" for hot weather relief
 * by analyzing three key factors:
 * 1. Shade coverage from trees
 * 2. Seating availability from benches
 * 3. Convenience from trash cans
 *
 * Algorithm focuses on data quality and accuracy before frontend development.
 */

const { Pool } = require("pg")
const { DB_CONFIG } = require("../scripts/setup-postgresql")

// Algorithm configuration
const FRESH_SPOT_CONFIG = {
	// Search radius in meters for each amenity type
	SEARCH_RADIUS: {
		TREES: 20, // Trees provide shade, expanded for urban spaces
		BENCHES: 20, // Benches should be within reasonable walking distance
		TRASH_CANS: 50, // Trash cans for convenience, reasonable radius
		FOUNTAINS: 75, // Water cooling effect extends further
	},

	// Scoring weights (must sum to 1.0)
	WEIGHTS: {
		SHADE: 0.5, // Shade is most important in hot weather
		SEATING: 0.3, // Seating is important for resting
		CONVENIENCE: 0.2, // Trash cans add convenience but less critical
	},

	// Water cooling bonus system (additive, not competitive)
	WATER_COOLING: {
		MAX_BONUS: 2.0, // Maximum bonus points to add to overall score
		DECAY_FUNCTION: "exponential", // How cooling effect decreases with distance
		FOUNTAIN_MULTIPLIER: 1.0, // Base multiplier for fountain cooling effects
	},

	// Scoring thresholds
	THRESHOLDS: {
		EXCELLENT: 7.0, // Exceptional fresh spot (lowered slightly)
		GOOD: 5.0, // Good fresh spot (lowered)
		FAIR: 3.0, // Acceptable fresh spot (lowered)
		POOR: 1.5, // Minimal fresh spot qualities (lowered)
	},

	// Minimum requirements for each factor (relaxed)
	MINIMUMS: {
		SHADE_SCORE: 5.0, // Minimum tree shade score (lowered)
		TREE_COUNT: 1, // At least 1 tree nearby
		BENCH_COUNT: 0, // Benches not required (trees can provide spots to sit)
		TOTAL_SCORE: 3.0, // Minimum overall score (lowered)
	},
}

class FreshSpotAnalyzer {
	constructor() {
		this.pool = new Pool(DB_CONFIG)
	}

	/**
	 * Analyze a location for fresh spot potential
	 * @param {number} latitude - Location latitude (WGS84)
	 * @param {number} longitude - Location longitude (WGS84)
	 * @returns {Object} Fresh spot analysis results
	 */
	async analyzeFreshSpot(latitude, longitude) {
		try {
			// Validate coordinates
			this.validateCoordinates(latitude, longitude)

			// Analyze each factor in parallel for efficiency
			const [
				shadeAnalysis,
				seatingAnalysis,
				convenienceAnalysis,
				waterCoolingAnalysis,
			] = await Promise.all([
				this.analyzeShade(latitude, longitude),
				this.analyzeSeating(latitude, longitude),
				this.analyzeConvenience(latitude, longitude),
				this.analyzeWaterCooling(latitude, longitude),
			])

			// Calculate overall fresh spot score
			const overallScore = this.calculateOverallScore(
				shadeAnalysis,
				seatingAnalysis,
				convenienceAnalysis,
				waterCoolingAnalysis
			)

			// Determine fresh spot rating
			const rating = this.determineFreshSpotRating(overallScore)

			// Check if location meets minimum requirements
			const meetsRequirements = this.checkMinimumRequirements(
				shadeAnalysis,
				seatingAnalysis,
				convenienceAnalysis,
				overallScore
			)

			return {
				location: { latitude, longitude },
				analysis: {
					shade: shadeAnalysis,
					seating: seatingAnalysis,
					convenience: convenienceAnalysis,
					water_cooling: waterCoolingAnalysis,
				},
				scoring: {
					overall_score: Math.round(overallScore * 100) / 100,
					rating: rating,
					meets_requirements: meetsRequirements,
				},
				metadata: {
					analyzed_at: new Date().toISOString(),
					algorithm_version: "1.1", // Updated version with water cooling
					search_radii: FRESH_SPOT_CONFIG.SEARCH_RADIUS,
				},
			}
		} catch (error) {
			throw new Error(`Fresh spot analysis failed: ${error.message}`)
		}
	}

	/**
	 * Analyze shade coverage from nearby trees
	 */
	async analyzeShade(latitude, longitude) {
		const query = `
            SELECT
                tree_id,
                common_name,
                shade_score,
                estimated_canopy_radius_m,
                ST_Y(location) as latitude,
                ST_X(location) as longitude,
                ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
            FROM ousposer.trees
            WHERE ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                $3
            )
            ORDER BY distance_m, shade_score DESC
        `

		const result = await this.pool.query(query, [
			latitude,
			longitude,
			FRESH_SPOT_CONFIG.SEARCH_RADIUS.TREES,
		])
		const trees = result.rows

		if (trees.length === 0) {
			return {
				score: 0,
				tree_count: 0,
				best_shade_score: 0,
				average_shade_score: 0,
				closest_tree_distance: null,
				trees: [],
			}
		}

		// Calculate shade metrics
		const shadeScores = trees.map((t) => t.shade_score)
		const bestShadeScore = Math.max(...shadeScores)
		const averageShadeScore =
			shadeScores.reduce((a, b) => a + b, 0) / shadeScores.length
		const closestTreeDistance = Math.min(...trees.map((t) => t.distance_m))

		// Calculate shade score (weighted by proximity and quality)
		let shadeScore = 0
		trees.forEach((tree) => {
			const proximityFactor = Math.max(
				0,
				1 - tree.distance_m / FRESH_SPOT_CONFIG.SEARCH_RADIUS.TREES
			)
			const qualityFactor = tree.shade_score / 10 // Normalize to 0-1
			shadeScore += proximityFactor * qualityFactor * 2 // Scale up
		})

		// Cap at 10
		shadeScore = Math.min(10, shadeScore)

		return {
			score: Math.round(shadeScore * 100) / 100,
			tree_count: trees.length,
			best_shade_score: bestShadeScore,
			average_shade_score: Math.round(averageShadeScore * 100) / 100,
			closest_tree_distance: Math.round(closestTreeDistance * 100) / 100,
			trees,
			// trees: trees.slice(0, 5), // Return top 5 closest trees
		}
	}

	/**
	 * Analyze seating availability from nearby benches
	 */
	async analyzeSeating(latitude, longitude) {
		const query = `
            SELECT
                bench_id,
                bench_type,
                total_length_m,
                ST_Y(location) as latitude,
                ST_X(location) as longitude,
                ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
            FROM ousposer.benches
            WHERE ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                $3
            )
            ORDER BY distance_m
        `

		const result = await this.pool.query(query, [
			latitude,
			longitude,
			FRESH_SPOT_CONFIG.SEARCH_RADIUS.BENCHES,
		])
		const benches = result.rows

		if (benches.length === 0) {
			return {
				score: 0,
				bench_count: 0,
				total_seating_length: 0,
				closest_bench_distance: null,
				benches: [],
			}
		}

		// Calculate seating metrics
		const totalSeatingLength = benches.reduce(
			(sum, bench) => sum + bench.total_length_m,
			0
		)
		const closestBenchDistance = Math.min(...benches.map((b) => b.distance_m))

		// Calculate seating score (based on quantity, proximity, and quality)
		let seatingScore = 0
		benches.forEach((bench) => {
			const proximityFactor = Math.max(
				0,
				1 - bench.distance_m / FRESH_SPOT_CONFIG.SEARCH_RADIUS.BENCHES
			)
			const lengthFactor = Math.min(1, bench.total_length_m / 5) // 5m+ bench gets full points
			seatingScore += proximityFactor * lengthFactor * 3 // Scale up
		})

		// Bonus for multiple benches
		if (benches.length > 1) {
			seatingScore *= 1.2
		}

		// Cap at 10
		seatingScore = Math.min(10, seatingScore)

		return {
			score: Math.round(seatingScore * 100) / 100,
			bench_count: benches.length,
			total_seating_length: Math.round(totalSeatingLength * 100) / 100,
			closest_bench_distance: Math.round(closestBenchDistance * 100) / 100,
			benches: benches.slice(0, 3), // Return top 3 closest benches
		}
	}

	/**
	 * Analyze convenience from nearby trash cans
	 */
	async analyzeConvenience(latitude, longitude) {
		const query = `
            SELECT
                poubelle_id,
                ST_Y(location) as latitude,
                ST_X(location) as longitude,
                ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
            FROM ousposer.poubelles
            WHERE ST_DWithin(
                location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                $3
            )
            ORDER BY distance_m
        `

		const result = await this.pool.query(query, [
			latitude,
			longitude,
			FRESH_SPOT_CONFIG.SEARCH_RADIUS.TRASH_CANS,
		])
		const trashCans = result.rows

		if (trashCans.length === 0) {
			return {
				score: 0,
				trash_can_count: 0,
				closest_trash_can_distance: null,
				trash_cans: [],
			}
		}

		// Calculate convenience metrics
		const closestTrashCanDistance = Math.min(
			...trashCans.map((t) => t.distance_m)
		)

		// Calculate convenience score (based on proximity and availability)
		let convenienceScore = 0
		trashCans.forEach((trashCan) => {
			const proximityFactor = Math.max(
				0,
				1 - trashCan.distance_m / FRESH_SPOT_CONFIG.SEARCH_RADIUS.TRASH_CANS
			)
			convenienceScore += proximityFactor * 2 // Scale up
		})

		// Bonus for multiple trash cans
		if (trashCans.length > 2) {
			convenienceScore *= 1.1
		}

		// Cap at 10
		convenienceScore = Math.min(10, convenienceScore)

		return {
			score: Math.round(convenienceScore * 100) / 100,
			trash_can_count: trashCans.length,
			closest_trash_can_distance:
				Math.round(closestTrashCanDistance * 100) / 100,
			trash_cans: trashCans.slice(0, 2), // Return top 2 closest trash cans
		}
	}

	/**
	 * Analyze water cooling effects from nearby fountains
	 */
	async analyzeWaterCooling(latitude, longitude) {
		try {
			const query = `
                SELECT
                    f.id,
                    f.gid,
                    f.type_objet,
                    f.modele,
                    f.voie,
                    f.arrondissement,
                    f.dispo,
                    f.cooling_effect,
                    f.effective_range_m,
                    ST_Y(f.location) as latitude,
                    ST_X(f.location) as longitude,
                    ST_Distance(
                        ST_GeogFromText('POINT(' || $2 || ' ' || $1 || ')'),
                        ST_GeogFromText('POINT(' || ST_X(f.location) || ' ' || ST_Y(f.location) || ')')
                    ) as distance_m
                FROM ousposer.fountains f
                WHERE f.dispo = 'OUI'
                AND ST_DWithin(
                    ST_GeogFromText('POINT(' || $2 || ' ' || $1 || ')'),
                    ST_GeogFromText('POINT(' || ST_X(f.location) || ' ' || ST_Y(f.location) || ')'),
                    $3
                )
                ORDER BY distance_m ASC
                LIMIT 10
            `

			const result = await this.pool.query(query, [
				latitude,
				longitude,
				FRESH_SPOT_CONFIG.SEARCH_RADIUS.FOUNTAINS,
			])
			const fountains = result.rows

			if (fountains.length === 0) {
				return {
					bonus: 0,
					fountain_count: 0,
					closest_fountain_distance: null,
					fountains: [],
				}
			}

			// Calculate water cooling bonus using exponential decay
			let coolingBonus = 0
			let closestFountainDistance = fountains[0].distance_m

			fountains.forEach((fountain) => {
				// Exponential decay: stronger effect closer to fountain
				const distanceFactor = Math.exp(-fountain.distance_m / 30) // 30m decay constant

				// Factor in fountain's cooling effect and effective range
				const effectivenessFactor =
					fountain.cooling_effect *
					Math.max(0, 1 - fountain.distance_m / fountain.effective_range_m)

				// Calculate bonus contribution
				const fountainBonus =
					distanceFactor *
					effectivenessFactor *
					FRESH_SPOT_CONFIG.WATER_COOLING.FOUNTAIN_MULTIPLIER

				coolingBonus += fountainBonus
			})

			// Cap the bonus at maximum allowed
			coolingBonus = Math.min(
				FRESH_SPOT_CONFIG.WATER_COOLING.MAX_BONUS,
				coolingBonus
			)

			return {
				bonus: Math.round(coolingBonus * 100) / 100,
				fountain_count: fountains.length,
				closest_fountain_distance:
					Math.round(closestFountainDistance * 100) / 100,
				fountains: fountains.slice(0, 3), // Return top 3 closest fountains
			}
		} catch (error) {
			console.error("Water cooling analysis failed:", error)
			return {
				bonus: 0,
				fountain_count: 0,
				closest_fountain_distance: null,
				fountains: [],
			}
		}
	}

	/**
	 * Calculate overall fresh spot score using weighted factors plus water cooling bonus
	 */
	calculateOverallScore(
		shadeAnalysis,
		seatingAnalysis,
		convenienceAnalysis,
		waterCoolingAnalysis = null
	) {
		const { WEIGHTS } = FRESH_SPOT_CONFIG

		const baseScore =
			shadeAnalysis.score * WEIGHTS.SHADE +
			seatingAnalysis.score * WEIGHTS.SEATING +
			convenienceAnalysis.score * WEIGHTS.CONVENIENCE

		// Add water cooling bonus if available
		const waterBonus = waterCoolingAnalysis ? waterCoolingAnalysis.bonus : 0

		return baseScore + waterBonus
	}

	/**
	 * Determine fresh spot rating based on overall score
	 */
	determineFreshSpotRating(overallScore) {
		const { THRESHOLDS } = FRESH_SPOT_CONFIG

		if (overallScore >= THRESHOLDS.EXCELLENT) return "excellent"
		if (overallScore >= THRESHOLDS.GOOD) return "good"
		if (overallScore >= THRESHOLDS.FAIR) return "fair"
		if (overallScore >= THRESHOLDS.POOR) return "poor"
		return "inadequate"
	}

	/**
	 * Check if location meets minimum requirements for fresh spot
	 */
	checkMinimumRequirements(
		shadeAnalysis,
		seatingAnalysis,
		convenienceAnalysis,
		overallScore
	) {
		const { MINIMUMS } = FRESH_SPOT_CONFIG

		return (
			overallScore >= MINIMUMS.TOTAL_SCORE &&
			shadeAnalysis.tree_count >= MINIMUMS.TREE_COUNT &&
			shadeAnalysis.best_shade_score >= MINIMUMS.SHADE_SCORE &&
			seatingAnalysis.bench_count >= MINIMUMS.BENCH_COUNT
		)
	}

	/**
	 * Validate coordinates are within Paris bounds
	 */
	validateCoordinates(latitude, longitude) {
		if (latitude < 48.81 || latitude > 48.91) {
			throw new Error(
				`Latitude ${latitude} is outside Paris bounds (48.81-48.91)`
			)
		}
		if (longitude < 2.2 || longitude > 2.5) {
			throw new Error(
				`Longitude ${longitude} is outside Paris bounds (2.2-2.5)`
			)
		}
	}

	/**
	 * Close database connection
	 */
	async close() {
		await this.pool.end()
	}
}

module.exports = {
	FreshSpotAnalyzer,
	FRESH_SPOT_CONFIG,
}
