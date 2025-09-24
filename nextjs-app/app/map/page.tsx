import dynamic from 'next/dynamic'
import { Suspense } from 'react'

// Dynamically import the map component with SSR disabled
const FreshSpotMap = dynamic(() => import('@/components/map/fresh-spot-map'), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  )
})

export default function MapPage() {
  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b z-10">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">
              OusPoser - Fresh Spots Map
            </h1>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-600">
                Paris Fresh Spots Heatmap
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Map Container */}
      <div className="flex-1 relative">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Initializing map...</p>
            </div>
          </div>
        }>
          <FreshSpotMap />
        </Suspense>
      </div>
    </div>
  )
}
