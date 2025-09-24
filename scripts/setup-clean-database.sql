-- =====================================================
-- CLEAN DATABASE SETUP FOR OUSPOSER
-- Simplified schema for benches and trash cans
-- =====================================================

-- Drop existing tables if they exist
DROP TABLE IF EXISTS benches CASCADE;
DROP TABLE IF EXISTS poubelles CASCADE;

-- =====================================================
-- BENCHES TABLE - Simplified for map display
-- =====================================================
CREATE TABLE benches (
    -- Primary identification
    id SERIAL PRIMARY KEY,
    bench_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Location & Administrative
    arrondissement INTEGER NOT NULL CHECK (arrondissement BETWEEN 1 AND 20),
    location GEOMETRY(POINT, 4326) NOT NULL,  -- Center point for map display
    
    -- Bench Classification (based on validated analysis)
    bench_type VARCHAR(30) NOT NULL CHECK (bench_type IN (
        'single-5-point',      -- 5-point single component (6 examples, 95% confidence)
        'single-7-point',      -- 7-point single component (14 examples, 98% confidence) 
        'two-component',       -- [2,5] pattern (16 examples, 96% confidence)
        'multi-4-component',   -- Rectangle frame only (6 examples, 90% confidence)
        'multi-5-component',   -- Rectangle + 1 backrest (25 examples, 85% confidence)
        'multi-6-component'    -- Rectangle + 2 backrests (14 examples, 90% confidence)
    )),
    
    -- Physical Characteristics
    total_components INTEGER NOT NULL CHECK (total_components > 0),
    envelope_length_m REAL CHECK (envelope_length_m > 0),
    envelope_width_m REAL CHECK (envelope_width_m > 0),
    total_length_m REAL CHECK (total_length_m > 0),
    
    -- Component References
    component_ids INTEGER[] NOT NULL,
    
    -- Detection Metadata
    detection_method VARCHAR(50) NOT NULL,
    detection_confidence REAL NOT NULL CHECK (detection_confidence BETWEEN 0 AND 1),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT benches_location_valid CHECK (ST_IsValid(location)),
    CONSTRAINT benches_components_match CHECK (array_length(component_ids, 1) = total_components)
);

-- =====================================================
-- POUBELLES TABLE - Simplified for map display
-- =====================================================
CREATE TABLE poubelles (
    -- Primary identification
    id SERIAL PRIMARY KEY,
    poubelle_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Location & Administrative
    arrondissement INTEGER NOT NULL CHECK (arrondissement BETWEEN 1 AND 20),
    location GEOMETRY(POINT, 4326) NOT NULL,  -- Center point for map display
    
    -- Component reference
    component_id INTEGER NOT NULL,
    
    -- Physical characteristics (for validation)
    point_count INTEGER NOT NULL CHECK (point_count > 0),
    total_length_m REAL NOT NULL CHECK (total_length_m > 0),
    aspect_ratio REAL CHECK (aspect_ratio > 0),
    
    -- Detection metadata
    detection_method VARCHAR(50) NOT NULL DEFAULT 'point_count_73',
    detection_confidence REAL NOT NULL DEFAULT 1.0 CHECK (detection_confidence BETWEEN 0 AND 1),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT poubelles_location_valid CHECK (ST_IsValid(location))
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Spatial indexes
CREATE INDEX idx_benches_location ON benches USING GIST (location);
CREATE INDEX idx_poubelles_location ON poubelles USING GIST (location);

-- Query optimization indexes
CREATE INDEX idx_benches_arrondissement ON benches (arrondissement);
CREATE INDEX idx_benches_type ON benches (bench_type);
CREATE INDEX idx_benches_confidence ON benches (detection_confidence);

CREATE INDEX idx_poubelles_arrondissement ON poubelles (arrondissement);
CREATE INDEX idx_poubelles_confidence ON poubelles (detection_confidence);

-- Component reference indexes
CREATE INDEX idx_benches_component_ids ON benches USING GIN (component_ids);
CREATE INDEX idx_poubelles_component_id ON poubelles (component_id);

-- =====================================================
-- HELPER VIEWS FOR MAP DISPLAY
-- =====================================================

-- Simplified bench view for map display
CREATE VIEW benches_map_view AS
SELECT 
    id,
    bench_id,
    arrondissement,
    ST_X(location) as longitude,
    ST_Y(location) as latitude,
    CASE 
        WHEN total_components = 1 THEN 'single-bench'
        WHEN total_components = 2 THEN 'double-bench'
        ELSE 'multi-bench'
    END as display_category,
    bench_type,
    envelope_length_m,
    envelope_width_m,
    detection_confidence,
    CASE 
        WHEN envelope_length_m < 2.5 THEN 'compact'
        WHEN envelope_length_m < 4.0 THEN 'standard' 
        ELSE 'extended'
    END as size_category
FROM benches;

-- Simplified poubelles view for map display
CREATE VIEW poubelles_map_view AS
SELECT 
    id,
    poubelle_id,
    arrondissement,
    ST_X(location) as longitude,
    ST_Y(location) as latitude,
    detection_confidence
FROM poubelles;

-- Combined furniture view for map display
CREATE VIEW furniture_map_view AS
SELECT 
    'bench' as furniture_type,
    bench_id as furniture_id,
    arrondissement,
    longitude,
    latitude,
    display_category as subtype,
    detection_confidence
FROM benches_map_view
UNION ALL
SELECT 
    'poubelle' as furniture_type,
    poubelle_id as furniture_id,
    arrondissement,
    longitude,
    latitude,
    'trash-can' as subtype,
    detection_confidence
FROM poubelles_map_view;

-- =====================================================
-- SUMMARY STATISTICS VIEW
-- =====================================================
CREATE VIEW detection_summary AS
SELECT 
    'benches' as furniture_type,
    COUNT(*) as total_count,
    AVG(detection_confidence) as avg_confidence,
    COUNT(DISTINCT arrondissement) as arrondissements_covered
FROM benches
UNION ALL
SELECT 
    'poubelles' as furniture_type,
    COUNT(*) as total_count,
    AVG(detection_confidence) as avg_confidence,
    COUNT(DISTINCT arrondissement) as arrondissements_covered
FROM poubelles;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON benches TO ousposer_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON poubelles TO ousposer_user;
GRANT USAGE, SELECT ON SEQUENCE benches_id_seq TO ousposer_user;
GRANT USAGE, SELECT ON SEQUENCE poubelles_id_seq TO ousposer_user;
GRANT SELECT ON benches_map_view TO ousposer_user;
GRANT SELECT ON poubelles_map_view TO ousposer_user;
GRANT SELECT ON furniture_map_view TO ousposer_user;
GRANT SELECT ON detection_summary TO ousposer_user;

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================
SELECT 'Clean database schema created successfully!' as status;
