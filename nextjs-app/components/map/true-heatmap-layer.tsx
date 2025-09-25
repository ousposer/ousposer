"use client"

import { useEffect, useState } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import {
	getFreshSpotColor,
	getFreshSpotOpacity,
	FRESH_SPOT_GRADIENT_VIRIDIS,
} from "../../utils/color-gradients"

interface HeatmapPoint {
	lat: number
	lon: number
	score: number
	rating: string
}

interface TrueHeatmapLayerProps {
	visible: boolean
}

export default function TrueHeatmapLayer({ visible }: TrueHeatmapLayerProps) {
	const map = useMap()
	const [heatmapLayer, setHeatmapLayer] = useState<L.LayerGroup | null>(null)
	const [isLoading, setIsLoading] = useState(false)

	// Enhanced color mapping using Viridis gradient for smooth heatmap
	const getColor = (score: number): string => {
		return getFreshSpotColor(score, 10, FRESH_SPOT_GRADIENT_VIRIDIS)
	}

	// Get opacity based on score (higher scores more visible)
	const getOpacity = (score: number): number => {
		return Math.max(0.3, Math.min(0.8, score / 10))
	}

	// Create interpolated heatmap using canvas overlay
	const createHeatmapOverlay = (data: HeatmapPoint[]) => {
		const canvas = document.createElement("canvas")
		const ctx = canvas.getContext("2d")
		if (!ctx) return null

		// Set canvas size based on map container
		const mapContainer = map.getContainer()
		canvas.width = mapContainer.offsetWidth
		canvas.height = mapContainer.offsetHeight

		// Create image data for manipulation
		const imageData = ctx.createImageData(canvas.width, canvas.height)
		const pixels = imageData.data

		// Grid resolution for interpolation
		const gridSize = 20 // pixels
		const influenceRadius = 50 // pixels

		// Convert lat/lon to pixel coordinates
		const dataPoints = data.map((point) => {
			const pixelPoint = map.latLngToContainerPoint([point.lat, point.lon])
			return {
				x: pixelPoint.x,
				y: pixelPoint.y,
				score: point.score,
				color: getColor(point.score),
			}
		})

		// Generate heatmap using inverse distance weighting
		for (let y = 0; y < canvas.height; y += gridSize) {
			for (let x = 0; x < canvas.width; x += gridSize) {
				let totalWeight = 0
				let weightedScore = 0
				let weightedR = 0,
					weightedG = 0,
					weightedB = 0

				// Calculate influence from nearby data points
				for (const point of dataPoints) {
					const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2)

					if (distance <= influenceRadius) {
						const weight = distance === 0 ? 1 : 1 / distance ** 2
						totalWeight += weight
						weightedScore += point.score * weight

						// Extract RGB from hex color
						const hex = point.color.replace("#", "")
						const r = parseInt(hex.substr(0, 2), 16)
						const g = parseInt(hex.substr(2, 2), 16)
						const b = parseInt(hex.substr(4, 2), 16)

						weightedR += r * weight
						weightedG += g * weight
						weightedB += b * weight
					}
				}

				if (totalWeight > 0) {
					const avgScore = weightedScore / totalWeight
					const avgR = Math.round(weightedR / totalWeight)
					const avgG = Math.round(weightedG / totalWeight)
					const avgB = Math.round(weightedB / totalWeight)
					const alpha = Math.round(getOpacity(avgScore) * 255)

					// Fill grid area with interpolated color
					for (let dy = 0; dy < gridSize && y + dy < canvas.height; dy++) {
						for (let dx = 0; dx < gridSize && x + dx < canvas.width; dx++) {
							const pixelIndex = ((y + dy) * canvas.width + (x + dx)) * 4
							pixels[pixelIndex] = avgR // Red
							pixels[pixelIndex + 1] = avgG // Green
							pixels[pixelIndex + 2] = avgB // Blue
							pixels[pixelIndex + 3] = alpha // Alpha
						}
					}
				}
			}
		}

		// Apply the image data to canvas
		ctx.putImageData(imageData, 0, 0)

		// Create Leaflet image overlay
		const bounds = map.getBounds()
		const imageOverlay = L.imageOverlay(canvas.toDataURL(), bounds, {
			opacity: 0.6,
			interactive: false,
		})

		return imageOverlay
	}

	// Fetch heatmap data and create overlay
	const loadHeatmapData = async () => {
		if (!visible || isLoading) return

		setIsLoading(true)
		try {
			const bounds = map.getBounds()
			const zoom = map.getZoom()

			// Only show heatmap at higher zoom levels for performance
			if (zoom < 12) {
				if (heatmapLayer) {
					map.removeLayer(heatmapLayer)
					setHeatmapLayer(null)
				}
				setIsLoading(false)
				return
			}

			const response = await fetch(
				`http://localhost:3000/api/heatmap/zoom/${zoom}?` +
					`north=${bounds.getNorth()}&` +
					`south=${bounds.getSouth()}&` +
					`east=${bounds.getEast()}&` +
					`west=${bounds.getWest()}&` +
					`limit=500`
			)

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`)
			}

			const data: HeatmapPoint[] = await response.json()

			// Remove existing layer
			if (heatmapLayer) {
				map.removeLayer(heatmapLayer)
			}

			if (data.length > 0) {
				// Create new heatmap overlay
				const overlay = createHeatmapOverlay(data)
				if (overlay) {
					const layerGroup = L.layerGroup([overlay])
					layerGroup.addTo(map)
					setHeatmapLayer(layerGroup)
				}
			}
		} catch (error) {
			console.error("Failed to load heatmap data:", error)
		} finally {
			setIsLoading(false)
		}
	}

	// Update heatmap when map moves or zoom changes
	useEffect(() => {
		if (!visible) {
			if (heatmapLayer) {
				map.removeLayer(heatmapLayer)
				setHeatmapLayer(null)
			}
			return
		}

		loadHeatmapData()

		const handleMapUpdate = () => {
			// Debounce map updates
			setTimeout(loadHeatmapData, 300)
		}

		map.on("moveend", handleMapUpdate)
		map.on("zoomend", handleMapUpdate)

		return () => {
			map.off("moveend", handleMapUpdate)
			map.off("zoomend", handleMapUpdate)
		}
	}, [visible, map])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (heatmapLayer) {
				map.removeLayer(heatmapLayer)
			}
		}
	}, [])

	return null // This component doesn't render anything directly
}
