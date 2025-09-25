/**
 * Enhanced color gradient utilities for precise heatmap visualization
 * Supports smooth color transitions for granular score data
 */

export interface ColorStop {
	position: number // 0-1
	color: string // hex color
}

export interface RGBColor {
	r: number
	g: number
	b: number
}

/**
 * Convert hex color to RGB
 */
export function hexToRgb(hex: string): RGBColor {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
	if (!result) throw new Error(`Invalid hex color: ${hex}`)

	return {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16),
	}
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (n: number) =>
		Math.round(Math.max(0, Math.min(255, n)))
			.toString(16)
			.padStart(2, "0")
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Interpolate between two RGB colors
 */
export function interpolateRgb(
	color1: RGBColor,
	color2: RGBColor,
	factor: number
): RGBColor {
	const clampedFactor = Math.max(0, Math.min(1, factor))

	return {
		r: color1.r + (color2.r - color1.r) * clampedFactor,
		g: color1.g + (color2.g - color1.g) * clampedFactor,
		b: color1.b + (color2.b - color1.b) * clampedFactor,
	}
}

/**
 * Get color from gradient based on position (0-1)
 */
export function getGradientColor(
	position: number,
	colorStops: ColorStop[]
): string {
	const clampedPosition = Math.max(0, Math.min(1, position))

	// Sort color stops by position
	const sortedStops = [...colorStops].sort((a, b) => a.position - b.position)

	// Find the two stops to interpolate between
	let lowerStop = sortedStops[0]
	let upperStop = sortedStops[sortedStops.length - 1]

	for (let i = 0; i < sortedStops.length - 1; i++) {
		if (
			clampedPosition >= sortedStops[i].position &&
			clampedPosition <= sortedStops[i + 1].position
		) {
			lowerStop = sortedStops[i]
			upperStop = sortedStops[i + 1]
			break
		}
	}

	// If position is exactly on a stop, return that color
	if (lowerStop.position === upperStop.position) {
		return lowerStop.color
	}

	// Calculate interpolation factor
	const factor =
		(clampedPosition - lowerStop.position) /
		(upperStop.position - lowerStop.position)

	// Interpolate between colors
	const lowerRgb = hexToRgb(lowerStop.color)
	const upperRgb = hexToRgb(upperStop.color)
	const interpolatedRgb = interpolateRgb(lowerRgb, upperRgb, factor)

	return rgbToHex(interpolatedRgb.r, interpolatedRgb.g, interpolatedRgb.b)
}

/**
 * Fresh Spot Score Color Gradients
 * Enhanced with more color stops for precise visualization
 */

// High-contrast gradient for maximum visual distinction
export const FRESH_SPOT_GRADIENT_HIGH_CONTRAST: ColorStop[] = [
	{ position: 0.0, color: "#1a1a1a" }, // Very dark gray - No amenities
	{ position: 0.1, color: "#4c1d95" }, // Deep purple - Very poor
	{ position: 0.2, color: "#7c2d12" }, // Dark red-brown - Poor
	{ position: 0.3, color: "#dc2626" }, // Red - Below average
	{ position: 0.4, color: "#ea580c" }, // Red-orange - Fair
	{ position: 0.5, color: "#f59e0b" }, // Orange - Average
	{ position: 0.6, color: "#eab308" }, // Yellow - Good
	{ position: 0.7, color: "#84cc16" }, // Yellow-green - Very good
	{ position: 0.8, color: "#22c55e" }, // Green - Excellent
	{ position: 0.9, color: "#10b981" }, // Emerald - Outstanding
	{ position: 1.0, color: "#059669" }, // Dark emerald - Perfect
]

