// Geometry helpers: precise distance, angle, rectangle validation

function toRadians(deg) { return (deg * Math.PI) / 180; }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRadians(lat1))*Math.cos(toRadians(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function lonDegreesPerMeterAtLat(lat) {
  // meters per degree longitude ~ 111320 * cos(lat)
  return 1 / (111320 * Math.cos(toRadians(lat)));
}

function latDegreesPerMeter() {
  return 1 / 111320;
}

function vectorAngleDeg([x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  return (ang + 360) % 360; // 0-360
}

function angleDiffDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// Validate a rectangle: four sides with two parallel pairs and near-orthogonal adjacent sides.
// segments: array of {p1:[lon,lat], p2:[lon,lat], length}
function isRectangle(segments, { parallelTol=5, orthoTol=7, lengthTolRatio=0.15 } = {}) {
  if (!segments || segments.length !== 4) return false;
  const angles = segments.map(s => vectorAngleDeg(s.p1, s.p2));
  // Find parallel pairs: we try pairing indices based on angle closeness
  // Simple heuristic: sort by angle, pair 0-1 and 2-3 if parallel
  const idx = [0,1,2,3].sort((i,j) => angles[i]-angles[j]);
  const pairs = [[idx[0], idx[1]],[idx[2], idx[3]]];
  const parallelOk = pairs.every(([i,j]) => angleDiffDeg(angles[i], angles[j]) <= parallelTol);
  if (!parallelOk) return false;
  // Check orthogonality across pairs
  const meanA = (angles[idx[0]] + angles[idx[1]])/2;
  const meanB = (angles[idx[2]] + angles[idx[3]])/2;
  if (angleDiffDeg(meanA, meanB) < 90 - orthoTol || angleDiffDeg(meanA, meanB) > 90 + orthoTol) return false;
  // Length similarity
  const lenPair1 = [segments[idx[0]].length, segments[idx[1]].length];
  const lenPair2 = [segments[idx[2]].length, segments[idx[3]].length];
  const sim = (a,b) => Math.abs(a-b) / Math.max(a,b) <= lengthTolRatio;
  return sim(lenPair1[0], lenPair1[1]) && sim(lenPair2[0], lenPair2[1]);
}

module.exports = { haversineMeters, lonDegreesPerMeterAtLat, latDegreesPerMeter, vectorAngleDeg, angleDiffDeg, isRectangle };

