/**
 * FaceControl Backend - WebSocket Edition
 * Ultra-low latency mouse control using WebSocket + robotjs (cross-platform)
 * Environment Independent - Works on Windows, Mac, Linux
 */

const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const os = require('os');
const path = require('path');

// Cross-platform mouse control via robotjs
let robot;
try {
    robot = require('@jitsi/robotjs');
    // Configure robotjs for speed
    robot.setMouseDelay(0);
    console.log(`✅ RobotJS loaded successfully (Platform: ${os.platform()})`);
} catch (error) {
    console.error(`❌ Failed to load RobotJS on ${os.platform()}:`, error.message);
    console.log('⚠️ Mouse control will be disabled. Reinstall with: npm rebuild @jitsi/robotjs');
    // Create a mock robot object to prevent crashes
    robot = {
        moveMouse: () => { },
        mouseClick: () => { },
        mouseToggle: () => { },
        typeString: () => { },
        getMousePos: () => ({ x: 0, y: 0 }),
        getScreenSize: () => ({ width: 1920, height: 1080 }),
        screen: { capture: () => ({ width: 100, height: 100, image: Buffer.alloc(40000) }) }
    };
}

const { Jimp } = require('jimp');
// Node 18+ has native fetch, no need for node-fetch
// Load environment variables (cross-platform path handling)
const dotenvPath = path.resolve(__dirname, '.env');
require('dotenv').config({ path: dotenvPath });

// Log platform info for debugging
console.log(`🖥️  Platform: ${os.platform()} (${os.arch()})`);
console.log(`📁 Working Directory: ${process.cwd()}`);

// HF API Key - fallback to hardcoded if env not set
const HF_API_KEY = process.env.HF_API_KEY;

// Unsplash API Key for voice image search
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

const app = express();
const PORT = 3002;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Current state
let currentPos = { x: 960, y: 540 };
let screenSize = robot.getScreenSize();

// Movement queue for batching
let pendingMove = null;
let moveTimer = null;
const BATCH_INTERVAL = 8; // 8ms = 125fps max

// ============================================
// Mouse Control Functions (Cross-Platform)
// ============================================

function moveCursor(x, y) {
    x = Math.max(0, Math.min(screenSize.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(screenSize.height - 1, Math.round(y)));

    // Only move if position changed
    if (x === currentPos.x && y === currentPos.y) return currentPos;

    try {
        robot.moveMouse(x, y);
        currentPos = { x, y };
    } catch (error) {
        // Silent fail for speed
    }

    return currentPos;
}

function mouseClick(action = 'left') {
    try {
        switch (action) {
            case 'left':
                robot.mouseClick();
                break;
            case 'right':
                robot.mouseClick('right');
                break;
            case 'mousedown':
                robot.mouseToggle('down');
                break;
            case 'mouseup':
                robot.mouseToggle('up');
                break;
        }
    } catch (error) {
        console.error('[Click Error]', error.message);
    }
}

// Batched move execution
function executePendingMove() {
    if (pendingMove) {
        moveCursor(pendingMove.x, pendingMove.y);
        pendingMove = null;
    }
}

// Queue move for batched execution
function queueMove(x, y) {
    pendingMove = { x, y };

    if (!moveTimer) {
        moveTimer = setInterval(() => {
            if (pendingMove) {
                executePendingMove();
            }
        }, BATCH_INTERVAL);
    }
}

// ============================================
// HTTP API (for health check only)
// ============================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        position: currentPos,
        screen: screenSize,
        websocket: `ws://localhost:${PORT}`
    });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ============================================
