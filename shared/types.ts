/**
 * Shared TypeScript types for OusPoser
 * Used by both data-processing and nextjs-app
 */

// Geographic coordinates
export interface Coordinates {
  latitude: number;
  longitude: number;
}

// Fresh Spot Analysis Types
export interface FreshSpotAnalysis {
  location: Coordinates;
  analysis: {
    shade: ShadeAnalysis;
    seating: SeatingAnalysis;
    convenience: ConvenienceAnalysis;
  };
  scoring: {
    overall_score: number;
    rating: 'excellent' | 'good' | 'fair' | 'poor' | 'inadequate';
    meets_requirements: boolean;
  };
  metadata: {
    analyzed_at: string;
    algorithm_version: string;
    search_radii: {
      TREES: number;
      BENCHES: number;
      TRASH_CANS: number;
    };
    response_time_ms?: number;
    api_version?: string;
  };
}

export interface ShadeAnalysis {
  score: number;
  tree_count: number;
  best_shade_score: number;
  average_shade_score: number;
  closest_tree_distance: number | null;
  trees: TreeInfo[];
}

export interface SeatingAnalysis {
  score: number;
  bench_count: number;
  total_seating_length: number;
  closest_bench_distance: number | null;
  benches: BenchInfo[];
}

export interface ConvenienceAnalysis {
  score: number;
  trash_can_count: number;
  closest_trash_can_distance: number | null;
  trash_cans: TrashCanInfo[];
}

// Individual amenity types
export interface TreeInfo {
  tree_id: number;
  common_name: string;
  shade_score: number;
  estimated_canopy_radius_m: number;
  distance_m: number;
}

export interface BenchInfo {
  bench_id: string;
  bench_type: string;
  total_length_m: number;
  distance_m: number;
}

export interface TrashCanInfo {
  poubelle_id: string;
  distance_m: number;
}

// Heatmap data types
export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  fresh_spot_score: number;
  shade_score: number;
  seating_score: number;
  convenience_score: number;
  tree_count: number;
  bench_count: number;
  trash_count: number;
}

// API Response types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
  message?: string;
}

// Configuration types
export interface FreshSpotConfig {
  SEARCH_RADIUS: {
    TREES: number;
    BENCHES: number;
    TRASH_CANS: number;
  };
  WEIGHTS: {
    SHADE: number;
    SEATING: number;
    CONVENIENCE: number;
  };
  THRESHOLDS: {
    EXCELLENT: number;
    GOOD: number;
    FAIR: number;
    POOR: number;
  };
  MINIMUMS: {
    SHADE_SCORE: number;
    TREE_COUNT: number;
    BENCH_COUNT: number;
    TOTAL_SCORE: number;
  };
}
