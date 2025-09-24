#!/usr/bin/env node

const sqlite3 = require("sqlite3").verbose()
const fs = require("fs")

/**
 * Citywide Street Furniture Detection System
 * Combines optimized bench detection with poubelle detection
 * Processes all 20 Paris arrondissements
 */

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
 * Extract all coordinate points from a component's geometry
 */
function extractCoordinates(component) {
	try {
		const geo = JSON.parse(component.geo_shape)
		return geo.geometry.coordinates.map((coord) => ({
			lat: coord[1],
			lon: coord[0],
			objectid: component.objectid,
		}))
	} catch (error) {
		return []
	}
}

/**
 * Create spatial index of all coordinate points for an arrondissement
 */
async function createSpatialIndex(db, arrondissement) {
	console.log(
		`  🗺️  Creating spatial index for arrondissement ${arrondissement}...`
	)

	// Create or recreate the coordinate points table
	await new Promise((resolve, reject) => {
		db.serialize(() => {
			db.run(`DROP TABLE IF EXISTS coord_points`)
			db.run(
				`
                CREATE TABLE coord_points (
                    objectid INTEGER,
                    lat REAL,
                    lon REAL,
                    coord_index INTEGER
                )
            `,
				(err) => {
					if (err) reject(err)
					else resolve()
				}
			)
		})
	})

	// Get all components and extract their coordinates
	const components = await new Promise((resolve, reject) => {
		db.all(
			`
            SELECT objectid, geo_shape
            FROM street_furniture 
            WHERE arrondissement = ?
              AND total_length_m BETWEEN 0.3 AND 3.0
        `,
			[arrondissement],
			(err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			}
		)
	})

	// Insert all coordinate points
	const insertStmt = db.prepare(`
        INSERT INTO coord_points (objectid, lat, lon, coord_index) 
        VALUES (?, ?, ?, ?)
    `)

	let totalPoints = 0
	for (const component of components) {
		const coords = extractCoordinates(component)
		coords.forEach((coord, index) => {
			insertStmt.run(component.objectid, coord.lat, coord.lon, index)
			totalPoints++
		})
	}

	insertStmt.finalize()
	console.log(`    Indexed ${totalPoints} coordinate points`)

	return totalPoints
}

/**
 * Find components connected to a given component using spatial index
 */
async function findConnectedComponentsOptimized(
	db,
	component,
	tolerance = 0.1
) {
	const coords = extractCoordinates(component)
	if (coords.length === 0) return []

	const connectedIds = new Set()

	// For each coordinate point of the component, find nearby points
	for (const coord of coords) {
		// Use spatial query with tolerance (in degrees, roughly 0.1m ≈ 0.000001 degrees)
		const toleranceDegrees = tolerance / 111000 // Convert meters to degrees

		const nearbyPoints = await new Promise((resolve, reject) => {
			db.all(
				`
                SELECT DISTINCT objectid
                FROM coord_points 
                WHERE objectid != ?
                  AND lat BETWEEN ? AND ?
                  AND lon BETWEEN ? AND ?
            `,
				[
					component.objectid,
					coord.lat - toleranceDegrees,
					coord.lat + toleranceDegrees,
					coord.lon - toleranceDegrees,
					coord.lon + toleranceDegrees,
				],
				(err, rows) => {
					if (err) reject(err)
					else resolve(rows)
				}
			)
		})

		// Add to connected set
		nearbyPoints.forEach((row) => connectedIds.add(row.objectid))
	}

	// Get full component data for connected components
	if (connectedIds.size === 0) return []

	const connectedComponents = await new Promise((resolve, reject) => {
		const placeholders = Array.from(connectedIds)
			.map(() => "?")
			.join(",")
		db.all(
			`
            SELECT objectid, latitude, longitude, total_length_m, point_count, aspect_ratio, geo_shape
            FROM street_furniture 
            WHERE objectid IN (${placeholders})
        `,
			Array.from(connectedIds),
			(err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			}
		)
	})

	return connectedComponents
}

/**
 * Build connection chain using optimized spatial queries
 */
async function buildConnectionChainOptimized(
	db,
	startComponent,
	maxLength = 6
) {
	const chain = [startComponent]
	const used = new Set([startComponent.objectid])

	let current = startComponent

	while (chain.length < maxLength) {
		const connected = await findConnectedComponentsOptimized(db, current, 0.1) // 10cm tolerance
		const available = connected.filter((comp) => !used.has(comp.objectid))

		if (available.length === 0) break

		const next = available[0]
		chain.push(next)
		used.add(next.objectid)
		current = next
	}

	return { chain }
}

