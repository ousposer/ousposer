"use client"

import { useEffect, useState, useRef } from "react"
import {
	MapContainer,
	TileLayer,
	useMapEvents,
	CircleMarker,
	Popup,
	Circle,
} from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import HeatmapLayer from "./heatmap-layer"
import SmoothHeatmapLayer, {
	HeatmapGradientType,
	isWebGLSupported,
} from "./smooth-heatmap-layer"

// Fix for default markers in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
	iconRetinaUrl:
		"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
	iconUrl:
		"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
	shadowUrl:
		"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
})

// Paris bounds
const PARIS_CENTER: [number, number] = [48.8566, 2.3522]
const PARIS_BOUNDS: [[number, number], [number, number]] = [
	[48.8, 2.2], // Southwest
	[48.92, 2.5], // Northeast
]

interface FreshSpotAnalysis {
	location: {
		latitude: number
		longitude: number
	}
	analysis: {
		shade: {
			score: number
			tree_count: number
			best_shade_score: number
			average_shade_score: number
			closest_tree_distance: number
			trees: Array<{
				tree_id: number
				common_name: string
				shade_score: number
				estimated_canopy_radius_m: number
				latitude: number
				longitude: number
				distance_m: number
			}>
		}
		seating: {
			score: number
			bench_count: number
			total_seating_length: number
			closest_bench_distance: number
			benches: Array<{
				bench_id: string
				bench_type: string
				total_length_m: number
				latitude: number
				longitude: number
				distance_m: number
			}>
		}
		convenience: {
			score: number
			trash_can_count: number
			closest_trash_can_distance: number
			trash_cans: Array<{
				poubelle_id: string
				latitude: number
				longitude: number
				distance_m: number
			}>
		}
	}
	scoring: {
		overall_score: number
		rating: string
		meets_requirements: boolean
	}
	metadata: {
		analyzed_at: string
		algorithm_version: string
		search_radii: {
			TREES: number
			BENCHES: number
			TRASH_CANS: number
		}
		response_time_ms: number
		api_version: string
	}
}

// Helper functions for visual markers
function getTreeColor(shadeScore: number): string {
	if (shadeScore >= 8) return "#059669" // Green-600 - Excellent shade
	if (shadeScore >= 6) return "#16A34A" // Green-500 - Good shade
	if (shadeScore >= 4) return "#65A30D" // Lime-600 - Fair shade
	return "#CA8A04" // Yellow-600 - Poor shade
}

function getBenchColor(): string {
	return "#2563EB" // Blue-600 - Consistent bench color
}

function getTrashCanColor(): string {
	return "#EA580C" // Orange-600 - Consistent trash can color
}

function MapClickHandler({
	onMapClick,
}: {
	onMapClick: (lat: number, lon: number) => void
}) {
	useMapEvents({
		click: (e) => {
			onMapClick(e.latlng.lat, e.latlng.lng)
		},
	})
	return null
}

