export default function MapLoading() {
  return (
    <div className="h-screen flex flex-col">
      {/* Header skeleton */}
      <header className="bg-white shadow-sm border-b">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="h-6 bg-gray-200 rounded w-48 animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-32 animate-pulse"></div>
          </div>
        </div>
      </header>

      {/* Map loading */}
      <div className="flex-1 flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            Loading Fresh Spots Map
          </h2>
          <p className="text-gray-600">
            Preparing heatmap data for Paris...
          </p>
        </div>
      </div>
    </div>
  )
}
