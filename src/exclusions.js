// Heuristics to exclude known non-bench patterns
// Returns true if a component should be excluded from bench candidates

const { CONFIG } = require('./config');

function isLikelyNonBenchComponent(comp) {
  // comp: { aspect_ratio, point_count, angle_changes_sum }
  const e = CONFIG.exclusions;
  if (comp.aspect_ratio >= e.aspectRatioNearSquare && comp.point_count >= e.pointCountHigh) {
    return true;
  }
  if (typeof comp.angle_changes_sum === 'number') {
    if (comp.angle_changes_sum <= e.angleChangesSumLow || comp.angle_changes_sum >= e.angleChangesSumHigh) {
      return true;
    }
  }
  return false;
}

module.exports = { isLikelyNonBenchComponent };

