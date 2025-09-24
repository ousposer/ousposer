#!/usr/bin/env python3
"""
Extract key insights from bench pattern analysis and generate actionable detection rules.
"""

import json
from pathlib import Path

def analyze_bench_patterns():
    """Analyze the bench pattern results and extract key insights."""
    
    print("🔍 BENCH PATTERN ANALYSIS INSIGHTS")
    print("=" * 60)
    
    # Key findings from the analysis output
    findings = {
        "single_component_benches": {
            "5_point": {
                "count": 6,
                "envelope_length": 2.98,
                "envelope_width": 1.69,
                "aspect_ratio_range": (0.40, 0.89),
                "total_length": 7.13,
                "tolerance_2pct": {"length": 0.060, "width": 0.034}
            },
            "7_point": {
                "count": 14,
                "envelope_length": 2.32,
                "envelope_width": 1.60,
                "aspect_ratio_range": (0.39, 1.00),
                "total_length": 8.69,
                "tolerance_2pct": {"length": 0.046, "width": 0.032}
            }
        },
        "multi_component_patterns": {
            "2_component": {
                "count": 16,
                "pattern": [2, 5],  # Always 2-point + 5-point
                "distance": 0.10,  # Very close components
                "confidence": 0.96
            },
            "4_component": {
                "count": 6,
                "pattern": [2, 2, 2, 2],  # Rectangle frame
                "max_distance": 3.29,
                "suggested_eps": 3.57,
                "confidence": 0.90
            },
            "5_component": {
                "count": 25,
                "pattern": [2, 2, 2, 2, 2],  # Rectangle + 1 backrest
                "max_distance": 2.51,
                "suggested_eps": 3.24,
                "confidence": 0.85
            },
            "6_component": {
                "count": 14,
                "pattern": [2, 2, 2, 2, 2, 2],  # Rectangle + 2 backrests
                "max_distance": 2.84,
                "suggested_eps": 3.35,
                "confidence": 0.90
            }
        }
    }
    
    print("\n📊 KEY FINDINGS:")
    print("-" * 40)
    
    print("\n1. SINGLE-COMPONENT BENCHES:")
    print(f"   • 7-point benches: {findings['single_component_benches']['7_point']['count']} examples (MOST COMMON)")
    print(f"     - Envelope: {findings['single_component_benches']['7_point']['envelope_length']:.2f}m × {findings['single_component_benches']['7_point']['envelope_width']:.2f}m")
    print(f"     - 2% tolerance: ±{findings['single_component_benches']['7_point']['tolerance_2pct']['length']:.3f}m × ±{findings['single_component_benches']['7_point']['tolerance_2pct']['width']:.3f}m")
    print(f"     - Confidence: 98% (highest)")
    
    print(f"   • 5-point benches: {findings['single_component_benches']['5_point']['count']} examples")
    print(f"     - Envelope: {findings['single_component_benches']['5_point']['envelope_length']:.2f}m × {findings['single_component_benches']['5_point']['envelope_width']:.2f}m")
    print(f"     - 2% tolerance: ±{findings['single_component_benches']['5_point']['tolerance_2pct']['length']:.3f}m × ±{findings['single_component_benches']['5_point']['tolerance_2pct']['width']:.3f}m")
    print(f"     - Confidence: 95%")
    
    print("\n2. MULTI-COMPONENT BENCHES:")
    print(f"   • 2-component: {findings['multi_component_patterns']['2_component']['count']} examples")
    print(f"     - Pattern: {findings['multi_component_patterns']['2_component']['pattern']} points (frame + backrest)")
    print(f"     - Distance: {findings['multi_component_patterns']['2_component']['distance']:.2f}m (very close)")
    print(f"     - Confidence: {findings['multi_component_patterns']['2_component']['confidence']:.0%}")
    
    print(f"   • 5-component: {findings['multi_component_patterns']['5_component']['count']} examples (MOST COMMON)")
    print(f"     - Pattern: all 2-point components (rectangle + 1 backrest)")
    print(f"     - DBSCAN eps: {findings['multi_component_patterns']['5_component']['suggested_eps']:.2f}m")
    
    print(f"   • 6-component: {findings['multi_component_patterns']['6_component']['count']} examples")
    print(f"     - Pattern: all 2-point components (rectangle + 2 backrests)")
    print(f"     - DBSCAN eps: {findings['multi_component_patterns']['6_component']['suggested_eps']:.2f}m")
    
    print("\n🎯 DETECTION STRATEGY:")
    print("-" * 40)
    
    print("\nPhase 1: High-Confidence Single Components")
    print("  ✓ Filter 7-point components with envelope 2.32±0.05m × 1.60±0.03m")
    print("  ✓ Filter 5-point components with envelope 2.98±0.06m × 1.69±0.03m")
    print("  ✓ Use 2% tolerance for precise matching")
    print("  ✓ Expected confidence: 95-98%")
    
    print("\nPhase 2: Two-Component Frame+Backrest")
    print("  ✓ DBSCAN with eps=0.13m (very tight clustering)")
    print("  ✓ Look for [2,5] point pattern")
    print("  ✓ Validate frame (2-point) + backrest (5-point) geometry")
    print("  ✓ Expected confidence: 96%")
    
    print("\nPhase 3: Multi-Component Rectangle+Backrests")
    print("  ✓ DBSCAN with eps=3.5m for 4/5/6-component clusters")
    print("  ✓ All components have 2 points (simple line segments)")
    print("  ✓ Validate rectangle frame (4 components)")
    print("  ✓ Validate 1-2 backrest lines inside frame")
    print("  ✓ Expected confidence: 85-90%")
    
    return findings

