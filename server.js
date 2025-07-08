// server.js - Complete backend with MSG91 OTP + Razorpay Payment Integration

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

// Import new services
// const OTPService = require('./services/OTPService');
const PaymentService = require('./services/PaymentService');

const app = express();

app.use(express.static(path.join(__dirname, './')));

// Enhanced CORS configuration
const corsOptions = {
  origin: [
    'https://chatastro-wo.vercel.app',
    'https://chatastro-wo.onrender.com'
    ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));


// In-memory storage for MVP (replace with MongoDB later)
const users = new Map();
const sessions = new Map();
const astroCache = new Map();

// User state tracking
const userStates = new Map(); // Track free questions, payment status, etc.


// Utility function to generate unique IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}


// Enhanced logging utility
function debugLog(category, message, data = null) {
    if (process.env.ENABLE_DEBUG_LOGS === 'true') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${category.toUpperCase()}] ${message}`);
        if (data && process.env[`DEBUG_${category.toUpperCase()}`] === 'true') {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

// Enhanced geocoding with fallback
async function getCoordinates(location) {
    try {
        debugLog('geocoding', `Getting coordinates for: ${location}`);
        
        const response = await fetch(`https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(location)}&key=${process.env.OPENCAGE_API_KEY}&limit=1`, {
            timeout: parseInt(process.env.API_TIMEOUT_MS) || 10000
        });
        
        if (!response.ok) {
            throw new Error(`Geocoding API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const coordinates = {
                latitude: result.geometry.lat,
                longitude: result.geometry.lng,
                timezone: result.annotations?.timezone?.name || 'Asia/Kolkata',
                city: result.components.city || result.components.town || result.components.village,
                country: result.components.country
            };
            
            debugLog('geocoding', 'Coordinates found', coordinates);
            return coordinates;
        }
        throw new Error('Location not found');
    } catch (error) {
        console.error('Geocoding error:', error);
        
        // Fallback for common Indian cities
        const indianCityCoordinates = {
            'mumbai': { latitude: 19.0760, longitude: 72.8777, timezone: 'Asia/Kolkata' },
            'delhi': { latitude: 28.7041, longitude: 77.1025, timezone: 'Asia/Kolkata' },
            'bangalore': { latitude: 12.9716, longitude: 77.5946, timezone: 'Asia/Kolkata' },
            'kolkata': { latitude: 22.5726, longitude: 88.3639, timezone: 'Asia/Kolkata' },
            'chennai': { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' },
            'hyderabad': { latitude: 17.3850, longitude: 78.4867, timezone: 'Asia/Kolkata' },
            'pune': { latitude: 18.5204, longitude: 73.8567, timezone: 'Asia/Kolkata' }
        };
        
        const cityKey = location.toLowerCase().trim();
        if (indianCityCoordinates[cityKey]) {
            debugLog('geocoding', `Using fallback coordinates for ${cityKey}`);
            return indianCityCoordinates[cityKey];
        }
        
        throw new Error('Failed to get location coordinates');
    }
}