export default function FreshSpotMap() {
	const [analysis, setAnalysis] = useState<FreshSpotAnalysis | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [showHeatmap, setShowHeatmap] = useState(true)
	const [showSmoothHeatmap, setShowSmoothHeatmap] = useState(false)
	const [heatmapGradient, setHeatmapGradient] =
		useState<HeatmapGradientType>("viridis")
	const [heatmapIntensity, setHeatmapIntensity] = useState(1.0)
	const [webglSupported] = useState(isWebGLSupported())
	const mapRef = useRef<L.Map | null>(null)

	useEffect(() => {
		return () => {
			if (mapRef.current) {
				mapRef.current.remove()
				mapRef.current = null
			}
		}
	}, [])

	const handleMapClick = async (lat: number, lon: number) => {
		setLoading(true)
		setError(null)

		try {
			const response = await fetch(
				`/api/fresh-spots/analyze?lat=${lat}&lon=${lon}`
			)

			if (!response.ok) {
				throw new Error("Failed to analyze location")
			}

			const data = await response.json()
			setAnalysis(data)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error")
			setAnalysis(null)
		} finally {
			setLoading(false)
		}
	}

	const getScoreColor = (score: number) => {
		if (score >= 7) return "bg-blue-500"
		if (score >= 5) return "bg-green-500"
		if (score >= 3) return "bg-yellow-500"
		return "bg-red-500"
	}

	const getScoreLabel = (score: number) => {
		if (score >= 7) return "Excellent"
		if (score >= 5) return "Good"
		if (score >= 3) return "Fair"
		return "Poor"
	}
	console.log(analysis)
	return (
		<div className="h-full relative">
			{/* Map */}
			<MapContainer
				ref={mapRef}
				center={PARIS_CENTER}
				zoom={12}
				className="h-full w-full"
				maxBounds={PARIS_BOUNDS}
				maxBoundsViscosity={1.0}>
				<TileLayer
					attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
					url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
				/>
				<MapClickHandler onMapClick={handleMapClick} />

				{/* Visual markers for analysis results */}
				{analysis && (
					<>
						{/* Search radius circles */}
						<Circle
							center={[analysis.location.latitude, analysis.location.longitude]}
							radius={analysis.metadata.search_radii.TREES}
							pathOptions={{
								color: "#10B981",
								fillColor: "#10B981",
								fillOpacity: 0.1,
								weight: 1,
								dashArray: "5, 5",
							}}
						/>
						<Circle
							center={[analysis.location.latitude, analysis.location.longitude]}
							radius={analysis.metadata.search_radii.TRASH_CANS}
							pathOptions={{
								color: "#F59E0B",
								fillColor: "#F59E0B",
								fillOpacity: 0.05,
								weight: 1,
								dashArray: "10, 5",
							}}
						/>

						{/* Tree markers */}
						{analysis.analysis.shade.trees.map((tree) => (
							<CircleMarker
								key={`tree-${tree.tree_id}`}
								center={[tree.latitude, tree.longitude]}
								radius={6}
								pathOptions={{
									color: getTreeColor(tree.shade_score),
									fillColor: getTreeColor(tree.shade_score),
									fillOpacity: 0.8,
									weight: 2,
								}}>
								<Popup>
									<div className="text-sm">
										<strong>🌳 {tree.common_name}</strong>
										<br />
										Shade Score: {tree.shade_score}/10
										<br />
										Canopy: {tree.estimated_canopy_radius_m}m radius
										<br />
										Distance: {tree.distance_m.toFixed(1)}m
									</div>
								</Popup>
							</CircleMarker>
						))}

						{/* Bench markers */}
						{analysis.analysis.seating.benches.map((bench) => (
							<CircleMarker
								key={`bench-${bench.bench_id}`}
								center={[bench.latitude, bench.longitude]}
								radius={5}
								pathOptions={{
									color: getBenchColor(),
									fillColor: getBenchColor(),
									fillOpacity: 0.8,
									weight: 2,
								}}>
								<Popup>
									<div className="text-sm">
										<strong>🪑 Bench</strong>
										<br />
										Type: {bench.bench_type}
										<br />
										Length: {bench.total_length_m.toFixed(1)}m<br />
										Distance: {bench.distance_m.toFixed(1)}m
									</div>
								</Popup>
							</CircleMarker>
						))}

						{/* Trash can markers */}
						{analysis.analysis.convenience.trash_cans.map((trashCan) => (
							<CircleMarker
								key={`trash-${trashCan.poubelle_id}`}
								center={[trashCan.latitude, trashCan.longitude]}
								radius={4}
								pathOptions={{
									color: getTrashCanColor(),
									fillColor: getTrashCanColor(),
									fillOpacity: 0.8,
									weight: 2,
								}}>
								<Popup>
									<div className="text-sm">
										<strong>🗑️ Trash Can</strong>
										<br />
										Distance: {trashCan.distance_m.toFixed(1)}m
									</div>
								</Popup>
							</CircleMarker>
						))}
					</>
				)}

				{/* Heatmap Layers */}
				<HeatmapLayer
					visible={showHeatmap && !showSmoothHeatmap}
					opacity={0.6}
					minZoom={12}
				/>
				<SmoothHeatmapLayer
					visible={showSmoothHeatmap}
					gradientType={heatmapGradient}
					intensity={heatmapIntensity}
					radius={40}
					blur={15}
					opacity={0.7}
					useWebGL={webglSupported}
				/>
			</MapContainer>

			{/* Enhanced Map Controls */}
			<div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-4 z-[1000] min-w-[280px]">
				<h4 className="text-sm font-semibold mb-3 text-gray-800">
					Heatmap Controls
				</h4>

				{/* Heatmap Type Selection */}
				<div className="space-y-3">
					<div className="flex items-center space-x-3">
						<label className="flex items-center space-x-2 cursor-pointer">
							<input
								type="radio"
								name="heatmapType"
								checked={showHeatmap && !showSmoothHeatmap}
								onChange={() => {
									setShowHeatmap(true)
									setShowSmoothHeatmap(false)
								}}
								className="rounded"
							/>
							<span className="text-sm">Circle Heatmap</span>
						</label>
					</div>

					<div className="flex items-center space-x-3">
						<label className="flex items-center space-x-2 cursor-pointer">
							<input
								type="radio"
								name="heatmapType"
								checked={showSmoothHeatmap}
								onChange={() => {
									setShowSmoothHeatmap(true)
									setShowHeatmap(false)
								}}
								className="rounded"
							/>
							<span className="text-sm">Smooth Heatmap</span>
							{webglSupported && (
								<span className="text-xs bg-green-100 text-green-800 px-1 rounded">
									WebGL
								</span>
							)}
						</label>
					</div>

					<div className="flex items-center space-x-3">
						<label className="flex items-center space-x-2 cursor-pointer">
							<input
								type="radio"
								name="heatmapType"
								checked={!showHeatmap && !showSmoothHeatmap}
								onChange={() => {
									setShowHeatmap(false)
									setShowSmoothHeatmap(false)
								}}
								className="rounded"
							/>
							<span className="text-sm">No Heatmap</span>
						</label>
					</div>
				</div>

				{/* Smooth Heatmap Controls */}
				{showSmoothHeatmap && (
					<div className="mt-4 pt-3 border-t border-gray-200 space-y-3">
						{/* Gradient Selection */}
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Color Gradient
							</label>
							<select
								value={heatmapGradient}
								onChange={(e) =>
									setHeatmapGradient(e.target.value as HeatmapGradientType)
								}
								className="w-full text-xs border border-gray-300 rounded px-2 py-1">
								<option value="viridis">Viridis (Scientific)</option>
								<option value="high-contrast">High Contrast</option>
								<option value="weather">Weather Style</option>
								<option value="blue-mono">Blue Monochrome (100 steps)</option>
							</select>
						</div>

						{/* Intensity Control */}
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Intensity: {heatmapIntensity.toFixed(1)}
							</label>
							<input
								type="range"
								min="0.1"
								max="2.0"
								step="0.1"
								value={heatmapIntensity}
								onChange={(e) =>
									setHeatmapIntensity(parseFloat(e.target.value))
								}
								className="w-full"
							/>
						</div>
					</div>
				)}
			</div>

			{/* Analysis Panel */}
			{(analysis || loading || error) && (
				<div className="absolute top-4 right-4 w-80 bg-white rounded-lg shadow-lg p-6 z-[1000]">
					<h3 className="text-lg font-semibold mb-4">Fresh Spot Analysis</h3>

					{loading && (
						<div className="text-center py-4">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
							<p className="text-gray-600">Analyzing location...</p>
						</div>
					)}

					{error && (
						<div className="text-red-600 text-center py-4">
							<p>Error: {error}</p>
						</div>
					)}

					{analysis && !loading && (
						<div className="space-y-4">
							{/* Overall Score */}
							<div className="text-center">
								<div
									className={`inline-block w-16 h-16 rounded-full ${getScoreColor(
										analysis.scoring.overall_score
									)} text-white flex items-center justify-center text-xl font-bold mb-2`}>
									{analysis.scoring.overall_score.toFixed(1)}
								</div>
								<p className="font-semibold">
									{getScoreLabel(analysis.scoring.overall_score)} Fresh Spot
								</p>
							</div>

							{/* Individual scoring */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm">Shade Coverage</span>
									<div className="flex items-center">
										<div
											className={`w-3 h-3 rounded-full ${getScoreColor(
												analysis.analysis.shade.score
											)} mr-2`}></div>
										<span className="text-sm font-medium">
											{analysis.analysis.shade.score.toFixed(1)}
										</span>
									</div>
								</div>

								<div className="flex items-center justify-between">
									<span className="text-sm">Seating Available</span>
									<div className="flex items-center">
										<div
											className={`w-3 h-3 rounded-full ${getScoreColor(
												analysis.analysis.seating.score
											)} mr-2`}></div>
										<span className="text-sm font-medium">
											{analysis.analysis.seating.score.toFixed(1)}
										</span>
									</div>
								</div>

								<div className="flex items-center justify-between">
									<span className="text-sm">Convenience</span>
									<div className="flex items-center">
										<div
											className={`w-3 h-3 rounded-full ${getScoreColor(
												analysis.analysis.convenience.score
											)} mr-2`}></div>
										<span className="text-sm font-medium">
											{analysis.analysis.convenience.score.toFixed(1)}
										</span>
									</div>
								</div>
							</div>

							{/* Nearby Amenities */}
							<div className="border-t pt-4">
								<h4 className="text-sm font-semibold mb-2">Nearby Amenities</h4>
								<div className="grid grid-cols-3 gap-2 text-center">
									<div>
										<div className="text-green-600 text-lg">🌳</div>
										<div className="text-xs text-gray-600">
											{analysis.analysis.shade.tree_count} trees
										</div>
									</div>
									<div>
										<div className="text-blue-600 text-lg">🪑</div>
										<div className="text-xs text-gray-600">
											{analysis.analysis.seating.bench_count} benches
										</div>
									</div>
									<div>
										<div className="text-orange-600 text-lg">🗑️</div>
										<div className="text-xs text-gray-600">
											{analysis.analysis.convenience.trash_can_count} bins
										</div>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			)}

			{/* Instructions */}
			<div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-md p-4 z-[1000]">
				<p className="text-sm text-gray-600">
					Click anywhere on the map to analyze fresh spot quality
				</p>
			</div>
		</div>
	)
}
