#!/usr/bin/env node

/**
 * Process Paris Fountains Data
 *
 * Imports fountain data from Paris Open Data API into PostgreSQL
 * for integration with fresh spot analysis algorithm.
 */

const fs = require("fs")
const path = require("path")
const { Pool } = require("pg")
const { DB_CONFIG } = require("./setup-postgresql")

class FountainProcessor {
	constructor() {
		this.pool = new Pool(DB_CONFIG)
		this.processed = 0
		this.errors = 0
	}

	/**
	 * Create fountains table with spatial indexing
	 */
	async createFountainsTable() {
		const createTableQuery = `
            CREATE TABLE IF NOT EXISTS ousposer.fountains (
                id SERIAL PRIMARY KEY,
                gid VARCHAR(50) UNIQUE NOT NULL,
                type_objet VARCHAR(100),
                modele VARCHAR(200),
                voie VARCHAR(500),
                commune VARCHAR(100),
                arrondissement INTEGER,
                dispo VARCHAR(10),
                location GEOMETRY(POINT, 4326),
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                cooling_effect DECIMAL(3, 2) DEFAULT 1.0,
                effective_range_m INTEGER DEFAULT 25,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Spatial index for efficient proximity queries
            CREATE INDEX IF NOT EXISTS idx_fountains_location 
            ON ousposer.fountains USING GIST (location);
            
            -- Index for availability filtering
            CREATE INDEX IF NOT EXISTS idx_fountains_dispo 
            ON ousposer.fountains (dispo);
            
            -- Index for arrondissement filtering
            CREATE INDEX IF NOT EXISTS idx_fountains_arrondissement 
            ON ousposer.fountains (arrondissement);
        `

		await this.pool.query(createTableQuery)
		console.log("✅ Fountains table created with spatial indexing")
	}

	/**
	 * Extract arrondissement number from commune string
	 */
	extractArrondissement(commune) {
		if (!commune) return null
		const match = commune.match(/(\d+)EME/)
		return match ? parseInt(match[1]) : null
	}

	/**
	 * Determine cooling effect based on fountain type
	 */
	getCoolingEffect(typeObjet, modele) {
		const coolingMap = {
			FONTAINE_WALLACE: 1.2, // Classic Wallace fountains - good cooling
			FONTAINE_2EN1: 1.0, // Standard dual-purpose fountains
			BORNE_FONTAINE: 0.8, // Simple water points - minimal cooling
			FONTAINE_PETILLANTE: 1.5, // Sparkling water fountains - premium
			FONTAINE_ALBIEN: 1.3, // Artesian water fountains - good flow
			TOTEM: 0.9, // Modern totem fountains
			ARCEAU: 0.7, // Arch-style fountains
			POINT_EAU: 0.6, // Basic water points
		}

		// Check for specific models that might indicate better cooling
		if (modele && modele.toLowerCase().includes("brumisateur")) {
			return 2.0 // Misting fountains provide excellent cooling
		}

		return coolingMap[typeObjet] || 1.0 // Default cooling effect
	}

	/**
	 * Determine effective range based on fountain type
	 */
	getEffectiveRange(typeObjet, coolingEffect) {
		const baseRange = 25 // meters

		// Larger fountains have wider cooling effect
		if (coolingEffect >= 1.5) return 40
		if (coolingEffect >= 1.2) return 30
		if (coolingEffect >= 1.0) return 25
		return 20
	}

	/**
	 * Process and insert fountain data
	 */
	async processFountainData(fountainData) {
		const insertQuery = `
            INSERT INTO ousposer.fountains (
                gid, type_objet, modele, voie, commune, arrondissement,
                dispo, location, latitude, longitude, cooling_effect, effective_range_m
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (gid) DO UPDATE SET
                type_objet = EXCLUDED.type_objet,
                modele = EXCLUDED.modele,
                voie = EXCLUDED.voie,
                commune = EXCLUDED.commune,
                arrondissement = EXCLUDED.arrondissement,
                dispo = EXCLUDED.dispo,
                location = EXCLUDED.location,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                cooling_effect = EXCLUDED.cooling_effect,
                effective_range_m = EXCLUDED.effective_range_m,
                updated_at = CURRENT_TIMESTAMP
        `

		for (const fountain of fountainData.results) {
			try {
				const { geo_point_2d, gid, type_objet, modele, voie, commune, dispo } =
					fountain

				if (!geo_point_2d || !geo_point_2d.lat || !geo_point_2d.lon) {
					console.warn(`⚠️  Skipping fountain ${gid} - missing coordinates`)
					continue
				}

				const latitude = geo_point_2d.lat
				const longitude = geo_point_2d.lon
				const arrondissement = this.extractArrondissement(commune)
				const coolingEffect = this.getCoolingEffect(type_objet, modele)
				const effectiveRange = this.getEffectiveRange(type_objet, coolingEffect)

				const location = `POINT(${longitude} ${latitude})`

				await this.pool.query(insertQuery, [
					gid,
					type_objet,
					modele,
					voie,
					commune,
					arrondissement,
					dispo,
					location,
					latitude,
					longitude,
					coolingEffect,
					effectiveRange,
				])

				this.processed++

				if (this.processed % 100 === 0) {
					console.log(`🔄 Processed ${this.processed} fountains...`)
				}
			} catch (error) {
				this.errors++
				console.error(
					`❌ Error processing fountain ${fountain.gid}:`,
					error.message
				)
			}
		}
	}

