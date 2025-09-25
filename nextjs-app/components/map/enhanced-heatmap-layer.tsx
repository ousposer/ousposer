'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  getFreshSpotColor,
  getFreshSpotOpacity,
  FRESH_SPOT_GRADIENT_VIRIDIS,
  FRESH_SPOT_GRADIENT_HIGH_CONTRAST,
  FRESH_SPOT_GRADIENT_WEATHER,
  ColorStop
} from '../../utils/color-gradients'

interface HeatmapPoint {
  lat: number
  lon: number
  score: number
  rating: string
}

interface EnhancedHeatmapLayerProps {
  visible: boolean
  gradient?: ColorStop[]
  intensity?: number
  radius?: number
  blur?: number
  maxZoom?: number
  minOpacity?: number
  maxOpacity?: number
}

export default function EnhancedHeatmapLayer({
  visible,
  gradient = FRESH_SPOT_GRADIENT_VIRIDIS,
  intensity = 1.0,
  radius = 50,
  blur = 15,
  maxZoom = 18,
  minOpacity = 0.1,
  maxOpacity = 0.8
}: EnhancedHeatmapLayerProps) {
  const map = useMap()
  const [heatmapLayer, setHeatmapLayer] = useState<L.ImageOverlay | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const workerRef = useRef<Worker | null>(null)

  // Enhanced color mapping with configurable gradient
  const getColor = useCallback((score: number): string => {
    return getFreshSpotColor(score, 10, gradient)
  }, [gradient])

  // Dynamic opacity based on score and zoom level
  const getOpacity = useCallback((score: number, zoom: number): number => {
    const baseOpacity = Math.max(minOpacity, Math.min(maxOpacity, (score / 10) * intensity))
    const zoomFactor = Math.min(1, zoom / maxZoom)
    return baseOpacity * zoomFactor
  }, [intensity, minOpacity, maxOpacity, maxZoom])

  // Gaussian blur kernel for smooth interpolation
  const createGaussianKernel = (radius: number, sigma?: number): number[] => {
    const size = radius * 2 + 1
    const kernel = new Array(size * size)
    const actualSigma = sigma || radius / 3
    const twoSigmaSquared = 2 * actualSigma * actualSigma
    let sum = 0

    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        const distance = x * x + y * y
        const value = Math.exp(-distance / twoSigmaSquared)
        kernel[(y + radius) * size + (x + radius)] = value
        sum += value
      }
    }

    // Normalize kernel
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= sum
    }

    return kernel
  }

  // Enhanced interpolation using radial basis functions
  const interpolateWithRBF = (
    x: number, 
    y: number, 
    dataPoints: Array<{x: number, y: number, score: number}>,
    influenceRadius: number
  ): number => {
    let totalWeight = 0
    let weightedScore = 0

    for (const point of dataPoints) {
      const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2)
      
      if (distance <= influenceRadius) {
        // Gaussian RBF with smooth falloff
        const normalizedDistance = distance / influenceRadius
        const weight = Math.exp(-normalizedDistance * normalizedDistance * 4)
        
        totalWeight += weight
        weightedScore += point.score * weight
      }
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0
  }

  // Create high-quality heatmap using enhanced algorithms
  const createEnhancedHeatmap = async (data: HeatmapPoint[]): Promise<HTMLCanvasElement | null> => {
    if (!data.length) return null

    const mapContainer = map.getContainer()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // High resolution for crisp rendering
    const pixelRatio = window.devicePixelRatio || 1
    const width = mapContainer.offsetWidth
    const height = mapContainer.offsetHeight
    
    canvas.width = width * pixelRatio
    canvas.height = height * pixelRatio
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    ctx.scale(pixelRatio, pixelRatio)

    // Convert geographic coordinates to pixel coordinates
    const zoom = map.getZoom()
    const dataPoints = data.map(point => {
      const pixelPoint = map.latLngToContainerPoint([point.lat, point.lon])
      return {
        x: pixelPoint.x,
        y: pixelPoint.y,
        score: point.score,
        color: getColor(point.score)
      }
    })

    // Create intensity map with enhanced interpolation
    const intensityMap = new Float32Array(width * height)
    const dynamicRadius = Math.max(20, radius * (zoom / 15))
    
    // Fill intensity map using RBF interpolation
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const intensity = interpolateWithRBF(x, y, dataPoints, dynamicRadius)
        intensityMap[y * width + x] = intensity
      }
      
      // Progress indicator for large datasets
      if (y % 50 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0)) // Yield to main thread
      }
    }

    // Apply Gaussian blur for smooth gradients
    const blurredMap = applyGaussianBlur(intensityMap, width, height, blur)

    // Render final heatmap with enhanced colors
    const imageData = ctx.createImageData(width, height)
    const pixels = imageData.data

    for (let i = 0; i < blurredMap.length; i++) {
      const intensity = blurredMap[i]
      const pixelIndex = i * 4

      if (intensity > 0.01) { // Threshold to avoid noise
        const color = getColor(intensity)
        const opacity = getOpacity(intensity, zoom)
        
        // Parse hex color
        const hex = color.replace('#', '')
        const r = parseInt(hex.substr(0, 2), 16)
        const g = parseInt(hex.substr(2, 2), 16)
        const b = parseInt(hex.substr(4, 2), 16)

        pixels[pixelIndex] = r
        pixels[pixelIndex + 1] = g
        pixels[pixelIndex + 2] = b
        pixels[pixelIndex + 3] = Math.round(opacity * 255)
      }
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas
  }

  // Gaussian blur implementation for smooth gradients
  const applyGaussianBlur = (
    data: Float32Array, 
    width: number, 
    height: number, 
    blurRadius: number
  ): Float32Array => {
    if (blurRadius <= 0) return data

    const kernel = createGaussianKernel(blurRadius)
    const kernelSize = blurRadius * 2 + 1
    const result = new Float32Array(width * height)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0
        let weightSum = 0

        for (let ky = -blurRadius; ky <= blurRadius; ky++) {
          for (let kx = -blurRadius; kx <= blurRadius; kx++) {
            const px = x + kx
            const py = y + ky

            if (px >= 0 && px < width && py >= 0 && py < height) {
              const kernelIndex = (ky + blurRadius) * kernelSize + (kx + blurRadius)
              const weight = kernel[kernelIndex]
              const value = data[py * width + px]

              sum += value * weight
              weightSum += weight
            }
          }
        }

        result[y * width + x] = weightSum > 0 ? sum / weightSum : 0
      }
    }

    return result
  }

  // Fetch heatmap data with bounds optimization
  const fetchHeatmapData = async (): Promise<HeatmapPoint[]> => {
    try {
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      
      const response = await fetch(
        `http://localhost:3000/api/heatmap/zoom/${zoom}?` +
        `north=${bounds.getNorth()}&south=${bounds.getSouth()}&` +
        `east=${bounds.getEast()}&west=${bounds.getWest()}`
      )
      
      if (!response.ok) throw new Error('Failed to fetch heatmap data')
      
      const result = await response.json()
      return result.data.map((point: any) => ({
        lat: parseFloat(point.latitude),
        lon: parseFloat(point.longitude),
        score: parseFloat(point.overall_score),
        rating: point.rating
      }))
    } catch (error) {
      console.error('Error fetching heatmap data:', error)
      return []
    }
  }

  // Update heatmap when map changes
  const updateHeatmap = useCallback(async () => {
    if (!visible || isLoading) return

    setIsLoading(true)
    
    try {
      const data = await fetchHeatmapData()
      const canvas = await createEnhancedHeatmap(data)
      
      if (canvas && map) {
        // Remove existing layer
        if (heatmapLayer) {
          map.removeLayer(heatmapLayer)
        }

        // Create image overlay from canvas
        const bounds = map.getBounds()
        const imageUrl = canvas.toDataURL()
        const overlay = L.imageOverlay(imageUrl, bounds, {
          opacity: 0.7,
          interactive: false
        })

        overlay.addTo(map)
        setHeatmapLayer(overlay)
      }
    } catch (error) {
      console.error('Error updating heatmap:', error)
    } finally {
      setIsLoading(false)
    }
  }, [visible, map, heatmapLayer, isLoading, gradient, intensity, radius, blur])

  // Setup map event listeners
  useEffect(() => {
    if (!map) return

    const handleMapChange = () => {
      // Debounce updates to avoid excessive re-rendering
      setTimeout(updateHeatmap, 300)
    }

    map.on('zoomend', handleMapChange)
    map.on('moveend', handleMapChange)

    // Initial render
    if (visible) {
      updateHeatmap()
    }

    return () => {
      map.off('zoomend', handleMapChange)
      map.off('moveend', handleMapChange)
      
      if (heatmapLayer) {
        map.removeLayer(heatmapLayer)
      }
    }
  }, [map, visible, updateHeatmap])

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

  return null // This component doesn't render anything directly
}
