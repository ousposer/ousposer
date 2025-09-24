#!/usr/bin/env node

/**
 * Test Fresh Spot Detection Algorithm
 * 
 * Tests the algorithm against known locations in Paris to validate
 * scoring accuracy and algorithm performance.
 */

const { FreshSpotAnalyzer, FRESH_SPOT_CONFIG } = require('../src/fresh-spot-algorithm');

// Test locations in Paris with expected characteristics
const TEST_LOCATIONS = [
    {
        name: "Louvre Gardens (should be excellent)",
        latitude: 48.8606,
        longitude: 2.3376,
        expected_rating: "excellent",
        description: "Famous gardens with many trees, benches, and amenities"
    },
    {
        name: "Place de la République (should be good)",
        latitude: 48.8676,
        longitude: 2.3631,
        expected_rating: "good", 
        description: "Large square with trees and seating"
    },
    {
        name: "Champs-Élysées near Arc de Triomphe (should be fair)",
        latitude: 48.8738,
        longitude: 2.2950,
        expected_rating: "fair",
        description: "Busy area with some trees but limited seating"
    },
    {
        name: "Parc des Buttes-Chaumont (should be excellent)",
        latitude: 48.8799,
        longitude: 2.3831,
        expected_rating: "excellent",
        description: "Large park with extensive trees and seating"
    },
    {
        name: "Jardin du Luxembourg (should be excellent)",
        latitude: 48.8462,
        longitude: 2.3371,
        expected_rating: "excellent",
        description: "Famous park with abundant shade and seating"
    },
    {
        name: "Random residential street (should be poor/inadequate)",
        latitude: 48.8520,
        longitude: 2.3850,
        expected_rating: "poor",
        description: "Typical residential area with limited amenities"
    }
];

/**
 * Test the fresh spot algorithm
 */