// Enhanced Divine API integration
async function fetchAstrologyData(birthData, apiEndpoints) {
    const results = {};
    
    const baseUrl = 'https://astroapi-3.divineapi.com/indian-api/v1';
    
    debugLog('divine_api', 'Fetching astrology data', { 
        endpoints: apiEndpoints, 
        birthData: { name: birthData.fullName, gender: birthData.gender },
        baseUrl,
        authToken: process.env.DIVINE_AUTH_TOKEN ? 'configured' : 'missing',
        apiKey: process.env.DIVINE_API_KEY ? 'configured' : 'missing'
    });
    
    for (const endpoint of apiEndpoints) {
        try {
            const formData = new URLSearchParams();
            formData.append('api_key', process.env.DIVINE_API_KEY);
            formData.append('full_name', birthData.fullName);
            formData.append('day', birthData.day.toString());
            formData.append('month', birthData.month.toString());
            formData.append('year', birthData.year.toString());
            formData.append('hour', birthData.hour.toString());
            formData.append('min', birthData.minute.toString());
            formData.append('sec', '0');
            formData.append('gender', birthData.gender || 'male');
            formData.append('place', birthData.birthPlace);
            formData.append('lat', birthData.latitude.toString());
            formData.append('lon', birthData.longitude.toString());
            formData.append('tzone', (birthData.timezoneOffset || 5.5).toString());
            formData.append('lan', 'en');
            
            debugLog('divine_api', `Calling ${endpoint}`, {
                url: `${baseUrl}/${endpoint}`,
                authTokenLength: process.env.DIVINE_AUTH_TOKEN ? process.env.DIVINE_AUTH_TOKEN.length : 0,
                apiKeyLength: process.env.DIVINE_API_KEY ? process.env.DIVINE_API_KEY.length : 0
            });
            
            const response = await fetch(`${baseUrl}/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.DIVINE_AUTH_TOKEN}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData.toString()
            });
            
            debugLog('divine_api', `Response status for ${endpoint}: ${response.status}`);
            
            if (response.ok) {
                const data = await response.json();
                results[endpoint] = data;
                debugLog('divine_api', `Success for ${endpoint}`, { 
                    success: data.success,
                    hasData: !!data.data,
                    dataKeys: data.data ? Object.keys(data.data) : []
                });
            } else {
                const errorText = await response.text();
                console.error(`Divine API error for ${endpoint}:`, response.status, errorText);
                
                results[endpoint] = {
                    error: true,
                    status: response.status,
                    message: `API error: ${response.status} ${response.statusText}`,
                    details: errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText
                };
            }
        } catch (error) {
            console.error(`Error fetching ${endpoint}:`, error.message);
            results[endpoint] = {
                error: true,
                message: `Network error: ${error.message}`,
                fallback: true
            };
        }
    }
    
    return results;
}

// Enhanced Claude AI integration for streaming-friendly responses
async function getClaudeResponse(prompt, context = '', isGeneralOverview = false) {
    try {
        debugLog('claude_ai', 'Getting Claude response', { 
            promptLength: prompt.length, 
            contextLength: context.length,
            apiKeyPresent: !!process.env.CLAUDE_API_KEY,
            isGeneralOverview
        });

        if (!process.env.CLAUDE_API_KEY) {
            throw new Error('Claude API key not found in environment variables');
        }

        console.log('🤖 Making Claude API request...');
        
        // Enhanced prompt for different types of responses
        let systemPrompt;
        if (isGeneralOverview) {
            systemPrompt = `You are an expert Indian Vedic astrologer providing a comprehensive general overview of someone's birth chart. 

${context}

Generate a comprehensive Vedic astrology general overview for the user that covers all major astrological components. Structure the reading as follows:

✨ **Your Cosmic Blueprint**
- Lagna & Moon sign personality
- Key planet positions & strengths
- Important house influences
- Current Dasha period effects  
- Natural talents & abilities
- Lucky elements & guidance
- Encouraging cosmic potential

Write as a caring astrologer in 80-100 words. Be warm, specific, and uplifting with emojis. Mention specific planets and houses✨ **Your Cosmic Blueprint**
- Lagna & Moon sign personality
- Key planet positions & strengths
- Important house influences
- Current Dasha period effects  
- Natural talents & abilities
- Lucky elements & guidance
- Encouraging cosmic potential

Write as a caring astrologer in 80-100 words. Be warm, specific, and uplifting with emojis. Mention specific planets and houses from their chart

Write as if you're speaking directly to them, using "you" and "your" throughout.`;
        } else {
            systemPrompt = `You are an expert Vedic astrologer with deep knowledge of Indian astrology. Provide personalized, accurate, and compassionate guidance.

${context}

User Question: ${prompt}

Provide a warm, insightful response that:
1. Addresses their specific question directly
2. Uses the astrological data provided in context
3. Offers practical guidance and remedies
4. Maintains a positive and encouraging tone
5. Includes relevant timing if applicable
6. Is written in flowing paragraphs perfect for streaming text display
7. Uses emojis thoughtfully for visual appeal
8. Keeps response length appropriate (100-200 words for specific questions)

Keep the response conversational and easy to understand, avoiding overly technical jargon.`;
        }
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-sonnet-20240229',
                max_tokens: isGeneralOverview ? 1500 : 1000,
                temperature: 0.7,
                messages: [{
                    role: 'user',
                    content: systemPrompt
                }]
            })
        });
        
        console.log(`📡 Claude API Response Status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Claude API Error: ${response.status} ${response.statusText}`);
            console.error('Error details:', errorText);
            throw new Error(`Claude API error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        
        if (!data.content || !data.content[0] || !data.content[0].text) {
            throw new Error('Invalid response format from Claude API');
        }
        
        const responseText = data.content[0].text;
        
        debugLog('claude_ai', 'Claude response received', { 
            responseLength: responseText.length,
            usage: data.usage 
        });
        
        console.log('✅ Claude response generated successfully');
        return responseText;
        
    } catch (error) {
        console.error('❌ Claude API error:', error.message);
        throw error;
    }
}

// Enhanced smart classification system
function classifyUserQuery(query) {
    const queryLower = query.toLowerCase();
    
    // Check for general overview request
    if (queryLower.includes('general') && (queryLower.includes('overview') || queryLower.includes('reading'))) {
        return {
            intent: 'general_overview',
            confidence: 1.0,
            apis: ['planetary-positions', 'basic-astro-details'],
            isGeneralOverview: true
        };
    }
    
    const intents = {
        marriage: {
            keywords: ['marry', 'marriage', 'wedding', 'spouse', 'partner', 'husband', 'wife', 'relationship', 'shaadi', 'vivah'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        },
        career: {
            keywords: ['career', 'job', 'work', 'profession', 'business', 'success', 'promotion', 'office', 'naukri'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        },
        money: {
            keywords: ['money', 'wealth', 'finance', 'income', 'salary', 'profit', 'rich', 'financial', 'dhan', 'paisa'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        },
        health: {
            keywords: ['health', 'disease', 'illness', 'fitness', 'medical', 'body', 'pain', 'healing', 'swasthya'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        },
        love: {
            keywords: ['love', 'romance', 'dating', 'boyfriend', 'girlfriend', 'crush', 'attraction', 'pyaar'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        },
        family: {
            keywords: ['family', 'father', 'mother', 'brother', 'sister', 'children', 'kids', 'parents', 'parivar'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        },
        general: {
            keywords: ['life', 'future', 'destiny', 'general', 'overall', 'horoscope', 'kundli', 'jyotish'],
            apis: ['planetary-positions', 'basic-astro-details'],
            confidence: 0
        }
    };
    
    // Calculate confidence scores
    Object.keys(intents).forEach(intent => {
        const keywords = intents[intent].keywords;
        let totalScore = 0;
        let matches = 0;
        
        keywords.forEach(keyword => {
            if (queryLower.includes(keyword)) {
                matches++;
                const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                if (regex.test(query)) {
                    totalScore += 2;
                } else {
                    totalScore += 1;
                }
            }
        });
        
        intents[intent].confidence = matches > 0 ? totalScore / keywords.length : 0;
    });
    
    // Find best matching intent
    let bestIntent = 'general';
    let highestConfidence = 0;
    
    Object.keys(intents).forEach(intent => {
        if (intents[intent].confidence > highestConfidence) {
            highestConfidence = intents[intent].confidence;
            bestIntent = intent;
        }
    });
    
    return {
        intent: bestIntent,
        confidence: highestConfidence,
        apis: intents[bestIntent].apis,
        isComplex: query.split(' ').length > 10,
        isGeneralOverview: false
    };
}

// Enhanced query processing with free question tracking
async function processQuery(userId, message, sessionId) {
    const user = users.get(userId);
    if (!user) {
        throw new Error('User not found');
    }
    
    // Get user state for free question tracking
    let userState = userStates.get(userId) || { 
        freeQuestionsUsed: 0, 
        isPremium: false, 
        totalQuestions: 0 
    };
    
    // Get or create session
    let session = sessions.get(sessionId) || { 
        messages: [], 
        context: '', 
        startTime: Date.now(),
        queryCount: 0
    };
    
    session.queryCount++;
    userState.totalQuestions++;
    
    // Classify the query
    const classification = classifyUserQuery(message);
    
    // Enhanced caching strategy
    const cacheKey = `${userId}_${classification.apis.join('_')}`;
    let astroData = astroCache.get(cacheKey);
    
    const cacheExpiry = 3600000; // 1 hour
    const needsFreshData = !astroData || (Date.now() - astroData.timestamp) > cacheExpiry;
    
    if (needsFreshData) {
        debugLog('cache', `Fetching fresh astrology data for ${cacheKey}`);
        try {
            const freshData = await fetchAstrologyData(user.birthData, classification.apis);
            astroData = {
                data: freshData,
                timestamp: Date.now(),
                cacheKey
            };
            astroCache.set(cacheKey, astroData);
        } catch (error) {
            console.error('Error fetching astrology data:', error);
            if (!astroData) {
                astroData = {
                    data: {},
                    timestamp: Date.now(),
                    error: true,
                    fallback: true
                };
            }
        }
    } else {
        debugLog('cache', `Using cached data for ${cacheKey}`);
    }
    
    // Prepare enhanced context for Claude
    const context = `
User Profile:
- Name: ${user.fullName}
- Gender: ${user.gender || 'not specified'}
- Birth: ${user.birthData.birthDate} at ${user.birthData.birthTime}
- Location: ${user.birthData.birthPlace}
- Session: Query #${session.queryCount}
- User Status: ${userState.isPremium ? 'Premium' : 'Free'} (Total Questions: ${userState.totalQuestions})

Astrological Data Available: ${JSON.stringify(Object.keys(astroData.data), null, 2)}
Astrology Analysis: ${JSON.stringify(astroData.data, null, 2)}

Conversation History (Last 3 exchanges):
${session.context.split('\n').slice(-6).join('\n')}

Query Classification:
- Intent: ${classification.intent}
- Confidence: ${classification.confidence.toFixed(2)}
- APIs Used: ${classification.apis.join(', ')}
- Type: ${classification.isGeneralOverview ? 'General Overview' : 'Specific Question'}

IMPORTANT INSTRUCTIONS:
- Provide personalized advice based on the user's birth chart data
- Consider gender-specific interpretations where relevant
- Be warm, compassionate, and encouraging
- Write in flowing paragraphs perfect for streaming text display
- Use emojis thoughtfully for visual appeal
- If this is a general overview, be comprehensive yet concise
- For specific questions, be focused and practical
- Include timing and remedies when relevant
`;
    
    // Get AI response
    const response = await getClaudeResponse(message, context, classification.isGeneralOverview);
    
    // Update session and user state
    const messageEntry = {
        user: message,
        bot: response,
        timestamp: Date.now(),
        classification: classification.intent,
        confidence: classification.confidence,
        isGeneralOverview: classification.isGeneralOverview
    };
    
    session.messages.push(messageEntry);
    session.context += `User: ${message}\nBot: ${response}\n`;
    session.lastActivity = Date.now();
    
    // Keep only last 10 messages in context
    if (session.messages.length > 10) {
        session.messages = session.messages.slice(-10);
        const contextLines = session.context.split('\n');
        session.context = contextLines.slice(-20).join('\n');
    }
    
    sessions.set(sessionId, session);
    userStates.set(userId, userState);
    
    debugLog('session', `Query processed for user ${userId}`, { 
        queryCount: session.queryCount,
        classification: classification.intent,
        responseLength: response.length,
        userQuestions: userState.totalQuestions
    });
    
    return response;
}

// API Routes

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Simple API test dashboard
app.get('/test', (req, res) => {
    const testPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ChatAstro API Test Dashboard</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px; background: #1a0033; color: white; }
        .container { max-width: 800px; margin: 0 auto; }
        .test-section { background: rgba(255,255,255,0.1); padding: 20px; margin: 20px 0; border-radius: 10px; }
        .btn { background: #7c3aed; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; margin: 10px 5px; }
        .btn:hover { background: #6d28d9; }
        .result { background: #000; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 4px solid #10b981; font-family: monospace; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
        .error { border-left-color: #ef4444; }
        .loading { opacity: 0.6; }
        h1 { color: #ffb300; }
        h2 { color: #a855f7; }
        .endpoint { background: rgba(255,179,0,0.1); padding: 8px 12px; border-radius: 4px; font-family: monospace; margin: 5px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🌟 ChatAstro API Test Dashboard</h1>
        
        <div class="test-section">
            <h2>📱 MSG91 OTP Test</h2>
            <p>Test your MSG91 integration for OTP functionality:</p>
            <div class="endpoint">GET /api/test/msg91</div>
            <button class="btn" onclick="testAPI('msg91')">Test MSG91 API</button>
            <div id="msg91-result" class="result" style="display:none;"></div>
        </div>
        
        <div class="test-section">
            <h2>💳 Razorpay Payment Test</h2>
            <p>Test your Razorpay integration for payment processing:</p>
            <div class="endpoint">GET /api/test/payment</div>
            <button class="btn" onclick="testAPI('payment')">Test Payment API</button>
            <div id="payment-result" class="result" style="display:none;"></div>
        </div>
        
        <div class="test-section">
            <h2>🤖 Claude AI Test</h2>
            <p>Test your Claude AI integration for astrological interpretations:</p>
            <div class="endpoint">GET /api/test/claude</div>
            <button class="btn" onclick="testAPI('claude')">Test Claude API</button>
            <div id="claude-result" class="result" style="display:none;"></div>
        </div>
        
        <div class="test-section">
            <h2>🔮 Divine API Test</h2>
            <p>Test your Divine API integration for Vedic astrology data:</p>
            <div class="endpoint">GET /api/test/divine</div>
            <button class="btn" onclick="testAPI('divine')">Test Divine API</button>
            <div id="divine-result" class="result" style="display:none;"></div>
        </div>
        
        <div class="test-section">
            <h2>💊 System Health</h2>
            <p>Check overall system status and API configurations:</p>
            <div class="endpoint">GET /api/health</div>
            <button class="btn" onclick="testAPI('health')">Check Health</button>
            <div id="health-result" class="result" style="display:none;"></div>
        </div>
        
        <div class="test-section">
            <h2>🏠 Main App</h2>
            <p>Go back to the main ChatAstro application:</p>
            <button class="btn" onclick="window.location.href='/'">Open ChatAstro</button>
        </div>
    </div>
    
    <script>
        async function testAPI(type) {
            const resultDiv = document.getElementById(type + '-result');
            const btn = event.target;
            
            // Show loading state
            btn.classList.add('loading');
            btn.textContent = 'Testing...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'result';
            resultDiv.textContent = 'Testing API connection...';
            
            try {
                let url;
                switch(type) {
                    case 'msg91': url = '/api/test/msg91'; break;
                    case 'payment': url = '/api/test/payment'; break;
                    case 'divine': url = '/api/test/divine'; break;
                    case 'claude': url = '/api/test/claude'; break;
                    case 'health': url = '/api/health'; break;
                }
                
                const response = await fetch(url);
                const data = await response.json();
                
                // Show result
                resultDiv.textContent = JSON.stringify(data, null, 2);
                
                if (data.success === false || !response.ok) {
                    resultDiv.classList.add('error');
                }
                
            } catch (error) {
                resultDiv.textContent = 'Error: ' + error.message;
                resultDiv.classList.add('error');
            }
            
            // Reset button
            btn.classList.remove('loading');
            btn.textContent = getButtonText(type);
        }
        
        function getButtonText(type) {
            switch(type) {
                case 'msg91': return 'Test MSG91 API';
                case 'payment': return 'Test Payment API';
                case 'divine': return 'Test Divine API';
                case 'claude': return 'Test Claude API';
                case 'health': return 'Check Health';
                default: return 'Test';
            }
        }
    </script>
</body>
</html>`;
    res.send(testPage);
});

