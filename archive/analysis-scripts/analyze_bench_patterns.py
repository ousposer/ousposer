#!/usr/bin/env python3
"""
Analyze correlations between raw Paris street furniture data and manually validated bench clusters
to develop reliable programmatic detection patterns.
"""

import json
import pandas as pd
import geopandas as gpd
import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from scipy.spatial.distance import pdist, squareform
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

class BenchPatternAnalyzer:
    def __init__(self, raw_data_path, manual_clusters_path):
        """Initialize analyzer with data paths."""
        self.raw_data_path = Path(raw_data_path)
        self.manual_clusters_path = Path(manual_clusters_path)
        self.raw_data = None
        self.manual_clusters = None
        self.bench_components = None
        
    def load_data(self):
        """Load raw street furniture data and manual clusters efficiently."""
        print("📊 Loading manual clusters first...")
        with open(self.manual_clusters_path, 'r') as f:
            self.manual_clusters = json.load(f)

        # Get all bench component IDs to filter raw data
        bench_clusters = [c for c in self.manual_clusters if c['type'] == 'benches']
        all_bench_ids = set()
        for cluster in bench_clusters:
            all_bench_ids.update(cluster['component_ids'])

        print(f"✅ Loaded {len(self.manual_clusters)} manual clusters")
        print(f"🎯 Need to extract {len(all_bench_ids)} bench components from raw data")

        print("📊 Loading and filtering raw street furniture data...")
        # Load raw data in chunks to handle large file
        raw_components = []
        chunk_size = 10000

        with open(self.raw_data_path, 'r') as f:
            raw_list = json.load(f)

        print(f"📈 Processing {len(raw_list)} total components...")

        # Filter for bench components only
        for component in raw_list:
            if component['objectid'] in all_bench_ids:
                # Add geometric calculations
                coords = component['geo_shape']['geometry']['coordinates']
                geom = LineString(coords)

                component['geometry'] = geom
                component['point_count'] = len(coords)
                component['length_m'] = geom.length * 111000  # Rough lat/lon to meters

                # Calculate oriented envelope dimensions
                bounds = geom.bounds
                length = max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 111000
                width = min(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 111000
                component['envelope_length_m'] = length
                component['envelope_width_m'] = width
                component['aspect_ratio'] = width / length if length > 0 else 0

                raw_components.append(component)

        self.raw_data = pd.DataFrame(raw_components)
        print(f"✅ Loaded {len(self.raw_data)} bench components from raw data")

    def extract_bench_components(self):
        """Add cluster information to the already filtered bench components."""
        bench_clusters = [c for c in self.manual_clusters if c['type'] == 'benches']
        print(f"🪑 Found {len(bench_clusters)} validated bench clusters")

        # Raw data is already filtered to bench components
        self.bench_components = self.raw_data.copy()

        # Add cluster information
        id_to_cluster = {}
        for cluster in bench_clusters:
            for comp_id in cluster['component_ids']:
                id_to_cluster[comp_id] = {
                    'cluster_id': cluster['id'],
                    'component_count': cluster['component_count'],
                    'arrondissement': cluster['arrondissement'],
                    'total_length': cluster['total_length'],
                    'confidence': cluster['confidence']
                }

        for col in ['cluster_id', 'component_count', 'arrondissement', 'total_length', 'confidence']:
            self.bench_components[col] = self.bench_components['objectid'].map(
                lambda x: id_to_cluster.get(x, {}).get(col)
            )

        print(f"✅ Processed {len(self.bench_components)} bench components with cluster info")
        return self.bench_components
    
    def analyze_component_patterns(self):
        """Analyze coordinate patterns and geometric properties of bench components."""
        print("\n📐 Analyzing Component Patterns")
        print("=" * 50)
        
        # Point count distribution by component count
        pattern_analysis = self.bench_components.groupby(['component_count', 'point_count']).size().reset_index(name='count')
        
        print("Point count patterns by bench type:")
        for comp_count in sorted(pattern_analysis['component_count'].unique()):
            subset = pattern_analysis[pattern_analysis['component_count'] == comp_count]
            print(f"\n{comp_count}-component benches:")
            for _, row in subset.iterrows():
                print(f"  {row['point_count']} points: {row['count']} components")
        
        # Geometric properties analysis
        print("\n📏 Geometric Properties Analysis:")
        
        # Single-component benches detailed analysis
        single_benches = self.bench_components[self.bench_components['component_count'] == 1]
        if len(single_benches) > 0:
            print(f"\nSingle-component benches ({len(single_benches)} components):")
            print(f"  Point counts: {sorted(single_benches['point_count'].unique())}")
            print(f"  Length range: {single_benches['length_m'].min():.2f} - {single_benches['length_m'].max():.2f}m")
            print(f"  Length mean: {single_benches['length_m'].mean():.2f}m ± {single_benches['length_m'].std():.2f}m")
            
            # Analyze by point count
            for pc in sorted(single_benches['point_count'].unique()):
                subset = single_benches[single_benches['point_count'] == pc]
                print(f"  {pc}-point benches: {len(subset)} examples, avg length: {subset['length_m'].mean():.2f}m")
        
        return pattern_analysis
    
    def analyze_spatial_relationships(self):
        """Calculate distances and spatial relationships in multi-component benches."""
        print("\n🗺️ Analyzing Spatial Relationships")
        print("=" * 50)
        
        multi_component_clusters = [c for c in self.manual_clusters 
                                  if c['type'] == 'benches' and c['component_count'] > 1]
        
        spatial_stats = []
        
        for cluster in multi_component_clusters:
            comp_ids = cluster['component_ids']
            components = self.bench_components[self.bench_components['objectid'].isin(comp_ids)]
            
            if len(components) < 2:
                continue
                
            # Calculate pairwise distances
            centroids = [geom.centroid for geom in components['geometry']]
            coords = [(p.x, p.y) for p in centroids]
            
            if len(coords) >= 2:
                distances = pdist(coords)
                
                spatial_stats.append({
                    'cluster_id': cluster['id'],
                    'component_count': cluster['component_count'],
                    'min_distance': np.min(distances) * 111000,  # Convert to meters
                    'max_distance': np.max(distances) * 111000,
                    'mean_distance': np.mean(distances) * 111000,
                    'arrondissement': cluster['arrondissement']
                })
        
        spatial_df = pd.DataFrame(spatial_stats)
        
        if len(spatial_df) > 0:
            print("Distance statistics by component count:")
            for comp_count in sorted(spatial_df['component_count'].unique()):
                subset = spatial_df[spatial_df['component_count'] == comp_count]
                print(f"\n{comp_count}-component benches ({len(subset)} examples):")
                print(f"  Min distance: {subset['min_distance'].mean():.2f}m ± {subset['min_distance'].std():.2f}m")
                print(f"  Max distance: {subset['max_distance'].mean():.2f}m ± {subset['max_distance'].std():.2f}m")
                print(f"  Mean distance: {subset['mean_distance'].mean():.2f}m ± {subset['mean_distance'].std():.2f}m")
        
        return spatial_df
    
    def calculate_canonical_dimensions(self):
        """Calculate canonical dimensions from single-component benches."""
        print("\n📐 Calculating Canonical Dimensions")
        print("=" * 50)

        single_benches = self.bench_components[self.bench_components['component_count'] == 1]

        canonical_stats = {}

        for point_count in sorted(single_benches['point_count'].unique()):
            subset = single_benches[single_benches['point_count'] == point_count]

            # Use pre-calculated envelope dimensions
            lengths = subset['envelope_length_m'].values
            widths = subset['envelope_width_m'].values
            aspect_ratios = subset['aspect_ratio'].values
            total_lengths = subset['length_m'].values

            canonical_stats[point_count] = {
                'count': len(subset),
                'envelope_length_mean': np.mean(lengths),
                'envelope_length_std': np.std(lengths),
                'envelope_width_mean': np.mean(widths),
                'envelope_width_std': np.std(widths),
                'aspect_ratio_mean': np.mean(aspect_ratios),
                'aspect_ratio_std': np.std(aspect_ratios),
                'total_length_mean': np.mean(total_lengths),
                'total_length_std': np.std(total_lengths),
                'length_range': (np.min(lengths), np.max(lengths)),
                'width_range': (np.min(widths), np.max(widths)),
                'aspect_ratio_range': (np.min(aspect_ratios), np.max(aspect_ratios))
            }

            print(f"\n{point_count}-point single benches ({len(subset)} examples):")
            print(f"  Envelope Length: {np.mean(lengths):.2f}m ± {np.std(lengths):.2f}m (range: {np.min(lengths):.2f}-{np.max(lengths):.2f}m)")
            print(f"  Envelope Width: {np.mean(widths):.2f}m ± {np.std(widths):.2f}m (range: {np.min(widths):.2f}-{np.max(widths):.2f}m)")
            print(f"  Aspect Ratio: {np.mean(aspect_ratios):.3f} ± {np.std(aspect_ratios):.3f} (range: {np.min(aspect_ratios):.3f}-{np.max(aspect_ratios):.3f})")
            print(f"  Total Length: {np.mean(total_lengths):.2f}m ± {np.std(total_lengths):.2f}m")

            # Calculate 2% tolerance ranges
            length_tol = np.mean(lengths) * 0.02
            width_tol = np.mean(widths) * 0.02
            print(f"  2% tolerance - Envelope Length: ±{length_tol:.3f}m, Width: ±{width_tol:.3f}m")

            # Show individual examples for detailed analysis
            print(f"  Individual examples:")
            for i, (_, row) in enumerate(subset.head(3).iterrows()):
                print(f"    #{i+1}: objectid={row['objectid']}, L={row['envelope_length_m']:.2f}m, W={row['envelope_width_m']:.2f}m, AR={row['aspect_ratio']:.3f}")

        return canonical_stats

    def analyze_multi_component_geometry(self):
        """Detailed geometric analysis of multi-component benches."""
        print("\n🔧 Multi-Component Geometric Analysis")
        print("=" * 50)

        multi_clusters = [c for c in self.manual_clusters
                         if c['type'] == 'benches' and c['component_count'] > 1]

        geometric_patterns = {}

        for cluster in multi_clusters:
            comp_count = cluster['component_count']
            if comp_count not in geometric_patterns:
                geometric_patterns[comp_count] = []

            comp_ids = cluster['component_ids']
            components = self.bench_components[self.bench_components['objectid'].isin(comp_ids)]

            if len(components) == 0:
                continue

            # Analyze component patterns
            point_counts = sorted(components['point_count'].tolist())
            lengths = components['envelope_length_m'].tolist()
            widths = components['envelope_width_m'].tolist()
            aspect_ratios = components['aspect_ratio'].tolist()

            # Calculate spatial metrics
            centroids = [geom.centroid for geom in components['geometry']]
            coords = [(p.x, p.y) for p in centroids]

            if len(coords) >= 2:
                distances = pdist(coords)
                min_dist = np.min(distances) * 111000
                max_dist = np.max(distances) * 111000
                mean_dist = np.mean(distances) * 111000
            else:
                min_dist = max_dist = mean_dist = 0

            pattern = {
                'cluster_id': cluster['id'],
                'point_count_pattern': point_counts,
                'envelope_lengths': lengths,
                'envelope_widths': widths,
                'aspect_ratios': aspect_ratios,
                'min_distance_m': min_dist,
                'max_distance_m': max_dist,
                'mean_distance_m': mean_dist,
                'total_cluster_length': cluster['total_length'],
                'arrondissement': cluster['arrondissement']
            }

            geometric_patterns[comp_count].append(pattern)

        # Summarize patterns
        for comp_count in sorted(geometric_patterns.keys()):
            patterns = geometric_patterns[comp_count]
            print(f"\n{comp_count}-component benches ({len(patterns)} examples):")

            # Point count patterns
            all_point_patterns = [p['point_count_pattern'] for p in patterns]
            unique_patterns = list(set(tuple(p) for p in all_point_patterns))
            print(f"  Point count patterns: {unique_patterns}")

            # Distance statistics
            min_dists = [p['min_distance_m'] for p in patterns]
            max_dists = [p['max_distance_m'] for p in patterns]
            mean_dists = [p['mean_distance_m'] for p in patterns]

            print(f"  Component distances:")
            print(f"    Min: {np.mean(min_dists):.2f}m ± {np.std(min_dists):.2f}m")
            print(f"    Max: {np.mean(max_dists):.2f}m ± {np.std(max_dists):.2f}m")
            print(f"    Mean: {np.mean(mean_dists):.2f}m ± {np.std(mean_dists):.2f}m")

            # Show examples
            print(f"  Examples:")
            for i, pattern in enumerate(patterns[:3]):
                print(f"    #{i+1}: {pattern['point_count_pattern']} points, distances: {pattern['min_distance_m']:.2f}-{pattern['max_distance_m']:.2f}m")

        return geometric_patterns
    
    def compare_with_detection_results(self, detection_results_path=None):
        """Compare manual clusters with current PostGIS detection results."""
        print("\n🔍 Validation Pattern Discovery")
        print("=" * 50)
        
        # Analyze manual cluster characteristics
        bench_clusters = [c for c in self.manual_clusters if c['type'] == 'benches']
        
        print(f"Manual validation summary:")
        print(f"  Total bench clusters: {len(bench_clusters)}")
        
        by_component_count = {}
        for cluster in bench_clusters:
            cc = cluster['component_count']
            if cc not in by_component_count:
                by_component_count[cc] = []
            by_component_count[cc].append(cluster)
        
        for cc in sorted(by_component_count.keys()):
            clusters = by_component_count[cc]
            lengths = [c['total_length'] for c in clusters]
            print(f"  {cc}-component: {len(clusters)} examples, avg length: {np.mean(lengths):.2f}m")
        
        # If detection results available, compare
        if detection_results_path and Path(detection_results_path).exists():
            print(f"\n📊 Comparing with detection results from {detection_results_path}")
            # Load and compare detection results
            # This would require the specific format of your detection results
        
        return by_component_count
    
    def generate_detection_rules(self):
        """Generate programmatic detection rules based on analysis."""
        print("\n🎯 Generating Detection Rules")
        print("=" * 50)

        rules = {
            'single_component_benches': {},
            'multi_component_clustering': {},
            'geometric_validation': {},
            'confidence_scoring': {}
        }

        # Single-component bench rules from canonical dimensions
        canonical_dims = self.calculate_canonical_dimensions()

        for point_count, stats in canonical_dims.items():
            rules['single_component_benches'][f'{point_count}_point'] = {
                'point_count': point_count,
                'envelope_length_canonical': stats['envelope_length_mean'],
                'envelope_width_canonical': stats['envelope_width_mean'],
                'envelope_length_tolerance_2pct': stats['envelope_length_mean'] * 0.02,
                'envelope_width_tolerance_2pct': stats['envelope_width_mean'] * 0.02,
                'aspect_ratio_min': stats['aspect_ratio_range'][0],
                'aspect_ratio_max': stats['aspect_ratio_range'][1],
                'total_length_min': stats['total_length_mean'] - 2 * stats['total_length_std'],
                'total_length_max': stats['total_length_mean'] + 2 * stats['total_length_std'],
                'confidence': 0.98 if point_count == 7 else 0.95,
                'sample_count': stats['count']
            }

        # Multi-component clustering rules
        geometric_patterns = self.analyze_multi_component_geometry()

        clustering_rules = {}
        for comp_count, patterns in geometric_patterns.items():
            if len(patterns) > 0:
                max_dists = [p['max_distance_m'] for p in patterns]
                mean_dists = [p['mean_distance_m'] for p in patterns]

                clustering_rules[f'{comp_count}_component'] = {
                    'component_count': comp_count,
                    'max_distance_mean': np.mean(max_dists),
                    'max_distance_std': np.std(max_dists),
                    'suggested_eps_meters': np.mean(max_dists) + np.std(max_dists),
                    'typical_point_patterns': list(set(tuple(p['point_count_pattern']) for p in patterns)),
                    'confidence': 0.90 if comp_count == 2 else 0.85,
                    'sample_count': len(patterns)
                }

        rules['multi_component_clustering'] = clustering_rules

        # Geometric validation rules
        rules['geometric_validation'] = {
            'rectangle_frame_validation': {
                'min_components': 4,
                'parallel_tolerance_deg': 4,
                'orthogonal_tolerance_deg': 5,
                'length_similarity_tolerance_ratio': 0.02
            },
            'backrest_validation': {
                'straightness_min': 0.98,
                'parallel_angle_tolerance_deg': 4,
                'offset_min_meters': 0.25,
                'offset_max_meters': 0.40,
                'length_similarity_tolerance_ratio': 0.02
            }
        }

        # Confidence scoring based on detection method
        rules['confidence_scoring'] = {
            'single_component_envelope_canonical': 0.98,
            'single_component_length_fallback': 0.90,
            'two_component_frame_backrest': 0.96,
            'rectangle_validation_4_component': 0.90,
            'rect_with_backrest_5_component': 0.85,
            'rect_with_2_backrests_6_component': 0.90
        }

        print("Generated detection rules:")
        print(json.dumps(rules, indent=2, default=str))

        return rules

    def validate_against_current_detection(self, detection_results_path=None):
        """Compare manual clusters against current PostGIS detection results."""
        print("\n🔍 Validation Against Current Detection")
        print("=" * 50)

        # Analyze what we know from manual validation
        bench_clusters = [c for c in self.manual_clusters if c['type'] == 'benches']
        manual_component_ids = set()
        for cluster in bench_clusters:
            manual_component_ids.update(cluster['component_ids'])

        print(f"Manual validation baseline:")
        print(f"  Total bench clusters: {len(bench_clusters)}")
        print(f"  Total bench components: {len(manual_component_ids)}")

        # Component count distribution
        comp_count_dist = {}
        for cluster in bench_clusters:
            cc = cluster['component_count']
            comp_count_dist[cc] = comp_count_dist.get(cc, 0) + 1

        print(f"  Component count distribution:")
        for cc in sorted(comp_count_dist.keys()):
            print(f"    {cc}-component: {comp_count_dist[cc]} benches")

        # Arrondissement distribution
        arr_dist = {}
        for cluster in bench_clusters:
            arr = cluster['arrondissement']
            arr_dist[arr] = arr_dist.get(arr, 0) + 1

        print(f"  Arrondissement distribution:")
        for arr in sorted(arr_dist.keys()):
            print(f"    Arr {arr}: {arr_dist[arr]} benches")

        # If detection results available, load and compare
        if detection_results_path and Path(detection_results_path).exists():
            print(f"\n📊 Loading detection results from {detection_results_path}")
            with open(detection_results_path, 'r') as f:
                detection_data = json.load(f)

            # Extract detected bench component IDs
            detected_component_ids = set()
            total_detected_benches = 0

            for arr_data in detection_data:
                if 'benches' in arr_data:
                    for bench in arr_data['benches']:
                        total_detected_benches += 1
                        if 'components' in bench:
                            detected_component_ids.update(bench['components'])

            print(f"Detection results:")
            print(f"  Total detected benches: {total_detected_benches}")
            print(f"  Total detected components: {len(detected_component_ids)}")

            # Calculate overlap
            overlap = manual_component_ids.intersection(detected_component_ids)
            manual_only = manual_component_ids - detected_component_ids
            detected_only = detected_component_ids - manual_component_ids

            print(f"\nValidation metrics:")
            print(f"  True positives (overlap): {len(overlap)} components")
            print(f"  False negatives (manual only): {len(manual_only)} components")
            print(f"  Potential false positives (detected only): {len(detected_only)} components")

            recall = 0
            precision = 0

            if len(manual_component_ids) > 0:
                recall = len(overlap) / len(manual_component_ids)
                print(f"  Recall: {recall:.2%}")

            if len(detected_component_ids) > 0:
                precision = len(overlap) / len(detected_component_ids)
                print(f"  Precision: {precision:.2%}")

            return {
                'manual_clusters': len(bench_clusters),
                'manual_components': len(manual_component_ids),
                'detected_benches': total_detected_benches,
                'detected_components': len(detected_component_ids),
                'true_positives': len(overlap),
                'false_negatives': len(manual_only),
                'potential_false_positives': len(detected_only),
                'recall': recall,
                'precision': precision
            }

        return {
            'manual_clusters': len(bench_clusters),
            'manual_components': len(manual_component_ids),
            'component_count_distribution': comp_count_dist,
            'arrondissement_distribution': arr_dist
        }
    
    def run_full_analysis(self):
        """Run complete analysis pipeline."""
        print("🚀 Starting Bench Pattern Analysis")
        print("=" * 60)

        # Load data
        self.load_data()

        # Extract bench components
        self.extract_bench_components()

        # Run analyses
        pattern_analysis = self.analyze_component_patterns()
        spatial_analysis = self.analyze_spatial_relationships()
        canonical_dims = self.calculate_canonical_dimensions()
        validation_patterns = self.validate_against_current_detection()
        detection_rules = self.generate_detection_rules()

        # Save results
        results = {
            'pattern_analysis': pattern_analysis.to_dict('records') if pattern_analysis is not None else [],
            'spatial_analysis': spatial_analysis.to_dict('records') if spatial_analysis is not None and len(spatial_analysis) > 0 else [],
            'canonical_dimensions': canonical_dims,
            'validation_patterns': validation_patterns,
            'detection_rules': detection_rules,
            'summary': {
                'total_bench_components': len(self.bench_components) if self.bench_components is not None else 0,
                'unique_clusters': len(self.bench_components['cluster_id'].unique()) if self.bench_components is not None else 0,
                'component_count_distribution': self.bench_components['component_count'].value_counts().to_dict() if self.bench_components is not None else {}
            }
        }

        # Convert numpy types to native Python types for JSON serialization
        def convert_numpy_types(obj):
            if hasattr(obj, 'item'):
                return obj.item()
            elif hasattr(obj, 'tolist'):
                return obj.tolist()
            elif isinstance(obj, dict):
                return {str(k): convert_numpy_types(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_numpy_types(item) for item in obj]
            else:
                return obj

        results_clean = convert_numpy_types(results)

        output_path = Path('bench_pattern_analysis_results.json')
        with open(output_path, 'w') as f:
            json.dump(results_clean, f, indent=2, default=str)

        print(f"\n💾 Results saved to {output_path}")
        print("\n✅ Analysis complete!")

        return results

if __name__ == "__main__":
    # Initialize analyzer
    analyzer = BenchPatternAnalyzer(
        raw_data_path="/Users/flow/Documents/portfolio-projects/ousposer/plan-de-voirie-mobiliers-urbains-jardinieres-bancs-corbeilles-de-rue.json",
        manual_clusters_path="/Users/flow/Documents/portfolio-projects/ousposer/manual_clusters_2025-08-13.json"
    )
    
    # Run analysis
    results = analyzer.run_full_analysis()
