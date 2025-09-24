import { NextRequest, NextResponse } from 'next/server'

const DATA_PROCESSING_URL = process.env.DATA_PROCESSING_URL || 'http://localhost:3000'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const lat = searchParams.get('lat')
    const lon = searchParams.get('lon')
    
    if (!lat || !lon) {
      return NextResponse.json(
        { error: 'Missing required parameters: lat, lon' },
        { status: 400 }
      )
    }

    // Proxy request to data-processing backend
    const response = await fetch(
      `${DATA_PROCESSING_URL}/api/fresh-spots/analyze?lat=${lat}&lon=${lon}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        // Add cache control
        next: { revalidate: 300 } // Cache for 5 minutes
      }
    )

    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`)
    }

    const data = await response.json()
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    })
  } catch (error) {
    console.error('Fresh spot analysis error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze fresh spot' },
      { status: 500 }
    )
  }
}