// // ===================================
// // MSG91 OTP ROUTES
// // ===================================

// // Send OTP endpoint
// app.post('/api/otp/send', async (req, res) => {
//     try {
//         const { mobileNumber, countryCode } = req.body;
        
//         if (!mobileNumber) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Mobile number is required'
//             });
//         }
        
//         // Validate Indian mobile number format
//         const cleanMobile = mobileNumber.replace(/[^\d]/g, '');
//         if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9'
//             });
//         }
        
//         console.log('📱 OTP request for:', cleanMobile);
        
//         const result = await OTPService.sendOTP(cleanMobile, countryCode || '91');
        
//         res.json({
//             success: result.success,
//             message: result.message,
//             data: {
//                 mobile: result.mobile,
//                 expiryTime: result.expiryTime,
//                 isDemo: result.isDemo || false
//             }
//         });
        
//     } catch (error) {
//         console.error('❌ Send OTP Error:', error.message);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to send OTP. Please try again.',
//             error: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });

// // Verify OTP endpoint
// app.post('/api/otp/verify', async (req, res) => {
//     try {
//         const { mobileNumber, otp } = req.body;
        
//         if (!mobileNumber || !otp) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Mobile number and OTP are required'
//             });
//         }
        
//         const cleanMobile = mobileNumber.replace(/[^\d]/g, '');
//         console.log('🔐 OTP verification for:', cleanMobile, 'OTP:', otp);
        
