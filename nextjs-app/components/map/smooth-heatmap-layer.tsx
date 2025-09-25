"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"
import {
	getFreshSpotColor,
	FRESH_SPOT_GRADIENT_VIRIDIS,
	FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
	FRESH_SPOT_GRADIENT_WEATHER,
	FRESH_SPOT_GRADIENT_BLUE_MONO,
	ColorStop,
} from "../../utils/color-gradients"
import {
	WebGLHeatmapRenderer,
	isWebGLSupported,
	createWebGLHeatmap,
	HeatmapDataPoint,
} from "../../utils/webgl-heatmap"

interface HeatmapPoint {
	lat: number
	lon: number
	score: number
	rating: string
}

export type HeatmapGradientType =
	| "viridis"
	| "high-contrast"
	| "weather"
	| "blue-mono"

interface SmoothHeatmapLayerProps {
	visible: boolean
	gradientType?: HeatmapGradientType
	intensity?: number
	radius?: number
	blur?: number
	opacity?: number
	useWebGL?: boolean
	autoUpdate?: boolean
}

const GRADIENT_PRESETS = {
	viridis: FRESH_SPOT_GRADIENT_VIRIDIS,
	"high-contrast": FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
	weather: FRESH_SPOT_GRADIENT_WEATHER,
	"blue-mono": FRESH_SPOT_GRADIENT_BLUE_MONO,
}

