// PostGIS-based detection using ST_DWithin, envelopes, and robust rectangle/backrest validation

const { Client } = require("pg")
const { CONFIG } = require("./config")
const { isValidRectangleFrame } = require("./rectangle-validation")
const { isLikelyNonBenchComponent } = require("./exclusions")

async function queryClient() {
	const { DB_CONFIG } = require("../scripts/setup-postgresql")
	const client = new Client(DB_CONFIG)
	await client.connect()
	return client
}

async function detectPoubellesPG(client, arrondissement) {
	const q = `
	    SELECT objectid, arrondissement, total_length_m, point_count, aspect_ratio,
	           ST_Y(location) AS latitude, ST_X(location) AS longitude
	    FROM ousposer.street_furniture_components
	    WHERE arrondissement = $1
	      AND aspect_ratio > $2
	      AND point_count > $3
	      AND total_length_m BETWEEN $4 AND $5
	  `
	const params = [
		arrondissement,
		CONFIG.poubelle.aspectRatioMin,
		CONFIG.poubelle.pointCountMin,
		CONFIG.poubelle.lengthMin,
		CONFIG.poubelle.lengthMax,
	]
	const { rows } = await client.query(q, params)
	return rows.map((comp) => ({
		type: "poubelle",
		poubelle_id: `poubelle_${arrondissement}_${comp.objectid}`,
		component_id: comp.objectid,
		arrondissement,
		total_length_m: comp.total_length_m,
		point_count: comp.point_count,
		aspect_ratio: comp.aspect_ratio,
		location: { latitude: comp.latitude, longitude: comp.longitude },
		detection_method: "pg_geometric_characteristics",
		detection_confidence: 0.95,
	}))
}

// Compute oriented envelope long/short sides for a single component
async function getEnvelopeForComponent(client, objectid) {
	const q = `
	  WITH env AS (
	    SELECT ST_OrientedEnvelope(shape) AS e
	    FROM ousposer.street_furniture_components WHERE objectid = $1
	  ), ring AS (
	    SELECT ST_ExteriorRing(e) AS r FROM env
	  ), pts AS (
	    SELECT ST_PointN(r,1) p1, ST_PointN(r,2) p2, ST_PointN(r,3) p3, ST_PointN(r,4) p4 FROM ring
	  )
	  SELECT
	    ST_Length(ST_MakeLine(p1,p2)::geography) s1,
	    ST_Length(ST_MakeLine(p2,p3)::geography) s2,
	    ST_Length(ST_MakeLine(p3,p4)::geography) s3,
	    ST_Length(ST_MakeLine(p4,p1)::geography) s4
	  FROM pts
	`
	const { rows } = await client.query(q, [objectid])
	if (!rows.length) return null
	const { s1, s2, s3, s4 } = rows[0]
	const sides = [s1, s2, s3, s4].map(Number).sort((a, b) => a - b)
	return { env_short: sides[0], env_long: sides[3] }
}