//         const result = await OTPService.verifyOTP(cleanMobile, otp);
        
//         res.json({
//             success: result.success,
//             message: result.message,
//             data: result.success ? { mobile: result.mobile } : null
//         });
        
//     } catch (error) {
//         console.error('❌ Verify OTP Error:', error.message);
//         res.status(500).json({
//             success: false,
//             message: 'OTP verification failed. Please try again.',
//             error: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });

// // Resend OTP endpoint
// app.post('/api/otp/resend', async (req, res) => {
//     try {
//         const { mobileNumber } = req.body;
        
//         if (!mobileNumber) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Mobile number is required'
//             });
//         }
        
//         const cleanMobile = mobileNumber.replace(/[^\d]/g, '');
//         console.log('🔄 OTP resend for:', cleanMobile);
        
//         const result = await OTPService.resendOTP(cleanMobile);
        
//         res.json({
//             success: result.success,
//             message: result.message,
//             data: result.success ? {
//                 mobile: result.mobile,
//                 expiryTime: result.expiryTime,
//                 isDemo: result.isDemo || false
//             } : null
//         });
        
//     } catch (error) {
//         console.error('❌ Resend OTP Error:', error.message);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to resend OTP. Please try again.',
//             error: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });

// // Get OTP status (for debugging)
// app.get('/api/otp/status/:mobile', (req, res) => {
//     try {
//         const status = OTPService.getOTPStatus(req.params.mobile);
        
//         res.json({
//             success: true,
//             status: status
//         });
        
