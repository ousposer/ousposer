#!/usr/bin/env node

const { Client } = require("pg")
const fs = require("fs")
const sqlite3 = require("sqlite3").verbose()
const { DB_CONFIG } = require("./setup-postgresql")

/**
 * Data Import Script for OusPoser PostgreSQL Database
 * Imports detection results and original components from SQLite to PostgreSQL
 */

/**
 * Import benches data to PostgreSQL
 */
async function importBenches(client, benches) {
	console.log(`🪑 Importing ${benches.length} benches...`)

	const insertQuery = `
        INSERT INTO ousposer.benches (
            bench_id, arrondissement, bench_type, component_ids, total_components,
            total_length_m, location, frame_components, internal_components,
            detection_method, detection_confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10, $11, $12)
        ON CONFLICT (bench_id) DO UPDATE SET
            total_length_m = EXCLUDED.total_length_m,
            detection_confidence = EXCLUDED.detection_confidence,
            detected_at = CURRENT_TIMESTAMP
    `

	let imported = 0
	let errors = 0

	for (const bench of benches) {
		try {
			const values = [
				bench.bench_id,
				bench.arrondissement,
				bench.bench_type,
				bench.components, // PostgreSQL array
				bench.total_components,
				bench.total_length_m,
				bench.location.longitude, // PostGIS expects lon, lat
				bench.location.latitude,
				bench.frame_components || null,
				bench.internal_components || null,
				bench.detection_method,
				bench.detection_confidence,
			]

			await client.query(insertQuery, values)
			imported++

			if (imported % 100 === 0) {
				console.log(
					`   Progress: ${imported}/${benches.length} benches imported`
				)
			}
		} catch (error) {
			errors++
			console.warn(
				`   ⚠️  Error importing bench ${bench.bench_id}:`,
				error.message
			)
		}
	}

	console.log(
		`   ✅ Benches import complete: ${imported} imported, ${errors} errors`
	)
	return { imported, errors }
}

/**
 * Import poubelles data to PostgreSQL
 */
async function importPoubelles(client, poubelles, sqliteDb) {
	console.log(`🗑️  Importing ${poubelles.length} poubelles...`)

	const insertQuery = `
        INSERT INTO ousposer.poubelles (
            poubelle_id, arrondissement, component_id, total_length_m,
            point_count, aspect_ratio, location, shape, detection_method, detection_confidence
        ) VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10, $11)
        ON CONFLICT (poubelle_id) DO UPDATE SET
            total_length_m = EXCLUDED.total_length_m,
            detection_confidence = EXCLUDED.detection_confidence,
            detected_at = CURRENT_TIMESTAMP
    `

	let imported = 0
	let errors = 0

	for (const poubelle of poubelles) {
		try {
			// Get original geometry from SQLite
			const geoResult = await new Promise((resolve, reject) => {
				sqliteDb.get(
					"SELECT geo_shape FROM street_furniture WHERE objectid = ?",
					[poubelle.component_id],
					(err, row) => {
						if (err) reject(err)
						else resolve(row)
					}
				)
			})

			if (!geoResult) {
				console.warn(
					`   ⚠️  No geometry found for poubelle component ${poubelle.component_id}`
				)
				errors++
				continue
			}

			// Parse geometry and create LineString
			const geoShape = JSON.parse(geoResult.geo_shape)
			const coords = geoShape.geometry.coordinates

			// Create PostGIS LineString from coordinates
			const lineStringWKT = `LINESTRING(${coords
				.map((c) => `${c[0]} ${c[1]}`)
				.join(", ")})`

			const values = [
				poubelle.poubelle_id,
				poubelle.arrondissement,
				poubelle.component_id,
				poubelle.total_length_m,
				poubelle.point_count,
				poubelle.aspect_ratio,
				poubelle.location.longitude,
				poubelle.location.latitude,
				`ST_SetSRID(ST_GeomFromText('${lineStringWKT}'), 4326)`, // LineString geometry
				poubelle.detection_method,
				poubelle.detection_confidence,
			]

			// Special query for geometry
			const specialQuery = `
                INSERT INTO ousposer.poubelles (
                    poubelle_id, arrondissement, component_id, total_length_m,
                    point_count, aspect_ratio, location, shape, detection_method, detection_confidence
                ) VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), ${values[8]}, $9, $10)
                ON CONFLICT (poubelle_id) DO UPDATE SET
                    total_length_m = EXCLUDED.total_length_m,
                    detection_confidence = EXCLUDED.detection_confidence,
                    detected_at = CURRENT_TIMESTAMP
            `

			await client.query(specialQuery, [
				values[0],
				values[1],
				values[2],
				values[3],
				values[4],
				values[5],
				values[6],
				values[7],
				values[9],
				values[10],
			])

			imported++

			if (imported % 50 === 0) {
				console.log(
					`   Progress: ${imported}/${poubelles.length} poubelles imported`
				)
			}
		} catch (error) {
			errors++
			console.warn(
				`   ⚠️  Error importing poubelle ${poubelle.poubelle_id}:`,
				error.message
			)
		}
	}

	console.log(
		`   ✅ Poubelles import complete: ${imported} imported, ${errors} errors`
	)
	return { imported, errors }
}

