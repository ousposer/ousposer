#!/usr/bin/env node
/**
 * Enhanced Detection Pipeline for OusPoser
 * Implements validated patterns from bench analysis for 95%+ accuracy
 */

const { Pool } = require("pg")
const { CONFIG } = require("./config.js")

// Database connection
const pool = new Pool({
	user: process.env.DB_USER || "postgres",
	host: process.env.DB_HOST || "localhost",
	database: process.env.DB_NAME || "ousposer",
	password: process.env.DB_PASSWORD || "",
	port: process.env.DB_PORT || 5432,
})

/**
 * Phase 1: High-Confidence Single Component Detection (95-98% confidence)
 * Based on validated envelope dimensions with 2% tolerance
 */
async function detectSingleComponentBenches(client, arrondissement) {
	console.log(
		`🎯 Phase 1: Detecting single-component benches in arrondissement ${arrondissement}`
	)

	const benches = []

	// 7-point benches (most reliable - 98% confidence)
	const query7Point = `
        WITH envelope_analysis AS (
            SELECT
                objectid,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                point_count,
                total_length_m,
                ST_Length(ST_Transform(ST_ExteriorRing(ST_OrientedEnvelope(ST_Transform(shape, 2154))), 2154)) as envelope_perimeter,
                ST_Area(ST_OrientedEnvelope(ST_Transform(shape, 2154))) as envelope_area
            FROM ousposer.street_furniture_components
            WHERE arrondissement = $1
              AND point_count = 7
        ),
        envelope_dimensions AS (
            SELECT *,
                -- Calculate envelope length and width from perimeter and area
                -- For rectangle: perimeter = 2(l+w), area = l*w
                -- Solve: l = (perimeter + sqrt(perimeter^2 - 16*area)) / 4
                (envelope_perimeter + sqrt(envelope_perimeter^2 - 16*envelope_area)) / 4 as envelope_length_m,
                (envelope_perimeter - sqrt(envelope_perimeter^2 - 16*envelope_area)) / 4 as envelope_width_m
            FROM envelope_analysis
            WHERE envelope_perimeter^2 - 16*envelope_area > 0  -- Valid rectangle
        )
        SELECT *
        FROM envelope_dimensions
        WHERE envelope_length_m BETWEEN $2 AND $3
          AND envelope_width_m BETWEEN $4 AND $5
          AND total_length_m BETWEEN $6 AND $7
    `

	const canonical7 = CONFIG.singleBench
	const length7Tolerance =
		canonical7.lengthCanonicalMeters * canonical7.similarityToleranceRatio
	const width7Tolerance =
		canonical7.widthCanonicalMeters * canonical7.similarityToleranceRatio

	const result7Point = await client.query(query7Point, [
		arrondissement,
		canonical7.lengthCanonicalMeters - length7Tolerance, // 2.32 - 0.046 = 2.274
		canonical7.lengthCanonicalMeters + length7Tolerance, // 2.32 + 0.046 = 2.366
		canonical7.widthCanonicalMeters - width7Tolerance, // 1.60 - 0.032 = 1.568
		canonical7.widthCanonicalMeters + width7Tolerance, // 1.60 + 0.032 = 1.632
		CONFIG.singleBench.lengthMin, // 5.0
		CONFIG.singleBench.lengthMax, // 10.0
	])

	for (const row of result7Point.rows) {
		benches.push({
			bench_id: `bench_${arrondissement}_single7_${row.objectid}`,
			bench_type: "single-7-point",
			arrondissement,
			location: `POINT(${row.longitude} ${row.latitude})`,
			total_components: 1,
			envelope_length_m: row.envelope_length_m,
			envelope_width_m: row.envelope_width_m,
			total_length_m: row.total_length_m,
			component_ids: [row.objectid],
			detection_method: "envelope_7point_canonical",
			detection_confidence: 0.98,
		})
	}

	// 5-point benches (95% confidence)
	const query5Point = query7Point.replace("point_count = 7", "point_count = 5")

	const canonical5 = {
		lengthCanonicalMeters: CONFIG.singleBench.lengthCanonicalMeters5Point,
		widthCanonicalMeters: CONFIG.singleBench.widthCanonicalMeters5Point,
		similarityToleranceRatio: CONFIG.singleBench.similarityToleranceRatio,
	}
	const length5Tolerance =
		canonical5.lengthCanonicalMeters * canonical5.similarityToleranceRatio
	const width5Tolerance =
		canonical5.widthCanonicalMeters * canonical5.similarityToleranceRatio

	const result5Point = await client.query(query5Point, [
		arrondissement,
		canonical5.lengthCanonicalMeters - length5Tolerance, // 2.98 - 0.060 = 2.920
		canonical5.lengthCanonicalMeters + length5Tolerance, // 2.98 + 0.060 = 3.040
		canonical5.widthCanonicalMeters - width5Tolerance, // 1.69 - 0.034 = 1.656
		canonical5.widthCanonicalMeters + width5Tolerance, // 1.69 + 0.034 = 1.724
		CONFIG.singleBench.lengthMin, // 5.0
		CONFIG.singleBench.lengthMax, // 10.0
	])

	for (const row of result5Point.rows) {
		benches.push({
			bench_id: `bench_${arrondissement}_single5_${row.objectid}`,
			bench_type: "single-5-point",
			arrondissement,
			location: `POINT(${row.longitude} ${row.latitude})`,
			total_components: 1,
			envelope_length_m: row.envelope_length_m,
			envelope_width_m: row.envelope_width_m,
			total_length_m: row.total_length_m,
			component_ids: [row.objectid],
			detection_method: "envelope_5point_canonical",
			detection_confidence: 0.95,
		})
	}

	console.log(
		`  ✅ Found ${result7Point.rows.length} 7-point benches (98% confidence)`
	)
	console.log(
		`  ✅ Found ${result5Point.rows.length} 5-point benches (95% confidence)`
	)

	return benches
}