async function detectSingleBenchesPG(client, arrondissement) {
	// Prefer envelope-based tight detection if canonical dimensions are calibrated
	const useCanon =
		Number.isFinite(CONFIG.singleBench.lengthCanonicalMeters) &&
		Number.isFinite(CONFIG.singleBench.widthCanonicalMeters)

	if (useCanon) {
		const tol = CONFIG.singleBench.similarityToleranceRatio
		const L = CONFIG.singleBench.lengthCanonicalMeters
		const W = CONFIG.singleBench.widthCanonicalMeters
		const q = `
		  WITH comps AS (
		    SELECT objectid, arrondissement,
		           ST_Y(location) AS latitude, ST_X(location) AS longitude,
		           point_count
		    FROM ousposer.street_furniture_components
		    WHERE arrondissement = $1 AND point_count >= $2
		  ), env AS (
		    SELECT c.objectid, c.arrondissement, c.latitude, c.longitude, c.point_count,
		           ST_OrientedEnvelope(s.shape) AS e
		    FROM comps c JOIN ousposer.street_furniture_components s USING(objectid)
		  ), ring AS (
		    SELECT objectid, arrondissement, latitude, longitude, point_count,
		           ST_ExteriorRing(e) AS r
		    FROM env
		  ), sides AS (
		    SELECT objectid, arrondissement, latitude, longitude, point_count,
		           ST_Length(ST_MakeLine(ST_PointN(r,1), ST_PointN(r,2))::geography) s1,
		           ST_Length(ST_MakeLine(ST_PointN(r,2), ST_PointN(r,3))::geography) s2,
		           ST_Length(ST_MakeLine(ST_PointN(r,3), ST_PointN(r,4))::geography) s3,
		           ST_Length(ST_MakeLine(ST_PointN(r,4), ST_PointN(r,1))::geography) s4
		    FROM ring
		  )
		  SELECT objectid, arrondissement, latitude, longitude, point_count,
		         GREATEST(s1,s2,s3,s4) AS env_long,
		         LEAST(s1,s2,s3,s4) AS env_short
		  FROM sides
		`
		const { rows } = await client.query(q, [
			arrondissement,
			CONFIG.singleBench.minPointCount,
		])
		const benches = []
		for (const r of rows) {
			const long = Number(r.env_long)
			const short = Number(r.env_short)
			if (Math.abs(long - L) <= tol * L && Math.abs(short - W) <= tol * W) {
				benches.push({
					bench_id: `bench_${arrondissement}_${r.objectid}`,
					bench_type: "single-component",
					components: [r.objectid],
					total_components: 1,
					location: { latitude: r.latitude, longitude: r.longitude },
					arrondissement,
					detection_method: "pg_single_component_envelope_canonical",
					detection_confidence: 0.98,
					envelope_length_m: long,
					envelope_width_m: short,
				})
			}
		}
		return benches
	} else {
		// Fallback to previous length-based heuristic if canonicals not calibrated yet
		const q = `
		    SELECT objectid, arrondissement, total_length_m, point_count,
		           ST_Y(location) AS latitude, ST_X(location) AS longitude
		    FROM ousposer.street_furniture_components
		    WHERE arrondissement = $1
		      AND total_length_m BETWEEN $2 AND $3
		      AND point_count >= $4
		  `
		const p = [
			arrondissement,
			CONFIG.singleBench.lengthMin,
			CONFIG.singleBench.lengthMax,
			CONFIG.singleBench.minPointCount,
		]
		const { rows } = await client.query(q, p)
		return rows.map((comp) => ({
			bench_id: `bench_${arrondissement}_${comp.objectid}`,
			bench_type: "single-component",
			components: [comp.objectid],
			total_components: 1,
			total_length_m: comp.total_length_m,
			location: { latitude: comp.latitude, longitude: comp.longitude },
			arrondissement,
			detection_method: "pg_single_component_length",
			detection_confidence: 0.9,
		}))
	}
}

async function getCandidateComponentsPG(
	client,
	arrondissement,
	excludedIds = []
) {
	const q = `
	    SELECT objectid, arrondissement, total_length_m, point_count,
	           ST_Y(location) AS latitude, ST_X(location) AS longitude,
	           ST_AsGeoJSON(shape) AS geometry
	    FROM ousposer.street_furniture_components
	    WHERE arrondissement = $1
	      AND total_length_m BETWEEN $2 AND $3
	      AND ($4::int[] IS NULL OR NOT objectid = ANY($4))
	  `
	const { rows } = await client.query(q, [
		arrondissement,
		CONFIG.multiPiece.lengthMin,
		CONFIG.multiPiece.lengthMax,
		excludedIds?.length ? excludedIds : null,
	])
	return rows.filter((comp) => !isLikelyNonBenchComponent(comp))
}