// Create HTTP + WebSocket Server
// ============================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('🔌 Client connected via WebSocket');

    // Send current position on connect
    ws.send(JSON.stringify({ type: 'position', ...currentPos }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            switch (msg.action) {
                case 'moveTo':
                    // Queue move for batched execution (ultra-fast)
                    queueMove(msg.x, msg.y);
                    break;

                case 'move':
                    // Relative move
                    queueMove(currentPos.x + (msg.x || 0), currentPos.y + (msg.y || 0));
                    break;

                case 'click':
                    mouseClick(msg.button || 'left');
                    break;

                case 'doubleclick':
                    mouseClick('left');
                    setTimeout(() => mouseClick('left'), 50);
                    break;

                case 'mousedown':
                    mouseClick('mousedown');
                    break;

                case 'mouseup':
                    mouseClick('mouseup');
                    break;

                case 'type':
                    // Type text from speech recognition
                    if (msg.text) {
                        try {
                            robot.typeString(msg.text);
                        } catch (error) {
                            console.error('[Type Error]', error.message);
                        }
                    }
                case 'analyze':
                    console.log('🔍 Analyzing screen at', msg.x, msg.y);
                    analyzeScreen(msg.x, msg.y, ws);
                    break;

                case 'analyze_design':
                    console.log('🎨 Analyzing FULL DESIGN...');
                    analyzeFullDesign(ws);
                    break;

                case 'improve_design':
                    console.log('🚀 Generating Design IMPROVEMENTS...');
                    generateDesignImprovements(ws);
                    break;

                case 'image_search':
                    console.log('🖼️ Image Search:', msg.query);
                    searchUnsplashImages(msg.query, msg.count || 12, ws);
                    break;

                case 'suggest_images':
                    console.log('🔮 AI Image Suggestions requested...');
                    generateSmartImageSuggestions(ws);
                    break;
            }
        } catch (e) {
            // Silent fail for speed
        }
    });

    ws.on('close', () => {
        console.log('🔌 Client disconnected');
    });

    ws.on('error', () => {
        // Silent
    });
});

// ============================================
// Start Server
// ============================================

server.listen(PORT, () => {
    const platform = os.platform();
    const platformName = {
        'win32': 'Windows',
        'darwin': 'macOS',
        'linux': 'Linux'
    }[platform] || platform;

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  🚀 FaceControl WebSocket Server             ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  HTTP:      http://localhost:${PORT}            ║`);
    console.log(`║  WebSocket: ws://localhost:${PORT}              ║`);
    console.log('║  Latency:   ~8ms (125fps)                    ║');
    console.log(`║  Platform:  ${platformName.padEnd(22)}       ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('✅ Ultra-smooth mode ready!\n');

    // Check if HF_API_KEY is set
    if (!HF_API_KEY) {
        console.log('⚠️  Warning: HF_API_KEY not set. AI analysis features will be disabled.');
        console.log('   Create a .env file with: HF_API_KEY=your_key_here\n');
    }
});


// ============================================
// 🎨 ANALYZE FULL DESIGN (Advisor)
// ============================================
async function analyzeFullDesign(ws) {
    try {
        if (!HF_API_KEY) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing HF_API_KEY' }));
            return;
        }

        const startTime = Date.now();
        const screenSize = robot.getScreenSize();

        // Capture FULL Screen (High Res for Design)
        // We'll scale it down later if needed, but for now capture it all.
        // NOTE: RobotJS capture is fast.
        const capture = robot.screen.capture(0, 0, screenSize.width, screenSize.height);

        // Convert BGRA -> RGBA
        const width = capture.width;
        const height = capture.height;
        const rgbaBuffer = Buffer.alloc(width * height * 4);
        const data = capture.image;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            rgbaBuffer[idx] = data[idx + 2];     // R
            rgbaBuffer[idx + 1] = data[idx + 1]; // G
            rgbaBuffer[idx + 2] = data[idx];     // B
            rgbaBuffer[idx + 3] = 255;           // A
        }

        // Process with Jimp
        const image = new Jimp({ width, height, data: rgbaBuffer });

        // Resize to manageable max dim (e.g. 1024) to save tokens/bandwidth while keeping detail
        // Aggressively resize to prevent timeouts with large screens (like retina/4k)
        if (width > 1024 || height > 1024) {
            image.scaleToFit({ w: 1024, h: 1024 });
        }

        // Reduce quality to 70 for speed (still good for text)
        const imageBuffer = await image.getBuffer('image/jpeg', { quality: 70 });
        const base64Image = imageBuffer.toString('base64');

        console.log(`🎨 Captured & Resized: ${image.bitmap.width}x${image.bitmap.height} -> Ready in ${Date.now() - startTime}ms`);

        // PROMPT: Detailed Design Advisor
        const prompt = `Act as a Senior UX/UI Design Director. 
TARGET FOCUS: Analyze ONLY the central "Canvas" area (the user's actual design/artwork inside the editing workspace).
STRICTLY IGNORE: The surrounding Adobe Express interface, including the left sidebar (Add-ons), the top navigation bar, and the right floating panels (FaceControl).

Provide crisp, professional feedback specifically on the user's design composition:

1. 🧩 Layout & Hierarchy: Critique the alignment, balance, and spacing *within the design artwork*.
2. 🎯 Visual Aesthetics: Judge the color harmony, font pairings, and professional look.
3. ♿ Readability: Check text contrast against the design background and font legibility.
4. 🧠 Message Clarity: Is the design's purpose (e.g., event banner, poster) instantly clear or cluttered?

Return STRICT JSON:
{
  "layout": "Specific feedback...",
  "practices": "Specific feedback...",
  "accessibility": "Specific feedback...",
  "clarity": "Specific feedback..."
}

Keep feedback under 20 words per section. No markdown.`;

        console.log("start");
        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Qwen/Qwen2.5-VL-72B-Instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_completion_tokens: 500,
                temperature: 0.2,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ HF API Error Response:', errorText);
            throw new Error(`HF API Error: ${response.status} - ${errorText.substring(0, 200)}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content;

        console.log(`🧠 AI Advice (${Date.now() - startTime}ms) len: ${content.length}`);

        // Parse JSON
        let advice;
        try {
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            advice = JSON.parse(jsonStr);
        } catch (e) {
            console.warn("JSON Parse fix", e);
            advice = { layout: content }; // Fallback
        }

        ws.send(JSON.stringify({
            type: 'design_advice',
            data: advice
        }));

    } catch (error) {
        console.error('❌ Design Analysis Error:', error.message);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Design Analysis Failed'
        }));
    }
}