// Weather map inspired gradient (blue to red spectrum)
export const FRESH_SPOT_GRADIENT_WEATHER: ColorStop[] = [
	{ position: 0.0, color: "#1e1b4b" }, // Deep navy - Coldest/worst
	{ position: 0.1, color: "#3730a3" }, // Indigo
	{ position: 0.2, color: "#1d4ed8" }, // Blue
	{ position: 0.3, color: "#0ea5e9" }, // Sky blue
	{ position: 0.4, color: "#06b6d4" }, // Cyan
	{ position: 0.5, color: "#10b981" }, // Emerald
	{ position: 0.6, color: "#84cc16" }, // Lime
	{ position: 0.7, color: "#eab308" }, // Yellow
	{ position: 0.8, color: "#f97316" }, // Orange
	{ position: 0.9, color: "#ef4444" }, // Red
	{ position: 1.0, color: "#dc2626" }, // Dark red - Hottest/best
]

// Viridis-inspired gradient (perceptually uniform)
export const FRESH_SPOT_GRADIENT_VIRIDIS: ColorStop[] = [
	{ position: 0.0, color: "#440154" }, // Dark purple
	{ position: 0.1, color: "#482777" }, // Purple
	{ position: 0.2, color: "#3f4a8a" }, // Blue-purple
	{ position: 0.3, color: "#31678e" }, // Blue
	{ position: 0.4, color: "#26838f" }, // Teal
	{ position: 0.5, color: "#1f9d8a" }, // Green-teal
	{ position: 0.6, color: "#6cce5a" }, // Green
	{ position: 0.7, color: "#b6de2b" }, // Yellow-green
	{ position: 0.8, color: "#fee825" }, // Yellow
	{ position: 0.9, color: "#fde047" }, // Bright yellow
	{ position: 1.0, color: "#f0f921" }, // Brightest yellow
]

// 100-step monochromatic blue gradient (deep blue to light blue)
export const FRESH_SPOT_GRADIENT_BLUE_MONO: ColorStop[] = (() => {
	const gradient: ColorStop[] = []

	// Define the blue color range (deep navy to light blue)
	const deepBlue = { r: 8, g: 47, b: 107 } // #082f6b - Deep navy blue
	const lightBlue = { r: 173, g: 216, b: 230 } // #add8e6 - Light blue

	// Generate 100 steps for ultra-smooth transitions
	for (let i = 0; i <= 99; i++) {
		const position = i / 99 // 0 to 1

		// Interpolate between deep blue and light blue
		const r = Math.round(deepBlue.r + (lightBlue.r - deepBlue.r) * position)
		const g = Math.round(deepBlue.g + (lightBlue.g - deepBlue.g) * position)
		const b = Math.round(deepBlue.b + (lightBlue.b - deepBlue.b) * position)

		// Convert to hex
		const hex = `#${r.toString(16).padStart(2, "0")}${g
			.toString(16)
			.padStart(2, "0")}${b.toString(16).padStart(2, "0")}`

		gradient.push({ position, color: hex })
	}

	return gradient
})()

/**
 * Get color for fresh spot score using enhanced gradients
 */
export function getFreshSpotColor(
	score: number,
	maxScore: number = 10,
	gradient: ColorStop[] = FRESH_SPOT_GRADIENT_HIGH_CONTRAST
): string {
	const normalizedScore = Math.max(0, Math.min(1, score / maxScore))
	return getGradientColor(normalizedScore, gradient)
}

/**
 * Get opacity based on score (higher scores more opaque)
 */
export function getFreshSpotOpacity(
	score: number,
	maxScore: number = 10
): number {
	const normalizedScore = Math.max(0, Math.min(1, score / maxScore))
	return 0.3 + normalizedScore * 0.7 // Range: 0.3 to 1.0
}

/**
 * Generate color legend for UI
 */
export function generateColorLegend(
	gradient: ColorStop[] = FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
	steps: number = 10
): Array<{ score: number; color: string; label: string }> {
	const legend = []

	for (let i = 0; i <= steps; i++) {
		const position = i / steps
		const score = position * 10 // Assuming 0-10 scale
		const color = getGradientColor(position, gradient)

		let label = ""
		if (score === 0) label = "No amenities"
		else if (score < 2) label = "Poor"
		else if (score < 4) label = "Fair"
		else if (score < 6) label = "Good"
		else if (score < 8) label = "Very good"
		else label = "Excellent"

		legend.push({ score, color, label })
	}

	return legend
}
