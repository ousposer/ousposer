-- OusPoser Trees Table Schema
-- PostgreSQL + PostGIS table for Paris trees data
-- Part of the cool spots detection system

-- Set schema context
SET search_path TO ousposer, public;

-- =====================================================
-- TREES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS trees (
    id SERIAL PRIMARY KEY,
    tree_id INTEGER UNIQUE NOT NULL, -- Original tree ID from OpenData Paris
    arrondissement INTEGER NOT NULL CHECK (arrondissement BETWEEN 1 AND 20),
    
    -- Spatial data (WGS84 - EPSG:4326)
    latitude REAL NOT NULL CHECK (latitude BETWEEN 48.81 AND 48.91), -- Paris latitude bounds (expanded)
    longitude REAL NOT NULL CHECK (longitude BETWEEN 2.2 AND 2.5), -- Paris longitude bounds
    location GEOMETRY(POINT, 4326) NOT NULL,
    
    -- Botanical information
    common_name VARCHAR(100),
    genus VARCHAR(50),
    species VARCHAR(50),
    variety VARCHAR(100),
    
    -- Physical characteristics
    height_m REAL CHECK (height_m > 0 AND height_m <= 100), -- Reasonable height bounds
    circumference_cm REAL CHECK (circumference_cm > 0 AND circumference_cm <= 2000), -- Reasonable circumference bounds
    development_stage VARCHAR(100),
    location_type VARCHAR(50), -- Alignement, Jardin, PERIPHERIQUE, etc.
    is_remarkable BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Cool spots scoring
    estimated_canopy_radius_m REAL CHECK (estimated_canopy_radius_m >= 0 AND estimated_canopy_radius_m <= 50),
    shade_score REAL CHECK (shade_score >= 0 AND shade_score <= 10),
    
    -- Metadata
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Spatial constraints
    CONSTRAINT trees_location_valid CHECK (ST_IsValid(location)),
    CONSTRAINT trees_location_matches_coords CHECK (
        ABS(ST_X(location) - longitude) < 0.0001 AND 
        ABS(ST_Y(location) - latitude) < 0.0001
    )
);

-- =====================================================
-- SPATIAL INDEXES
-- =====================================================

-- Primary spatial index for location-based queries
CREATE INDEX IF NOT EXISTS idx_trees_location ON trees USING GIST (location);

-- Arrondissement index for administrative queries
CREATE INDEX IF NOT EXISTS idx_trees_arrondissement ON trees (arrondissement);

-- Botanical indexes for species analysis
CREATE INDEX IF NOT EXISTS idx_trees_genus ON trees (genus);
CREATE INDEX IF NOT EXISTS idx_trees_species ON trees (genus, species);
CREATE INDEX IF NOT EXISTS idx_trees_common_name ON trees (common_name);

-- Cool spots scoring indexes
CREATE INDEX IF NOT EXISTS idx_trees_shade_score ON trees (shade_score);
CREATE INDEX IF NOT EXISTS idx_trees_canopy_radius ON trees (estimated_canopy_radius_m);

-- Physical characteristics indexes
CREATE INDEX IF NOT EXISTS idx_trees_height ON trees (height_m);
CREATE INDEX IF NOT EXISTS idx_trees_location_type ON trees (location_type);
CREATE INDEX IF NOT EXISTS idx_trees_remarkable ON trees (is_remarkable);

-- Composite index for cool spots queries (arrondissement + shade score)
CREATE INDEX IF NOT EXISTS idx_trees_arr_shade ON trees (arrondissement, shade_score);

-- =====================================================
-- UTILITY VIEWS
-- =====================================================

-- View for trees with high shade potential (score >= 8)
CREATE OR REPLACE VIEW high_shade_trees AS
SELECT 
    tree_id,
    arrondissement,
    latitude,
    longitude,
    location,
    common_name,
    genus,
    species,
    height_m,
    estimated_canopy_radius_m,
    shade_score,
    location_type
FROM trees
WHERE shade_score >= 8.0
ORDER BY shade_score DESC, estimated_canopy_radius_m DESC;