/**
 * Find components inside a rectangular frame
 */
function findInternalComponents(frameComponents, allComponents) {
	const lats = frameComponents.map((c) => c.latitude)
	const lons = frameComponents.map((c) => c.longitude)

	const minLat = Math.min(...lats)
	const maxLat = Math.max(...lats)
	const minLon = Math.min(...lons)
	const maxLon = Math.max(...lons)

	const latMargin = (maxLat - minLat) * 0.1
	const lonMargin = (maxLon - minLon) * 0.1

	const frameIds = new Set(frameComponents.map((c) => c.objectid))

	const internal = allComponents.filter((comp) => {
		if (frameIds.has(comp.objectid)) return false

		return (
			comp.latitude > minLat - latMargin &&
			comp.latitude < maxLat + latMargin &&
			comp.longitude > minLon - lonMargin &&
			comp.longitude < maxLon + lonMargin
		)
	})

	return internal
}

/**
 * Validate internal components
 */
function validateInternalComponents(frameComponents, internalComponents) {
	const longSides = frameComponents.filter((c) => c.total_length_m > 1.5)
	if (longSides.length === 0) return []

	const targetLength = longSides[0].total_length_m
	const tolerance = 0.1

	return internalComponents.filter(
		(comp) => Math.abs(comp.total_length_m - targetLength) < tolerance
	)
}

/**
 * Detect poubelles using geometric characteristics
 */
async function detectPoubelles(db, arrondissement) {
	console.log(
		`  🗑️  Detecting poubelles in arrondissement ${arrondissement}...`
	)

	const poubelles = await new Promise((resolve, reject) => {
		db.all(
			`
            SELECT objectid, latitude, longitude, total_length_m, point_count, aspect_ratio, geo_shape
            FROM street_furniture 
            WHERE arrondissement = ?
              AND aspect_ratio > 0.95
              AND point_count > 70
              AND total_length_m > 2.1
              AND total_length_m < 2.4
            ORDER BY objectid
        `,
			[arrondissement],
			(err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			}
		)
	})

	console.log(`    Found ${poubelles.length} poubelles`)

	return poubelles.map((comp) => ({
		type: "poubelle",
		poubelle_id: `poubelle_${arrondissement}_${comp.objectid}`,
		component_id: comp.objectid,
		arrondissement: arrondissement,
		total_length_m: comp.total_length_m,
		point_count: comp.point_count,
		aspect_ratio: comp.aspect_ratio,
		location: { latitude: comp.latitude, longitude: comp.longitude },
		geo_shape: comp.geo_shape,
		detection_method: "geometric_characteristics",
		detection_confidence: 0.95,
	}))
}

/**
 * Detect single-component benches
 */
async function detectSingleComponentBenches(db, arrondissement) {
	console.log(
		`  🪑 Detecting single-component benches in arrondissement ${arrondissement}...`
	)

	const singleBenches = await new Promise((resolve, reject) => {
		db.all(
			`
            SELECT objectid, latitude, longitude, total_length_m, point_count, aspect_ratio, geo_shape
            FROM street_furniture 
            WHERE arrondissement = ?
              AND total_length_m BETWEEN 7.0 AND 7.5
              AND point_count >= 6
            ORDER BY total_length_m
        `,
			[arrondissement],
			(err, rows) => {
				if (err) reject(err)
				else resolve(rows)
			}
		)
	})

	console.log(`    Found ${singleBenches.length} single-component benches`)

	return singleBenches.map((comp) => ({
		type: "bench",
		bench_id: `bench_${arrondissement}_single_${comp.objectid}`,
		bench_type: "single-component",
		components: [comp.objectid],
		total_components: 1,
		arrondissement: arrondissement,
		total_length_m: comp.total_length_m,
		location: { latitude: comp.latitude, longitude: comp.longitude },
		detection_method: "geometric_topology",
		detection_confidence: 0.98,
	}))
}

/**
 * Process a single arrondissement for all furniture types
 */
