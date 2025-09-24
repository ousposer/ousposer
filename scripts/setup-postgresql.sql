-- OusPoser PostgreSQL + PostGIS Database Setup
-- Production database for Paris street furniture detection results

-- Enable PostGIS extension for spatial data support
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Create database schema
CREATE SCHEMA IF NOT EXISTS ousposer;
SET search_path TO ousposer, public;

-- =====================================================
-- BENCHES TABLE
-- =====================================================
CREATE TABLE benches (
    id SERIAL PRIMARY KEY,
    bench_id VARCHAR(100) UNIQUE NOT NULL,
    arrondissement INTEGER NOT NULL CHECK (arrondissement BETWEEN 1 AND 20),
    
    -- Bench characteristics
    bench_type VARCHAR(20) NOT NULL CHECK (bench_type IN ('single-component', '5-component', '6-component')),
    component_ids INTEGER[] NOT NULL,
    total_components INTEGER NOT NULL CHECK (total_components > 0),
    total_length_m REAL NOT NULL CHECK (total_length_m > 0),
    
    -- Spatial data (WGS84 - EPSG:4326)
    location GEOMETRY(POINT, 4326) NOT NULL,
    bounding_box GEOMETRY(POLYGON, 4326), -- For multi-component benches
    
    -- Multi-component bench details
    frame_components INTEGER[], -- Frame component IDs for multi-component benches
    internal_components INTEGER[], -- Internal component IDs for multi-component benches
    
    -- Detection metadata
    detection_method VARCHAR(50) NOT NULL DEFAULT 'geometric_topology',
    detection_confidence REAL NOT NULL DEFAULT 1.0 CHECK (detection_confidence BETWEEN 0 AND 1),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Data validation constraints
    CONSTRAINT benches_location_valid CHECK (ST_IsValid(location)),
    CONSTRAINT benches_bounding_box_valid CHECK (bounding_box IS NULL OR ST_IsValid(bounding_box)),
    CONSTRAINT benches_components_match CHECK (array_length(component_ids, 1) = total_components)
);

-- =====================================================
-- POUBELLES TABLE  
-- =====================================================
CREATE TABLE poubelles (
    id SERIAL PRIMARY KEY,
    poubelle_id VARCHAR(100) UNIQUE NOT NULL,
    arrondissement INTEGER NOT NULL CHECK (arrondissement BETWEEN 1 AND 20),
    
    -- Component reference
    component_id INTEGER NOT NULL,
    
    -- Geometric characteristics used for detection
    total_length_m REAL NOT NULL CHECK (total_length_m > 0),
    point_count INTEGER NOT NULL CHECK (point_count > 0),
    aspect_ratio REAL NOT NULL CHECK (aspect_ratio > 0),
    
    -- Spatial data (WGS84 - EPSG:4326)
    location GEOMETRY(POINT, 4326) NOT NULL,
    shape GEOMETRY(LINESTRING, 4326) NOT NULL, -- Original LineString geometry
    
    -- Detection metadata
    detection_method VARCHAR(50) NOT NULL DEFAULT 'geometric_characteristics',
    detection_confidence REAL NOT NULL DEFAULT 1.0 CHECK (detection_confidence BETWEEN 0 AND 1),
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Data validation constraints
    CONSTRAINT poubelles_location_valid CHECK (ST_IsValid(location)),
    CONSTRAINT poubelles_shape_valid CHECK (ST_IsValid(shape))
);

-- =====================================================
-- STREET FURNITURE COMPONENTS (Reference table)
-- =====================================================
CREATE TABLE street_furniture_components (
    id SERIAL PRIMARY KEY,
    objectid INTEGER UNIQUE NOT NULL,
    arrondissement INTEGER CHECK (arrondissement BETWEEN 1 AND 20),
    
    -- Geometric properties
    total_length_m REAL NOT NULL CHECK (total_length_m > 0),
    point_count INTEGER NOT NULL CHECK (point_count > 0),
    aspect_ratio REAL NOT NULL CHECK (aspect_ratio > 0),
    bounding_width_m REAL,
    bounding_height_m REAL,
    angle_changes_sum REAL,
    
    -- Spatial data
    location GEOMETRY(POINT, 4326) NOT NULL,
    shape GEOMETRY(LINESTRING, 4326) NOT NULL,
    
    -- Classification status
    classified_as VARCHAR(20), -- 'bench_component', 'poubelle', 'unclassified'
    used_in_bench_id VARCHAR(100), -- Reference to bench if used as component
    used_in_poubelle_id VARCHAR(100), -- Reference to poubelle if classified as such
    
    -- Metadata
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT components_location_valid CHECK (ST_IsValid(location)),
    CONSTRAINT components_shape_valid CHECK (ST_IsValid(shape))
);

