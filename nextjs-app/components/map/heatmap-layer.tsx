"use client"

import { useEffect, useState } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import {
	getFreshSpotColor,
	getFreshSpotOpacity,
	FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
} from "../../utils/color-gradients"

interface HeatmapPoint {
	latitude: string
	longitude: string
	overall_score: string
	rating: string
	shade_score: string
	seating_score: string
	convenience_score: string
	tree_count: number
	bench_count: number
	trash_can_count: number
}

interface HeatmapLayerProps {
	visible: boolean
	opacity?: number
	minZoom?: number
}

export default function HeatmapLayer({
	visible = true,
	opacity = 0.6,
	minZoom = 12,
}: HeatmapLayerProps) {
	const map = useMap()
	const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([])
	const [loading, setLoading] = useState(false)
	const [heatmapLayer, setHeatmapLayer] = useState<L.LayerGroup | null>(null)

	// Enhanced color mapping using smooth gradients
	const getEnhancedColor = (score: number): string => {
		return getFreshSpotColor(score, 10, FRESH_SPOT_GRADIENT_HIGH_CONTRAST)
	}

	// Enhanced opacity based on score
	const getEnhancedOpacity = (score: number): number => {
		return getFreshSpotOpacity(score, 10)
	}

	// Get circle radius based on score
	const getCircleRadius = (score: number, zoom: number): number => {
		const baseRadius = Math.max(2, score * 0.8) // 0.8-8 pixels base
		const zoomFactor = Math.max(0.5, zoom - 10) // Scale with zoom
		return baseRadius * zoomFactor
	}

	// Fetch heatmap data based on current map bounds
	const fetchHeatmapData = async () => {
		if (!map || map.getZoom() < minZoom) return

		setLoading(true)
		try {
			const bounds = map.getBounds()
			const zoom = map.getZoom()

			// Use zoom-optimized endpoint for better performance
			const response = await fetch(
				`http://localhost:3000/api/heatmap/zoom/${zoom}?` +
					`north=${bounds.getNorth()}&` +
					`south=${bounds.getSouth()}&` +
					`east=${bounds.getEast()}&` +
					`west=${bounds.getWest()}`
			)

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const result = await response.json()

			if (result.success) {
				setHeatmapData(result.data || [])
			} else {
				console.error("Heatmap API error:", result.error)
			}
		} catch (error) {
			console.error("Failed to fetch heatmap data:", error)
		} finally {
			setLoading(false)
		}
	}

	// Create or update heatmap layer
	useEffect(() => {
		if (!map || !visible || heatmapData.length === 0) {
			if (heatmapLayer) {
				map.removeLayer(heatmapLayer)
				setHeatmapLayer(null)
			}
			return
		}

		// Remove existing layer
		if (heatmapLayer) {
			map.removeLayer(heatmapLayer)
		}

		// Create new layer group
		const newLayer = L.layerGroup()
		const zoom = map.getZoom()

		// Add circles for each heatmap point
		heatmapData.forEach((point) => {
			const score = parseFloat(point.overall_score)
			const lat = parseFloat(point.latitude)
			const lng = parseFloat(point.longitude)

			if (isNaN(lat) || isNaN(lng) || isNaN(score)) return

			const color = getEnhancedColor(score)
			const enhancedOpacity = getEnhancedOpacity(score)
			const radius = getCircleRadius(score, zoom)

			const circle = L.circleMarker([lat, lng], {
				radius: radius,
				fillColor: color,
				color: color,
				weight: 1,
				opacity: enhancedOpacity * opacity,
				fillOpacity: enhancedOpacity * opacity * 0.8,
			})

			// Add popup with details
			circle.bindPopup(`
        <div class="p-2">
          <h3 class="font-semibold text-sm mb-1">Fresh Spot Analysis</h3>
          <div class="text-xs space-y-1">
            <div><strong>Overall Score:</strong> ${score.toFixed(1)}/10</div>
            <div><strong>Rating:</strong> <span class="capitalize">${
							point.rating
						}</span></div>
            <div class="border-t pt-1 mt-1">
              <div><strong>Shade:</strong> ${parseFloat(
								point.shade_score
							).toFixed(1)}/10</div>
              <div><strong>Seating:</strong> ${parseFloat(
								point.seating_score
							).toFixed(1)}/10</div>
              <div><strong>Convenience:</strong> ${parseFloat(
								point.convenience_score
							).toFixed(1)}/10</div>
            </div>
            <div class="border-t pt-1 mt-1">
              <div><strong>Trees:</strong> ${point.tree_count}</div>
              <div><strong>Benches:</strong> ${point.bench_count}</div>
              <div><strong>Trash Cans:</strong> ${point.trash_can_count}</div>
            </div>
          </div>
        </div>
      `)

			newLayer.addLayer(circle)
		})

		// Add layer to map
		newLayer.addTo(map)
		setHeatmapLayer(newLayer)
	}, [map, visible, heatmapData, opacity, minZoom])

	// Fetch data when map moves or zooms
	useEffect(() => {
		if (!map) return

		const handleMapChange = () => {
			fetchHeatmapData()
		}

		// Initial load
		fetchHeatmapData()

		// Listen for map events
		map.on("moveend", handleMapChange)
		map.on("zoomend", handleMapChange)

		return () => {
			map.off("moveend", handleMapChange)
			map.off("zoomend", handleMapChange)
		}
	}, [map, minZoom])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (heatmapLayer && map) {
				map.removeLayer(heatmapLayer)
			}
		}
	}, [])

	return null // This component doesn't render anything directly
}