// Check if two components form a (frame + backrest) 2-component bench
async function detectTwoComponentBenchPG(client, arrondissement, idA, idB) {
	const tolRatio = CONFIG.multiPiece.lengthSimilarityToleranceRatio
	const offMin = CONFIG.backrest.offsetMinMeters
	const offMax = CONFIG.backrest.offsetMaxMeters
	const angTol = CONFIG.backrest.angleParallelToleranceDeg
	const straightMin = CONFIG.backrest.straightnessMin
	const q = `
	WITH a AS (
	  SELECT objectid, shape FROM ousposer.street_furniture_components WHERE objectid = $1 AND arrondissement = $3
	), b AS (
	  SELECT objectid, shape FROM ousposer.street_furniture_components WHERE objectid = $2 AND arrondissement = $3
	), parts AS (
	  SELECT * FROM a UNION ALL SELECT * FROM b
	), closed AS (
	  SELECT objectid, shape FROM parts WHERE ST_IsClosed(shape) LIMIT 1
	), inner_line AS (
	  SELECT objectid, shape FROM parts WHERE NOT ST_IsClosed(shape) LIMIT 1
	), env AS (
	  SELECT ST_OrientedEnvelope(shape) AS e FROM closed
	), ring AS (
	  SELECT ST_ExteriorRing(e) AS r FROM env
	), pts AS (
	  SELECT ST_PointN(r,1) p1, ST_PointN(r,2) p2, ST_PointN(r,3) p3, ST_PointN(r,4) p4 FROM ring
	), sides AS (
	  SELECT 
	    ST_MakeLine(p1,p2) s12, ST_Length(ST_MakeLine(p1,p2)::geography) l12,
	    ST_MakeLine(p2,p3) s23, ST_Length(ST_MakeLine(p2,p3)::geography) l23,
	    ST_MakeLine(p3,p4) s34, ST_Length(ST_MakeLine(p3,p4)::geography) l34,
	    ST_MakeLine(p4,p1) s41, ST_Length(ST_MakeLine(p4,p1)::geography) l41
	  FROM pts
	), long_short AS (
	  SELECT
	    CASE WHEN l12>=l23 AND l12>=l34 AND l12>=l41 THEN s12
	         WHEN l23>=l12 AND l23>=l34 AND l23>=l41 THEN s23
	         WHEN l34>=l12 AND l34>=l23 AND l34>=l41 THEN s34
	         ELSE s41 END AS long1,
	    CASE WHEN (l12>=l23 AND l12>=l34 AND l12>=l41) THEN GREATEST(l12, GREATEST(GREATEST(l23,l34),l41))
	         WHEN (l23>=l12 AND l23>=l34 AND l23>=l41) THEN GREATEST(l23, GREATEST(GREATEST(l12,l34),l41))
	         WHEN (l34>=l12 AND l34>=l23 AND l34>=l41) THEN GREATEST(l34, GREATEST(GREATEST(l12,l23),l41))
	         ELSE GREATEST(l41, GREATEST(GREATEST(l12,l23),l34)) END AS long_len,
	    CASE WHEN l12<=l23 AND l12<=l34 AND l12<=l41 THEN l12
	         WHEN l23<=l12 AND l23<=l34 AND l23<=l41 THEN l23
	         WHEN l34<=l12 AND l34<=l23 AND l34<=l41 THEN l34
	         ELSE l41 END AS short_len,
	    -- second long side (opposite)
	    CASE WHEN l12>=l23 AND l12>=l34 AND l12>=l41 THEN s34
	         WHEN l23>=l12 AND l23>=l34 AND l23>=l41 THEN s41
	         WHEN l34>=l12 AND l34>=l23 AND l34>=l41 THEN s12
	         ELSE s23 END AS long2
	  FROM sides
	), inner_metrics AS (
	  SELECT 
	    ST_Length(i.shape::geography) AS inner_len,
	    -- straightness
	    CASE WHEN ST_Length(i.shape::geography)>0 THEN ST_Distance(ST_StartPoint(i.shape)::geography, ST_EndPoint(i.shape)::geography) / ST_Length(i.shape::geography) ELSE 0 END AS straightness,
	    -- angles vs long sides
	    DEGREES(ST_Azimuth(ST_StartPoint(i.shape), ST_EndPoint(i.shape))) AS inner_ang,
	    DEGREES(ST_Azimuth(ST_StartPoint(ls1.long1), ST_EndPoint(ls1.long1))) AS long1_ang,
	    DEGREES(ST_Azimuth(ST_StartPoint(ls1.long2), ST_EndPoint(ls1.long2))) AS long2_ang,
	    ls1.long_len AS long_len,
	    ls1.short_len AS short_len,
	    -- distances (meters) to long sides
	    ST_Distance(i.shape::geography, ls1.long1::geography) AS d1,
	    ST_Distance(i.shape::geography, ls1.long2::geography) AS d2
	  FROM inner_line i CROSS JOIN long_short ls1
	)
	SELECT 
	  inner_len, straightness, long_len, short_len,
	  LEAST(ABS(inner_ang - long1_ang), ABS(inner_ang - long2_ang)) AS ang_diff_deg,
	  LEAST(d1, d2) AS offset_m
	FROM inner_metrics
	`
	const { rows } = await client.query(q, [idA, idB, arrondissement])
	if (!rows.length) return null
	const r = rows[0]
	const angDiff = Math.min(
		Number(r.ang_diff_deg),
		Math.abs(Number(r.ang_diff_deg) - 180)
	)
	const pass =
		Number(r.straightness) >= straightMin &&
		angDiff <= angTol &&
		Math.abs(Number(r.inner_len) - Number(r.long_len)) <=
			tolRatio * Number(r.long_len) &&
		Number(r.offset_m) >= offMin &&
		Number(r.offset_m) <= offMax
	if (!pass) return null
	return {
		bench_type: "2-component",
		envelope_length_m: Number(r.long_len),
		envelope_width_m: Number(r.short_len),
		offset_m: Number(r.offset_m),
		angle_diff_deg: angDiff,
		detection_method: "pg_two_component_frame_backrest",
		detection_confidence: 0.96,
	}
}

