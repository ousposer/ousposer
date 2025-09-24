import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-6">
          OusPoser
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Find the perfect fresh spots in Paris for hot weather relief
        </p>
        
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-md">
            <div className="text-blue-500 text-3xl mb-4">🌳</div>
            <h3 className="text-lg font-semibold mb-2">Shade Coverage</h3>
            <p className="text-gray-600">
              Find areas with tree coverage and natural shade for cooling relief
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-6 shadow-md">
            <div className="text-green-500 text-3xl mb-4">🪑</div>
            <h3 className="text-lg font-semibold mb-2">Seating Available</h3>
            <p className="text-gray-600">
              Discover benches and seating areas for comfortable rest
            </p>
          </div>
          
          <div className="bg-white rounded-lg p-6 shadow-md">
            <div className="text-orange-500 text-3xl mb-4">🗑️</div>
            <h3 className="text-lg font-semibold mb-2">Convenience</h3>
            <p className="text-gray-600">
              Locate nearby amenities like trash cans and facilities
            </p>
          </div>
        </div>
        
        <div className="space-y-4">
          <Link 
            href="/map" 
            className="inline-block bg-blue-500 text-white px-8 py-3 rounded-lg text-lg font-semibold hover:bg-blue-600 transition-colors"
          >
            Explore Fresh Spots Map
          </Link>
          
          <div className="text-sm text-gray-500">
            <p>Data includes 190,005 trees, 7,858 benches, and 26,879 trash cans across Paris</p>
          </div>
        </div>
      </div>
    </div>
  )
}
