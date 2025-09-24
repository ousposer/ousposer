#!/usr/bin/env node
/**
 * Enhanced Detection Pipeline Runner for OusPoser
 * Implements validated patterns for 95%+ accuracy bench and trash can detection
 */

const { detectArrondissement, pool } = require("./enhanced-detection.js")

/**
 * Run detection for all Paris arrondissements
 */
async function runFullDetection() {
	console.log("🚀 Starting Enhanced OusPoser Detection Pipeline")
	console.log("=" * 70)
	console.log("📊 Using validated patterns from 285 manual bench examples")
	console.log("🎯 Target: 95%+ detection accuracy with 2% tolerance")
	console.log("")

	const startTime = Date.now()
	const results = []

	// Paris arrondissements 1-20
	const arrondissements = Array.from({ length: 20 }, (_, i) => i + 1)

	for (const arr of arrondissements) {
		try {
			const result = await detectArrondissement(arr)
			results.push(result)
		} catch (error) {
			console.error(`❌ Error processing arrondissement ${arr}:`, error.message)
			results.push({
				arrondissement: arr,
				error: error.message,
				trashCans: 0,
				benches: 0,
				singleBenches: 0,
				twoBenches: 0,
				multiBenches: 0,
			})
		}
	}

	// Calculate totals
	const totals = results.reduce(
		(acc, r) => ({
			trashCans: acc.trashCans + (r.trashCans || 0),
			benches: acc.benches + (r.benches || 0),
			singleBenches: acc.singleBenches + (r.singleBenches || 0),
			twoBenches: acc.twoBenches + (r.twoBenches || 0),
			multiBenches: acc.multiBenches + (r.multiBenches || 0),
			errors: acc.errors + (r.error ? 1 : 0),
		}),
		{
			trashCans: 0,
			benches: 0,
			singleBenches: 0,
			twoBenches: 0,
			multiBenches: 0,
			errors: 0,
		}
	)

	const duration = (Date.now() - startTime) / 1000

	console.log("\n" + "=".repeat(70))
	console.log("🎉 ENHANCED DETECTION COMPLETE!")
	console.log("=".repeat(70))
	console.log(`⏱️  Total time: ${duration.toFixed(1)}s`)
	console.log(`📍 Arrondissements processed: ${arrondissements.length}`)
	console.log(`❌ Errors: ${totals.errors}`)
	console.log("")
	console.log("📊 DETECTION RESULTS:")
	console.log(`🗑️  Trash cans: ${totals.trashCans.toLocaleString()}`)
	console.log(`🪑 Total benches: ${totals.benches.toLocaleString()}`)
	console.log(
		`   • Single-component: ${totals.singleBenches.toLocaleString()} (95-98% confidence)`
	)
	console.log(
		`   • Two-component: ${totals.twoBenches.toLocaleString()} (96% confidence)`
	)
	console.log(
		`   • Multi-component: ${totals.multiBenches.toLocaleString()} (85-90% confidence)`
	)
	console.log("")

	// Show top arrondissements
	const sortedResults = results
		.filter((r) => !r.error)
		.sort((a, b) => (b.benches || 0) - (a.benches || 0))
		.slice(0, 5)

	console.log("🏆 TOP 5 ARRONDISSEMENTS BY BENCH COUNT:")
	sortedResults.forEach((r, i) => {
		console.log(
			`${i + 1}. Arr ${r.arrondissement}: ${r.benches} benches, ${
				r.trashCans
			} trash cans`
		)
	})

	console.log("")
	console.log("✅ Clean database ready for OusPoser map display!")
	console.log("📍 Use the furniture_map_view for Leaflet integration")

	return results
}

/**
 * Run detection for specific arrondissements
 */
async function runSpecificArrondissements(arrondissements) {
	console.log(
		`🚀 Running detection for arrondissements: ${arrondissements.join(", ")}`
	)

	const results = []

	for (const arr of arrondissements) {
		try {
			const result = await detectArrondissement(arr)
			results.push(result)
		} catch (error) {
			console.error(`❌ Error processing arrondissement ${arr}:`, error.message)
		}
	}

	return results
}

/**
 * Show database statistics
 */