// ============================================
// 🚀 GENERATE DESIGN IMPROVEMENTS (Actionable)
// ============================================
async function generateDesignImprovements(ws) {
    try {
        if (!HF_API_KEY) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing HF_API_KEY' }));
            return;
        }

        const startTime = Date.now();
        const screenSize = robot.getScreenSize();

        // Capture FULL Screen
        const capture = robot.screen.capture(0, 0, screenSize.width, screenSize.height);

        // Convert BGRA -> RGBA
        const width = capture.width;
        const height = capture.height;
        const rgbaBuffer = Buffer.alloc(width * height * 4);
        const data = capture.image;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            rgbaBuffer[idx] = data[idx + 2];     // R
            rgbaBuffer[idx + 1] = data[idx + 1]; // G
            rgbaBuffer[idx + 2] = data[idx];     // B
            rgbaBuffer[idx + 3] = 255;           // A
        }

        // Process with Jimp - resize for speed
        const image = new Jimp({ width, height, data: rgbaBuffer });
        if (width > 1024 || height > 1024) {
            image.scaleToFit({ w: 1024, h: 1024 });
        }

        const imageBuffer = await image.getBuffer('image/jpeg', { quality: 70 });
        const base64Image = imageBuffer.toString('base64');

        console.log(`🚀 Captured & Resized: ${image.bitmap.width}x${image.bitmap.height} -> Ready in ${Date.now() - startTime}ms`);

        // PROMPT: Generate ACTIONABLE design improvements
        const prompt = `You are a Design Improvement Engine. Analyze the central canvas area (the user's design) and generate ACTIONABLE improvement commands.

FOCUS ONLY on the user's design/artwork in the central canvas. IGNORE the Adobe Express UI (sidebars, toolbars, panels).

Your task: Suggest 2-4 visual enhancements that can be programmatically added to improve the design.

Return STRICT JSON with this structure:
{
  "reasoning": "Brief explanation of why these improvements help (max 30 words)",
  "improvements": {
    "addShape": [
      {
        "type": "rectangle",
        "x": 50,
        "y": 50,
        "width": 200,
        "height": 100,
        "fill": "#6366f1",
        "opacity": 0.8,
        "cornerRadius": 12
      }
    ],
    "addText": [
      {
        "content": "Add your text here",
        "x": 100,
        "y": 200,
        "color": "#ffffff"
      }
    ],
    "addDecorations": [
      {
        "type": "accent-shape",
        "x": 20,
        "y": 100,
        "width": 8,
        "height": 300,
        "fill": "#10b981",
        "cornerRadius": 4
      }
    ]
  }
}

Guidelines:
- Use harmonious colors (hex format like #6366f1, #10b981, #f59e0b)
- Position elements thoughtfully (x, y in pixels from top-left)
- cornerRadius makes shapes modern (8-20 pixels typical)
- Keep opacity between 0.3 and 1.0
- Be creative but tasteful - suggest accent shapes, backgrounds, or decorative elements
- Output ONLY valid JSON, no markdown or explanatory text`;

        console.log("🚀 Sending to AI for improvement generation...");
        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Qwen/Qwen2.5-VL-72B-Instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_completion_tokens: 800,
                temperature: 0.3,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ HF API Error Response:', errorText);
            throw new Error(`HF API Error: ${response.status} - ${errorText.substring(0, 200)}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content;

        console.log(`🧠 AI Improvements (${Date.now() - startTime}ms) len: ${content.length}`);

        // Parse JSON
        let improvements;
        try {
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            improvements = JSON.parse(jsonStr);
        } catch (e) {
            console.warn("JSON Parse fix attempt", e);
            // Try to extract just the improvements object
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    improvements = JSON.parse(match[0]);
                } catch (e2) {
                    improvements = {
                        reasoning: "Could not parse AI response",
                        improvements: {
                            addShape: [{
                                type: "rectangle",
                                x: 100,
                                y: 100,
                                width: 200,
                                height: 100,
                                fill: "#6366f1",
                                cornerRadius: 12
                            }]
                        }
                    };
                }
            } else {
                improvements = {
                    reasoning: "Default improvement applied",
                    improvements: {
                        addShape: [{
                            type: "rectangle",
                            x: 100,
                            y: 100,
                            width: 200,
                            height: 100,
                            fill: "#6366f1",
                            cornerRadius: 12
                        }]
                    }
                };
            }
        }

        console.log("✅ Improvements generated:", JSON.stringify(improvements, null, 2));

        ws.send(JSON.stringify({
            type: 'design_improvements',
            data: improvements
        }));

    } catch (error) {
        console.error('❌ Design Improvement Error:', error.message);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Design Improvement Failed'
        }));
    }
}

// ============================================
// 🔮 AI-POWERED IMAGE SUGGESTIONS
// ============================================
async function generateSmartImageSuggestions(ws) {
    try {
        if (!HF_API_KEY) {
            ws.send(JSON.stringify({
                type: 'image_suggestion_error',
                message: 'Missing HF_API_KEY for AI analysis'
            }));
            return;
        }

        if (!UNSPLASH_ACCESS_KEY) {
            ws.send(JSON.stringify({
                type: 'image_suggestion_error',
                message: 'Missing UNSPLASH_ACCESS_KEY'
            }));
            return;
        }

        const startTime = Date.now();

        // Step 1: Capture the screen (canvas area)
        console.log('🔮 Step 1: Capturing screen...');
        const screenSize = robot.getScreenSize();
        const capture = robot.screen.capture(0, 0, screenSize.width, screenSize.height);

        // Convert BGRA -> RGBA
        const width = capture.width;
        const height = capture.height;
        const rgbaBuffer = Buffer.alloc(width * height * 4);
        const data = capture.image;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            rgbaBuffer[idx] = data[idx + 2];     // R
            rgbaBuffer[idx + 1] = data[idx + 1]; // G
            rgbaBuffer[idx + 2] = data[idx];     // B
            rgbaBuffer[idx + 3] = 255;           // A
        }

        // Process with Jimp - resize for speed
        const image = new Jimp({ width, height, data: rgbaBuffer });
        if (width > 1024 || height > 1024) {
            image.scaleToFit({ w: 1024, h: 1024 });
        }

        const imageBuffer = await image.getBuffer('image/jpeg', { quality: 70 });
        const base64Image = imageBuffer.toString('base64');

        console.log(`🔮 Step 2: Sending to AI for analysis... (${Date.now() - startTime}ms)`);

        // Step 2: Send to AI to get search keywords
        const prompt = `You are a visual researcher helping find stock photos. Look at the Adobe Express canvas in this screenshot (the white/colored design area in the center - IGNORE the toolbars and sidebar UI).

Based on the design's theme, colors, text, and style, suggest a short search query for finding a complementary stock photo on Unsplash.

Rules:
- Return ONLY a search query (2-5 words)
- Focus on mood/style, not literal elements
- Think about what background or accent image would enhance this design
- Examples: "minimalist blue gradient", "warm coffee aesthetic", "modern tech abstract", "nature peaceful green"

Return ONLY the search query, nothing else.`;

        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Qwen/Qwen2.5-VL-72B-Instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_completion_tokens: 50,
                temperature: 0.3,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ AI Analysis Error:', errorText);
            throw new Error(`AI Error: ${response.status}`);
        }

        const result = await response.json();
        let searchQuery = result.choices[0].message.content.trim();
        
        // Clean up the query (remove quotes, extra punctuation)
        searchQuery = searchQuery.replace(/["']/g, '').replace(/\.$/, '').trim();

        console.log(`🔮 Step 3: AI suggested query: "${searchQuery}" (${Date.now() - startTime}ms)`);

        // Send the insight back to frontend
        ws.send(JSON.stringify({
            type: 'image_suggestion_insight',
            insight: searchQuery
        }));

        // Step 3: Search Unsplash with the AI-generated query
        console.log(`🔮 Step 4: Searching Unsplash for "${searchQuery}"...`);

        const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchQuery)}&per_page=9&orientation=landscape`;

        const unsplashResponse = await fetch(unsplashUrl, {
            headers: {
                'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`,
                'Accept-Version': 'v1'
            }
        });

        if (!unsplashResponse.ok) {
            throw new Error(`Unsplash Error: ${unsplashResponse.status}`);
        }

        const unsplashData = await unsplashResponse.json();

        const images = unsplashData.results.map((img, index) => ({
            index: index,
            id: img.id,
            thumbnail: img.urls.small,
            regular: img.urls.regular,
            full: img.urls.full,
            width: img.width,
            height: img.height,
            color: img.color,
            description: img.description || img.alt_description || searchQuery,
            photographer: {
                name: img.user.name,
                username: img.user.username,
                link: img.user.links.html
            }
        }));

        console.log(`🔮 Complete! Found ${images.length} images in ${Date.now() - startTime}ms`);

        ws.send(JSON.stringify({
            type: 'image_suggestion_results',
            query: searchQuery,
            total: unsplashData.total,
            images: images
        }));

    } catch (error) {
        console.error('❌ Smart Suggestion Error:', error.message);
        ws.send(JSON.stringify({
            type: 'image_suggestion_error',
            message: error.message
        }));
    }
}