/**
 * Import original street furniture components for reference
 */
async function importComponents(client, sqliteDb, arrondissements) {
	console.log(`🧩 Importing original street furniture components...`)

	const insertQuery = `
        INSERT INTO ousposer.street_furniture_components (
            objectid, arrondissement, total_length_m, point_count, aspect_ratio,
            bounding_width_m, bounding_height_m, angle_changes_sum,
            location, shape, classified_as
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326), $11, $12)
        ON CONFLICT (objectid) DO UPDATE SET
            classified_as = EXCLUDED.classified_as,
            imported_at = CURRENT_TIMESTAMP
    `

	let totalImported = 0
	let totalErrors = 0

	for (const arr of arrondissements) {
		console.log(`   Processing arrondissement ${arr}...`)

		const components = await new Promise((resolve, reject) => {
			sqliteDb.all(
				`
                SELECT objectid, arrondissement, total_length_m, point_count, aspect_ratio,
                       bounding_width_m, bounding_height_m, angle_changes_sum,
                       latitude, longitude, geo_shape
                FROM street_furniture 
                WHERE arrondissement = ?
                ORDER BY objectid
            `,
				[arr],
				(err, rows) => {
					if (err) reject(err)
					else resolve(rows)
				}
			)
		})

		let imported = 0
		let errors = 0

		for (const comp of components) {
			try {
				// Parse geometry
				const geoShape = JSON.parse(comp.geo_shape)
				const coords = geoShape.geometry.coordinates
				const lineStringWKT = `LINESTRING(${coords
					.map((c) => `${c[0]} ${c[1]}`)
					.join(", ")})`

				// Determine classification (will be updated later with actual usage)
				let classification = "unclassified"
				if (
					comp.aspect_ratio > 0.95 &&
					comp.point_count > 65 &&
					comp.total_length_m > 2.1 &&
					comp.total_length_m < 2.4
				) {
					classification = "poubelle"
				}

				const specialQuery = `
                    INSERT INTO ousposer.street_furniture_components (
                        objectid, arrondissement, total_length_m, point_count, aspect_ratio,
                        bounding_width_m, bounding_height_m, angle_changes_sum,
                        location, shape, classified_as
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326), 
                             ST_SetSRID(ST_GeomFromText('${lineStringWKT}'), 4326), $11)
                    ON CONFLICT (objectid) DO UPDATE SET
                        classified_as = EXCLUDED.classified_as,
                        imported_at = CURRENT_TIMESTAMP
                `

				await client.query(specialQuery, [
					comp.objectid,
					comp.arrondissement,
					comp.total_length_m,
					comp.point_count,
					comp.aspect_ratio,
					comp.bounding_width_m,
					comp.bounding_height_m,
					comp.angle_changes_sum,
					comp.longitude,
					comp.latitude,
					classification,
				])

				imported++
			} catch (error) {
				errors++
				if (errors <= 5) {
					// Only show first few errors
					console.warn(
						`     ⚠️  Error importing component ${comp.objectid}:`,
						error.message
					)
				}
			}
		}

		console.log(`     Arr ${arr}: ${imported} imported, ${errors} errors`)
		totalImported += imported
		totalErrors += errors
	}

	console.log(
		`   ✅ Components import complete: ${totalImported} imported, ${totalErrors} errors`
	)
	return { imported: totalImported, errors: totalErrors }
}

/**
 * Update component classifications based on actual usage
 */
async function updateComponentClassifications(client) {
	console.log(`🔄 Updating component classifications...`)

	try {
		// Mark components used in benches
		await client.query(`
            UPDATE ousposer.street_furniture_components 
            SET classified_as = 'bench_component',
                used_in_bench_id = b.bench_id
            FROM ousposer.benches b
            WHERE street_furniture_components.objectid = ANY(b.component_ids)
        `)

		// Mark components used as poubelles
		await client.query(`
            UPDATE ousposer.street_furniture_components 
            SET classified_as = 'poubelle',
                used_in_poubelle_id = p.poubelle_id
            FROM ousposer.poubelles p
            WHERE street_furniture_components.objectid = p.component_id
        `)

		// Get classification stats
		const statsResult = await client.query(`
            SELECT classified_as, COUNT(*) as count
            FROM ousposer.street_furniture_components
            GROUP BY classified_as
            ORDER BY count DESC
        `)

		console.log("   ✅ Classification update complete:")
		statsResult.rows.forEach((row) => {
			console.log(`     ${row.classified_as}: ${row.count} components`)
		})
	} catch (error) {
		console.error("❌ Error updating classifications:", error.message)
		throw error
	}
}

