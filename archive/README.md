# 📦 OusPoser Archive

This directory contains legacy files, experimental code, and superseded documentation from the OusPoser project development journey.

## 📁 Archive Structure

### `legacy-detection/`
**Superseded detection algorithms and approaches**

- `citywide-detection.js` - Original SQLite-based detection system
- `strict-classification-algorithm.js` - Failed overly-strict approach  
- `create-furniture-pieces-db.js` - Legacy furniture piece clustering
- `postgis-detection.js` - Overcomplicated PostGIS spatial queries
- `citywide-postgis.js` - PostGIS-based citywide detection
- `sqlite-helpers.js` - SQLite utility functions

**Why Archived**: These approaches had various issues:
- Performance problems with large datasets
- Overly complex spatial queries
- Poor accuracy on validation data
- Difficult to maintain and debug

### `analysis-scripts/`
**Research and pattern analysis tools**

- `analyze_bench_patterns.py` - Comprehensive Python analysis of 285 manual examples
- `bench_detection_insights.py` - Pattern discovery and validation
- `calibrate-single-bench.js` - Single-component bench calibration

**Why Archived**: These were research tools that served their purpose in discovering the patterns now implemented in the production system. The insights are captured in the current `src/config.js`.

### `experimental-results/`
**JSON result files from various detection experiments**

- `bench_detection_insights.json` - Pattern analysis results
- `bench_pattern_analysis_results.json` - Geometric analysis output
- `citywide_detection_results.json` - Legacy detection results
- `citywide_detection_results_postgis.json` - PostGIS detection results
- `manual_bench_geolocations.json` - Manual geolocation data
- `manual_clustering_analysis.json` - Manual clustering analysis
- `manual_clusters_2025-08-13.json` - 100 validated furniture examples
- `optimized_bench_detection_arr9.json` - Arrondissement 9 optimization
- `postgresql_import_data.json` - PostgreSQL import format
- `strict_classification_9_2025-07-20.json` - Strict classification results

**Why Archived**: These are historical results from various experiments. The final production system generates fresh results.

### `old-documentation/`
**Superseded documentation and guides**

- `BENCH_PATTERN_ANALYSIS_SUMMARY.md` - Analysis summary (now in PROJECT_JOURNEY.md)
- `CITYWIDE_DEPLOYMENT.md` - Old deployment guide
- `CLASSIFICATION_GUIDE.md` - Manual classification guide
- `DATASET_DOCUMENTATION.md` - Dataset analysis documentation
- `IMPLEMENTATION_COMPLETE.md` - Old completion status
- `MANUAL_CLUSTERING_GUIDE.md` - Manual clustering instructions
- `NEXT_AGENT_CONTEXT.md` - Context for next development phase
- `PROJECT_STATUS_COMPLETE.md` - Old project status

**Why Archived**: These documents were created during development but are now superseded by the current documentation (README.md, PROJECT_JOURNEY.md, QUICK_START.md).

### `legacy-servers/`
**Old server implementations**

- `server.js` - Original SQLite-based Express server

**Why Archived**: Replaced by `server-postgresql.js` which uses the production PostgreSQL database.

## 🔍 Historical Value

These archived files document the complex journey from initial data exploration to the final production system. They show:

1. **Multiple approaches tried** - Various detection algorithms and spatial analysis techniques
2. **Iterative refinement** - How manual analysis led to algorithmic improvements  
3. **Performance evolution** - From slow, complex queries to fast, validated patterns
4. **Documentation evolution** - How understanding grew throughout the project

## ⚠️ Usage Warning

**Do not use these archived files in production.** They are kept for:
- Historical reference
- Understanding the development process
- Learning from failed approaches
- Potential future research

The current production system in the main directory is the validated, working solution.

## 🎯 Current Production System

For the working system, see:
- **Main detection**: `../src/enhanced-detection.js`
- **CLI runner**: `../src/run-enhanced-detection.js`
- **Web server**: `../server-postgresql.js`
- **Documentation**: `../README.md`, `../PROJECT_JOURNEY.md`, `../QUICK_START.md`

---

*"Those who cannot remember the past are condemned to repeat it." - This archive ensures we remember the journey and the lessons learned.*