async function processArrondissement(db, arrondissement) {
	console.log(`\n🏛️  Processing arrondissement ${arrondissement}...`)

	const results = {
		arrondissement: arrondissement,
		benches: [],
		poubelles: [],
		processing_time: Date.now(),
	}

	try {
		// Step 1: Create spatial index
		await createSpatialIndex(db, arrondissement)

		// Step 2: Detect poubelles first (they have specific criteria)
		const poubelles = await detectPoubelles(db, arrondissement)
		results.poubelles = poubelles

		// Step 3: Detect single-component benches
		const singleBenches = await detectSingleComponentBenches(db, arrondissement)
		results.benches.push(...singleBenches)

		// Step 4: Get remaining components for multi-component bench detection
		// NOTE: We only exclude single-component benches, NOT poubelles
		// Some poubelle-detected components might actually be part of multi-component benches
		const excludedIds = new Set([...singleBenches.flatMap((b) => b.components)])

		const remainingComponents = await new Promise((resolve, reject) => {
			const excludeClause =
				excludedIds.size > 0
					? `AND objectid NOT IN (${Array.from(excludedIds).join(",")})`
					: ""

			db.all(
				`
                SELECT objectid, latitude, longitude, total_length_m, point_count, aspect_ratio, geo_shape
                FROM street_furniture 
                WHERE arrondissement = ?
                  AND total_length_m BETWEEN 0.3 AND 3.0
                  ${excludeClause}
                ORDER BY total_length_m ASC
            `,
				[arrondissement],
				(err, rows) => {
					if (err) reject(err)
					else resolve(rows)
				}
			)
		})

		console.log(
			`    ${remainingComponents.length} components remaining for multi-component bench detection`
		)

		// Step 5: Detect multi-component benches
		const multiBenches = []
		const processedComponents = new Set()
		let processedCount = 0

		for (const component of remainingComponents) {
			processedCount++

			if (
				processedCount % 200 === 0 ||
				processedCount === remainingComponents.length
			) {
				console.log(
					`    Progress: ${processedCount}/${remainingComponents.length} (${(
						(processedCount / remainingComponents.length) *
						100
					).toFixed(1)}%) - Found ${
						multiBenches.length
					} multi-component benches`
				)
			}

			if (processedComponents.has(component.objectid)) continue

			const result = await buildConnectionChainOptimized(db, component)

			// Mark all components in the chain as processed to avoid re-analyzing them
			result.chain.forEach((c) => processedComponents.add(c.objectid))

			if (result.chain.length >= 4) {
				const frameComps = result.chain.slice(0, 4)
				const internalComps = findInternalComponents(
					frameComps,
					remainingComponents
				)
				const validInternal = validateInternalComponents(
					frameComps,
					internalComps
				)

				if (validInternal.length > 0) {
					const bench = {
						type: "bench",
						bench_id: `bench_${arrondissement}_multi_${frameComps[0].objectid}`,
						bench_type:
							validInternal.length === 1 ? "5-component" : "6-component",
						components: [
							...frameComps.map((c) => c.objectid),
							...validInternal.map((c) => c.objectid),
						],
						total_components: frameComps.length + validInternal.length,
						arrondissement: arrondissement,
						frame_components: frameComps.map((c) => c.objectid),
						internal_components: validInternal.map((c) => c.objectid),
						total_length_m:
							frameComps.reduce((sum, c) => sum + c.total_length_m, 0) +
							validInternal.reduce((sum, c) => sum + c.total_length_m, 0),
						location: {
							latitude:
								frameComps.reduce((sum, c) => sum + c.latitude, 0) /
								frameComps.length,
							longitude:
								frameComps.reduce((sum, c) => sum + c.longitude, 0) /
								frameComps.length,
						},
						detection_method: "geometric_topology",
						detection_confidence: 0.95,
					}

					multiBenches.push(bench)

					frameComps.forEach((c) => processedComponents.add(c.objectid))
					validInternal.forEach((c) => processedComponents.add(c.objectid))
				}
			}
		}

		results.benches.push(...multiBenches)

		// Step 6: Clean up poubelles that are actually part of benches
		const allBenchComponentIds = new Set(
			results.benches.flatMap((b) => b.components)
		)
		const originalPoubelleCount = results.poubelles.length
		results.poubelles = results.poubelles.filter(
			(p) => !allBenchComponentIds.has(p.component_id)
		)
		const removedPoubelles = originalPoubelleCount - results.poubelles.length

		results.processing_time = Date.now() - results.processing_time

		console.log(`  ✅ Arrondissement ${arrondissement} complete:`)
		console.log(
			`    Benches: ${results.benches.length} (${singleBenches.length} single, ${multiBenches.length} multi-component)`
		)
		console.log(
			`    Poubelles: ${results.poubelles.length} (removed ${removedPoubelles} that were part of benches)`
		)
		console.log(`    Processing time: ${results.processing_time}ms`)

		return results
	} catch (error) {
		console.error(
			`❌ Error processing arrondissement ${arrondissement}:`,
			error
		)
		throw error
	}
}