async function testFreshSpotAlgorithm() {
    console.log('🧪 Testing Fresh Spot Detection Algorithm');
    console.log('==========================================\n');
    
    const analyzer = new FreshSpotAnalyzer();
    const results = [];
    
    try {
        console.log('📋 Algorithm Configuration:');
        console.log(`   Search Radii: Trees ${FRESH_SPOT_CONFIG.SEARCH_RADIUS.TREES}m, Benches ${FRESH_SPOT_CONFIG.SEARCH_RADIUS.BENCHES}m, Trash ${FRESH_SPOT_CONFIG.SEARCH_RADIUS.TRASH_CANS}m`);
        console.log(`   Weights: Shade ${FRESH_SPOT_CONFIG.WEIGHTS.SHADE}, Seating ${FRESH_SPOT_CONFIG.WEIGHTS.SEATING}, Convenience ${FRESH_SPOT_CONFIG.WEIGHTS.CONVENIENCE}`);
        console.log(`   Thresholds: Excellent ${FRESH_SPOT_CONFIG.THRESHOLDS.EXCELLENT}+, Good ${FRESH_SPOT_CONFIG.THRESHOLDS.GOOD}+, Fair ${FRESH_SPOT_CONFIG.THRESHOLDS.FAIR}+\n`);
        
        // Test each location
        for (let i = 0; i < TEST_LOCATIONS.length; i++) {
            const location = TEST_LOCATIONS[i];
            console.log(`🔍 Testing Location ${i + 1}/${TEST_LOCATIONS.length}: ${location.name}`);
            console.log(`   Coordinates: ${location.latitude}, ${location.longitude}`);
            console.log(`   Expected: ${location.expected_rating}`);
            console.log(`   Description: ${location.description}`);
            
            try {
                const startTime = Date.now();
                const analysis = await analyzer.analyzeFreshSpot(location.latitude, location.longitude);
                const duration = Date.now() - startTime;
                
                // Store result
                results.push({
                    location: location,
                    analysis: analysis,
                    duration: duration
                });
                
                // Display results
                console.log(`   ✅ Analysis completed in ${duration}ms`);
                console.log(`   📊 Overall Score: ${analysis.scoring.overall_score}/10`);
                console.log(`   🏆 Rating: ${analysis.scoring.rating}`);
                console.log(`   ✔️  Meets Requirements: ${analysis.scoring.meets_requirements ? 'Yes' : 'No'}`);
                console.log(`   🌳 Shade: ${analysis.analysis.shade.score}/10 (${analysis.analysis.shade.tree_count} trees)`);
                console.log(`   🪑 Seating: ${analysis.analysis.seating.score}/10 (${analysis.analysis.seating.bench_count} benches)`);
                console.log(`   🗑️  Convenience: ${analysis.analysis.convenience.score}/10 (${analysis.analysis.convenience.trash_can_count} trash cans)`);
                
                // Check if rating matches expectation
                const ratingMatch = analysis.scoring.rating === location.expected_rating;
                console.log(`   🎯 Expected Rating Match: ${ratingMatch ? '✅ Yes' : '❌ No'}`);
                
                if (!ratingMatch) {
                    console.log(`      Expected: ${location.expected_rating}, Got: ${analysis.scoring.rating}`);
                }
                
            } catch (error) {
                console.log(`   ❌ Analysis failed: ${error.message}`);
                results.push({
                    location: location,
                    error: error.message,
                    duration: 0
                });
            }
            
            console.log(''); // Empty line for readability
        }
        
        // Summary statistics
        console.log('📈 Test Summary');
        console.log('===============');
        
        const successfulTests = results.filter(r => !r.error);
        const failedTests = results.filter(r => r.error);
        
        console.log(`✅ Successful analyses: ${successfulTests.length}/${TEST_LOCATIONS.length}`);
        console.log(`❌ Failed analyses: ${failedTests.length}/${TEST_LOCATIONS.length}`);
        
        if (successfulTests.length > 0) {
            const avgDuration = successfulTests.reduce((sum, r) => sum + r.duration, 0) / successfulTests.length;
            console.log(`⏱️  Average analysis time: ${Math.round(avgDuration)}ms`);
            
            // Rating distribution
            const ratingCounts = {};
            successfulTests.forEach(r => {
                const rating = r.analysis.scoring.rating;
                ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
            });
            
            console.log('🏆 Rating Distribution:');
            Object.entries(ratingCounts).forEach(([rating, count]) => {
                console.log(`   ${rating}: ${count} locations`);
            });
            
            // Score statistics
            const scores = successfulTests.map(r => r.analysis.scoring.overall_score);
            const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            const minScore = Math.min(...scores);
            const maxScore = Math.max(...scores);
            
            console.log('📊 Score Statistics:');
            console.log(`   Average: ${Math.round(avgScore * 100) / 100}/10`);
            console.log(`   Range: ${minScore}/10 - ${maxScore}/10`);
            
            // Requirements compliance
            const meetingRequirements = successfulTests.filter(r => r.analysis.scoring.meets_requirements).length;
            console.log(`✔️  Locations meeting requirements: ${meetingRequirements}/${successfulTests.length}`);
        }
        
        if (failedTests.length > 0) {
            console.log('\n❌ Failed Tests:');
            failedTests.forEach(r => {
                console.log(`   ${r.location.name}: ${r.error}`);
            });
        }
        
        // Detailed results for review
        console.log('\n📋 Detailed Results for Algorithm Validation:');
        console.log('==============================================');
        successfulTests.forEach((result, index) => {
            const { location, analysis } = result;
            console.log(`\n${index + 1}. ${location.name}`);
            console.log(`   Score: ${analysis.scoring.overall_score}/10 (${analysis.scoring.rating})`);
            console.log(`   Shade: ${analysis.analysis.shade.score}/10 | Seating: ${analysis.analysis.seating.score}/10 | Convenience: ${analysis.analysis.convenience.score}/10`);
            console.log(`   Trees: ${analysis.analysis.shade.tree_count} | Benches: ${analysis.analysis.seating.bench_count} | Trash: ${analysis.analysis.convenience.trash_can_count}`);
            console.log(`   Meets Requirements: ${analysis.scoring.meets_requirements}`);
        });
        
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
        console.error(error.stack);
    } finally {
        await analyzer.close();
    }
    
    console.log('\n🎉 Fresh Spot Algorithm Testing Complete!');
}

// Run tests if called directly
if (require.main === module) {
    testFreshSpotAlgorithm();
}

module.exports = { testFreshSpotAlgorithm, TEST_LOCATIONS };