//     } catch (error) {
//         res.status(500).json({
//             success: false,
//             message: 'Failed to get OTP status'
//         });
//     }
// });

// Skip OTP endpoint - for development/testing
// app.post('/api/otp/skip', async (req, res) => {
//     try {
//         const { mobileNumber } = req.body;
        
//         if (!mobileNumber) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Mobile number is required'
//             });
//         }
        
//         // Validate Indian mobile number format
//         const cleanMobile = mobileNumber.replace(/[^\d]/g, '');
//         if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9'
//             });
//         }
        
//         // Check if skip OTP is enabled
//         if (process.env.SKIP_OTP === 'true' || process.env.NODE_ENV === 'development') {
//             console.log('🚀 OTP Skipped for:', cleanMobile);
            
//             // Create session directly without OTP verification
//             const sessionId = generateId();
//             const userData = {
//                 phone: cleanMobile,
//                 verified: true,
//                 timestamp: new Date().toISOString(),
//                 skipOtp: true
//             };
            
//             // Store user data
//             sessions.set(sessionId, userData);
//             users.set(cleanMobile, userData);
            
//             // Initialize user state
//             userStates.set(cleanMobile, {
//                 freeQuestions: 3,
//                 isPaidUser: false,
//                 lastQuestionTime: null
//             });
            
//             debugLog('auth', `OTP skipped for phone: ${cleanMobile}`);
            
//             res.json({
//                 success: true,
//                 message: 'OTP verification skipped - proceeding directly',
//                 data: {
//                     mobile: cleanMobile,
//                     sessionId: sessionId,
//                     skipOtp: true,
//                     verified: true
//                 }
//             });
//         } else {
//             res.status(400).json({
//                 success: false,
//                 message: 'OTP skip not enabled. Please verify OTP normally.'
//             });
//         }
        
//     } catch (error) {
//         console.error('❌ Skip OTP Error:', error.message);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to skip OTP. Please try again.',
//             error: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });

// ===================================
// RAZORPAY PAYMENT ROUTES
// ===================================

// Create payment order
app.post('/api/payment/create-order', async (req, res) => {
    try {
        const { userId, planType, userDetails } = req.body;
        
        if (!userId || !planType || !userDetails) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: userId, planType, and userDetails are required'
            });
        }

        // Validate plan type
        const validPlans = ['basic', 'standard', 'premium', 'report'];
        if (!validPlans.includes(planType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid plan type. Must be one of: basic, standard, premium, report'
            });
        }

        console.log('💳 Creating payment order:', { userId, planType, userName: userDetails.name });

        const result = await PaymentService.createOrder(userId, planType, userDetails);

        res.json({
            success: true,
            order: result.order,
            message: 'Payment order created successfully'
        });

    } catch (error) {
        console.error('❌ Create order error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to create payment order',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Verify payment
app.post('/api/payment/verify', async (req, res) => {
    try {
        const { paymentData, userId } = req.body;
        
        if (!paymentData || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Missing payment data or user ID'
            });
        }

        console.log('🔐 Verifying payment:', { 
            userId, 
            orderId: paymentData.razorpay_order_id,
            paymentId: paymentData.razorpay_payment_id 
        });

        const result = await PaymentService.verifyPayment(paymentData);

        if (result.success) {
            // Update user state to premium
            let userState = userStates.get(userId) || { 
                freeQuestionsUsed: 0, 
                isPremium: false, 
                totalQuestions: 0 
            };

            userState.isPremium = true;
            userState.planType = result.order.planType;
            userState.totalQuestions = result.order.plan.questions;
            userState.remainingQuestions = result.order.plan.questions;
            userState.purchaseDate = new Date().toISOString();
            userState.paymentId = result.payment.id;

            userStates.set(userId, userState);

            console.log('✅ Payment verified and user upgraded to premium:', {
                userId,
                planType: result.order.planType,
                questions: result.order.plan.questions
            });
        }

        res.json({
            success: result.success,
            payment: result.payment,
            order: result.order,
            userState: userStates.get(userId),
            message: result.success ? 'Payment verified successfully' : 'Payment verification failed'
        });

    } catch (error) {
        console.error('❌ Payment verification error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Payment verification failed',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Handle payment failure
app.post('/api/payment/failure', async (req, res) => {
    try {
        const { orderId, errorData } = req.body;
        
        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required'
            });
        }

        console.log('❌ Payment failure reported:', { orderId, error: errorData });

        const result = await PaymentService.handlePaymentFailure(orderId, errorData);

        res.json({
            success: false,
            message: result.message,
            error: result.error
        });

    } catch (error) {
        console.error('❌ Payment failure handling error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to handle payment failure'
        });
    }
});

// Get payment status
app.get('/api/payment/status/:orderId', (req, res) => {
    try {
        const { orderId } = req.params;
        const status = PaymentService.getPaymentStatus(orderId);

        if (!status) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        res.json({
            success: true,
            status: status
        });

    } catch (error) {
        console.error('❌ Get payment status error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get payment status'
        });
    }
});

// Get user payment history
app.get('/api/payment/history/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const payments = PaymentService.getUserPayments(userId);

        res.json({
            success: true,
            payments: payments
        });

    } catch (error) {
        console.error('❌ Get payment history error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get payment history'
        });
    }
});

// Get available plans
app.get('/api/payment/plans', (req, res) => {
    try {
        const plans = PaymentService.getAllPlans();

        res.json({
            success: true,
            plans: plans
        });

    } catch (error) {
        console.error('❌ Get plans error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get plans'
        });
    }
});

// Webhook endpoint (for production)
app.post('/api/payment/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);

        // Validate webhook signature
        if (!PaymentService.validateWebhook(body, signature)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid webhook signature'
            });
        }

        // Process webhook
        await PaymentService.processWebhook(req.body);

        res.json({ success: true });

    } catch (error) {
        console.error('❌ Webhook processing error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Webhook processing failed'
        });
    }
});

