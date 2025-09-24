/**
 * Shared constants for OusPoser
 * Used by both data-processing and nextjs-app
 */

// Paris geographic bounds
export const PARIS_BOUNDS = {
  NORTH: 48.91,
  SOUTH: 48.81,
  EAST: 2.5,
  WEST: 2.2,
} as const;

// Fresh Spot Color Gradient: Blue (extremely cool) → Red (very hot)
export const FRESH_SPOT_COLORS = {
  0.0: '#ff0000',    // Very hot/no fresh spot (red)
  0.2: '#ff6600',    // Hot (orange-red)
  0.4: '#ffaa00',    // Warm (orange)
  0.6: '#ffff00',    // Moderate (yellow)
  0.8: '#00aaff',    // Cool (light blue)
  1.0: '#0066ff',    // Extremely cool/perfect fresh spot (blue)
} as const;

// Alternative gradient with more blue tones
export const FRESH_SPOT_COLORS_DETAILED = {
  0.0: '#8B0000',    // Dark red (very hot)
  0.1: '#FF0000',    // Red (hot)
  0.2: '#FF4500',    // Orange red
  0.3: '#FF8C00',    // Dark orange
  0.4: '#FFD700',    // Gold
  0.5: '#FFFF00',    // Yellow (moderate)
  0.6: '#ADFF2F',    // Green yellow
  0.7: '#00FF7F',    // Spring green
  0.8: '#00CED1',    // Dark turquoise
  0.9: '#0080FF',    // Light blue
  1.0: '#0000FF',    // Blue (extremely cool)
} as const;

// API endpoints
export const API_ENDPOINTS = {
  FRESH_SPOTS: {
    ANALYZE: '/api/fresh-spots/analyze',
    CONFIG: '/api/fresh-spots/config',
  },
  AMENITIES: {
    BENCHES: '/api/benches',
    TREES: '/api/trees',
    TRASH_CANS: '/api/poubelles',
    FURNITURE: '/api/furniture',
  },
  SEARCH: {
    NEAR: '/api/search/near',
  },
  STATS: '/api/stats',
  HEALTH: '/api/health',
} as const;

// Default configuration values
export const DEFAULT_CONFIG = {
  SEARCH_RADIUS: {
    TREES: 150,
    BENCHES: 200,
    TRASH_CANS: 200,
  },
  WEIGHTS: {
    SHADE: 0.5,
    SEATING: 0.3,
    CONVENIENCE: 0.2,
  },
  THRESHOLDS: {
    EXCELLENT: 7.0,
    GOOD: 5.0,
    FAIR: 3.0,
    POOR: 1.5,
  },
} as const;

// Heatmap configuration
export const HEATMAP_CONFIG = {
  DEFAULT_GRID_RESOLUTION: 50, // meters
  MIN_GRID_RESOLUTION: 10,     // meters
  MAX_GRID_RESOLUTION: 100,    // meters
  DEFAULT_ZOOM_LEVEL: 12,
  MIN_ZOOM_LEVEL: 10,
  MAX_ZOOM_LEVEL: 18,
} as const;

// Map configuration
export const MAP_CONFIG = {
  DEFAULT_CENTER: {
    latitude: 48.8566,
    longitude: 2.3522,
  },
  DEFAULT_ZOOM: 12,
  TILE_LAYER: {
    URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ATTRIBUTION: '&copy; OpenStreetMap contributors',
  },
} as const;

// Database configuration
export const DB_CONFIG = {
  SCHEMA: 'ousposer',
  TABLES: {
    BENCHES: 'benches',
    TREES: 'trees',
    TRASH_CANS: 'poubelles',
    COMPONENTS: 'street_furniture_components',
  },
} as const;