// DBSCAN clusters helper (top-level)
async function getClustersPG(client, arrondissement, excludedIds = []) {
	const eps = CONFIG.cluster.epsMeters || CONFIG.toleranceMeters
	const q = `
	  WITH base AS (
	    SELECT objectid, shape
	    FROM ousposer.street_furniture_components
	    WHERE arrondissement = $1
	      AND total_length_m BETWEEN $2 AND $3
	      AND ($4::int[] IS NULL OR NOT objectid = ANY($4))
	  ), clusters AS (
	    SELECT objectid,
	           ST_ClusterDBSCAN(ST_Transform(shape, 2154), eps := $5, minpoints := 1) OVER () AS cid
	    FROM base
	  )
	  SELECT cid, array_agg(objectid ORDER BY objectid) AS ids
	  FROM clusters
	  GROUP BY cid
	`
	const { rows } = await client.query(q, [
		arrondissement,
		CONFIG.multiPiece.lengthMin,
		CONFIG.multiPiece.lengthMax,
		excludedIds?.length ? excludedIds : null,
		eps,
	])
	return rows.map((r) => r.ids)
}

// Validate backrest inner lines for a given 4-piece frame using PostGIS
async function checkBackrestsForFramePG(
	client,
	arrondissement,
	frameIds,
	innerIds
) {
	if (!innerIds || innerIds.length === 0) return []
	const tolRatio = CONFIG.multiPiece.lengthSimilarityToleranceRatio
	const offMin = CONFIG.backrest.offsetMinMeters
	const offMax = CONFIG.backrest.offsetMaxMeters
	const angTol = CONFIG.backrest.angleParallelToleranceDeg
	const straightMin = CONFIG.backrest.straightnessMin
	const q = `
	WITH frame AS (
	  SELECT shape FROM ousposer.street_furniture_components WHERE arrondissement=$1 AND objectid = ANY($2)
	), env AS (
	  SELECT ST_OrientedEnvelope(ST_Collect(shape)) AS e FROM frame
	), ring AS (
	  SELECT ST_ExteriorRing(e) AS r FROM env
	), pts AS (
	  SELECT ST_PointN(r,1) p1, ST_PointN(r,2) p2, ST_PointN(r,3) p3, ST_PointN(r,4) p4 FROM ring
	), sides AS (
	  SELECT
	    ST_MakeLine(p1,p2) s12, ST_Length(ST_MakeLine(p1,p2)::geography) l12,
	    ST_MakeLine(p2,p3) s23, ST_Length(ST_MakeLine(p2,p3)::geography) l23,
	    ST_MakeLine(p3,p4) s34, ST_Length(ST_MakeLine(p3,p4)::geography) l34,
	    ST_MakeLine(p4,p1) s41, ST_Length(ST_MakeLine(p4,p1)::geography) l41
	  FROM pts
	), long_short AS (
	  SELECT
	    CASE WHEN l12>=l23 AND l12>=l34 AND l12>=l41 THEN s12
	         WHEN l23>=l12 AND l23>=l34 AND l23>=l41 THEN s23
	         WHEN l34>=l12 AND l34>=l23 AND l34>=l41 THEN s34
	         ELSE s41 END AS long1,
	    CASE WHEN l12>=l23 AND l12>=l34 AND l12>=l41 THEN s34
	         WHEN l23>=l12 AND l23>=l34 AND l23>=l41 THEN s41
	         WHEN l34>=l12 AND l34>=l23 AND l34>=l41 THEN s12
	         ELSE s23 END AS long2,
	    GREATEST(l12,l23,l34,l41) AS long_len
	  FROM sides
	), inners AS (
	  SELECT objectid, shape FROM ousposer.street_furniture_components WHERE arrondissement=$1 AND objectid = ANY($3)
	), metrics AS (
	  SELECT i.objectid,
	    ST_Length(i.shape::geography) AS inner_len,
	    CASE WHEN ST_Length(i.shape::geography)>0 THEN ST_Distance(ST_StartPoint(i.shape)::geography, ST_EndPoint(i.shape)::geography) / ST_Length(i.shape::geography) ELSE 0 END AS straightness,
	    DEGREES(ST_Azimuth(ST_StartPoint(i.shape), ST_EndPoint(i.shape))) AS inner_ang,
	    DEGREES(ST_Azimuth(ST_StartPoint(ls.long1), ST_EndPoint(ls.long1))) AS long1_ang,
	    DEGREES(ST_Azimuth(ST_StartPoint(ls.long2), ST_EndPoint(ls.long2))) AS long2_ang,
	    ls.long_len AS long_len,
	    ST_Distance(i.shape::geography, ls.long1::geography) AS d1,
	    ST_Distance(i.shape::geography, ls.long2::geography) AS d2
	  FROM inners i CROSS JOIN long_short ls
	)
	SELECT objectid,
	  inner_len, straightness,
	  LEAST(ABS(inner_ang - long1_ang), ABS(inner_ang - long2_ang)) AS ang_diff_deg,
	  long_len,
	  LEAST(d1, d2) AS offset_m
	FROM metrics
	`
	const { rows } = await client.query(q, [arrondissement, frameIds, innerIds])
	return rows.filter((r) => {
		const angDiff = Math.min(
			Number(r.ang_diff_deg),
			Math.abs(Number(r.ang_diff_deg) - 180)
		)
		return (
			Number(r.straightness) >= straightMin &&
			angDiff <= angTol &&
			Math.abs(Number(r.inner_len) - Number(r.long_len)) <=
				tolRatio * Number(r.long_len) &&
			Number(r.offset_m) >= offMin &&
			Number(r.offset_m) <= offMax
		)
	})
}

