# 🗺️ Paris Street Furniture Dataset Documentation

## 📊 Dataset Overview

### File Information
- **File**: `plan-de-voirie-mobiliers-urbains-jardinieres-bancs-corbeilles-de-rue.json`
- **Size**: 182MB
- **Total Objects**: 273,306 street furniture components
- **Geographic Coverage**: Paris metropolitan area
- **Coordinate System**: WGS84 (EPSG:4326)
- **Geographic Bounds**: 
  - Latitude: 48.815° to 48.903° N
  - Longitude: 2.226° to 2.470° E

### Purpose
This dataset contains raw geometric representations of Paris street furniture requiring spatial analysis and machine learning for automatic classification into functional categories (benches, trash cans, jardinieres).

## 🏗️ Object Schema

Each of the 273,306 objects follows this structure:

```json
{
  "objectid": 28688,                    // Unique identifier (1-273306)
  "num_pave": "123B",                   // Geographic area code
  "igds_level": 15,                     // CAD layer level (always 15)
  "lib_level": "ENVIRONNEMENT",         // Category (always "ENVIRONNEMENT")
  "lib_classe": null,                   // Sub-category (always null)
  "geo_shape": {                        // GeoJSON Feature
    "type": "Feature",
    "geometry": {
      "type": "LineString",             // Always LineString
      "coordinates": [[lon,lat], ...]   // 2-77 coordinate pairs
    },
    "properties": {}                    // Always empty
  },
  "geo_point_2d": {                     // Centroid point
    "lon": 2.378008138557916,
    "lat": 48.83999220733723
  }
}
```

### Field Descriptions

| Field | Type | Description | Value Range |
|-------|------|-------------|-------------|
| `objectid` | Integer | Unique object identifier | 1 to 273,306 |
| `num_pave` | String | Geographic area/district code | 369 unique values |
| `igds_level` | Integer | CAD drawing layer level | Always 15 |
| `lib_level` | String | Object category | Always "ENVIRONNEMENT" |
| `lib_classe` | Null | Object sub-category | Always null |
| `geo_shape` | GeoJSON | Complete geometric representation | LineString with 2-77 points |
| `geo_point_2d` | Object | Centroid coordinates | {lat, lon} |

## 📐 Geometric Characteristics

### Coordinate Distribution
The dataset shows distinct patterns in coordinate counts that correlate with furniture types:

| Coordinate Count | Object Count | Percentage | Typical Furniture Type |
|------------------|--------------|------------|----------------------|
| 2 points | 198,559 | 72.6% | Simple linear elements |
| 3-12 points | 27,354 | 10.0% | Moderate complexity shapes |
| 73 points | 27,532 | 10.1% | **Circular trash cans** |
| Other (13-77) | 19,861 | 7.3% | Complex jardinieres/benches |

### Key Geometric Insights
- **73-point objects**: Represent circular drawings of trash cans (poubelles)
- **2-point objects**: Simple line segments, often components of multi-part furniture
- **5-7 point objects**: Typical single-component benches
- **Variable counts**: Jardinieres with complex garden outlines

## 🪑 Street Furniture Classification

Based on manual clustering analysis of 100 validated examples:

### 🗑️ Poubelles (Trash Cans)
- **Component Count**: Always 1
- **Coordinate Pattern**: Exactly 73 points (circular drawings)
- **Total Length**: ~2.26 meters (circumference)
- **Aspect Ratio**: ~0.99 (nearly circular)
- **Detection**: High confidence based on 73-point pattern

### 🪑 Benches
Complex multi-pattern furniture requiring spatial clustering:

#### Single-Component Benches (20 examples)
- **Component Count**: 1
- **Coordinate Patterns**:
  - 7 points: 14 examples (70%) - rectangular with backrest
  - 5 points: 6 examples (30%) - simpler rectangular shape
- **Total Length**: 5.4-7.2 meters
- **Aspect Ratio**: 0.55-1.02

#### Two-Component Benches (16 examples)
- **Component Count**: 2
- **Coordinate Pattern**: Consistently [2, 5] points
  - 2-point component: Frame outline
  - 5-point component: Backrest detail
