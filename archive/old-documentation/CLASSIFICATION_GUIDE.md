# 🎯 Manual Classification Interface Guide

## Overview

The Manual Classification Interface allows you to validate and correct furniture piece classifications by comparing individual components (precise) with clustered furniture pieces side by side. This creates high-quality training data for machine learning models.

## 🚀 Getting Started

1. **Access the Interface**: Navigate to `http://localhost:3000/classify`
2. **Select Arrondissement**: Choose an arrondissement to work with (start with 9e for test data)
3. **Load Data**: Click "Load Data" to display both components and pieces
4. **Start Classifying**: Click on furniture pieces to begin validation

## 🗺️ Interface Layout

### Left Side: Individual Components (Precise)
- Shows the actual LineString components from the original data
- Color-coded by length:
  - **Red**: Potential benches (4-10m)
  - **Orange**: Medium objects (2-5m)
  - **Blue**: Short objects (0.5-2m)
  - **Gray**: Tiny objects (0-0.5m)
  - **Purple**: Large objects (10m+)

### Right Side: Clustered Furniture Pieces
- Shows the clustered furniture pieces as bounding boxes
- Color-coded by estimated type:
  - **Red**: Poubelles
  - **Green**: Benches
  - **Orange**: Jardinieres (Multi-component)
  - **Purple**: Jardinieres (Single)

### Right Sidebar: Classification Controls
- Piece information and classification buttons
- Export functionality for training data

## 🎮 How to Use

### 1. Load Data
1. Select an arrondissement from the dropdown
2. Optionally filter by furniture type
3. Click "Load Data"
4. Both maps will populate and sync automatically

### 2. Select and Classify Pieces
1. **Click on a furniture piece** (bounding box) in the right map
2. The piece will be highlighted and its components will be highlighted in the left map
3. Both maps will zoom to the selected piece
4. The sidebar will show piece details

### 3. Validate Classification
1. **Compare the components** (left) with the **clustered piece** (right)
2. **Check if the clustering makes sense**:
   - Are all components part of the same furniture piece?
   - Are there missing components that should be included?
   - Are there extra components that don't belong?
3. **Verify the furniture type**:
   - **Poubelles**: Single circular/square objects, ~2.26m length
   - **Benches**: Linear arrangements, multiple components, 5-30m total
   - **Jardinieres**: Garden/planter arrangements, variable shapes
   - **Single Jardinieres**: Individual garden elements

### 4. Correct Classification
1. Click the appropriate classification button:
   - **Poubelles** (Red)
   - **Benches** (Green) 
   - **Jardinieres** (Orange)
   - **Single Jardiniere** (Purple)
2. Click "💾 Save Classification"
3. The interface will automatically move to the next piece

## ⌨️ Keyboard Shortcuts

- **1**: Classify as Poubelles
- **2**: Classify as Benches  
- **3**: Classify as Jardinieres
- **4**: Classify as Single Jardiniere
- **S**: Save current classification
- **N**: Move to next piece

## 🔍 What to Look For

### Good Clustering Examples
- **Benches**: All seat and backrest components grouped together
- **Jardinieres**: All parts of a garden/planter area included
- **Poubelles**: Single objects correctly identified

### Common Errors to Fix
- **Over-clustering**: Multiple separate benches grouped as one
- **Under-clustering**: Single bench split across multiple clusters
- **Type misclassification**: Jardinieres labeled as benches, etc.
- **Outliers**: Unrelated components included in clusters

### Validation Questions
1. **Spatial coherence**: Are all components close together?
2. **Functional coherence**: Do components form a single furniture piece?
3. **Type accuracy**: Is the estimated type correct?
4. **Completeness**: Are any components missing or extra?

## 📊 Training Data Export

1. Click "📥 Export Training Data" to download all manual classifications
2. The exported JSON contains:
   - Original clustering data
   - Manual classifications
   - Confidence scores
   - Timestamps

## 🎯 Recommended Workflow

### Phase 1: Quick Validation (Arrondissement 9)
1. Load arrondissement 9 (contains our test cases)
2. Validate 20-30 pieces to get familiar with the interface
3. Focus on obvious errors first

### Phase 2: Systematic Classification
1. Work through one arrondissement at a time
2. Start with high-density areas (12, 16) where clustering errors are common
3. Classify 50-100 pieces per session

### Phase 3: Quality Control
1. Review exported training data
2. Look for patterns in corrections
3. Use insights to improve clustering algorithms

## 🚀 Tips for Efficient Classification

1. **Use keyboard shortcuts** for speed
2. **Focus on edge cases** - obvious correct classifications can be skipped
3. **Take breaks** - classification accuracy decreases with fatigue
4. **Document patterns** - note common error types for algorithm improvement
5. **Start with familiar areas** - use local knowledge when available

## 🔧 Technical Notes

- **Map Synchronization**: Both maps stay synchronized for easy comparison
- **Component Highlighting**: Selected piece components are highlighted in bold
- **Auto-progression**: Interface automatically moves to next piece after saving
- **Persistent Storage**: Classifications are saved to database immediately
- **Export Format**: JSON format compatible with ML training pipelines

## 📈 Progress Tracking

The interface tracks:
- Number of pieces classified
- Classification accuracy patterns
- Time spent per piece
- Export history

Use the export function regularly to backup your training data and monitor progress.

---

**Happy Classifying! 🎯**

Your manual classifications will directly improve the machine learning models and help create more accurate automated furniture detection for the OusPoser project.