-- View for trees statistics by arrondissement
CREATE OR REPLACE VIEW trees_by_arrondissement AS
SELECT
    arrondissement,
    COUNT(*) as total_trees,
    ROUND(AVG(shade_score)::numeric, 2) as avg_shade_score,
    ROUND(AVG(height_m)::numeric, 2) as avg_height_m,
    ROUND(AVG(estimated_canopy_radius_m)::numeric, 2) as avg_canopy_radius_m,
    COUNT(CASE WHEN shade_score >= 8.0 THEN 1 END) as high_shade_trees,
    COUNT(CASE WHEN is_remarkable THEN 1 END) as remarkable_trees,
    COUNT(DISTINCT genus) as unique_genera,
    COUNT(DISTINCT CONCAT(genus, ' ', species)) as unique_species
FROM trees
GROUP BY arrondissement
ORDER BY arrondissement;

-- View for botanical diversity analysis
CREATE OR REPLACE VIEW tree_species_diversity AS
SELECT
    genus,
    species,
    common_name,
    COUNT(*) as tree_count,
    ROUND(AVG(shade_score)::numeric, 2) as avg_shade_score,
    ROUND(AVG(height_m)::numeric, 2) as avg_height_m,
    ROUND(AVG(estimated_canopy_radius_m)::numeric, 2) as avg_canopy_radius_m,
    COUNT(DISTINCT arrondissement) as arrondissements_present
FROM trees
WHERE genus IS NOT NULL AND species IS NOT NULL
GROUP BY genus, species, common_name
ORDER BY tree_count DESC;

-- =====================================================
-- SAMPLE SPATIAL QUERIES FOR COOL SPOTS
-- =====================================================

-- Function to find trees within radius of a point
-- Usage: SELECT * FROM find_trees_near_point(48.8566, 2.3522, 500);
CREATE OR REPLACE FUNCTION find_trees_near_point(
    lat REAL, 
    lon REAL, 
    radius_meters INTEGER DEFAULT 500
)
RETURNS TABLE (
    tree_id INTEGER,
    arrondissement INTEGER,
    distance_m REAL,
    common_name VARCHAR,
    shade_score REAL,
    canopy_radius_m REAL,
    location GEOMETRY
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.tree_id,
        t.arrondissement,
        ST_Distance(t.location::geography, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography)::REAL as distance_m,
        t.common_name,
        t.shade_score,
        t.estimated_canopy_radius_m,
        t.location
    FROM trees t
    WHERE ST_DWithin(
        t.location::geography, 
        ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 
        radius_meters
    )
    ORDER BY distance_m;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- DATA VALIDATION FUNCTIONS
-- =====================================================

-- Function to validate tree data integrity
CREATE OR REPLACE FUNCTION validate_trees_data()
RETURNS TABLE (
    check_name TEXT,
    status TEXT,
    count_or_message TEXT
) AS $$
BEGIN
    -- Check total count
    RETURN QUERY
    SELECT 'Total trees'::TEXT, 'INFO'::TEXT, COUNT(*)::TEXT FROM trees;
    
    -- Check for duplicates
    RETURN QUERY
    SELECT 'Duplicate tree_ids'::TEXT, 
           CASE WHEN COUNT(*) = 0 THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
           COUNT(*)::TEXT
    FROM (SELECT tree_id FROM trees GROUP BY tree_id HAVING COUNT(*) > 1) dups;
    
    -- Check coordinate bounds
    RETURN QUERY
    SELECT 'Invalid coordinates'::TEXT,
           CASE WHEN COUNT(*) = 0 THEN 'PASS'::TEXT ELSE 'FAIL'::TEXT END,
           COUNT(*)::TEXT
    FROM trees 
    WHERE latitude NOT BETWEEN 48.8 AND 48.9 
       OR longitude NOT BETWEEN 2.2 AND 2.5;
    
    -- Check arrondissement distribution
    RETURN QUERY
    SELECT 'Arrondissements covered'::TEXT, 'INFO'::TEXT, COUNT(DISTINCT arrondissement)::TEXT FROM trees;
    
    -- Check missing botanical data
    RETURN QUERY
    SELECT 'Trees missing genus'::TEXT, 'INFO'::TEXT, COUNT(*)::TEXT FROM trees WHERE genus IS NULL;
    
    -- Check shade score distribution
    RETURN QUERY
    SELECT 'High shade trees (score >= 8)'::TEXT, 'INFO'::TEXT, COUNT(*)::TEXT FROM trees WHERE shade_score >= 8.0;
    
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================
SELECT 'Trees table schema created successfully!' as status;
SELECT 'Indexes created for spatial and botanical queries' as indexes;
SELECT 'Views created: high_shade_trees, trees_by_arrondissement, tree_species_diversity' as views;
SELECT 'Functions created: find_trees_near_point, validate_trees_data' as functions;