/**
 * Main import function
 */
async function importDetectionResults(
	detectionFile = "postgresql_import_data.json"
) {
	console.log("🚀 Starting data import to PostgreSQL...\n")

	// Check if detection results file exists
	if (!fs.existsSync(detectionFile)) {
		console.error(`❌ Detection results file not found: ${detectionFile}`)
		console.error(
			"   Run citywide detection first: node scripts/citywide-detection.js"
		)
		process.exit(1)
	}

	const client = new Client(DB_CONFIG)
	const sqliteDb = new sqlite3.Database("data/street_furniture.db")

	try {
		// Connect to PostgreSQL
		await client.connect()
		console.log("✅ Connected to PostgreSQL database")

		// Load detection results
		console.log(`📖 Loading detection results from ${detectionFile}...`)
		const detectionData = JSON.parse(fs.readFileSync(detectionFile, "utf8"))

		console.log(
			`   Found ${detectionData.benches.length} benches and ${detectionData.poubelles.length} poubelles`
		)

		// Get arrondissements for component import
		const arrondissements = await new Promise((resolve, reject) => {
			sqliteDb.all(
				"SELECT DISTINCT arrondissement FROM street_furniture WHERE arrondissement IS NOT NULL ORDER BY arrondissement",
				(err, rows) => {
					if (err) reject(err)
					else resolve(rows.map((row) => row.arrondissement))
				}
			)
		})

		console.log(
			`   Will import components from ${arrondissements.length} arrondissements\n`
		)

		// Start transaction
		await client.query("BEGIN")

		const results = {
			benches: { imported: 0, errors: 0 },
			poubelles: { imported: 0, errors: 0 },
			components: { imported: 0, errors: 0 },
		}

		// Import benches
		results.benches = await importBenches(client, detectionData.benches)

		// Import poubelles
		results.poubelles = await importPoubelles(
			client,
			detectionData.poubelles,
			sqliteDb
		)

		// Import original components
		results.components = await importComponents(
			client,
			sqliteDb,
			arrondissements
		)

		// Update component classifications
		await updateComponentClassifications(client)

		// Commit transaction
		await client.query("COMMIT")

		// Generate final statistics
		console.log("\n🎉 IMPORT COMPLETE!")
		console.log("=".repeat(50))
		console.log(`📊 IMPORT SUMMARY:`)
		console.log(
			`   🪑 Benches: ${results.benches.imported} imported, ${results.benches.errors} errors`
		)
		console.log(
			`   🗑️  Poubelles: ${results.poubelles.imported} imported, ${results.poubelles.errors} errors`
		)
		console.log(
			`   🧩 Components: ${results.components.imported} imported, ${results.components.errors} errors`
		)

		// Database statistics
		const dbStats = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM ousposer.benches) as bench_count,
                (SELECT COUNT(*) FROM ousposer.poubelles) as poubelle_count,
                (SELECT COUNT(*) FROM ousposer.street_furniture_components) as component_count
        `)

		const stats = dbStats.rows[0]
		console.log(`\n📈 DATABASE TOTALS:`)
		console.log(`   🪑 Total benches in database: ${stats.bench_count}`)
		console.log(`   🗑️  Total poubelles in database: ${stats.poubelle_count}`)
		console.log(`   🧩 Total components in database: ${stats.component_count}`)

		// Arrondissement breakdown
		const arrStats = await client.query(`
            SELECT arrondissement, bench_count, poubelle_count, total_furniture
            FROM ousposer.arrondissement_stats
            ORDER BY arrondissement
        `)

		console.log(`\n🏛️  BY ARRONDISSEMENT:`)
		arrStats.rows.forEach((row) => {
			console.log(
				`   Arr ${row.arrondissement.toString().padStart(2)}: ${row.bench_count
					.toString()
					.padStart(3)} benches, ${row.poubelle_count
					.toString()
					.padStart(3)} poubelles`
			)
		})

		console.log("\n✅ PostgreSQL database ready for production use!")
	} catch (error) {
		console.error("\n❌ Import failed:", error.message)

		try {
			await client.query("ROLLBACK")
			console.log("🔄 Transaction rolled back")
		} catch (rollbackError) {
			console.error("❌ Rollback failed:", rollbackError.message)
		}

		throw error
	} finally {
		await client.end()
		sqliteDb.close()
	}
}

module.exports = {
	importBenches,
	importPoubelles,
	importComponents,
	updateComponentClassifications,
	importDetectionResults,
}

// Run import if script is executed directly
if (require.main === module) {
	const detectionFile = process.argv[2] || "postgresql_import_data.json"
	importDetectionResults(detectionFile)
		.then(() => {
			console.log("\n✅ Import completed successfully!")
			process.exit(0)
		})
		.catch((error) => {
			console.error("\n❌ Import failed:", error)
			process.exit(1)
		})
}
