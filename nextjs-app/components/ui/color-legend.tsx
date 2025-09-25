"use client"

import React from "react"
import {
	generateColorLegend,
	FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
	FRESH_SPOT_GRADIENT_WEATHER,
	FRESH_SPOT_GRADIENT_VIRIDIS,
	FRESH_SPOT_GRADIENT_BLUE_MONO,
	ColorStop,
} from "../../utils/color-gradients"

interface ColorLegendProps {
	gradient?: ColorStop[]
	title?: string
	steps?: number
	orientation?: "horizontal" | "vertical"
	showLabels?: boolean
	showScores?: boolean
	className?: string
}

export default function ColorLegend({
	gradient = FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
	title = "Fresh Spot Rating",
	steps = 20,
	orientation = "vertical",
	showLabels = true,
	showScores = true,
	className = "",
}: ColorLegendProps) {
	const legend = generateColorLegend(gradient, steps)

	const isHorizontal = orientation === "horizontal"

	return (
		<div
			className={`bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg ${className}`}>
			{title && (
				<h3 className="text-sm font-semibold text-gray-800 mb-3 text-center">
					{title}
				</h3>
			)}

			<div
				className={`flex ${
					isHorizontal ? "flex-row items-center" : "flex-col"
				} gap-1`}>
				{/* Color gradient bar */}
				<div
					className={`
            ${isHorizontal ? "h-6 w-48" : "w-6 h-48"} 
            rounded-md overflow-hidden border border-gray-300
          `}
					style={{
						background: `linear-gradient(${
							isHorizontal ? "to right" : "to top"
						}, ${gradient
							.map((stop) => `${stop.color} ${stop.position * 100}%`)
							.join(", ")})`,
					}}
				/>

				{/* Labels and scores */}
				{(showLabels || showScores) && (
					<div
						className={`flex ${
							isHorizontal
								? "flex-row justify-between w-48"
								: "flex-col justify-between h-48"
						}`}>
						{/* High value */}
						<div
							className={`text-xs text-gray-700 ${
								isHorizontal ? "text-right" : "text-center"
							}`}>
							{showScores && <div className="font-mono">10.0</div>}
							{showLabels && <div>Excellent</div>}
						</div>

						{/* Mid value */}
						<div
							className={`text-xs text-gray-700 text-center ${
								isHorizontal ? "" : "flex-1 flex flex-col justify-center"
							}`}>
							{showScores && <div className="font-mono">5.0</div>}
							{showLabels && <div>Good</div>}
						</div>

						{/* Low value */}
						<div
							className={`text-xs text-gray-700 ${
								isHorizontal ? "text-left" : "text-center"
							}`}>
							{showScores && <div className="font-mono">0.0</div>}
							{showLabels && <div>Poor</div>}
						</div>
					</div>
				)}
			</div>

			{/* Detailed breakdown */}
			<div className="mt-3 text-xs text-gray-600">
				<div className="grid grid-cols-2 gap-1">
					<div>🌳 Shade</div>
					<div>🪑 Seating</div>
					<div>🗑️ Convenience</div>
					<div>💧 Water cooling</div>
				</div>
			</div>
		</div>
	)
}

// Preset legend components for different gradients
export function HighContrastLegend(props: Omit<ColorLegendProps, "gradient">) {
	return (
		<ColorLegend
			{...props}
			gradient={FRESH_SPOT_GRADIENT_HIGH_CONTRAST}
			title="Fresh Spot Rating (High Contrast)"
		/>
	)
}

export function WeatherLegend(props: Omit<ColorLegendProps, "gradient">) {
	return (
		<ColorLegend
			{...props}
			gradient={FRESH_SPOT_GRADIENT_WEATHER}
			title="Fresh Spot Rating (Weather Style)"
		/>
	)
}

export function ViridisLegend(props: Omit<ColorLegendProps, "gradient">) {
	return (
		<ColorLegend
			{...props}
			gradient={FRESH_SPOT_GRADIENT_VIRIDIS}
			title="Fresh Spot Rating (Viridis)"
		/>
	)
}

export function BlueMonoLegend(props: Omit<ColorLegendProps, "gradient">) {
	return (
		<ColorLegend
			{...props}
			gradient={FRESH_SPOT_GRADIENT_BLUE_MONO}
			title="Fresh Spot Rating (Blue Monochrome)"
		/>
	)
}

// Gradient comparison component
export function GradientComparison() {
	return (
		<div className="bg-white/95 backdrop-blur-sm rounded-lg p-6 shadow-lg">
			<h2 className="text-lg font-bold text-gray-800 mb-4 text-center">
				Enhanced Color Gradients
			</h2>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				<HighContrastLegend
					orientation="horizontal"
					showLabels={false}
					className="bg-transparent shadow-none p-2"
				/>
				<WeatherLegend
					orientation="horizontal"
					showLabels={false}
					className="bg-transparent shadow-none p-2"
				/>
				<ViridisLegend
					orientation="horizontal"
					showLabels={false}
					className="bg-transparent shadow-none p-2"
				/>
				<BlueMonoLegend
					orientation="horizontal"
					showLabels={false}
					className="bg-transparent shadow-none p-2"
				/>
			</div>

			<div className="mt-4 text-sm text-gray-600 text-center">
				<p>
					<strong>Enhanced precision:</strong> Smooth gradients represent scores
					like 0.56, 1.97, 2.44 with distinct colors instead of broad
					categories.
				</p>
			</div>
		</div>
	)
}