/**
 * Phase 2: Two-Component Frame+Backrest Detection (96% confidence)
 * Based on validated [2,5] pattern with tight 0.13m clustering
 */
async function detectTwoComponentBenches(
	client,
	arrondissement,
	excludedIds = []
) {
	console.log(
		`🎯 Phase 2: Detecting two-component benches in arrondissement ${arrondissement}`
	)

	const benches = []
	const eps = CONFIG.cluster.twoComponentEpsMeters // 0.13m

	const query = `
        WITH base AS (
            SELECT
                objectid,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                point_count,
                total_length_m,
                ST_Transform(shape, 2154) as shape_projected
            FROM ousposer.street_furniture_components
            WHERE arrondissement = $1
              AND point_count IN (2, 5)
              AND total_length_m BETWEEN $2 AND $3
              AND ($4::int[] IS NULL OR NOT objectid = ANY($4))
        ),
        clusters AS (
            SELECT 
                objectid,
                point_count,
                longitude,
                latitude,
                total_length_m,
                ST_ClusterDBSCAN(shape_projected, eps := $5, minpoints := 1) OVER () AS cluster_id
            FROM base
        ),
        cluster_summary AS (
            SELECT 
                cluster_id,
                array_agg(objectid ORDER BY objectid) as component_ids,
                array_agg(point_count ORDER BY objectid) as point_counts,
                COUNT(*) as component_count,
                AVG(longitude) as center_longitude,
                AVG(latitude) as center_latitude,
                SUM(total_length_m) as total_length_m
            FROM clusters
            WHERE cluster_id IS NOT NULL
            GROUP BY cluster_id
        )
        SELECT *
        FROM cluster_summary
        WHERE component_count = 2
          AND point_counts = ARRAY[2, 5]  -- Exact [2,5] pattern
    `

	const result = await client.query(query, [
		arrondissement,
		CONFIG.multiPiece.lengthMin, // 0.5
		CONFIG.multiPiece.lengthMax, // 8.0
		excludedIds?.length ? excludedIds : null,
		eps,
	])

	for (const row of result.rows) {
		benches.push({
			bench_id: `bench_${arrondissement}_2comp_${row.component_ids.join("_")}`,
			bench_type: "two-component",
			arrondissement,
			location: `POINT(${row.center_longitude} ${row.center_latitude})`,
			total_components: 2,
			envelope_length_m: null, // Will be calculated from components
			envelope_width_m: null,
			total_length_m: row.total_length_m,
			component_ids: row.component_ids,
			detection_method: "dbscan_2comp_pattern",
			detection_confidence: 0.96,
		})
	}

	console.log(
		`  ✅ Found ${result.rows.length} two-component benches (96% confidence)`
	)

	return benches
}

