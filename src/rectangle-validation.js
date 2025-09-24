// Build segments from components and validate rectangle frames
const { haversineMeters } = require('./geometry');
const { isRectangle } = require('./geometry');
const { CONFIG } = require('./config');
const { extractCoordinates } = require('./sqlite-helpers');

function segmentFromComponent(comp) {
  // Use first and last coordinate as a segment approximation of the component's dominant line
  const coords = extractCoordinates(comp);
  if (coords.length < 2) return null;
  const p1 = [coords[0].lon, coords[0].lat];
  const p2 = [coords[coords.length - 1].lon, coords[coords.length - 1].lat];
  const length = haversineMeters(p1[1], p1[0], p2[1], p2[0]);
  return { p1, p2, length };
}

function isValidRectangleFrame(components) {
  if (components.length !== 4) return false;
  const segments = components.map(segmentFromComponent).filter(Boolean);
  if (segments.length !== 4) return false;
  return isRectangle(segments, {
    parallelTol: CONFIG.multiPiece.parallelAngleToleranceDeg,
    orthoTol: CONFIG.multiPiece.orthogonalAngleToleranceDeg,
    lengthTolRatio: CONFIG.multiPiece.lengthSimilarityToleranceRatio,
  });
}

module.exports = { isValidRectangleFrame, segmentFromComponent };

