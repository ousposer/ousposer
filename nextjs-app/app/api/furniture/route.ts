import { NextRequest, NextResponse } from 'next/server'

const DATA_PROCESSING_URL = process.env.DATA_PROCESSING_URL || 'http://localhost:3000'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Forward all query parameters to the backend
    const queryString = searchParams.toString()
    const url = `${DATA_PROCESSING_URL}/api/furniture${queryString ? `?${queryString}` : ''}`
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
      // Cache furniture data for 10 minutes
      next: { revalidate: 600 }
    })

    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`)
    }

    const data = await response.json()
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200'
      }
    })
  } catch (error) {
    console.error('Furniture data error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch furniture data' },
      { status: 500 }
    )
  }
}