export default function SmoothHeatmapLayer({
	visible,
	gradientType = "viridis",
	intensity = 1.0,
	radius = 40,
	blur = 15,
	opacity = 0.7,
	useWebGL = true,
	autoUpdate = true,
}: SmoothHeatmapLayerProps) {
	const map = useMap()
	const [heatmapLayer, setHeatmapLayer] = useState<L.ImageOverlay | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [renderMethod, setRenderMethod] = useState<"webgl" | "canvas">("canvas")
	const webglRendererRef = useRef<WebGLHeatmapRenderer | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const lastUpdateRef = useRef<string>("")
	const isUpdatingRef = useRef(false)

	const gradient = GRADIENT_PRESETS[gradientType]

	// Initialize rendering method
	useEffect(() => {
		if (useWebGL && isWebGLSupported()) {
			setRenderMethod("webgl")
		} else {
			setRenderMethod("canvas")
			if (useWebGL) {
				console.log("WebGL not supported, falling back to canvas rendering")
			}
		}
	}, [useWebGL])

	// Enhanced color mapping
	const getColor = useCallback(
		(score: number): string => {
			return getFreshSpotColor(score, 10, gradient)
		},
		[gradient]
	)

	// Group points based on zoom level to improve performance
	const groupPointsByZoom = useCallback(
		(points: HeatmapPoint[], zoom: number): HeatmapPoint[] => {
			// At high zoom levels (15+), show all points
			if (zoom >= 15) {
				return points
			}

			// Calculate grid size based on zoom level
			// Lower zoom = larger grid = more grouping
			const gridSize = Math.max(0.001, 0.01 / Math.pow(2, zoom - 10))

			console.log(
				`🔍 Grouping points with grid size: ${gridSize.toFixed(
					6
				)} (zoom: ${zoom})`
			)

			// Group points into grid cells
			const gridGroups = new Map<string, HeatmapPoint[]>()

			points.forEach((point) => {
				// Round coordinates to grid
				const gridLat = Math.round(point.lat / gridSize) * gridSize
				const gridLon = Math.round(point.lon / gridSize) * gridSize
				const gridKey = `${gridLat.toFixed(6)},${gridLon.toFixed(6)}`

				if (!gridGroups.has(gridKey)) {
					gridGroups.set(gridKey, [])
				}
				gridGroups.get(gridKey)!.push(point)
			})

			// Calculate median score for each grid cell
			const groupedPoints: HeatmapPoint[] = []
			gridGroups.forEach((cellPoints, gridKey) => {
				const [gridLat, gridLon] = gridKey.split(",").map(Number)

				// Calculate median score
				const scores = cellPoints.map((p) => p.score).sort((a, b) => a - b)
				const medianScore =
					scores.length % 2 === 0
						? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
						: scores[Math.floor(scores.length / 2)]

				// Use center of grid cell as position
				groupedPoints.push({
					lat: gridLat,
					lon: gridLon,
					score: medianScore,
					rating: `grouped-${cellPoints.length}`, // Indicate this is a grouped point
				})
			})

			console.log(
				`📊 Grouped ${points.length} points into ${groupedPoints.length} grid cells`
			)
			return groupedPoints
		},
		[]
	)

	// Fetch heatmap data from API without caching to avoid visual glitches
	const fetchHeatmapData = useCallback(async (): Promise<HeatmapPoint[]> => {
		try {
			const bounds = map.getBounds()
			const zoom = map.getZoom()

			console.log(`📡 Fetching heatmap data for zoom ${zoom}`)

			const response = await fetch(
				`http://localhost:3000/api/heatmap/zoom/${zoom}?` +
					`north=${bounds.getNorth()}&` +
					`south=${bounds.getSouth()}&` +
					`east=${bounds.getEast()}&` +
					`west=${bounds.getWest()}`
			)

			if (!response.ok) throw new Error("Failed to fetch heatmap data")

			const result = await response.json()
			console.log(`📡 API Response: ${result.data.length} points`)

			const mappedData = result.data.map((point: any) => ({
				lat: parseFloat(point.latitude),
				lon: parseFloat(point.longitude),
				score: parseFloat(point.overall_score),
				rating: point.rating,
			}))

			console.log(
				`🗺️ Received ${mappedData.length} heatmap points for rendering`
			)
			if (mappedData.length > 0) {
				console.log("📍 Sample point:", mappedData[0])
			}

			// Check if data is aggregated (has metadata)
			if (result.metadata?.aggregation_factor) {
				console.log(
					`📊 Server-side aggregation: ${result.metadata.aggregation_factor}x${result.metadata.aggregation_factor} (${result.metadata.effective_grid_size_m}m grid)`
				)
			}

			return mappedData
		} catch (error) {
			console.error("Error fetching heatmap data:", error)
			return []
		}
	}, [map])

	// Canvas rendering method - quadrant-based approach
	const renderWithCanvas = useCallback(
		async (data: HeatmapPoint[]): Promise<HTMLCanvasElement | null> => {
			if (!data.length) {
				console.warn("🎨 No data for canvas rendering")
				return null
			}

			console.log(
				`🎨 Starting quadrant-based canvas rendering with ${data.length} points`
			)
			const mapContainer = map.getContainer()
			const canvas = document.createElement("canvas")
			const ctx = canvas.getContext("2d")
			if (!ctx) {
				console.error("❌ Failed to get canvas 2D context")
				return null
			}

			const pixelRatio = window.devicePixelRatio || 1
			const width = mapContainer.offsetWidth
			const height = mapContainer.offsetHeight

			canvas.width = width * pixelRatio
			canvas.height = height * pixelRatio
			canvas.style.width = width + "px"
			canvas.style.height = height + "px"
			ctx.scale(pixelRatio, pixelRatio)

			// Get current map bounds
			const mapBounds = map.getBounds()
			const zoom = map.getZoom()

			// Calculate quadrant size based on zoom level (100m resolution from API)
			const quadrantSizeMeters = 100
			const metersPerPixel =
				(40075016.686 *
					Math.abs(Math.cos((mapBounds.getCenter().lat * Math.PI) / 180))) /
				Math.pow(2, zoom + 8)
			let quadrantSizePixels = Math.max(
				2, // Minimum 2 pixels for visibility
				quadrantSizeMeters / metersPerPixel
			)

			// Ensure quadrants are visible at all zoom levels
			if (quadrantSizePixels < 4) {
				quadrantSizePixels = Math.max(4, zoom * 0.5) // Scale with zoom
			}

			console.log(`🎯 Quadrant rendering:`)
			console.log(`   Canvas size: ${width}x${height}`)
			console.log(
				`   Zoom: ${zoom}, Meters per pixel: ${metersPerPixel.toFixed(2)}`
			)
			console.log(`   Quadrant size: ${quadrantSizePixels.toFixed(1)} pixels`)
			console.log(`   Rendering ${data.length} quadrants`)

			// Clear canvas with transparent background
			ctx.clearRect(0, 0, width, height)

			// Render each data point as a quadrant rectangle
			let renderedCount = 0
			for (const point of data) {
				// Convert lat/lng to pixel coordinates
				const pixelPoint = map.latLngToContainerPoint([point.lat, point.lon])

				// Check if quadrant is visible on canvas (with some margin)
				const margin = quadrantSizePixels
				if (
					pixelPoint.x < -margin ||
					pixelPoint.x > width + margin ||
					pixelPoint.y < -margin ||
					pixelPoint.y > height + margin
				) {
					continue
				}

				// Get color for this score
				const color = getColor(point.score)

				// Calculate quadrant rectangle (centered on the point)
				const x = Math.round(pixelPoint.x - quadrantSizePixels / 2)
				const y = Math.round(pixelPoint.y - quadrantSizePixels / 2)
				const size = Math.round(quadrantSizePixels)

				// Calculate opacity based on score (higher scores more visible)
				const scoreOpacity = Math.min(1, Math.max(0.3, point.score / 10))
				const finalOpacity = opacity * scoreOpacity

				// Set fill style
				ctx.fillStyle = color
				ctx.globalAlpha = finalOpacity

				// Draw filled rectangle for this quadrant
				ctx.fillRect(x, y, size, size)

				// Optional: Add subtle border for better definition at high zoom
				if (quadrantSizePixels > 8) {
					ctx.globalAlpha = finalOpacity * 0.8
					ctx.strokeStyle = color
					ctx.lineWidth = 0.5
					ctx.strokeRect(x, y, size, size)
				}

				renderedCount++
			}

			// Reset global alpha
			ctx.globalAlpha = 1.0

			console.log(
				`✅ Rendered ${renderedCount}/${data.length} visible quadrants`
			)

			return canvas
		},
		[map, getColor, opacity]
	)

	// Main update function with smart caching
	const updateHeatmap = useCallback(async () => {
		if (!visible || isLoading || isUpdatingRef.current) return

		// Create simplified key for duplicate detection (less strict)
		const bounds = map.getBounds()
		const zoom = map.getZoom()
		const roundedBounds = {
			north: Math.round(bounds.getNorth() * 100) / 100, // Round to 2 decimal places
			south: Math.round(bounds.getSouth() * 100) / 100,
			east: Math.round(bounds.getEast() * 100) / 100,
			west: Math.round(bounds.getWest() * 100) / 100,
		}
		const updateKey = `${zoom}-${roundedBounds.north}-${roundedBounds.south}-${roundedBounds.east}-${roundedBounds.west}-${gradientType}-${intensity}`

		// Only skip if the bounds haven't changed significantly
		if (lastUpdateRef.current === updateKey) {
			console.log("🔄 Skipping duplicate heatmap update (same area)")
			return
		}

		console.log("🗺️ Updating smooth heatmap...")
		isUpdatingRef.current = true
		setIsLoading(true)
		lastUpdateRef.current = updateKey

		try {
			const data = await fetchHeatmapData()
			console.log(`📊 Fetched ${data.length} heatmap points for rendering`)

			if (data.length === 0) {
				console.warn("⚠️ No heatmap data to render")
				return
			}

			let canvas: HTMLCanvasElement | null = null

			// Force canvas rendering for proper quadrant rectangles
			// WebGL is designed for circles/points, canvas is better for rectangles
			console.log("🎨 Using canvas rendering for quadrant rectangles...")
			canvas = await renderWithCanvas(data)

			if (!canvas) {
				console.error("❌ Failed to create canvas")
				return
			}

			if (canvas && map) {
				// Remove existing layer
				if (heatmapLayer) {
					map.removeLayer(heatmapLayer)
					console.log("🗑️ Removed existing heatmap layer")
				}

				// Create image overlay
				const bounds = map.getBounds()
				const imageUrl = canvas.toDataURL()
				console.log(
					`🖼️ Created canvas image (${canvas.width}x${canvas.height})`
				)
				console.log(`🗺️ Map bounds:`, bounds)

				// Debug: Check if canvas has any content
				const ctx = canvas.getContext("2d")
				if (ctx) {
					const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
					const pixels = imageData.data
					let hasContent = false
					for (let i = 3; i < pixels.length; i += 4) {
						// Check alpha channel
						if (pixels[i] > 0) {
							hasContent = true
							break
						}
					}
					console.log(`🎨 Canvas has visible content: ${hasContent}`)
					if (!hasContent) {
						console.warn("⚠️ Canvas appears to be empty/transparent!")
					}
				}

				const overlay = L.imageOverlay(imageUrl, bounds, {
					opacity: 1.0,
					interactive: false,
				})

				overlay.addTo(map)
				setHeatmapLayer(overlay)
				console.log("✅ Smooth heatmap overlay added to map")
			} else {
				console.error("❌ Missing canvas or map for overlay creation")
			}
		} catch (error) {
			console.error("❌ Error updating heatmap:", error)
			// Reset update key on error to allow retry
			lastUpdateRef.current = ""
		} finally {
			setIsLoading(false)
			isUpdatingRef.current = false
		}
	}, [
		visible,
		map,
		heatmapLayer,
		isLoading,
		fetchHeatmapData,
		renderWithCanvas,
		gradientType,
		intensity,
	])

	// Debounced update function to prevent request loops
	const debouncedUpdate = useCallback(() => {
		// Clear any existing timeout
		if (updateTimeoutRef.current) {
			clearTimeout(updateTimeoutRef.current)
		}

		// Set new timeout (reduced debounce for better responsiveness)
		updateTimeoutRef.current = setTimeout(() => {
			if (!isUpdatingRef.current) {
				updateHeatmap()
			}
		}, 200) // 200ms debounce for faster response
	}, [updateHeatmap])

	// Setup map event listeners with proper debouncing
	useEffect(() => {
		if (!map || !autoUpdate) return

		console.log("🎯 Setting up smooth heatmap event listeners")

		map.on("zoomend", debouncedUpdate)
		map.on("moveend", debouncedUpdate)

		// Initial render with delay to avoid conflicts
		if (visible) {
			setTimeout(() => {
				updateHeatmap()
			}, 100)
		}

		return () => {
			console.log("🧹 Cleaning up smooth heatmap event listeners")
			map.off("zoomend", debouncedUpdate)
			map.off("moveend", debouncedUpdate)

			// Clear any pending timeouts
			if (updateTimeoutRef.current) {
				clearTimeout(updateTimeoutRef.current)
			}

			if (heatmapLayer) {
				map.removeLayer(heatmapLayer)
			}
		}
	}, [map, visible, autoUpdate, debouncedUpdate, updateHeatmap])

	// Handle visibility changes
	useEffect(() => {
		if (!heatmapLayer) return

		if (visible) {
			if (!map.hasLayer(heatmapLayer)) {
				heatmapLayer.addTo(map)
			}
		} else {
			if (map.hasLayer(heatmapLayer)) {
				map.removeLayer(heatmapLayer)
			}
		}
	}, [visible, heatmapLayer, map])

	// Manual update trigger (exported for external use if needed)
	const triggerUpdate = useCallback(() => {
		updateHeatmap()
	}, [updateHeatmap])

	// Cleanup
	useEffect(() => {
		return () => {
			console.log("🧹 Cleaning up smooth heatmap component")

			// Clear timeouts
			if (updateTimeoutRef.current) {
				clearTimeout(updateTimeoutRef.current)
			}

			// Reset refs
			isUpdatingRef.current = false
			lastUpdateRef.current = ""

			// Dispose WebGL renderer
			if (webglRendererRef.current) {
				webglRendererRef.current.dispose()
			}
		}
	}, [])

	return null // This component doesn't render anything directly
}

// Export additional utilities
export { isWebGLSupported }