def generate_config_updates():
    """Generate CONFIG.js updates based on analysis."""
    
    print("\n⚙️ RECOMMENDED CONFIG UPDATES:")
    print("-" * 40)
    
    config_updates = {
        "singleBench": {
            "lengthCanonicalMeters": 2.32,  # 7-point benches (most common)
            "widthCanonicalMeters": 1.60,
            "similarityToleranceRatio": 0.02,  # 2% tolerance
            "minPointCount": 5,
            "lengthMin": 5.0,  # Fallback range
            "lengthMax": 10.0
        },
        "multiPiece": {
            "lengthMin": 0.5,  # 2-point components can be very short
            "lengthMax": 8.0,
            "lengthSimilarityToleranceRatio": 0.02
        },
        "cluster": {
            "epsMeters": 3.5,  # For 4/5/6-component benches
            "twoComponentEpsMeters": 0.13,  # For 2-component benches
            "minPoints": 1
        },
        "backrest": {
            "offsetMinMeters": 0.25,
            "offsetMaxMeters": 0.40,
            "angleParallelToleranceDeg": 4,
            "straightnessMin": 0.98
        }
    }
    
    print("\nCONFIG.js updates:")
    print(json.dumps(config_updates, indent=2))
    
    return config_updates

def generate_detection_algorithm():
    """Generate the improved detection algorithm."""
    
    print("\n🤖 IMPROVED DETECTION ALGORITHM:")
    print("-" * 40)
    
    algorithm = """
1. SINGLE-COMPONENT DETECTION (Highest Priority):
   - Filter components with 7 points AND envelope 2.32±0.05m × 1.60±0.03m
   - Filter components with 5 points AND envelope 2.98±0.06m × 1.69±0.03m
   - Use ST_OrientedEnvelope for precise measurements
   - Confidence: 95-98%

2. TWO-COMPONENT DETECTION:
   - DBSCAN clustering with eps=0.13m (very tight)
   - Validate [2,5] point pattern
   - Check frame (2-point) + backrest (5-point) geometry
   - Confidence: 96%

3. MULTI-COMPONENT DETECTION:
   - DBSCAN clustering with eps=3.5m
   - Filter for 4/5/6-component clusters
   - All components must have 2 points
   - Validate rectangle frame (4 components)
   - Validate 1-2 backrest lines (parallel, inside frame)
   - Confidence: 85-90%

4. GEOMETRIC VALIDATION:
   - Rectangle: parallel/orthogonal tolerance ±4-5°
   - Length similarity: ±2% tolerance
   - Backrest offset: 0.25-0.40m from frame
   - Backrest straightness: ≥98%
"""
    
    print(algorithm)
    
    return algorithm

def main():
    """Run the complete insights analysis."""
    
    # Analyze patterns
    findings = analyze_bench_patterns()
    
    # Generate config updates
    config_updates = generate_config_updates()
    
    # Generate algorithm
    algorithm = generate_detection_algorithm()
    
    print("\n🎯 NEXT STEPS:")
    print("-" * 40)
    print("1. Update CONFIG.js with the canonical dimensions")
    print("2. Implement two-tier DBSCAN clustering (0.13m and 3.5m eps)")
    print("3. Add envelope-based single-component detection")
    print("4. Test against the 285 validated bench components")
    print("5. Aim for 95%+ detection rate with validated examples")
    
    # Save results
    results = {
        "findings": findings,
        "config_updates": config_updates,
        "algorithm": algorithm,
        "validation_baseline": {
            "total_bench_clusters": 81,
            "total_bench_components": 285,
            "single_component": 20,
            "multi_component": 61
        }
    }
    
    output_path = Path('bench_detection_insights.json')
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n💾 Detailed insights saved to {output_path}")
    print("\n✅ Analysis complete! Ready to implement improved detection.")

if __name__ == "__main__":
    main()
