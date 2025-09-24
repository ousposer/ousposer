#!/usr/bin/env node

/**
 * Import processed trees data into PostgreSQL
 * Part of OusPoser cool spots detection system
 *
 * This script imports 190,005 processed trees from data/processed-trees.json
 * into the PostgreSQL ousposer.trees table with proper spatial indexing.
 */

const fs = require("fs")
const path = require("path")
const { Pool } = require("pg")
const { DB_CONFIG } = require("./setup-postgresql")

// Database configuration - using shared config from setup-postgresql.js
const pool = new Pool(DB_CONFIG)

// Configuration
const BATCH_SIZE = 1000 // Process trees in batches for memory efficiency
const DATA_FILE = path.join(__dirname, "..", "data", "processed-trees.json")

/**
 * Load and validate trees data
 */
function loadTreesData() {
	console.log("📂 Loading trees data from:", DATA_FILE)

	if (!fs.existsSync(DATA_FILE)) {
		throw new Error(`Trees data file not found: ${DATA_FILE}`)
	}

	const rawData = fs.readFileSync(DATA_FILE, "utf8")
	const trees = JSON.parse(rawData)

	console.log(`✅ Loaded ${trees.length} trees from file`)

	// Validate data structure
	if (!Array.isArray(trees) || trees.length === 0) {
		throw new Error("Invalid trees data: expected non-empty array")
	}

	// Validate first tree structure
	const firstTree = trees[0]
	const requiredFields = ["id", "arrondissement", "latitude", "longitude"]
	for (const field of requiredFields) {
		if (!(field in firstTree)) {
			throw new Error(`Missing required field: ${field}`)
		}
	}

	console.log("✅ Data structure validation passed")
	return trees
}

/**
 * Create trees table if it doesn't exist
 */
async function ensureTreesTable() {
	console.log("🔧 Ensuring trees table exists...")

	const schemaFile = path.join(__dirname, "create-trees-table.sql")
	if (!fs.existsSync(schemaFile)) {
		throw new Error(`Schema file not found: ${schemaFile}`)
	}

	const schemaSql = fs.readFileSync(schemaFile, "utf8")
	await pool.query(schemaSql)

	console.log("✅ Trees table schema ready")
}

/**
 * Clear existing trees data (for re-imports)
 */
async function clearExistingData() {
	console.log("🧹 Checking for existing trees data...")

	const result = await pool.query("SELECT COUNT(*) FROM ousposer.trees")
	const existingCount = parseInt(result.rows[0].count)

	if (existingCount > 0) {
		console.log(`⚠️  Found ${existingCount} existing trees`)
		console.log("🗑️  Clearing existing data for fresh import...")
		await pool.query("TRUNCATE TABLE ousposer.trees RESTART IDENTITY")
		console.log("✅ Existing data cleared")
	} else {
		console.log("✅ No existing data found")
	}
}

/**
 * Insert trees in batches with progress tracking
 */
async function insertTreesBatch(trees, startIndex, batchSize) {
	const endIndex = Math.min(startIndex + batchSize, trees.length)
	const batch = trees.slice(startIndex, endIndex)

	// Use transaction for batch insert
	const client = await pool.connect()

	try {
		await client.query("BEGIN")

		// Prepare single insert statement
		const insertQuery = `
            INSERT INTO ousposer.trees (
                tree_id, arrondissement, latitude, longitude,
                common_name, genus, species, variety,
                height_m, circumference_cm, development_stage, location_type,
                is_remarkable, estimated_canopy_radius_m, shade_score, location
            ) VALUES ($1, $2, $3::REAL, $4::REAL, $5, $6, $7, $8, $9::REAL, $10::REAL, $11, $12, $13::BOOLEAN, $14::REAL, $15::REAL, ST_SetSRID(ST_MakePoint($4::REAL, $3::REAL), 4326))
        `

		// Insert each tree in the batch
		for (const tree of batch) {
			const values = [
				tree.id, // tree_id
				tree.arrondissement, // arrondissement
				tree.latitude, // latitude
				tree.longitude, // longitude
				tree.common_name || null, // common_name
				tree.genus || null, // genus
				tree.species || null, // species
				tree.variety || null, // variety
				tree.height_m || null, // height_m
				tree.circumference_cm || null, // circumference_cm
				tree.development_stage || null, // development_stage
				tree.location_type || null, // location_type
				tree.is_remarkable || false, // is_remarkable
				tree.estimated_canopy_radius_m || null, // estimated_canopy_radius_m
				tree.shade_score || null, // shade_score
			]

			await client.query(insertQuery, values)
		}

		await client.query("COMMIT")
	} catch (error) {
		await client.query("ROLLBACK")
		throw error
	} finally {
		client.release()
	}

	return batch.length
}

/**
 * Import all trees with progress tracking
 */
async function importTrees(trees) {
	console.log(`🌳 Starting import of ${trees.length} trees...`)
	console.log(`📦 Using batch size: ${BATCH_SIZE}`)

	let totalImported = 0
	const startTime = Date.now()

	for (let i = 0; i < trees.length; i += BATCH_SIZE) {
		const batchImported = await insertTreesBatch(trees, i, BATCH_SIZE)
		totalImported += batchImported

		const progress = ((totalImported / trees.length) * 100).toFixed(1)
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

		console.log(
			`📊 Progress: ${totalImported}/${trees.length} (${progress}%) - ${elapsed}s elapsed`
		)
	}

	const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
	console.log(
		`✅ Import completed! ${totalImported} trees imported in ${totalTime}s`
	)
}

/**
 * Validate imported data
 */
async function validateImport() {
	console.log("🔍 Validating imported data...")

	// Run validation function
	const validationResult = await pool.query(
		"SELECT * FROM ousposer.validate_trees_data()"
	)

	console.log("\n📋 Data Validation Results:")
	console.log("================================")
	validationResult.rows.forEach((row) => {
		const status =
			row.status === "PASS" ? "✅" : row.status === "FAIL" ? "❌" : "ℹ️"
		console.log(`${status} ${row.check_name}: ${row.count_or_message}`)
	})

	// Get arrondissement distribution
	const arrResult = await pool.query(
		"SELECT * FROM ousposer.trees_by_arrondissement ORDER BY arrondissement"
	)

	console.log("\n🏛️ Trees by Arrondissement:")
	console.log("============================")
	arrResult.rows.forEach((row) => {
		console.log(
			`Arr ${row.arrondissement.toString().padStart(2)}: ${row.total_trees
				.toString()
				.padStart(6)} trees (avg shade: ${row.avg_shade_score}, high shade: ${
				row.high_shade_trees
			})`
		)
	})

	console.log("\n✅ Validation completed")
}

/**
 * Main import process
 */
async function main() {
	try {
		console.log("🌳 OusPoser Trees Import Starting...")
		console.log("=====================================\n")

		// Load data
		const trees = loadTreesData()

		// Ensure database schema
		await ensureTreesTable()

		// Clear existing data
		await clearExistingData()

		// Import trees
		await importTrees(trees)

		// Validate import
		await validateImport()

		console.log("\n🎉 Trees import completed successfully!")
		console.log("Ready for cool spots detection algorithm development.")
	} catch (error) {
		console.error("❌ Import failed:", error.message)
		console.error(error.stack)
		process.exit(1)
	} finally {
		await pool.end()
	}
}

// Run if called directly
if (require.main === module) {
	main()
}

module.exports = { main, loadTreesData, importTrees, validateImport }
