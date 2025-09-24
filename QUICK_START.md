# 🚀 OusPoser Quick Start Guide

## 📋 Overview

OusPoser is a Paris street furniture detection system that finds benches and trash cans from city data to help people find sitting spots during hot weather.

**Current Results**: 7,858 benches + 26,879 trash cans detected across all 20 Paris arrondissements.

## ⚡ Quick Start (5 minutes)

### 1. Prerequisites
- **Node.js** (v18+)
- **PostgreSQL** (v12+) with PostGIS extension
- **Git** for cloning

### 2. Installation
```bash
# Clone and install
git clone <repository>
cd ousposer
npm install
```

### 3. Database Setup
```bash
# Set up PostgreSQL database and schema
node scripts/setup-postgresql.js
```

### 4. Start Web Interface
```bash
# Start the production server
node server-postgresql.js
```

Visit: **http://localhost:3000**

## 🗄️ Database Connection

**Connection String**: `postgresql://postgres:password@localhost:5432/ousposer`

**Tables**:
- `ousposer.benches` - 7,858 detected benches
- `ousposer.poubelles` - 26,879 detected trash cans  
- `ousposer.street_furniture_components` - 273,306 original components

## 🔧 Advanced Usage

### Run Detection Pipeline
```bash
# Test single arrondissement
node src/run-enhanced-detection.js test

# Specific arrondissements
node src/run-enhanced-detection.js arr 1 12 16

# All Paris (20 arrondissements)
node src/run-enhanced-detection.js all

# Show statistics
node src/run-enhanced-detection.js stats
```

### Recreate Database (if needed)
```bash
# 1. Recreate SQLite from JSON (requires original JSON file)
node scripts/create-database.js

# 2. Set up clean PostgreSQL
psql -U postgres -d ousposer -f scripts/setup-clean-database.sql

# 3. Run detection
node src/run-enhanced-detection.js all
```

## 📊 API Endpoints

- **Health Check**: `GET /api/health`
- **All Furniture**: `GET /api/furniture`
- **Benches Only**: `GET /api/benches`
- **Trash Cans Only**: `GET /api/poubelles`
- **Statistics**: `GET /api/stats`
- **Spatial Search**: `GET /api/search/near?lat=48.8566&lon=2.3522&radius=1`

## 🎯 Key Features

### Detection Accuracy
- **Single-component benches**: 98% confidence
- **Two-component benches**: 96% confidence  
- **Multi-component benches**: 85-90% confidence
- **Trash cans**: 98% confidence

### Spatial Coverage
- **All 20 Paris arrondissements**
- **Complete dataset**: 273,306 components processed
- **Geographic accuracy**: PostGIS spatial indexing

### Performance
- **Query speed**: <100ms for spatial searches
- **Detection speed**: ~2 minutes per arrondissement
- **Memory efficient**: Batch processing for large datasets

## 🗂️ Project Structure

```
ousposer/
├── src/                    # Core detection system
│   ├── enhanced-detection.js    # Main detection pipeline
│   ├── run-enhanced-detection.js # CLI runner
│   └── config.js               # Detection parameters
├── scripts/                # Database and setup
│   ├── setup-postgresql.js     # Database setup
│   ├── create-database.js      # SQLite creation
│   └── import-to-postgresql.js # Data import
├── public/                 # Web interface
├── archive/                # Legacy/experimental files
└── server-postgresql.js   # Production web server
```

## 🔍 Troubleshooting

### Database Connection Issues
```bash
# Check PostgreSQL is running
pg_isready

# Verify database exists
psql -U postgres -l | grep ousposer

# Test connection
psql -U postgres -d ousposer -c "SELECT COUNT(*) FROM ousposer.benches;"
```

### Missing Data
```bash
# Check component count (should be 273,306)
psql -U postgres -d ousposer -c "SELECT COUNT(*) FROM ousposer.street_furniture_components;"

# If missing, recreate from JSON
node scripts/create-database.js
node src/run-enhanced-detection.js all
```

### Performance Issues
```bash
# Rebuild spatial indexes
psql -U postgres -d ousposer -c "REINDEX INDEX idx_benches_location;"
psql -U postgres -d ousposer -c "ANALYZE ousposer.benches;"
```

## 📚 Documentation

- **PROJECT_JOURNEY.md** - Complete development story
- **README.md** - Detailed technical documentation
- **CITYWIDE_DEPLOYMENT.md** - Production deployment guide

## 🎉 Success Verification

After setup, you should see:
- ✅ Web interface at http://localhost:3000
- ✅ 7,858 benches in database
- ✅ 26,879 trash cans in database
- ✅ Fast spatial queries (<100ms)
- ✅ All 20 arrondissements covered

**You're ready to help Parisians find places to sit! 🪑**
