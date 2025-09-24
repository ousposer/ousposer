#!/usr/bin/env node

/**
 * Test arrondissement parsing regex
 */
function parseArrondissement(arrText) {
	if (!arrText) return null

	// Handle Bois areas - assign to their administrative arrondissements
	if (arrText.includes("BOIS DE BOULOGNE")) {
		return 16 // Bois de Boulogne belongs to 16th arrondissement
	}
	if (arrText.includes("BOIS DE VINCENNES")) {
		return 12 // Bois de Vincennes belongs to 12th arrondissement
	}

	// Handle different arrondissement formats
	let match = arrText.match(/PARIS (\d+)(?:E|ER)? ARRDT/i)
	if (match) {
		const arrNum = parseInt(match[1])
		return arrNum >= 1 && arrNum <= 20 ? arrNum : null
	}

	return null
}

console.log('🧪 Testing Arrondissement Regex Parsing\n')

const testCases = [
	{ input: "PARIS 1ER ARRDT", expected: 1, description: "1st arrondissement (ER format)" },
	{ input: "PARIS 2E ARRDT", expected: 2, description: "2nd arrondissement (E format)" },
	{ input: "PARIS 10E ARRDT", expected: 10, description: "10th arrondissement" },
	{ input: "PARIS 20E ARRDT", expected: 20, description: "20th arrondissement" },
	{ input: "BOIS DE BOULOGNE", expected: 16, description: "Bois de Boulogne → 16th" },
	{ input: "BOIS DE VINCENNES", expected: 12, description: "Bois de Vincennes → 12th" },
	{ input: "HAUTS-DE-SEINE", expected: null, description: "Outside Paris" },
	{ input: "SEINE-SAINT-DENIS", expected: null, description: "Outside Paris" },
	{ input: null, expected: null, description: "Null input" },
	{ input: "", expected: null, description: "Empty string" }
]

console.log('📍 Arrondissement Parsing Tests:')
testCases.forEach(test => {
	const result = parseArrondissement(test.input)
	const status = result === test.expected ? '✅' : '❌'
	console.log(`  ${status} ${test.description}: "${test.input}" → ${result}`)
})

console.log('\n✅ Regex testing complete!')