// ===================================
// EXISTING ROUTES (Enhanced user creation with immediate general overview)
// ===================================

app.post('/api/user/create', async (req, res) => {
    try {
        const { fullName, gender, birthDate, birthTime, birthPlace } = req.body;
        
        // Enhanced validation
        if (!fullName || !gender || !birthDate || !birthTime || !birthPlace) {
            return res.status(400).json({ 
                success: false,
                message: 'All fields are required',
                missingFields: Object.entries({ fullName, gender, birthDate, birthTime, birthPlace })
                    .filter(([_, value]) => !value)
                    .map(([key, _]) => key)
            });
        }
        
        // Validate gender
        const validGenders = ['male', 'female', 'other'];
        if (!validGenders.includes(gender.toLowerCase())) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid gender selection. Must be male, female, or other.' 
            });
        }
        
        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(birthDate)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid birth date format. Use YYYY-MM-DD.' 
            });
        }
        
        // Validate time format
        const timeRegex = /^\d{2}:\d{2}$/;
        if (!timeRegex.test(birthTime)) {
            return res.status(400).json({ 
                success: false,
                message: 'Invalid birth time format. Use HH:MM.' 
            });
        }
        
        debugLog('user_creation', 'Creating user', { fullName, gender, birthPlace });
        
        // Get coordinates for birth place
        const coordinates = await getCoordinates(birthPlace);
        
        // Parse birth date and time
        const [year, month, day] = birthDate.split('-').map(Number);
        const [hour, minute] = birthTime.split(':').map(Number);
        
        // Calculate timezone offset
        const timezoneOffset = coordinates.timezone === 'Asia/Kolkata' ? 5.5 : 0;
        
        // Create user
        const userId = generateId();
        const sessionId = generateId();
        
        const user = {
            id: userId,
            fullName: fullName.trim(),
            gender: gender.toLowerCase(),
            birthData: {
                fullName: fullName.trim(),
                gender: gender.toLowerCase(),
                birthDate,
                birthTime,
                birthPlace: birthPlace.trim(),
                day,
                month,
                year,
                hour,
                minute,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                timezone: coordinates.timezone,
                timezoneOffset,
                city: coordinates.city,
                country: coordinates.country
            },
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };
        
        users.set(userId, user);
        
        // Initialize user state with free question availability
        userStates.set(userId, {
            freeQuestionsUsed: 0,
            isPremium: false,
            totalQuestions: 0,
            hasReceivedOverview: false
        });
        
        debugLog('user_creation', `User created successfully: ${fullName} (${gender}) - ${userId}`);
        
        res.json({
            success: true,
            user: { 
                id: userId, 
                fullName: user.fullName, 
                gender: user.gender,
                location: `${coordinates.city}, ${coordinates.country}`
            },
            sessionId,
            message: 'User profile created successfully'
        });
        
    } catch (error) {
        console.error('User creation error:', error);
        res.status(500).json({ 
            success: false,
            message: error.message,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Enhanced chat message processing with free question limits
app.post('/api/chat/message', async (req, res) => {
    try {
        const { userId, sessionId, message } = req.body;
        
        if (!userId || !sessionId || !message) {
            return res.status(400).json({ 
                success: false,
                message: 'Missing required fields: userId, sessionId, and message are required' 
            });
        }
        
        if (message.trim().length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Message cannot be empty' 
            });
        }
        
        if (message.length > 1000) {
            return res.status(400).json({ 
                success: false,
                message: 'Message too long. Please keep it under 1000 characters.' 
            });
        }
        
        // Check user state for free question limits
        let userState = userStates.get(userId) || { 
            freeQuestionsUsed: 0, 
            isPremium: false, 
            totalQuestions: 0,
            hasReceivedOverview: false
        };
        
        // For general overview requests (first time), don't count as free question
        const classification = classifyUserQuery(message.trim());
        const isGeneralOverview = classification.isGeneralOverview && !userState.hasReceivedOverview;
        
        if (isGeneralOverview) {
            userState.hasReceivedOverview = true;
            userStates.set(userId, userState);
        } else {
            // Check if user has exceeded free question limit
            if (!userState.isPremium && userState.freeQuestionsUsed >= 1) {
                return res.status(402).json({ 
                    success: false,
                    message: 'Free question limit reached. Please purchase a plan to continue.',
                    requiresPayment: true,
                    freeQuestionsUsed: userState.freeQuestionsUsed,
                    isPremium: userState.isPremium
                });
            }
            
            // Increment free question count for non-premium users
            if (!userState.isPremium) {
                userState.freeQuestionsUsed++;
                userStates.set(userId, userState);
            }
        }
        
        debugLog('chat', `Processing message from ${userId}`, { 
            messageLength: message.length,
            isGeneralOverview,
            freeQuestionsUsed: userState.freeQuestionsUsed,
            isPremium: userState.isPremium
        });
        
        const response = await processQuery(userId, message.trim(), sessionId);
        
        res.json({
            success: true,
            response,
            timestamp: new Date().toISOString(),
            sessionId,
            userState: {
                freeQuestionsUsed: userState.freeQuestionsUsed,
                isPremium: userState.isPremium,
                hasReceivedOverview: userState.hasReceivedOverview
            }
        });
        
    } catch (error) {
        console.error('Chat processing error:', error);
        
        res.status(500).json({ 
            success: false,
            message: error.message,
            errorType: error.constructor.name,
            timestamp: new Date().toISOString(),
            troubleshooting: error.message.includes('Claude API') ? [
                "1. Check if CLAUDE_API_KEY is set correctly in .env file",
                "2. Verify your Claude API key is valid and not expired",
                "3. Check if you have credits in your Anthropic account",
                "4. Try generating a new API key from console.anthropic.com"
            ] : [
                "1. Check your internet connection",
                "2. Verify all required fields are provided",
                "3. Try refreshing the page"
            ]
        });
    }
});

// Get user data with enhanced info
app.get('/api/user/:userId', (req, res) => {
    const user = users.get(req.params.userId);
    const userState = userStates.get(req.params.userId);
    
    if (!user) {
        return res.status(404).json({ 
            success: false,
            message: 'User not found' 
        });
    }
    
    res.json({
        success: true,
        user: {
            id: user.id,
            fullName: user.fullName,
            gender: user.gender,
            birthPlace: user.birthData.birthPlace,
            location: `${user.birthData.city}, ${user.birthData.country}`,
            createdAt: user.createdAt,
            lastActive: user.lastActive
        },
        userState: userState || {
            freeQuestionsUsed: 0,
            isPremium: false,
            totalQuestions: 0
        }
    });
});

// Get session history
app.get('/api/session/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    
    if (!session) {
        return res.status(404).json({ 
            success: false,
            message: 'Session not found' 
        });
    }
    
    res.json({
        success: true,
        session: {
            messages: session.messages,
            messageCount: session.messages.length,
            queryCount: session.queryCount,
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            duration: Date.now() - session.startTime
        }
    });
});