	/**
	 * Generate fountain statistics
	 */
	async generateStats() {
		const statsQuery = `
            SELECT 
                COUNT(*) as total_fountains,
                COUNT(CASE WHEN dispo = 'OUI' THEN 1 END) as available_fountains,
                COUNT(DISTINCT arrondissement) as arrondissements_covered,
                COUNT(DISTINCT type_objet) as fountain_types,
                AVG(cooling_effect) as avg_cooling_effect,
                MIN(cooling_effect) as min_cooling_effect,
                MAX(cooling_effect) as max_cooling_effect,
                AVG(effective_range_m) as avg_effective_range
            FROM ousposer.fountains
        `

		const typeStatsQuery = `
            SELECT 
                type_objet,
                COUNT(*) as count,
                AVG(cooling_effect) as avg_cooling_effect,
                AVG(effective_range_m) as avg_range
            FROM ousposer.fountains
            WHERE dispo = 'OUI'
            GROUP BY type_objet
            ORDER BY count DESC
        `

		const [generalStats, typeStats] = await Promise.all([
			this.pool.query(statsQuery),
			this.pool.query(typeStatsQuery),
		])

		return {
			general: generalStats.rows[0],
			by_type: typeStats.rows,
		}
	}

	/**
	 * Main processing function
	 */
	async processFountains() {
		console.log("🚰 Starting fountain data processing...")

		try {
			// Create table
			await this.createFountainsTable()

			// Load fountain data
			const dataPath = path.join(
				__dirname,
				"../../data/fontaines-a-boire-full.json"
			)
			if (!fs.existsSync(dataPath)) {
				throw new Error(`Fountain data file not found: ${dataPath}`)
			}

			const fountainData = JSON.parse(fs.readFileSync(dataPath, "utf8"))

			// Handle different data formats
			let fountains
			if (Array.isArray(fountainData)) {
				// Full dataset is a direct array
				fountains = fountainData
			} else if (fountainData.results) {
				// Sample dataset has results property
				fountains = fountainData.results
			} else {
				throw new Error("Unknown fountain data format")
			}

			console.log(`📊 Loaded ${fountains.length} fountains from dataset`)

			// Process data
			await this.processFountainData({ results: fountains })

			// Generate statistics
			const stats = await this.generateStats()

			console.log("\n✅ Fountain processing complete!")
			console.log(`📊 Processed: ${this.processed} fountains`)
			console.log(`❌ Errors: ${this.errors}`)
			console.log(
				`💧 Available fountains: ${stats.general.available_fountains}/${stats.general.total_fountains}`
			)
			console.log(
				`🗺️  Arrondissements covered: ${stats.general.arrondissements_covered}/20`
			)
			console.log(
				`🌡️  Average cooling effect: ${parseFloat(
					stats.general.avg_cooling_effect
				).toFixed(2)}`
			)
			console.log(
				`📏 Average effective range: ${Math.round(
					stats.general.avg_effective_range
				)}m`
			)

			console.log("\n📈 Fountain types:")
			stats.by_type.forEach((type) => {
				console.log(
					`   ${type.type_objet}: ${
						type.count
					} fountains (cooling: ${parseFloat(type.avg_cooling_effect).toFixed(
						1
					)}, range: ${Math.round(type.avg_range)}m)`
				)
			})
		} catch (error) {
			console.error("❌ Fountain processing failed:", error)
		} finally {
			await this.pool.end()
		}
	}
}

// Run if called directly
if (require.main === module) {
	const processor = new FountainProcessor()
	processor.processFountains()
}

module.exports = { FountainProcessor }
