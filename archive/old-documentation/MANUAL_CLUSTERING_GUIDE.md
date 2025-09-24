# 🎯 Manual Clustering Interface Guide

## Overview

The Manual Clustering Interface allows you to create ground truth training data by manually selecting individual components that belong together as furniture pieces. This approach generates high-quality training examples for improving automatic clustering algorithms.

## 🚀 Getting Started

1. **Access the Interface**: Navigate to `http://localhost:3000/manual-cluster`
2. **Select Arrondissement**: Choose an arrondissement to work with (start with 9e for test data)
3. **Load Components**: Click "Load Components" to display all individual components
4. **Start Clustering**: Click components that belong together, classify, and save

## 🎮 How to Use

### 1. Load Components
1. Select an arrondissement from the dropdown
2. Click "Load Components"
3. All individual components will appear on the map, color-coded by length

### 2. Select Components for a Furniture Piece
1. **Click on components** that you visually identify as belonging to the same furniture piece
2. Selected components will be highlighted in blue with thicker borders
3. The selection panel shows the count and details of selected components
4. You can click selected components again to deselect them

### 3. Classify the Selection
1. Choose the furniture type by clicking one of the classification buttons:
   - **Poubelles** (Red) - Trash cans
   - **Benches** (Green) - Seating areas
   - **Jardinieres** (Orange) - Garden/planter areas
2. The selected button will be highlighted

### 4. Save Training Example
1. Click "💾 Save Training Example" to save your manual cluster
2. The example will be stored in the database as training data
3. The selection will be cleared automatically
4. The training examples panel will update with your new example

### 5. Repeat for More Furniture Pieces
1. Continue selecting and classifying other furniture pieces in the area
2. Build up a collection of high-quality training examples
3. Focus on clear, obvious examples first

## ⌨️ Keyboard Shortcuts

- **1**: Select Poubelles type
- **2**: Select Benches type  
- **3**: Select Jardinieres type
- **S**: Save current selection (if type is selected)
- **C** or **Escape**: Clear current selection

## 🔍 What Makes Good Training Data

### Excellent Examples to Create
- **Clear Benches**: All seat and backrest components that obviously belong together
- **Obvious Poubelles**: Single circular/square components around 2.26m
- **Distinct Jardinieres**: Garden areas with clear boundaries

### What to Focus On
1. **Visual Coherence**: Components that clearly form one furniture piece
2. **Spatial Proximity**: Components close together (typically within 2-5m)
3. **Functional Unity**: Parts that serve the same furniture function
4. **Clear Boundaries**: Avoid ambiguous cases where it's unclear what belongs together

### What to Avoid
- **Ambiguous Cases**: When it's unclear if components belong together
- **Damaged/Incomplete Data**: Components with obvious data errors
- **Mixed Types**: Don't include components from different furniture types
- **Uncertain Boundaries**: Skip cases where the extent is unclear

## 📊 Training Data Export

1. Click "📥 Export Training Data" to download all manual clusters
2. The exported JSON contains:
   - Manual cluster definitions
   - Component IDs for each cluster
   - Classification types
   - Metadata (length, count, timestamps)

## 🎯 Recommended Workflow

### Phase 1: Start with Clear Examples (Arrondissement 9)
1. Load arrondissement 9 (contains our validation test cases)
2. Create 10-15 obvious bench examples
3. Create 5-10 clear poubelle examples
4. Create 5-10 jardiniere examples

### Phase 2: Expand to More Areas
1. Work through other arrondissements systematically
2. Focus on areas with good component density
3. Aim for 50-100 examples per furniture type

### Phase 3: Quality Control
1. Review exported training data for consistency
2. Look for patterns in your selections
3. Use insights to refine automatic clustering parameters

## 🔧 Technical Benefits

### Ground Truth Creation
- **Human Intelligence**: Leverage visual pattern recognition
- **Contextual Understanding**: Use real-world knowledge of furniture
- **Quality Control**: Only save examples you're confident about

### Training Data Quality
- **Precise Boundaries**: Exact component membership for each piece
- **Type Accuracy**: Human-verified furniture classifications
- **Spatial Relationships**: Real examples of how components cluster
- **Parameter Inference**: Data to optimize automatic clustering

### Algorithm Improvement
- **Distance Thresholds**: Learn optimal eps values from real examples
- **Component Patterns**: Understand typical cluster sizes and shapes
- **Type Characteristics**: Identify distinguishing features for each furniture type
- **Validation**: Test automatic clustering against human ground truth

## 🚀 Tips for Efficient Clustering

1. **Start with Obvious Cases**: Build confidence with clear examples
2. **Use Zoom**: Zoom in to see component details clearly
3. **Check Popups**: Click components to see their properties
4. **Work Systematically**: Cover an area methodically rather than jumping around
5. **Take Breaks**: Accuracy decreases with fatigue
6. **Document Patterns**: Note what makes good vs bad clusters

## 📈 Progress Tracking

The interface tracks:
- Number of manual clusters created
- Distribution by furniture type
- Component counts per cluster
- Export history

Use the export function regularly to backup your training data.

## 🔄 Integration with Automatic Clustering

Your manual clusters will be used to:
1. **Validate** automatic clustering results
2. **Optimize** clustering parameters (eps, minPts)
3. **Train** machine learning models for classification
4. **Benchmark** algorithm improvements

## 🎯 Success Metrics

Aim to create:
- **50+ bench examples** with 5-30 components each
- **30+ poubelle examples** (mostly single components)
- **30+ jardiniere examples** with 2-10 components each
- **Geographic diversity** across multiple arrondissements
- **Size diversity** from small to large furniture pieces

---

**Happy Clustering! 🎯**

Your manual clusters will directly improve the automatic clustering algorithms and create the foundation for accurate machine learning models in the OusPoser project.