// ===================================
// TEST ENDPOINTS
// ===================================

// // Test MSG91 integration
// app.get('/api/test/msg91', async (req, res) => {
//     try {
//         console.log('🧪 Testing MSG91 OTP Service...');
        
//         if (!process.env.MSG91_AUTH_KEY) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'MSG91_AUTH_KEY not found in environment variables',
//                 instructions: [
//                     '1. Get your Auth Key from MSG91 dashboard: https://msg91.com/',
//                     '2. Add MSG91_AUTH_KEY=your_key_here to your .env file',
//                     '3. Restart the server'
//                 ]
//             });
//         }
        
//         // Just validate the service is properly configured
//         const serviceConfig = {
//             authKey: process.env.MSG91_AUTH_KEY ? '✅ Configured' : '❌ Missing',
//             senderId: process.env.MSG91_SENDER_ID || 'CHATRO',
//             route: process.env.MSG91_ROUTE || '4',
//             demoMode: process.env.ENABLE_DEMO_OTP === 'true'
//         };
        
//         console.log('✅ MSG91 Service Configuration Valid');
        
//         res.json({
//             success: true,
//             status: 'MSG91 OTP Service Ready! ✅',
//             config: serviceConfig,
//             endpoints: {
//                 sendOTP: 'POST /api/otp/send',
//                 verifyOTP: 'POST /api/otp/verify',
//                 resendOTP: 'POST /api/otp/resend'
//             },
//             testInstructions: [
//                 '1. Use frontend to test complete OTP flow',
//                 '2. Check console logs for OTP values in development',
//                 '3. Monitor MSG91 dashboard for SMS delivery status'
//             ],
//             timestamp: new Date().toISOString()
//         });
        
//     } catch (error) {
//         console.error('❌ MSG91 Test Error:', error.message);
//         res.status(500).json({
//             success: false,
//             error: `MSG91 test failed: ${error.message}`
//         });
//     }
// });

// Test payment integration
app.get('/api/test/payment', async (req, res) => {
    try {
        console.log('🧪 Testing Razorpay Payment Integration...');

        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            return res.status(400).json({
                success: false,
                error: 'Razorpay credentials not found in environment variables',
                instructions: [
                    '1. Get your credentials from Razorpay dashboard: https://dashboard.razorpay.com/',
                    '2. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to your .env file',
                    '3. Restart the server'
                ]
            });
        }

        // Test configuration
        const config = {
            keyId: process.env.RAZORPAY_KEY_ID ? '✅ Configured' : '❌ Missing',
            keySecret: process.env.RAZORPAY_KEY_SECRET ? '✅ Configured' : '❌ Missing',
            webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ? '✅ Configured' : '⚠️ Optional',
            testMode: process.env.NODE_ENV === 'development'
        };

        const plans = PaymentService.getAllPlans();

        console.log('✅ Razorpay Payment Service Ready');

        res.json({
            success: true,
            status: 'Razorpay Payment Integration Ready! ✅',
            config: config,
            plans: plans,
            endpoints: {
                createOrder: 'POST /api/payment/create-order',
                verifyPayment: 'POST /api/payment/verify',
                paymentFailure: 'POST /api/payment/failure',
                paymentStatus: 'GET /api/payment/status/:orderId',
                paymentHistory: 'GET /api/payment/history/:userId',
                webhook: 'POST /api/payment/webhook'
            },
            testInstructions: [
                '1. Use frontend to test complete payment flow',
                '2. Use test card numbers from Razorpay documentation',
                '3. Monitor Razorpay dashboard for transaction status'
            ],
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Payment test error:', error.message);
        res.status(500).json({
            success: false,
            error: `Payment test failed: ${error.message}`
        });
    }
});

// Test Claude API endpoint
app.get('/api/test/claude', async (req, res) => {
    try {
        console.log("🔍 Testing Claude API...");
        
        if (!process.env.CLAUDE_API_KEY) {
            return res.status(400).json({
                success: false,
                error: "Claude API key not found in environment variables"
            });
        }
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 100,
                messages: [
                    {
                        role: 'user',
                        content: 'Test message for ChatAstro - please respond with "Claude API working perfectly for streaming responses!" 🤖'
                    }
                ]
            })
        });

        console.log("📡 Claude Response status:", response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Claude API Error:", errorText);
            
            return res.status(response.status).json({
                success: false,
                error: `Claude API returned ${response.status}: ${response.statusText}`,
                details: errorText
            });
        }

        const data = await response.json();
        
        console.log("✅ Claude API Working!");
        console.log("🤖 Response:", data.content[0].text);
        
        res.json({
            success: true,
            status: "Claude API Working! ✅",
            response: data.content[0].text,
            model: data.model,
            usage: data.usage,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error("❌ Network Error:", error.message);
        res.status(500).json({
            success: false,
            error: `Network error: ${error.message}`
        });
    }
});