-- =====================================================
-- SPATIAL INDEXES
-- =====================================================

-- Benches spatial indexes
CREATE INDEX idx_benches_location ON benches USING GIST (location);
CREATE INDEX idx_benches_bounding_box ON benches USING GIST (bounding_box);
CREATE INDEX idx_benches_arrondissement ON benches (arrondissement);
CREATE INDEX idx_benches_type ON benches (bench_type);

-- Poubelles spatial indexes  
CREATE INDEX idx_poubelles_location ON poubelles USING GIST (location);
CREATE INDEX idx_poubelles_shape ON poubelles USING GIST (shape);
CREATE INDEX idx_poubelles_arrondissement ON poubelles (arrondissement);

-- Components spatial indexes
CREATE INDEX idx_components_location ON street_furniture_components USING GIST (location);
CREATE INDEX idx_components_shape ON street_furniture_components USING GIST (shape);
CREATE INDEX idx_components_arrondissement ON street_furniture_components (arrondissement);
CREATE INDEX idx_components_objectid ON street_furniture_components (objectid);
CREATE INDEX idx_components_classified_as ON street_furniture_components (classified_as);

-- =====================================================
-- FOREIGN KEY RELATIONSHIPS
-- =====================================================

-- Add foreign key constraints after data import
-- ALTER TABLE benches ADD CONSTRAINT fk_benches_components 
--   FOREIGN KEY (component_ids) REFERENCES street_furniture_components(objectid);

-- =====================================================
-- UTILITY VIEWS
-- =====================================================

-- View for all street furniture with spatial data
CREATE VIEW street_furniture_overview AS
SELECT 
    'bench' as furniture_type,
    bench_id as furniture_id,
    arrondissement,
    location,
    bench_type as subtype,
    total_components as component_count,
    detection_confidence,
    detected_at
FROM benches
UNION ALL
SELECT 
    'poubelle' as furniture_type,
    poubelle_id as furniture_id,
    arrondissement,
    location,
    'standard' as subtype,
    1 as component_count,
    detection_confidence,
    detected_at
FROM poubelles;

-- View for arrondissement statistics
CREATE VIEW arrondissement_stats AS
SELECT 
    arrondissement,
    COUNT(CASE WHEN furniture_type = 'bench' THEN 1 END) as bench_count,
    COUNT(CASE WHEN furniture_type = 'poubelle' THEN 1 END) as poubelle_count,
    COUNT(*) as total_furniture,
    AVG(detection_confidence) as avg_confidence
FROM street_furniture_overview
GROUP BY arrondissement
ORDER BY arrondissement;

-- =====================================================
-- SAMPLE SPATIAL QUERIES
-- =====================================================

-- Find all furniture within 500m of a point (example: Louvre)
-- SELECT furniture_type, furniture_id, arrondissement,
--        ST_Distance(location, ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326)) as distance_m
-- FROM street_furniture_overview 
-- WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(2.3376, 48.8606), 4326), 0.005)
-- ORDER BY distance_m;

-- Find furniture density by arrondissement
-- SELECT arrondissement, 
--        bench_count,
--        poubelle_count,
--        total_furniture,
--        ROUND(total_furniture::numeric / ST_Area(arr_geom::geography) * 1000000, 2) as furniture_per_km2
-- FROM arrondissement_stats;

-- =====================================================
-- PERMISSIONS & SECURITY
-- =====================================================

-- Create read-only user for API access
-- CREATE USER ousposer_api WITH PASSWORD 'your_secure_password';
-- GRANT USAGE ON SCHEMA ousposer TO ousposer_api;
-- GRANT SELECT ON ALL TABLES IN SCHEMA ousposer TO ousposer_api;
-- GRANT SELECT ON ALL SEQUENCES IN SCHEMA ousposer TO ousposer_api;

-- Create admin user for data management
-- CREATE USER ousposer_admin WITH PASSWORD 'your_admin_password';
-- GRANT ALL PRIVILEGES ON SCHEMA ousposer TO ousposer_admin;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ousposer TO ousposer_admin;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ousposer TO ousposer_admin;

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================
SELECT 'OusPoser PostgreSQL + PostGIS database setup complete!' as status;
SELECT 'Tables created: benches, poubelles, street_furniture_components' as tables;
SELECT 'Spatial indexes created for efficient querying' as indexes;
SELECT 'Views created: street_furniture_overview, arrondissement_stats' as views;