- **Detection**: Frame + backrest validation required

#### Multi-Component Benches
- **5-Component**: 25 examples, all with 2-point components (rectangle frame + backrest)
- **6-Component**: 14 examples, all with 2-point components (rectangle frame + dual backrests)
- **4-Component**: 6 examples (rectangular frames)

### 🌿 Jardinieres (Planters)
- **Component Count**: 2-4 (variable)
- **Coordinate Pattern**: Highly variable (complex garden outlines)
- **Detection**: Most challenging due to irregular shapes

## 🗺️ Geographic Coding System

### `num_pave` Field Analysis
The `num_pave` field encodes geographic location with 369 unique values:

#### Arrondissement Codes (329 values)
**Pattern**: `[0-9]{3}[A-Z]` (e.g., "123A", "162M")
- **First 2-3 digits**: Arrondissement number
- **Letter suffix**: Subdivision within arrondissement

**Examples**:
- `"123A"` → 12th arrondissement, subdivision A
- `"162M"` → 16th arrondissement, subdivision M  
- `"0120"` → 1st arrondissement (leading zero format)

#### Special Area Codes (26 values)
**Pattern**: `[A-Z]{4}` (e.g., "BFON", "BMAN")
- Special administrative areas requiring investigation
- Possibly parks, monuments, or special districts

#### High-Density Areas
| Area Code | Object Count | Likely Location |
|-----------|--------------|-----------------|
| "121F" | 14,263 | 12th arr. (Bois de Vincennes) |
| "121G" | 9,714 | 12th arr. (Bois de Vincennes) |
| "162M" | 7,776 | 16th arr. (Bois de Boulogne) |
| "161M" | 7,541 | 16th arr. (Bois de Boulogne) |

**Note**: 12th and 16th arrondissements show highest object counts due to large parks (Bois de Vincennes and Bois de Boulogne) containing extensive street furniture.

## 🔧 Data Processing Challenges

### Multi-Component Furniture Detection
- **Challenge**: Each object represents either a complete furniture piece OR a component
- **Solution**: Spatial clustering (DBSCAN) to group related components
- **Validation**: Geometric analysis to confirm furniture type

### Classification Complexity
1. **Coordinate count alone insufficient** for classification
2. **Spatial relationships** between components critical
3. **Geometric validation** required for bench rectangle detection
4. **Aspect ratio analysis** helps distinguish circular trash cans

### Processing Pipeline Requirements
1. **Spatial Indexing**: PostGIS/SQLite with spatial extensions
2. **Clustering**: DBSCAN with metric CRS (EPSG:2154)
3. **Geometric Validation**: Rectangle detection, backrest alignment
4. **Classification**: ML models trained on manual ground truth

## 📈 Data Quality Metrics

### Validation Dataset
Manual clustering of 100 examples provides ground truth:
- **81 benches** (1-6 components each)
- **15 trash cans** (all single 73-point components)
- **4 jardinieres** (2-4 components each)

### Detection Confidence Levels
- **Trash Cans**: 95%+ (73-point pattern)
- **Single Benches**: 90%+ (envelope-based detection)
- **Multi-Component Benches**: 80-96% (geometric validation)
- **Jardinieres**: 70%+ (most challenging)

## 🎯 Recommended Processing Strategy

### Phase 1: High-Confidence Detection
1. **Trash Cans**: Filter objects with exactly 73 coordinates
2. **Single Benches**: Envelope-based detection with canonical dimensions

### Phase 2: Spatial Clustering
1. **DBSCAN Clustering**: Group nearby components (eps=5-10m)
2. **Geometric Validation**: Rectangle frame detection
3. **Backrest Analysis**: Parallel line validation within frames

### Phase 3: Classification Refinement
1. **Machine Learning**: Train on manual ground truth
2. **Confidence Scoring**: Multi-factor validation
3. **Quality Control**: Manual validation interface

This dataset represents the complete Paris street furniture inventory requiring sophisticated geometric analysis for accurate automatic classification into functional categories.