// Minimal neighbor helper (kept for legacy callers)
async function findNeighborsPG(client, arr, compId, tolerance) {
	const q = `
    SELECT DISTINCT other.objectid
    FROM ousposer.street_furniture_components AS base
    JOIN ousposer.street_furniture_components AS other
      ON other.objectid != base.objectid
    WHERE base.objectid = $1 AND base.arrondissement = $2 AND other.arrondissement = $2
      AND ST_DWithin(base.shape, other.shape, $3)
  `
	const { rows } = await client.query(q, [compId, arr, tolerance])
	return rows.map((r) => r.objectid)
}

async function detectMultiBenchesPG(client, arrondissement, excludedIds = []) {
	const candidates = await getCandidateComponentsPG(
		client,
		arrondissement,
		excludedIds
	)
	const candidateById = new Map(candidates.map((c) => [c.objectid, c]))

	const benches = []
	const clusters = await getClustersPG(client, arrondissement, excludedIds)

	// helper to generate all combinations of 4 from an array (cap to first few if huge)
	function* combos4(arr) {
		const n = arr.length
		for (let i = 0; i < n - 3; i++)
			for (let j = i + 1; j < n - 2; j++)
				for (let k = j + 1; k < n - 1; k++)
					for (let l = k + 1; l < n; l++) yield [arr[i], arr[j], arr[k], arr[l]]
	}

	for (const ids of clusters) {
		const cluster = ids
			.map((id) => candidateById.get(id))
			.filter(Boolean)
			.slice(0, CONFIG.maxBenchComponents) // cap
		if (cluster.length === 0) continue

		if (cluster.length === 2) {
			const [a, b] = cluster
			const two = await detectTwoComponentBenchPG(
				client,
				arrondissement,
				a.objectid,
				b.objectid
			)
			if (two) {
				benches.push({
					bench_id: `bench_${arrondissement}_2c_${a.objectid}_${b.objectid}`,
					bench_type: two.bench_type,
					components: [a.objectid, b.objectid],
					total_components: 2,
					location: { latitude: a.latitude, longitude: a.longitude },
					arrondissement,
					detection_method: two.detection_method,
					detection_confidence: two.detection_confidence,
					envelope_length_m: two.envelope_length_m,
					envelope_width_m: two.envelope_width_m,
					offset_m: two.offset_m,
					angle_diff_deg: two.angle_diff_deg,
				})
			}
			continue
		}

		if (cluster.length >= 4) {
			let frame = null
			for (const c4 of combos4(cluster)) {
				if (isValidRectangleFrame(c4)) {
					frame = c4
					break
				}
			}
			if (!frame) continue
			const frameIds = frame.map((c) => c.objectid)
			const others = cluster.filter((c) => !frameIds.includes(c.objectid))

			if (others.length === 0) {
				benches.push({
					bench_id: `bench_${arrondissement}_rect_${frameIds.join("_")}`,
					bench_type: "4-component-rectangle",
					components: frameIds,
					total_components: 4,
					location: {
						latitude: frame[0].latitude,
						longitude: frame[0].longitude,
					},
					arrondissement,
					detection_method: "pg_rectangle_validation",
					detection_confidence: 0.9,
				})
				continue
			}

			// Validate backrest lines among remaining components
			const validBackrests = await checkBackrestsForFramePG(
				client,
				arrondissement,
				frameIds,
				others.map((o) => o.objectid)
			)
			if (validBackrests.length === 1) {
				benches.push({
					bench_id: `bench_${arrondissement}_5c_${frameIds.join("_")}_${others
						.map((o) => o.objectid)
						.join("_")}`,
					bench_type: "5-component",
					components: [...frameIds, validBackrests[0].objectid],
					total_components: 5,
					location: {
						latitude: frame[0].latitude,
						longitude: frame[0].longitude,
					},
					arrondissement,
					detection_method: "pg_rect_with_backrest",
					detection_confidence: 0.8,
				})
			} else if (validBackrests.length >= 2) {
				const ids2 = validBackrests.slice(0, 2).map((r) => r.objectid)
				benches.push({
					bench_id: `bench_${arrondissement}_6c_${frameIds.join(
						"_"
					)}_${ids2.join("_")}`,
					bench_type: "6-component",
					components: [...frameIds, ...ids2],
					total_components: 6,
					location: {
						latitude: frame[0].latitude,
						longitude: frame[0].longitude,
					},
					arrondissement,
					detection_method: "pg_rect_with_2_backrests",
					detection_confidence: 0.9,
				})
			}
		}
	}

	return benches
}

async function detectArrondissementPG(arrondissement) {
	const client = await queryClient()
	try {
		const poubelles = await detectPoubellesPG(client, arrondissement)

		// Exclude poubelle components up-front from bench candidates if desired
		const excludeIds = poubelles.map((p) => p.component_id)

		const singleBenches = await detectSingleBenchesPG(client, arrondissement)
		const singleIds = singleBenches.flatMap((b) => b.components)

		const multiBenches = await detectMultiBenchesPG(client, arrondissement, [
			...excludeIds,
			...singleIds,
		])

		return {
			arrondissement,
			benches: [...singleBenches, ...multiBenches],
			poubelles,
		}
	} finally {
		await client.end()
	}
}

module.exports = {
	detectArrondissementPG,
	detectPoubellesPG,
	detectSingleBenchesPG,
	detectMultiBenchesPG,
	detectTwoComponentBenchPG,
	getCandidateComponentsPG,
	getEnvelopeForComponent,
	getClustersPG,
	checkBackrestsForFramePG,
	findNeighborsPG,
	queryClient,
}