/**
 * Main citywide detection function - processes all 20 arrondissements
 */
async function detectCitywideStreetFurniture() {
	console.log("🚀 Starting citywide street furniture detection...\n")
	console.log("🎯 Detecting: Benches (single & multi-component) + Poubelles")
	console.log("📍 Coverage: All 20 Paris arrondissements\n")

	const db = new sqlite3.Database("street_furniture.db")

	try {
		// Get all available arrondissements
		const arrondissements = await new Promise((resolve, reject) => {
			db.all(
				"SELECT DISTINCT arrondissement FROM street_furniture WHERE arrondissement IS NOT NULL ORDER BY arrondissement",
				(err, rows) => {
					if (err) reject(err)
					else resolve(rows.map((row) => row.arrondissement))
				}
			)
		})

		console.log(
			`📊 Found ${
				arrondissements.length
			} arrondissements: [${arrondissements.join(", ")}]\n`
		)

		const startTime = Date.now()
		const allResults = []
		let totalBenches = 0
		let totalPoubelles = 0

		// Process each arrondissement
		for (const arr of arrondissements) {
			const result = await processArrondissement(db, arr)
			allResults.push(result)
			totalBenches += result.benches.length
			totalPoubelles += result.poubelles.length
		}

		const totalTime = Date.now() - startTime

		// Generate summary
		console.log("\n🎉 CITYWIDE DETECTION COMPLETE!")
		console.log("=".repeat(50))
		console.log(`📊 TOTAL RESULTS:`)
		console.log(`   🪑 Benches: ${totalBenches}`)
		console.log(`   🗑️  Poubelles: ${totalPoubelles}`)
		console.log(`   🏛️  Arrondissements: ${arrondissements.length}`)
		console.log(`   ⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`)

		// Detailed breakdown
		console.log("\n📋 DETAILED BREAKDOWN:")
		allResults.forEach((result) => {
			const singleBenches = result.benches.filter(
				(b) => b.bench_type === "single-component"
			).length
			const multiBenches = result.benches.filter(
				(b) => b.bench_type !== "single-component"
			).length
			console.log(
				`   Arr ${result.arrondissement
					.toString()
					.padStart(2)}: ${result.benches.length
					.toString()
					.padStart(
						3
					)} benches (${singleBenches}+${multiBenches}), ${result.poubelles.length
					.toString()
					.padStart(3)} poubelles`
			)
		})

		// Prepare final results for export
		const finalResults = {
			timestamp: new Date().toISOString(),
			detection_method: "geometric_topology_and_characteristics",
			coverage: "all_paris_arrondissements",
			total_arrondissements: arrondissements.length,
			total_benches: totalBenches,
			total_poubelles: totalPoubelles,
			processing_time_ms: totalTime,
			arrondissements: allResults,

			// Flattened arrays for easy database import
			benches: allResults.flatMap((r) => r.benches),
			poubelles: allResults.flatMap((r) => r.poubelles),
		}

		// Save results
		const outputFile = "citywide_detection_results.json"
		fs.writeFileSync(outputFile, JSON.stringify(finalResults, null, 2))
		console.log(`\n💾 Results saved to ${outputFile}`)

		// Save PostgreSQL-ready format
		const pgResults = {
			benches: finalResults.benches,
			poubelles: finalResults.poubelles,
			metadata: {
				timestamp: finalResults.timestamp,
				total_benches: finalResults.total_benches,
				total_poubelles: finalResults.total_poubelles,
			},
		}

		const pgOutputFile = "postgresql_import_data.json"
		fs.writeFileSync(pgOutputFile, JSON.stringify(pgResults, null, 2))
		console.log(`💾 PostgreSQL import data saved to ${pgOutputFile}`)

		console.log("\n🌟 Ready for PostgreSQL + PostGIS import!")

		return finalResults
	} catch (error) {
		console.error("❌ Error in citywide detection:", error)
		throw error
	} finally {
		db.close()
	}
}

// Run detection if script is executed directly
if (require.main === module) {
	detectCitywideStreetFurniture()
		.then(() => {
			console.log("\n✅ Citywide detection completed successfully!")
			process.exit(0)
		})
		.catch((error) => {
			console.error("\n❌ Citywide detection failed:", error)
			process.exit(1)
		})
}

module.exports = {
	processArrondissement,
	detectCitywideStreetFurniture,
}