// ============================================
// 🖼️ IMAGE SEARCH (Unsplash)
// ============================================
async function searchUnsplashImages(query, count, ws) {
    try {
        if (!UNSPLASH_ACCESS_KEY) {
            console.log('❌ Missing UNSPLASH_ACCESS_KEY');
            ws.send(JSON.stringify({
                type: 'image_search_error',
                message: 'Missing Unsplash API Key. Add UNSPLASH_ACCESS_KEY to .env file.'
            }));
            return;
        }

        const startTime = Date.now();
        const perPage = Math.min(count, 30); // Unsplash max is 30

        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;

        console.log(`🔍 Searching Unsplash: "${query}" (${perPage} results)`);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`,
                'Accept-Version': 'v1'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Unsplash API Error:', response.status, errorText);
            throw new Error(`Unsplash API Error: ${response.status}`);
        }

        const data = await response.json();

        // Transform results to a cleaner format
        const images = data.results.map((img, index) => ({
            index: index,
            id: img.id,
            thumbnail: img.urls.small,       // 400px wide
            regular: img.urls.regular,       // 1080px wide
            full: img.urls.full,             // Original size
            width: img.width,
            height: img.height,
            color: img.color,                // Dominant color (for placeholder)
            description: img.description || img.alt_description || query,
            photographer: {
                name: img.user.name,
                username: img.user.username,
                link: img.user.links.html
            }
        }));

        console.log(`✅ Found ${images.length} images in ${Date.now() - startTime}ms`);

        ws.send(JSON.stringify({
            type: 'image_search_results',
            query: query,
            total: data.total,
            images: images
        }));

    } catch (error) {
        console.error('❌ Image Search Error:', error.message);
        ws.send(JSON.stringify({
            type: 'image_search_error',
            message: error.message
        }));
    }
}

// ============================================
// AI Analysis Functions
// ============================================

async function analyzeScreen(x, y, ws) {
    try {
        if (!HF_API_KEY) {
            console.log('❌ Missing HF_API_KEY');
            ws.send(JSON.stringify({
                type: 'explanation',
                data: { name: 'Error', mood: 'Missing API Key', reason: 'Please add HF_API_KEY to .env file' }
            }));
            return;
        }

        // 1. Get REAL mouse position from system
        const mousePos = robot.getMousePos();
        const startTime = Date.now();

        // 2. Capture Screen (600x600 for sharp text details)
        const size = 600;

        // Center vertically, but shift down 40% relative to cursor 
        const captureX = Math.max(0, Math.min(mousePos.x - size / 2, screenSize.width - size));
        const captureY = Math.max(0, Math.min(mousePos.y - (size * 0.2), screenSize.height - size));

        const capture = robot.screen.capture(captureX, captureY, size, size);

        // Convert BGRA (robotjs) to RGBA (Jimp)
        const width = capture.width;
        const height = capture.height;
        const rgbaBuffer = Buffer.alloc(width * height * 4);
        const data = capture.image;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            rgbaBuffer[idx] = data[idx + 2];     // R
            rgbaBuffer[idx + 1] = data[idx + 1]; // G
            rgbaBuffer[idx + 2] = data[idx];     // B
            rgbaBuffer[idx + 3] = 255;           // A
        }

        // Create compressed JPEG (High Quality for text readability)
        const image = new Jimp({ width, height, data: rgbaBuffer });
        const imageBuffer = await image.getBuffer('image/jpeg', { quality: 80 });
        const base64Image = imageBuffer.toString('base64');

        console.log('📸 Captured & Encoded (High Res):', (Date.now() - startTime) + 'ms');

        // STEP 3: HF Router API (Vision + JSON)
        // Switch to Llama 3.2 Vision (11B) for better UI understanding
        const prompt = `Act as a UI/UX expert. Analyze the specific UI element focused in this image (from Adobe Express).
Return a raw JSON object with:
- name: Precise technical component name (max 3 words).
- mood: 2 distinct, evocative adjectives for the visual style.
- reason: A razor-sharp explanation of its specific utility and design intent (under 15 words).

Example: {"name": "Generate Button", "mood": "Vibrant & Urgent", "reason": "Gradient fill draws eye to the core AI creation feature."}

Output STRICTLY valid JSON. No markdown. No conversational text.`;

        console.log(`data:image/jpeg;base64,${base64Image}`);

        const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Qwen/Qwen2.5-VL-72B-Instruct",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                max_completion_tokens: 300,
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HF Router failed (${response.status}): ${errText.substring(0, 100)}`);
        }

        const responseData = await response.json();
        const content = responseData.choices?.[0]?.message?.content || "";

        // Extract JSON from the router response
        let analysis;
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                analysis = JSON.parse(jsonMatch[0]);
            } else {
                // If no JSON found, treat the whole content as the reason
                analysis = { name: "Visual Element", mood: "Identified", reason: content.substring(0, 100) };
            }
        } catch (e) {
            analysis = { name: "Analysis", mood: "Complex", reason: content.substring(0, 100) };
        }

        console.log(`🧠 AI Thought (${Date.now() - startTime}ms):`, analysis);

        ws.send(JSON.stringify({
            type: 'explanation',
            data: {
                name: analysis.name || 'Component',
                mood: analysis.mood || 'Visual',
                reason: analysis.reason || 'Detected visual element.'
            }
        }));

    } catch (error) {
        ws.send(JSON.stringify({
            type: 'explanation',
            data: { name: 'Error', mood: 'Failed', reason: error.message.replace(/"/g, '') }
        }));
    }
}