// Test Divine API endpoint
app.get('/api/test/divine', async (req, res) => {
    try {
        console.log("🔮 Testing Divine API connection...");
        
        if (!process.env.DIVINE_API_KEY || !process.env.DIVINE_AUTH_TOKEN) {
            return res.status(400).json({
                success: false,
                error: "Divine API credentials not found in environment variables"
            });
        }

        const formData = new URLSearchParams();
        formData.append('api_key', process.env.DIVINE_API_KEY);
        formData.append('full_name', 'Test User');
        formData.append('day', '15');
        formData.append('month', '8');
        formData.append('year', '1990');
        formData.append('hour', '14');
        formData.append('min', '30');
        formData.append('sec', '0');
        formData.append('gender', 'male');
        formData.append('place', 'Mumbai');
        formData.append('lat', '19.0760');
        formData.append('lon', '72.8777');
        formData.append('tzone', '5.5');
        formData.append('lan', 'en');

        const response = await fetch('https://astroapi-3.divineapi.com/indian-api/v1/planetary-positions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.DIVINE_AUTH_TOKEN}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        console.log("📡 Divine Response status:", response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("❌ Divine API Error:", errorText);
            
            return res.status(response.status).json({
                success: false,
                error: `Divine API returned ${response.status}: ${response.statusText}`,
                details: errorText
            });
        }

        const data = await response.json();
        console.log("✅ Divine API Working!");
        
        res.json({
            success: true,
            status: "Divine API Working! ✅",
            result: data,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error("❌ Network Error:", error.message);
        res.status(500).json({
            success: false,
            error: `Network error: ${error.message}`
        });
    }
});

// Enhanced health check
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        stats: {
            users: users.size,
            sessions: sessions.size,
            cache: astroCache.size,
            userStates: userStates.size
        },
        apis: {
            msg91: {
                configured: !!process.env.MSG91_AUTH_KEY,
                auth_key: process.env.MSG91_AUTH_KEY ? '✅ Set' : '❌ Missing',
                sender_id: process.env.MSG91_SENDER_ID || 'CHATRO'
            },
            razorpay: {
                configured: !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET,
                key_id: process.env.RAZORPAY_KEY_ID ? '✅ Set' : '❌ Missing',
                key_secret: process.env.RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ Missing'
            },
            divine: {
                configured: !!process.env.DIVINE_API_KEY && !!process.env.DIVINE_AUTH_TOKEN,
                api_key: process.env.DIVINE_API_KEY ? '✅ Set' : '❌ Missing',
                auth_token: process.env.DIVINE_AUTH_TOKEN ? '✅ Set' : '❌ Missing'
            },
            claude: {
                configured: !!process.env.CLAUDE_API_KEY,
                api_key: process.env.CLAUDE_API_KEY ? '✅ Set' : '❌ Missing',
                key_length: process.env.CLAUDE_API_KEY ? process.env.CLAUDE_API_KEY.length : 0,
                key_format: process.env.CLAUDE_API_KEY ? 
                    (process.env.CLAUDE_API_KEY.startsWith('sk-ant-api03-') ? '✅ Correct' : '❌ Invalid format') : '❌ Missing'
            },
            opencage: {
                configured: !!process.env.OPENCAGE_API_KEY,
                api_key: process.env.OPENCAGE_API_KEY ? '✅ Set' : '❌ Missing'
            }
        }
    };
    
    res.json(health);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    
    res.status(500).json({ 
        success: false,
        message: 'Internal server error',
        timestamp: new Date().toISOString(),
        error: process.env.NODE_ENV === 'development' ? {
            message: error.message,
            stack: error.stack
        } : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false,
        message: 'Endpoint not found',
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n🌟✨ ChatAstro Backend with MSG91 + Razorpay Successfully Started! ✨🌟');
    console.log('='.repeat(80));
    console.log(`🚀 Server Running: http://localhost:${PORT}`);
    console.log(`📋 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🧪 Test Dashboard: http://localhost:${PORT}/test`);
    
    console.log('\n🔧 API Configuration:');
    console.log(`   MSG91 OTP: ${process.env.MSG91_AUTH_KEY ? '✅ Connected' : '❌ Missing Key'}`);
    console.log(`   Razorpay Payment: ${process.env.RAZORPAY_KEY_ID ? '✅ Connected' : '❌ Missing Key'}`);
    console.log(`   Claude AI: ${process.env.CLAUDE_API_KEY ? '✅ Connected' : '❌ Missing Key'}`);
    console.log(`   Divine API: ${process.env.DIVINE_API_KEY ? '✅ Connected' : '❌ Missing Key'}`);
    console.log(`   OpenCage: ${process.env.OPENCAGE_API_KEY ? '✅ Connected' : '❌ Missing Key'}`);
    
    console.log('\n✨ New Features:');
    console.log('   📱 MSG91 Real SMS OTP Integration');
    console.log('   💳 Razorpay Secure Payment Processing');
    console.log('   🎯 Payment Plans: ₹199/299/399 + ₹999 Report');
    console.log('   🔒 Premium User State Management');
    console.log('   💬 ChatGPT-style streaming responses');
    console.log('   🛡️ Enhanced security and validation');
    
    console.log('\n⭐ Ready to provide premium cosmic insights! ⭐');
    console.log('='.repeat(80));
});