/**
 * WebGL-accelerated heatmap rendering for high-performance visualization
 * Uses GPU shaders for real-time interpolation and rendering
 */

export interface HeatmapDataPoint {
	x: number
	y: number
	intensity: number
}

export interface WebGLHeatmapOptions {
	width: number
	height: number
	radius: number
	blur: number
	gradient: string[]
	opacity: number
}

export class WebGLHeatmapRenderer {
	private gl: WebGLRenderingContext | null = null
	private canvas: HTMLCanvasElement
	private program: WebGLProgram | null = null
	private positionBuffer: WebGLBuffer | null = null
	private intensityBuffer: WebGLBuffer | null = null
	private gradientTexture: WebGLTexture | null = null

	// Vertex shader for point positioning
	private vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_intensity;
    
    uniform vec2 u_resolution;
    uniform float u_radius;
    
    varying float v_intensity;
    varying vec2 v_center;
    
    void main() {
      // Convert from pixels to clip space
      vec2 clipSpace = ((a_position / u_resolution) * 2.0) - 1.0;
      gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      
      // Set point size based on radius
      gl_PointSize = u_radius * 2.0;
      
      v_intensity = a_intensity;
      v_center = a_position;
    }
  `

	// Fragment shader for smooth gradient rendering
	private fragmentShaderSource = `
    precision mediump float;
    
    uniform sampler2D u_gradient;
    uniform float u_opacity;
    uniform float u_radius;
    
    varying float v_intensity;
    varying vec2 v_center;
    