/**
 * Phase 3: Multi-Component Rectangle+Backrests Detection (85-90% confidence)
 * Based on validated 4/5/6-component patterns with 3.5m clustering
 */
async function detectMultiComponentBenches(
	client,
	arrondissement,
	excludedIds = []
) {
	console.log(
		`🎯 Phase 3: Detecting multi-component benches in arrondissement ${arrondissement}`
	)

	const benches = []
	const eps = CONFIG.cluster.epsMeters // 3.5m

	const query = `
        WITH base AS (
            SELECT
                objectid,
                ST_X(location) as longitude,
                ST_Y(location) as latitude,
                point_count,
                total_length_m,
                ST_Transform(shape, 2154) as shape_projected
            FROM ousposer.street_furniture_components
            WHERE arrondissement = $1
              AND point_count = 2  -- All 2-point components
              AND total_length_m BETWEEN $2 AND $3
              AND ($4::int[] IS NULL OR NOT objectid = ANY($4))
        ),
        clusters AS (
            SELECT 
                objectid,
                longitude,
                latitude,
                total_length_m,
                ST_ClusterDBSCAN(shape_projected, eps := $5, minpoints := 1) OVER () AS cluster_id
            FROM base
        ),
        cluster_summary AS (
            SELECT 
                cluster_id,
                array_agg(objectid ORDER BY objectid) as component_ids,
                COUNT(*) as component_count,
                AVG(longitude) as center_longitude,
                AVG(latitude) as center_latitude,
                SUM(total_length_m) as total_length_m
            FROM clusters
            WHERE cluster_id IS NOT NULL
            GROUP BY cluster_id
        )
        SELECT *
        FROM cluster_summary
        WHERE component_count IN (4, 5, 6)  -- Rectangle + 0-2 backrests
    `

	const result = await client.query(query, [
		arrondissement,
		CONFIG.multiPiece.lengthMin, // 0.5
		CONFIG.multiPiece.lengthMax, // 8.0
		excludedIds?.length ? excludedIds : null,
		eps,
	])

	for (const row of result.rows) {
		const benchType = `multi-${row.component_count}-component`
		const confidence =
			row.component_count === 4 ? 0.9 : row.component_count === 6 ? 0.9 : 0.85 // 5-component

		benches.push({
			bench_id: `bench_${arrondissement}_${
				row.component_count
			}comp_${row.component_ids.join("_")}`,
			bench_type: benchType,
			arrondissement,
			location: `POINT(${row.center_longitude} ${row.center_latitude})`,
			total_components: row.component_count,
			envelope_length_m: null, // Will be calculated from components
			envelope_width_m: null,
			total_length_m: row.total_length_m,
			component_ids: row.component_ids,
			detection_method: "dbscan_multicomp_rectangle",
			detection_confidence: confidence,
		})
	}

	console.log(
		`  ✅ Found ${result.rows.length} multi-component benches (85-90% confidence)`
	)

	return benches
}

/**
 * Trash Can Detection (95%+ confidence)
 * Based on validated 73-point circular pattern
 */
async function detectTrashCans(client, arrondissement) {
	console.log(`🗑️ Detecting trash cans in arrondissement ${arrondissement}`)

	const query = `
        SELECT
            objectid,
            ST_X(location) as longitude,
            ST_Y(location) as latitude,
            point_count,
            total_length_m,
            aspect_ratio
        FROM ousposer.street_furniture_components
        WHERE arrondissement = $1
          AND point_count = $2  -- Exactly 73 points
          AND total_length_m BETWEEN $3 AND $4
          AND aspect_ratio >= $5
    `

	const result = await client.query(query, [
		arrondissement,
		CONFIG.poubelle.pointCountExact, // 73
		CONFIG.poubelle.lengthMin, // 2.1
		CONFIG.poubelle.lengthMax, // 2.4
		CONFIG.poubelle.aspectRatioMin, // 0.95
	])

	const trashCans = result.rows.map((row) => ({
		poubelle_id: `poubelle_${arrondissement}_${row.objectid}`,
		arrondissement,
		location: `POINT(${row.longitude} ${row.latitude})`,
		component_id: row.objectid,
		point_count: row.point_count,
		total_length_m: row.total_length_m,
		aspect_ratio: row.aspect_ratio,
		detection_method: "point_count_73_circular",
		detection_confidence: 0.98,
	}))

	console.log(`  ✅ Found ${trashCans.length} trash cans (98% confidence)`)

	return trashCans
}

