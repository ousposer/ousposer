'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix for default markers in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

// Paris bounds
const PARIS_CENTER: [number, number] = [48.8566, 2.3522]
const PARIS_BOUNDS: [[number, number], [number, number]] = [
  [48.8, 2.2],   // Southwest
  [48.92, 2.5]   // Northeast
]

interface FreshSpotAnalysis {
  location: {
    latitude: number
    longitude: number
  }
  scores: {
    shade_score: number
    seating_score: number
    convenience_score: number
    overall_score: number
  }
  nearby: {
    trees: number
    benches: number
    trash_cans: number
  }
  rating: string
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng)
    }
  })
  return null
}

export default function FreshSpotMap() {
  const [analysis, setAnalysis] = useState<FreshSpotAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleMapClick = async (lat: number, lon: number) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/fresh-spots/analyze?lat=${lat}&lon=${lon}`)
      
      if (!response.ok) {
        throw new Error('Failed to analyze location')
      }
      
      const data = await response.json()
      setAnalysis(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setAnalysis(null)
    } finally {
      setLoading(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 7) return 'bg-blue-500'
    if (score >= 5) return 'bg-green-500'
    if (score >= 3) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const getScoreLabel = (score: number) => {
    if (score >= 7) return 'Excellent'
    if (score >= 5) return 'Good'
    if (score >= 3) return 'Fair'
    return 'Poor'
  }

  return (
    <div className="h-full relative">
      {/* Map */}
      <MapContainer
        center={PARIS_CENTER}
        zoom={12}
        className="h-full w-full"
        maxBounds={PARIS_BOUNDS}
        maxBoundsViscosity={1.0}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler onMapClick={handleMapClick} />
      </MapContainer>

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
                <div className={`inline-block w-16 h-16 rounded-full ${getScoreColor(analysis.scores.overall_score)} text-white flex items-center justify-center text-xl font-bold mb-2`}>
                  {analysis.scores.overall_score.toFixed(1)}
                </div>
                <p className="font-semibold">{getScoreLabel(analysis.scores.overall_score)} Fresh Spot</p>
              </div>
              
              {/* Individual Scores */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Shade Coverage</span>
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full ${getScoreColor(analysis.scores.shade_score)} mr-2`}></div>
                    <span className="text-sm font-medium">{analysis.scores.shade_score.toFixed(1)}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Seating Available</span>
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full ${getScoreColor(analysis.scores.seating_score)} mr-2`}></div>
                    <span className="text-sm font-medium">{analysis.scores.seating_score.toFixed(1)}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Convenience</span>
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full ${getScoreColor(analysis.scores.convenience_score)} mr-2`}></div>
                    <span className="text-sm font-medium">{analysis.scores.convenience_score.toFixed(1)}</span>
                  </div>
                </div>
              </div>
              
              {/* Nearby Amenities */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-2">Nearby Amenities</h4>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-green-600 text-lg">🌳</div>
                    <div className="text-xs text-gray-600">{analysis.nearby.trees} trees</div>
                  </div>
                  <div>
                    <div className="text-blue-600 text-lg">🪑</div>
                    <div className="text-xs text-gray-600">{analysis.nearby.benches} benches</div>
                  </div>
                  <div>
                    <div className="text-orange-600 text-lg">🗑️</div>
                    <div className="text-xs text-gray-600">{analysis.nearby.trash_cans} bins</div>
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