    void main() {
      // Calculate distance from center of point
      vec2 coord = gl_PointCoord - vec2(0.5);
      float distance = length(coord) * 2.0;
      
      // Create smooth circular falloff
      float alpha = 1.0 - smoothstep(0.0, 1.0, distance);
      
      // Sample gradient color based on intensity
      vec4 color = texture2D(u_gradient, vec2(v_intensity, 0.5));
      
      // Apply circular mask and opacity (intensity already affects color sampling)
      gl_FragColor = vec4(color.rgb, color.a * alpha * u_opacity);
    }
  `

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas
		this.initWebGL()
	}

	private initWebGL(): boolean {
		try {
			this.gl =
				this.canvas.getContext("webgl") ||
				this.canvas.getContext("experimental-webgl")

			if (!this.gl) {
				console.warn("WebGL not supported, falling back to canvas rendering")
				return false
			}

			// Enable blending for smooth overlays
			this.gl.enable(this.gl.BLEND)
			this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA)

			// Create shader program
			this.program = this.createShaderProgram()
			if (!this.program) return false

			// Create buffers
			this.positionBuffer = this.gl.createBuffer()
			this.intensityBuffer = this.gl.createBuffer()

			return true
		} catch (error) {
			console.error("WebGL initialization failed:", error)
			return false
		}
	}

	private createShader(type: number, source: string): WebGLShader | null {
		if (!this.gl) return null

		const shader = this.gl.createShader(type)
		if (!shader) return null

		this.gl.shaderSource(shader, source)
		this.gl.compileShader(shader)

		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			console.error(
				"Shader compilation error:",
				this.gl.getShaderInfoLog(shader)
			)
			this.gl.deleteShader(shader)
			return null
		}

		return shader
	}

	private createShaderProgram(): WebGLProgram | null {
		if (!this.gl) return null

		const vertexShader = this.createShader(
			this.gl.VERTEX_SHADER,
			this.vertexShaderSource
		)
		const fragmentShader = this.createShader(
			this.gl.FRAGMENT_SHADER,
			this.fragmentShaderSource
		)

		if (!vertexShader || !fragmentShader) return null

		const program = this.gl.createProgram()
		if (!program) return null

		this.gl.attachShader(program, vertexShader)
		this.gl.attachShader(program, fragmentShader)
		this.gl.linkProgram(program)

		if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
			console.error(
				"Shader program linking error:",
				this.gl.getProgramInfoLog(program)
			)
			this.gl.deleteProgram(program)
			return null
		}

		return program
	}

	private createGradientTexture(colors: string[]): WebGLTexture | null {
		if (!this.gl) return null

		const texture = this.gl.createTexture()
		if (!texture) return null

		// Create gradient data
		const width = 256
		const data = new Uint8Array(width * 4) // RGBA

		for (let i = 0; i < width; i++) {
			const t = i / (width - 1)
			const colorIndex = Math.floor(t * (colors.length - 1))
			const localT = t * (colors.length - 1) - colorIndex

			const color1 = this.hexToRgb(colors[colorIndex])
			const color2 = this.hexToRgb(
				colors[Math.min(colorIndex + 1, colors.length - 1)]
			)

			// Linear interpolation between colors
			const r = Math.round(color1.r + (color2.r - color1.r) * localT)
			const g = Math.round(color1.g + (color2.g - color1.g) * localT)
			const b = Math.round(color1.b + (color2.b - color1.b) * localT)

			data[i * 4] = r
			data[i * 4 + 1] = g
			data[i * 4 + 2] = b
			data[i * 4 + 3] = 255
		}

		this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
		this.gl.texImage2D(
			this.gl.TEXTURE_2D,
			0,
			this.gl.RGBA,
			width,
			1,
			0,
			this.gl.RGBA,
			this.gl.UNSIGNED_BYTE,
			data
		)

		// Set texture parameters for smooth interpolation
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MIN_FILTER,
			this.gl.LINEAR
		)
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_MAG_FILTER,
			this.gl.LINEAR
		)
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_WRAP_S,
			this.gl.CLAMP_TO_EDGE
		)
		this.gl.texParameteri(
			this.gl.TEXTURE_2D,
			this.gl.TEXTURE_WRAP_T,
			this.gl.CLAMP_TO_EDGE
		)

		return texture
	}

	private hexToRgb(hex: string): { r: number; g: number; b: number } {
		const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
		return result
			? {
					r: parseInt(result[1], 16),
					g: parseInt(result[2], 16),
					b: parseInt(result[3], 16),
			  }
			: { r: 0, g: 0, b: 0 }
	}

	public render(
		dataPoints: HeatmapDataPoint[],
		options: WebGLHeatmapOptions
	): boolean {
		if (!this.gl || !this.program || !dataPoints.length) return false

		// Set canvas size
		this.canvas.width = options.width
		this.canvas.height = options.height
		this.gl.viewport(0, 0, options.width, options.height)

		// Clear canvas
		this.gl.clearColor(0, 0, 0, 0)
		this.gl.clear(this.gl.COLOR_BUFFER_BIT)

		// Use shader program
		this.gl.useProgram(this.program)

		// Create or update gradient texture
		if (!this.gradientTexture) {
			this.gradientTexture = this.createGradientTexture(options.gradient)
		}

		// Bind gradient texture
		this.gl.activeTexture(this.gl.TEXTURE0)
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.gradientTexture)

		// Set uniforms
		const resolutionLocation = this.gl.getUniformLocation(
			this.program,
			"u_resolution"
		)
		const radiusLocation = this.gl.getUniformLocation(this.program, "u_radius")
		const opacityLocation = this.gl.getUniformLocation(
			this.program,
			"u_opacity"
		)
		const gradientLocation = this.gl.getUniformLocation(
			this.program,
			"u_gradient"
		)

		this.gl.uniform2f(resolutionLocation, options.width, options.height)
		this.gl.uniform1f(radiusLocation, options.radius)
		this.gl.uniform1f(opacityLocation, options.opacity)
		this.gl.uniform1i(gradientLocation, 0)

		// Prepare position data
		const positions = new Float32Array(dataPoints.length * 2)
		const intensities = new Float32Array(dataPoints.length)

		for (let i = 0; i < dataPoints.length; i++) {
			positions[i * 2] = dataPoints[i].x
			positions[i * 2 + 1] = dataPoints[i].y
			intensities[i] = Math.max(0, Math.min(1, dataPoints[i].intensity / 10)) // Normalize to 0-1
		}

		// Upload position data
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer)
		this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW)

		const positionLocation = this.gl.getAttribLocation(
			this.program,
			"a_position"
		)
		this.gl.enableVertexAttribArray(positionLocation)
		this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0)

		// Upload intensity data
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.intensityBuffer)
		this.gl.bufferData(this.gl.ARRAY_BUFFER, intensities, this.gl.STATIC_DRAW)

		const intensityLocation = this.gl.getAttribLocation(
			this.program,
			"a_intensity"
		)
		this.gl.enableVertexAttribArray(intensityLocation)
		this.gl.vertexAttribPointer(
			intensityLocation,
			1,
			this.gl.FLOAT,
			false,
			0,
			0
		)

		// Render points
		this.gl.drawArrays(this.gl.POINTS, 0, dataPoints.length)

		return true
	}

	public updateGradient(colors: string[]): void {
		if (this.gradientTexture && this.gl) {
			this.gl.deleteTexture(this.gradientTexture)
			this.gradientTexture = this.createGradientTexture(colors)
		}
	}

	public dispose(): void {
		if (this.gl) {
			if (this.program) this.gl.deleteProgram(this.program)
			if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer)
			if (this.intensityBuffer) this.gl.deleteBuffer(this.intensityBuffer)
			if (this.gradientTexture) this.gl.deleteTexture(this.gradientTexture)
		}
	}
}

// Utility function to check WebGL support
export function isWebGLSupported(): boolean {
	try {
		const canvas = document.createElement("canvas")
		return !!(
			canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
		)
	} catch (e) {
		return false
	}
}

// Factory function for creating WebGL heatmap renderer
export function createWebGLHeatmap(
	canvas: HTMLCanvasElement
): WebGLHeatmapRenderer | null {
	if (!isWebGLSupported()) {
		console.warn("WebGL not supported")
		return null
	}

	return new WebGLHeatmapRenderer(canvas)
}