/**
 * Insert benches into database
 */
async function insertBenches(client, benches) {
	if (benches.length === 0) return

	const query = `
        INSERT INTO benches (
            bench_id, arrondissement, location, bench_type, total_components,
            envelope_length_m, envelope_width_m, total_length_m, component_ids,
            detection_method, detection_confidence
        ) VALUES ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, $7, $8, $9, $10, $11)
    `

	for (const bench of benches) {
		await client.query(query, [
			bench.bench_id,
			bench.arrondissement,
			bench.location,
			bench.bench_type,
			bench.total_components,
			bench.envelope_length_m,
			bench.envelope_width_m,
			bench.total_length_m,
			bench.component_ids,
			bench.detection_method,
			bench.detection_confidence,
		])
	}

	console.log(`  💾 Inserted ${benches.length} benches into database`)
}

/**
 * Insert trash cans into database
 */
async function insertTrashCans(client, trashCans) {
	if (trashCans.length === 0) return

	const query = `
        INSERT INTO poubelles (
            poubelle_id, arrondissement, location, component_id, point_count,
            total_length_m, aspect_ratio, detection_method, detection_confidence
        ) VALUES ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, $7, $8, $9)
    `

	for (const trashCan of trashCans) {
		await client.query(query, [
			trashCan.poubelle_id,
			trashCan.arrondissement,
			trashCan.location,
			trashCan.component_id,
			trashCan.point_count,
			trashCan.total_length_m,
			trashCan.aspect_ratio,
			trashCan.detection_method,
			trashCan.detection_confidence,
		])
	}

	console.log(`  💾 Inserted ${trashCans.length} trash cans into database`)
}

/**
 * Main detection pipeline for a single arrondissement
 */
async function detectArrondissement(arrondissement) {
	const client = await pool.connect()

	try {
		console.log(
			`\n🚀 Starting enhanced detection for arrondissement ${arrondissement}`
		)
		console.log("=" * 60)

		// Phase 1: Trash cans (exclude from bench detection)
		const trashCans = await detectTrashCans(client, arrondissement)
		const excludedIds = trashCans.map((tc) => tc.component_id)

		// Phase 2: Single-component benches (highest confidence)
		const singleBenches = await detectSingleComponentBenches(
			client,
			arrondissement
		)
		const singleIds = singleBenches.flatMap((b) => b.component_ids)

		// Phase 3: Two-component benches
		const twoBenches = await detectTwoComponentBenches(client, arrondissement, [
			...excludedIds,
			...singleIds,
		])
		const twoIds = twoBenches.flatMap((b) => b.component_ids)

		// Phase 4: Multi-component benches
		const multiBenches = await detectMultiComponentBenches(
			client,
			arrondissement,
			[...excludedIds, ...singleIds, ...twoIds]
		)

		// Combine all benches
		const allBenches = [...singleBenches, ...twoBenches, ...multiBenches]

		// Insert into database
		await insertTrashCans(client, trashCans)
		await insertBenches(client, allBenches)

		console.log(`\n📊 Detection Summary for Arrondissement ${arrondissement}:`)
		console.log(`  🗑️ Trash cans: ${trashCans.length}`)
		console.log(`  🪑 Single benches: ${singleBenches.length}`)
		console.log(`  🪑 Two-component benches: ${twoBenches.length}`)
		console.log(`  🪑 Multi-component benches: ${multiBenches.length}`)
		console.log(`  🪑 Total benches: ${allBenches.length}`)

		return {
			arrondissement,
			trashCans: trashCans.length,
			benches: allBenches.length,
			singleBenches: singleBenches.length,
			twoBenches: twoBenches.length,
			multiBenches: multiBenches.length,
		}
	} finally {
		client.release()
	}
}

module.exports = {
	detectSingleComponentBenches,
	detectTwoComponentBenches,
	detectMultiComponentBenches,
	detectTrashCans,
	detectArrondissement,
	insertBenches,
	insertTrashCans,
	pool,
}
