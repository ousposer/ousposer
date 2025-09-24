// Centralized thresholds and config for detection

const CONFIG = {
	// General tolerances (meters)
	toleranceMeters: 0.1, // 10 cm adjacency at endpoints
	maxBenchComponents: 6,

	// Canonicals and tight tolerances (target ≈2%) - VALIDATED from 285 manual examples
	// Canonical dimensions are for oriented envelope of benches
	singleBench: {
		// 7-point benches (14 examples, most common single-component type)
		lengthCanonicalMeters: 2.32, // 2.32m ± 0.046m (2% tolerance)
		widthCanonicalMeters: 1.6, // 1.60m ± 0.032m (2% tolerance)
		// 5-point benches (6 examples, alternative single-component type)
		lengthCanonicalMeters5Point: 2.98, // 2.98m ± 0.060m (2% tolerance)
		widthCanonicalMeters5Point: 1.69, // 1.69m ± 0.034m (2% tolerance)
		// Legacy fallback window (used only if envelope detection fails)
		lengthMin: 5.0,
		lengthMax: 10.0,
		minPointCount: 5, // Accept both 5 and 7 point benches
		// Tight ratio tolerance for length/width comparisons
		similarityToleranceRatio: 0.02,
	},

	// Multi-component bench piece constraints - VALIDATED from 61 multi-component examples
	multiPiece: {
		lengthMin: 0.5, // 2-point components can be short line segments
		lengthMax: 8.0, // Accommodate longer components
		// Rectangle validation tolerances (tightened)
		parallelAngleToleranceDeg: 4,
		orthogonalAngleToleranceDeg: 5,
		lengthSimilarityToleranceRatio: 0.02, // 2%
	},

	// Backrest offset band (meters) - VALIDATED from manual examples
	backrest: {
		offsetMinMeters: 0.25,
		offsetMaxMeters: 0.4,
		straightnessMin: 0.98, // endpoints distance / total_length_m
		angleParallelToleranceDeg: 4,
	},

	// Clustering: DBSCAN epsilon in meters - VALIDATED from spatial analysis
	cluster: {
		epsMeters: 3.5, // For 4/5/6-component benches (max distance ~3.3m)
		twoComponentEpsMeters: 0.13, // For 2-component benches (very close, ~0.10m)
		minPoints: 1, // Each component is a potential cluster seed
	},

	// Poubelle (trash bin) constraints - VALIDATED (73-point circular pattern)
	poubelle: {
		aspectRatioMin: 0.95,
		pointCountMin: 70,
		pointCountExact: 73, // Most reliable indicator
		lengthMin: 2.1,
		lengthMax: 2.4,
	},

	// Exclusion heuristic thresholds for non-bench patterns
	exclusions: {
		// Very square-ish, very dense, long chains of turns: typical jardiniere boxes etc.
		aspectRatioNearSquare: 0.98, // >= this treated as too square-ish
		pointCountHigh: 120,
		angleChangesSumLow: 0.2, // benches usually have moderate rectilinearity; tune with data
		angleChangesSumHigh: 5.0,
	},
}

module.exports = { CONFIG }