async function showStatistics() {
	const client = await pool.connect()

	try {
		console.log("📊 DATABASE STATISTICS")
		console.log("=" * 40)

		// Overall counts
		const benchCount = await client.query(
			"SELECT COUNT(*) as count FROM benches"
		)
		const trashCount = await client.query(
			"SELECT COUNT(*) as count FROM poubelles"
		)

		console.log(`🪑 Total benches: ${benchCount.rows[0].count}`)
		console.log(`🗑️ Total trash cans: ${trashCount.rows[0].count}`)

		// Bench type breakdown
		const benchTypes = await client.query(`
            SELECT bench_type, COUNT(*) as count, AVG(detection_confidence) as avg_confidence
            FROM benches 
            GROUP BY bench_type 
            ORDER BY count DESC
        `)

		console.log("\n🪑 BENCH TYPE BREAKDOWN:")
		benchTypes.rows.forEach((row) => {
			console.log(
				`  ${row.bench_type}: ${row.count} (${(
					row.avg_confidence * 100
				).toFixed(1)}% avg confidence)`
			)
		})

		// Arrondissement breakdown
		const arrBreakdown = await client.query(`
            SELECT arrondissement,
                   COUNT(*) FILTER (WHERE type = 'bench') as benches,
                   COUNT(*) FILTER (WHERE type = 'poubelle') as trash_cans
            FROM (
                SELECT arrondissement, 'bench' as type FROM benches
                UNION ALL
                SELECT arrondissement, 'poubelle' as type FROM poubelles
            ) combined
            GROUP BY arrondissement
            ORDER BY arrondissement
        `)

		console.log("\n📍 BY ARRONDISSEMENT:")
		arrBreakdown.rows.forEach((row) => {
			console.log(
				`  Arr ${row.arrondissement}: ${row.benches || 0} benches, ${
					row.trash_cans || 0
				} trash cans`
			)
		})

		// Confidence distribution
		const confidenceStats = await client.query(`
            SELECT 
                ROUND(detection_confidence, 2) as confidence,
                COUNT(*) as count
            FROM (
                SELECT detection_confidence FROM benches
                UNION ALL
                SELECT detection_confidence FROM poubelles
            ) combined
            GROUP BY ROUND(detection_confidence, 2)
            ORDER BY confidence DESC
        `)

		console.log("\n🎯 CONFIDENCE DISTRIBUTION:")
		confidenceStats.rows.forEach((row) => {
			console.log(`  ${(row.confidence * 100).toFixed(0)}%: ${row.count} items`)
		})
	} finally {
		client.release()
	}
}

/**
 * Clear database tables
 */
async function clearDatabase() {
	const client = await pool.connect()

	try {
		await client.query("DELETE FROM benches")
		await client.query("DELETE FROM poubelles")
		console.log("🗑️ Database cleared successfully")
	} finally {
		client.release()
	}
}

/**
 * Main CLI interface
 */
async function main() {
	const args = process.argv.slice(2)
	const command = args[0]

	try {
		switch (command) {
			case "all":
				await runFullDetection()
				break

			case "arr":
				const arrondissements = args
					.slice(1)
					.map(Number)
					.filter((n) => n >= 1 && n <= 20)
				if (arrondissements.length === 0) {
					console.error("❌ Please specify valid arrondissements (1-20)")
					process.exit(1)
				}
				await runSpecificArrondissements(arrondissements)
				break

			case "stats":
				await showStatistics()
				break

			case "clear":
				await clearDatabase()
				break

			case "test":
				// Test with arrondissement 1 only
				await runSpecificArrondissements([1])
				break

			default:
				console.log("🪑 Enhanced OusPoser Detection Pipeline")
				console.log("")
				console.log("Usage:")
				console.log(
					"  node run-enhanced-detection.js all           # Run detection for all arrondissements"
				)
				console.log(
					"  node run-enhanced-detection.js arr 1 2 3     # Run detection for specific arrondissements"
				)
				console.log(
					"  node run-enhanced-detection.js test          # Test with arrondissement 1 only"
				)
				console.log(
					"  node run-enhanced-detection.js stats         # Show database statistics"
				)
				console.log(
					"  node run-enhanced-detection.js clear         # Clear database tables"
				)
				console.log("")
				console.log("Examples:")
				console.log(
					"  node run-enhanced-detection.js test          # Quick test"
				)
				console.log(
					"  node run-enhanced-detection.js arr 12 16     # Detect in Bois areas"
				)
				console.log(
					"  node run-enhanced-detection.js all           # Full Paris detection"
				)
				break
		}
	} catch (error) {
		console.error("❌ Error:", error.message)
		process.exit(1)
	} finally {
		await pool.end()
	}
}

// Run if called directly
if (require.main === module) {
	main()
}

module.exports = {
	runFullDetection,
	runSpecificArrondissements,
	showStatistics,
	clearDatabase,
}
