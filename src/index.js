/**
 * FaceControl - Hands-Free Mouse Control
 * ULTRA SMOOTH Edition with Wink Detection
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
    backendUrl: 'http://localhost:3002',
    screenWidth: 1920,
    screenHeight: 1080
};

// ============================================
// Adobe Express Add-on SDK Integration
// ============================================

let addOnUISdk = null;
let sandboxProxy = null; // Proxy to communicate with document sandbox

/**
 * Initialize Adobe Express Add-on SDK and get proxy to document sandbox
 */
async function initAddOnSdk() {
    try {
        // Import the SDK (available in Adobe Express add-on context)
        const addOnUISdkModule = await import('https://new.express.adobe.com/static/add-on-sdk/sdk.js');
        addOnUISdk = addOnUISdkModule.default;

        await addOnUISdk.ready;

        // Get proxy to document sandbox for canvas operations
        sandboxProxy = await addOnUISdk.instance.runtime.apiProxy("documentSandbox");

        console.log('✅ Adobe Express SDK initialized');
        console.log('✅ Document sandbox proxy connected');
        return true;
    } catch (error) {
        console.error('❌ Adobe Express SDK not available:', error);
        return false;
    }
}

// ============================================
// ULTRA SMOOTH Movement - Advanced Multi-Layer Smoothing
// ============================================

// ---- Layer 1: Raw input buffer for noise reduction ----
const RAW_BUFFER_SIZE = 8;  // Increased for more stability
let rawBufferX = [];
let rawBufferY = [];

// ---- Layer 2: Kalman-style prediction filter (tuned for stability) ----
let kalmanX = { estimate: null, errorEstimate: 1, errorMeasure: 0.05, q: 0.005 };
let kalmanY = { estimate: null, errorEstimate: 1, errorMeasure: 0.05, q: 0.005 };

// ---- Layer 3: Velocity-based adaptive smoothing ----
let velocityX = 0;
let velocityY = 0;
let lastTargetX = null;
let lastTargetY = null;
let lastTargetTime = 0;

// ---- Layer 4: Final output with bezier interpolation ----
let smoothX = null;
let smoothY = null;
let outputX = null;
let outputY = null;

// ---- Smoothing parameters (Tuned for stability) ----
const SMOOTH_CONFIG = {
    // Base smoothing (lower = smoother, higher = more responsive)
    baseSmoothFactor: 0.06,  // Lower = more stable
    // Velocity influence (higher = faster movements less smoothed)
    velocityInfluence: 0.002,
    // Maximum smooth factor (responsiveness cap)
    maxSmoothFactor: 0.20,
    // Minimum smooth factor (minimum smoothness) 
    minSmoothFactor: 0.02,   // Very smooth when still
    // Jitter threshold in pixels (movements below this are filtered)
    jitterThreshold: 5,      // Increased to filter micro-movements
    // Dead zone radius in normalized coordinates
    deadZone: 0.008,         // Larger dead zone for stability
    // Output interpolation factor
    outputLerp: 0.1,         // Slower interpolation = smoother
    // Bezier curve control point factor
    bezierFactor: 0.3
};

// Track position for sending
let lastSentX = 0;
let lastSentY = 0;

// Update timing - WebSocket allows much higher FPS!
let lastMouseUpdate = 0;
const UPDATE_INTERVAL = 8; // ~125fps - WebSocket can handle it!

// Animation frame for continuous interpolation
let animationFrameId = null;

// Mouth detection for click
let lastMouthClick = 0;
const MOUTH_CLICK_COOLDOWN = 500;

// ---- Helper Functions for Smoothing ----

function kalmanFilter(measurement, state) {
    if (state.estimate === null) {
        state.estimate = measurement;
        return measurement;
    }

    // Prediction update
    state.errorEstimate += state.q;

    // Kalman gain
    const gain = state.errorEstimate / (state.errorEstimate + state.errorMeasure);

    // Update estimate
    state.estimate = state.estimate + gain * (measurement - state.estimate);

    // Update error estimate
    state.errorEstimate = (1 - gain) * state.errorEstimate;

    return state.estimate;
}

function getMedian(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function addToBuffer(buffer, value, maxSize) {
    buffer.push(value);
    if (buffer.length > maxSize) buffer.shift();
}

function calculateAdaptiveSmoothFactor(vx, vy) {
    const velocity = Math.sqrt(vx * vx + vy * vy);
    // Higher velocity = higher smooth factor (more responsive)
    let factor = SMOOTH_CONFIG.baseSmoothFactor + velocity * SMOOTH_CONFIG.velocityInfluence;
    // Clamp to range
    return Math.max(SMOOTH_CONFIG.minSmoothFactor, Math.min(SMOOTH_CONFIG.maxSmoothFactor, factor));
}

function lerp(start, end, factor) {
    return start + (end - start) * factor;
}

function bezierInterpolate(p0, p1, p2, t) {
    // Quadratic bezier curve
    const oneMinusT = 1 - t;
    return oneMinusT * oneMinusT * p0 + 2 * oneMinusT * t * p1 + t * t * p2;
}

// ============================================
// State
// ============================================

const state = {
    isRunning: false,
    isCalibrated: false,
    calibrationNose: null,
    faceMesh: null,
    backendConnected: false,
    currentNose: { x: 0.5, y: 0.5 },

    finalX: null,
    finalY: null,

    // Click tracking
    lastLeftClick: 0,
    lastRightClick: 0,
    clickCount: 0,
    isDragging: false,

    // Settings
    sensitivity: 1.5,  // Default sensitivity (adjust with slider)
    showMesh: true,

    // Wink detection
    leftEyeOpen: true,
    rightEyeOpen: true,
    winkCooldown: 600,

    // ============================================
    // Speech Recognition State
    // ============================================
    speaking: false,                    // Single authoritative speaking state
    speechRecognition: null,            // Web Speech API instance
    targetTextArea: null,               // Locked text area for transcription
    lastFocusedTextArea: null,          // Track last focused editable element
    speechDebounceTimer: null,          // 250ms silence debounce timer
    lastSpeechActivityTime: 0,          // Timestamp of last speech activity (for debouncing)
    speechInactivityCheckInterval: null, // Interval to check for inactivity
    trackingPaused: false,              // Flag to pause tracking during speech

    // Tracking state preservation (for restoring after speech)
    preSpeechTrackingState: {
        isRunning: false,
        isCalibrated: false
    },
    // AI Analysis
    isAnalyzing: false,
    lastAnalyzedX: -999,
    lastAnalyzedY: -999,
    analysisCooldown: 2000,
    lastWideEyesTime: 0,
    wideEyesCooldown: 1500  // Cooldown between wide-eyes triggers
};

// Eye landmark indices for MediaPipe Face Mesh
const EYE_LANDMARKS = {
    // Left eye (user's left, appears on right in mirrored video)
    left: {
        top: 159,
        bottom: 145,
        inner: 133,
        outer: 33
    },
    // Right eye (user's right, appears on left in mirrored video)
    right: {
        top: 386,
        bottom: 374,
        inner: 362,
        outer: 263
    }
};

// ============================================
// DOM Elements
// ============================================

let elements = {};

function initElements() {
    elements = {
        video: document.getElementById('videoFeed'),
        canvas: document.getElementById('overlayCanvas'),
        placeholder: document.getElementById('placeholder'),
        trackingBadge: document.getElementById('trackingBadge'),
        startBtn: document.getElementById('startBtn'),
        stopBtn: document.getElementById('stopBtn'),
        calibrateBtn: document.getElementById('calibrateBtn'),
        faceStatus: document.getElementById('faceStatus'),
        mouthStatus: document.getElementById('mouthStatus'),
        cursorStatus: document.getElementById('cursorStatus'),
        clickCount: document.getElementById('clickCount'),
        connectionDot: document.getElementById('connectionDot'),
        connectionText: document.getElementById('connectionText'),
        feedback: document.getElementById('feedback'),
        positionDisplay: document.getElementById('positionDisplay'),
        // Speech recognition elements
        speakBtn: document.getElementById('speakBtn'),
        speechStatusText: document.getElementById('speechStatusText'),
        targetTranscriptArea: document.getElementById('targetTranscriptArea'),

        // Inspector
        inspectorCard: document.getElementById('inspectorCard'),
        inspectName: document.getElementById('inspectName'),
        inspectReason: document.getElementById('inspectReason'),
        inspectMood: document.getElementById('inspectMood'),
        inspectLoading: document.getElementById('inspectLoading'),

        // Design Advisor
        analyzeDesignBtn: document.getElementById('analyzeDesignBtn'),
        improveDesignBtn: document.getElementById('improveDesignBtn'),
        advisorResult: document.getElementById('advisorResult'),
        advisorContent: document.getElementById('advisorContent'),
        closeAdvisorBtn: document.getElementById('closeAdvisorBtn'),

        // Image Search
        imageSearchInput: document.getElementById('imageSearchInput'),
        searchImagesBtn: document.getElementById('searchImagesBtn'),
        imageGallery: document.getElementById('imageGallery'),
        suggestImagesBtn: document.getElementById('suggestImagesBtn'),
        aiInsight: document.getElementById('aiInsight'),
        aiInsightText: document.getElementById('aiInsightText')
    };
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    initElements();
    loadSavedSettings(); // Load saved settings from localStorage
    setupEventListeners();
    setupTextAreaTracking(); // Track focused text areas for speech targeting

    // Initialize Adobe Express SDK for canvas text injection
    await initAddOnSdk();

    checkBackend();
    getScreenSize();
    console.log('🎯 SenseLink - Hands-Free Control Ready');
    initDocumentSandbox(); // Initialize Document Sandbox for canvas manipulation
});

// ============================================
// Document API Communication
// ============================================

let documentApi = null;
let pendingImprovements = null; // Store improvements for "Apply" button

async function initDocumentSandbox() {
    try {
        // Wait for the Adobe Add-on UI SDK to be ready
        if (typeof addOnUISdk === 'undefined') {
            console.warn('⚠️ addOnUISdk not loaded - running outside Adobe Express');
            throw new Error('addOnUISdk not available');
        }

        // Wait for the SDK to be ready
        await addOnUISdk.ready;
        console.log('✅ Adobe Add-on UI SDK is ready');

        // Debug: Log what's available
        console.log('📋 addOnUISdk.app:', addOnUISdk.app);
        console.log('📋 addOnUISdk.app.document:', addOnUISdk.app?.document);

        // Store reference to the document API
        documentApi = addOnUISdk.app.document;

        if (documentApi) {
            console.log('✅ Document API connected!');
            console.log('📋 Available methods:', Object.keys(documentApi));

            // Check if addImage exists
            if (typeof documentApi.addImage === 'function') {
                console.log('✅ addImage method available');
            } else {
                console.warn('⚠️ addImage method NOT available');
                // Try to find alternative methods
                console.log('📋 Document API structure:', documentApi);
            }
        } else {
            console.warn('⚠️ documentApi is null/undefined');
        }

        // Enable the improve design button
        if (elements.improveDesignBtn) {
            elements.improveDesignBtn.disabled = false;
            elements.improveDesignBtn.title = 'Get AI design improvements and apply them!';
        }

    } catch (error) {
        console.warn('⚠️ Document API not available:', error.message);
        console.error(error);
        // Still enable the button for showing suggestions
        if (elements.improveDesignBtn) {
            elements.improveDesignBtn.disabled = false;
            elements.improveDesignBtn.title = 'Get AI design suggestions';
        }
    }
    console.log('🎨 Design Improvement feature initialized');
}

// ============================================
// Load Saved Settings from localStorage
// ============================================

function loadSavedSettings() {
    // Load Sensitivity
    const savedSensitivity = localStorage.getItem('facecontrol_sensitivity');
    if (savedSensitivity !== null) {
        const sensitivityValue = parseFloat(savedSensitivity);
        state.sensitivity = sensitivityValue;

        const sensitivitySlider = document.getElementById('sensitivitySlider');
        const sensitivityDisplay = document.getElementById('sensitivityValue');
        if (sensitivitySlider) {
            sensitivitySlider.value = sensitivityValue;
        }
        if (sensitivityDisplay) {
            sensitivityDisplay.textContent = sensitivityValue.toFixed(1);
        }
    }

    // Load Smoothness
    const savedSmoothness = localStorage.getItem('facecontrol_smoothness');
    if (savedSmoothness !== null) {
        const smoothnessValue = parseFloat(savedSmoothness);
        // Apply smoothness to SMOOTH_CONFIG
        SMOOTH_CONFIG.baseSmoothFactor = 0.02 + (smoothnessValue * 0.015);

        const smoothingSlider = document.getElementById('smoothingSlider');
        const smoothingDisplay = document.getElementById('smoothingValue');
        if (smoothingSlider) {
            smoothingSlider.value = smoothnessValue;
        }
        if (smoothingDisplay) {
            smoothingDisplay.textContent = smoothnessValue.toFixed(1);
        }
    }

    console.log('📦 Settings loaded from localStorage');
}

function setupEventListeners() {
    elements.startBtn.addEventListener('click', startTracking);
    elements.stopBtn.addEventListener('click', stopTracking);
    elements.calibrateBtn.addEventListener('click', calibrate);

    // Design Advisor Listeners
    if (elements.analyzeDesignBtn) {
        console.log("✨ Design Advisor Button Found! attaching listener...");
        elements.analyzeDesignBtn.addEventListener('click', (e) => {
            console.log("✨ Button Clicked!");
            triggerDesignAnalysis();
        });
    } else {
        console.error("❌ Design Advisor Button NOT found in DOM");
    }

    if (elements.closeAdvisorBtn) {
        elements.closeAdvisorBtn.addEventListener('click', () => {
            elements.advisorResult.style.display = 'none';
        });
    }

    // Improve Design Button - Auto-apply AI suggestions
    if (elements.improveDesignBtn) {
        console.log("🚀 Improve Design Button Found! attaching listener...");
        elements.improveDesignBtn.addEventListener('click', (e) => {
            console.log("🚀 Improve Design Clicked!");
            triggerDesignImprovement();
        });
    } else {
        console.warn("⚠️ Improve Design Button NOT found in DOM");
    }

    const sensitivitySlider = document.getElementById('sensitivitySlider');
    const smoothingSlider = document.getElementById('smoothingSlider');
    const meshToggle = document.getElementById('meshToggle');

    if (sensitivitySlider) {
        sensitivitySlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            state.sensitivity = value;
            document.getElementById('sensitivityValue').textContent = value.toFixed(1);
            // Save to localStorage
            localStorage.setItem('facecontrol_sensitivity', value.toString());
        });
    }

    if (smoothingSlider) {
        smoothingSlider.addEventListener('input', (e) => {
            // Higher slider value = more responsive (higher base smooth factor)
            // Map 0.1-0.9 to 0.02-0.03 range
            const val = parseFloat(e.target.value);
            SMOOTH_CONFIG.baseSmoothFactor = 0.02 + (val * 0.015);
            document.getElementById('smoothingValue').textContent = val.toFixed(1);
            // Save to localStorage
            localStorage.setItem('facecontrol_smoothness', val.toString());
        });
    }

    if (meshToggle) {
        meshToggle.addEventListener('change', (e) => {
            state.showMesh = e.target.checked;
        });
    }

    // Speech recognition button
    if (elements.speakBtn) {
        elements.speakBtn.addEventListener('click', toggleSpeaking);
    }

    // Image Search
    if (elements.searchImagesBtn) {
        elements.searchImagesBtn.addEventListener('click', triggerImageSearch);
    }
    if (elements.imageSearchInput) {
        elements.imageSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') triggerImageSearch();
        });
    }

    // AI Image Suggestions
    if (elements.suggestImagesBtn) {
        elements.suggestImagesBtn.addEventListener('click', triggerAISuggestions);
    }

    // Settings Modal
    setupSettingsModal();
}

// ============================================
// Backend Communication - WebSocket (Ultra-Low Latency)
// ============================================

let websocket = null;
let wsReconnectTimer = null;
const WS_URL = 'ws://localhost:3002';

function connectWebSocket() {
    if (websocket && websocket.readyState === WebSocket.OPEN) return;

    try {
        websocket = new WebSocket(WS_URL);

        websocket.onopen = () => {
            state.backendConnected = true;
            if (elements.connectionDot) elements.connectionDot.classList.add('connected');
            if (elements.connectionText) elements.connectionText.textContent = 'Connected';
            console.log('🚀 WebSocket connected - Ultra-smooth mode!');

            // Clear reconnect timer
            if (wsReconnectTimer) {
                clearInterval(wsReconnectTimer);
                wsReconnectTimer = null;
            }
        };

        websocket.onclose = () => {
            state.backendConnected = false;
            if (elements.connectionDot) elements.connectionDot.classList.remove('connected');
            if (elements.connectionText) elements.connectionText.textContent = 'Disconnected';

            // Try to reconnect every 2 seconds
            if (!wsReconnectTimer) {
                wsReconnectTimer = setInterval(connectWebSocket, 2000);
            }
        };

        websocket.onerror = () => {
            // Silent - will trigger onclose
        };

        websocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'position') {
                } else if (data.type === 'explanation') {
                    handleExplanation(data.data);
                } else if (data.type === 'design_advice') {
                    handleDesignResponse(data.data);
                } else if (data.type === 'design_improvements') {
                    handleDesignImprovement(data.data);
                } else if (data.type === 'image_search_results') {
                    handleImageSearchResults(data);
                } else if (data.type === 'image_search_error') {
                    handleImageSearchError(data.message);
                } else if (data.type === 'image_suggestion_insight') {
                    handleAIInsight(data.insight);
                } else if (data.type === 'image_suggestion_results') {
                    handleAISuggestionResults(data);
                } else if (data.type === 'image_suggestion_error') {
                    handleAISuggestionError(data.message);
                } else if (data.type === 'error') {
                    showFeedback(`❌ ${data.message}`);
                }
            } catch (e) { }
        };
    } catch (e) {
        state.backendConnected = false;
    }
}

async function checkBackend() {
    // First check HTTP health endpoint
    try {
        const res = await fetch(`${CONFIG.backendUrl}/api/health`);
        if (res.ok) {
            const data = await res.json();
            if (data.screen) {
                CONFIG.screenWidth = data.screen.width || 1920;
                CONFIG.screenHeight = data.screen.height || 1080;
            }
            // Now connect WebSocket
            connectWebSocket();
        }
    } catch (e) {
        state.backendConnected = false;
        // Still try WebSocket
        connectWebSocket();
    }
}

async function getScreenSize() {
    try {
        const res = await fetch(`${CONFIG.backendUrl}/api/health`);
        const data = await res.json();
        if (data.screen) {
            CONFIG.screenWidth = data.screen.width || 1920;
            CONFIG.screenHeight = data.screen.height || 1080;
        }
    } catch (e) { }
}

// Ultra-fast mouse send via WebSocket
function sendMouse(x, y) {
    if (!state.backendConnected || !websocket || websocket.readyState !== WebSocket.OPEN) return;

    // WebSocket send is instant - no HTTP overhead!
    websocket.send(JSON.stringify({ action: 'moveTo', x, y }));
}

// Ultra-fast click via WebSocket
function sendClick(button = 'left') {
    if (!state.backendConnected || !websocket || websocket.readyState !== WebSocket.OPEN) return;

    websocket.send(JSON.stringify({ action: 'click', button }));
}

function sendDragStart() {
    if (!state.backendConnected || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(JSON.stringify({ action: 'mousedown' }));
}

function sendDragEnd() {
    if (!state.backendConnected || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(JSON.stringify({ action: 'mouseup' }));
}

// ============================================
// Camera & Face Mesh
// ============================================

async function startTracking() {
    try {
        elements.startBtn.disabled = true;

        if (!state.faceMesh) {
            state.faceMesh = new FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
            });

            state.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            state.faceMesh.onResults(onFaceResults);
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' }
        });

        elements.video.srcObject = stream;
        await elements.video.play();

        elements.canvas.width = 640;
        elements.canvas.height = 480;

        elements.placeholder.classList.add('hidden');
        elements.startBtn.style.display = 'none';
        elements.stopBtn.style.display = 'flex';
        elements.calibrateBtn.disabled = false;
        elements.trackingBadge.classList.add('active');

        state.isRunning = true;
        processFrame();

        showFeedback('📷 Started!');

    } catch (error) {
        console.error(error);
        showFeedback('❌ Camera denied');
        elements.startBtn.disabled = false;
    }
}

function stopTracking() {
    state.isRunning = false;
    state.isCalibrated = false;
    state.calibrationNose = null;

    // Reset all smoothing variables
    smoothX = null;
    smoothY = null;
    outputX = null;
    outputY = null;
    rawBufferX = [];
    rawBufferY = [];
    velocityX = 0;
    velocityY = 0;
    lastTargetX = null;
    lastTargetY = null;
    lastTargetTime = 0;
    kalmanX = { estimate: null, errorEstimate: 1, errorMeasure: 0.1, q: 0.01 };
    kalmanY = { estimate: null, errorEstimate: 1, errorMeasure: 0.1, q: 0.01 };

    if (elements.video.srcObject) {
        elements.video.srcObject.getTracks().forEach(t => t.stop());
    }

    elements.placeholder.classList.remove('hidden');
    elements.startBtn.style.display = 'flex';
    elements.startBtn.disabled = false;
    elements.stopBtn.style.display = 'none';
    elements.calibrateBtn.disabled = true;
    elements.trackingBadge.classList.remove('active');

    updateStatus('face', 'Stopped');
    updateStatus('cursor', 'Idle');
}

async function processFrame() {
    if (!state.isRunning) return;

    if (elements.video.readyState >= 2) {
        await state.faceMesh.send({ image: elements.video });
    }

    requestAnimationFrame(processFrame);

    // Dwell-based analysis removed - now using wide-eyes gesture instead!
}

function triggerAnalysis(x, y) {
    if (!state.backendConnected) return;

    state.isAnalyzing = true;
    state.lastAnalyzedX = x;
    state.lastAnalyzedY = y;

    // Show loading UI
    elements.inspectorCard.style.display = 'flex';
    elements.inspectorCard.classList.add('active');
    elements.inspectLoading.style.display = 'block';
    elements.inspectName.textContent = 'Analyzing...';
    elements.inspectReason.textContent = 'Capturing screen...';

    console.log('📸 Sending analyze request to backend...');
    const analyzeStart = Date.now();
    state.analyzeStartTime = analyzeStart;

    websocket.send(JSON.stringify({ action: 'analyze', x, y }));
}

function handleExplanation(data) {
    const latency = Date.now() - (state.analyzeStartTime || Date.now());
    state.isAnalyzing = false;
    elements.inspectLoading.style.display = 'none';

    if (!data) {
        console.log('❌ Analysis failed');
        elements.inspectName.textContent = 'Failed';
        elements.inspectReason.textContent = 'Could not analyze area.';
        return;
    }

    // LOG RESULT TO CONSOLE
    console.log(`✨ ANALYSIS RESULT (${latency}ms):`, data);
    console.log(`   Name: ${data.name}`);
    console.log(`   Mood: ${data.mood}`);
    console.log(`   Reason: ${data.reason}`);

    elements.inspectName.textContent = data.name;
    elements.inspectReason.textContent = data.reason;
    elements.inspectMood.textContent = data.mood;
}

// ----------------------------------------------------
// TRIGGER DESIGN ADVISOR (Full Screen)
// ----------------------------------------------------
function triggerDesignAnalysis() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        showFeedback('❌ No Server');
        return;
    }

    // Show UI
    elements.advisorResult.style.display = 'flex';
    elements.advisorContent.innerHTML = `
        <div class="advisor-loading">
            <span class="loader"></span>
            <p>Scanning visual hierarchy & UX patterns...</p>
        </div>
    `;

    console.log('✨ Triggering FULL Design Analysis...');

    // Send request with special action
    websocket.send(JSON.stringify({
        action: 'analyze_design',
        // Optional: could send current cursor pos if relevant, but backend catches full screen
        x: state.finalX || 0,
        y: state.finalY || 0
    }));
}

function handleDesignResponse(data) {
    console.log("🎨 Design Advice:", data);
    elements.advisorContent.innerHTML = renderDesignAdvice(data);
}

function renderDesignAdvice(data) {
    if (!data || data.error) return `<div class="error-state">Analysis Failed</div>`;

    let html = `<div class="status-grid single-col">`;

    // Helper to create card
    const createCard = (icon, title, text) => `
        <div class="status-card advice-item">
            <div class="status-icon-wrapper">
                <span class="status-icon">${icon}</span>
            </div>
            <div class="status-info">
                <span class="status-label">${title}</span>
                <span class="status-value text-wrap">"${text}"</span>
            </div>
        </div>`;

    // 1. Layout & Hierarchy
    if (data.layout) {
        html += createCard('🧩', 'Layout & Hierarchy', data.layout);
    }

    // 2. Best Practices
    if (data.practices) {
        html += createCard('🎯', 'Best Practices', data.practices);
    }

    // 3. Accessibility
    if (data.accessibility) {
        html += createCard('♿', 'Accessibility', data.accessibility);
    }

    // 4. Clarity
    if (data.clarity) {
        html += createCard('🧠', 'Clarity Check', data.clarity);
    }

    html += `</div>`;
    return html;
}

// ============================================
// TRIGGER DESIGN IMPROVEMENT (AI Suggestions)
// ============================================
function triggerDesignImprovement() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        showFeedback('❌ No Server');
        return;
    }

    // Show loading UI
    elements.advisorResult.style.display = 'flex';
    elements.advisorContent.innerHTML = `
        <div class="advisor-loading">
            <span class="loader"></span>
            <p>🚀 Analyzing & generating improvements...</p>
        </div>
    `;

    console.log('🚀 Triggering Design IMPROVEMENT...');

    // Send request with special action for improvements
    websocket.send(JSON.stringify({
        action: 'improve_design',
        x: state.finalX || 0,
        y: state.finalY || 0
    }));
}

// Handle design improvement response from backend
function handleDesignImprovement(data) {
    console.log("🔧 Design Improvements received:", data);

    if (!data || data.error) {
        elements.advisorContent.innerHTML = `<div class="error-state">Improvement generation failed</div>`;
        return;
    }

    // Store improvements for the Apply button
    pendingImprovements = data.improvements;

    // Show the AI-generated improvement suggestions with Apply button
    elements.advisorContent.innerHTML = renderImprovementSuggestions(data);

    // Attach event listener to the Apply button
    const applyBtn = document.getElementById('applyChangesBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyImprovementsToCanvas);
    }

    showFeedback('✨ AI Suggestions Ready!');
}

// Apply improvements to canvas via Document API or fallback to downloads
async function applyImprovementsToCanvas() {
    if (!pendingImprovements) {
        showFeedback('❌ No improvements to apply');
        return;
    }

    const applyBtn = document.getElementById('applyChangesBtn');
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.innerHTML = '⏳ Applying...';
    }

    let appliedCount = 0;
    let downloadedCount = 0;

    try {
        // Try to get/reconnect to Document API
        let docApi = documentApi;

        if (!docApi && typeof addOnUISdk !== 'undefined') {
            try {
                await addOnUISdk.ready;
                docApi = addOnUISdk.app?.document;
                console.log('🔄 Re-attempted SDK connection:', docApi);
            } catch (e) {
                console.warn('SDK reconnection failed:', e);
            }
        }

        // If we have the API and addImage method, use it
        if (docApi && typeof docApi.addImage === 'function') {
            console.log('🎨 Using Document API to add elements...');

            // Apply shapes
            if (pendingImprovements.addShape) {
                for (const shape of pendingImprovements.addShape) {
                    try {
                        const svgBlob = createShapeSvgBlob(shape);
                        await docApi.addImage(svgBlob);
                        appliedCount++;
                        console.log('✅ Added shape:', shape.type);
                    } catch (e) {
                        console.warn('Could not add shape:', e.message);
                    }
                }
            }

            // Apply decorations
            if (pendingImprovements.addDecorations) {
                for (const deco of pendingImprovements.addDecorations) {
                    try {
                        const shapeConfig = {
                            type: 'rectangle',
                            width: deco.width || 50,
                            height: deco.height || 200,
                            fill: deco.fill || '#6366f1',
                            cornerRadius: deco.cornerRadius || 4,
                            opacity: deco.opacity || 1
                        };
                        const svgBlob = createShapeSvgBlob(shapeConfig);
                        await docApi.addImage(svgBlob);
                        appliedCount++;
                        console.log('✅ Added decoration:', deco.type);
                    } catch (e) {
                        console.warn('Could not add decoration:', e.message);
                    }
                }
            }

            // Apply text
            if (pendingImprovements.addText) {
                for (const text of pendingImprovements.addText) {
                    try {
                        const svgBlob = createTextSvgBlob(text);
                        await docApi.addImage(svgBlob);
                        appliedCount++;
                        console.log('✅ Added text:', text.content);
                    } catch (e) {
                        console.warn('Could not add text:', e.message);
                    }
                }
            }
        }

        // If API didn't work or we couldn't apply all, provide download links
        if (appliedCount === 0) {
            console.log('📥 Creating downloadable SVG files as fallback...');
            downloadedCount = createDownloadLinks(pendingImprovements);
        }

        console.log(`✅ Applied: ${appliedCount}, Downloaded: ${downloadedCount}`);

        if (appliedCount > 0) {
            showFeedback('✅ Changes Applied!');
            if (applyBtn) {
                applyBtn.innerHTML = '✅ Applied!';
                applyBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            }
            showSuccessMessage(`${appliedCount} elements added to your canvas!`);
        } else if (downloadedCount > 0) {
            showFeedback('📥 Files Ready!');
            if (applyBtn) {
                applyBtn.innerHTML = '📥 Downloaded!';
                applyBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            }
            showSuccessMessage(`${downloadedCount} SVG files created! Drag them into Adobe Express.`);
        } else {
            throw new Error('No elements could be added');
        }

    } catch (error) {
        console.error('❌ Failed to apply improvements:', error);
        showFeedback('❌ Apply Failed');

        if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.innerHTML = '🚀 Try Again';
        }

        showErrorMessage(error.message);
    }
}

// Create download links for SVG files
function createDownloadLinks(improvements) {
    let count = 0;
    const downloadContainer = document.createElement('div');
    downloadContainer.className = 'download-links-container';
    downloadContainer.innerHTML = '<p style="margin-bottom: 10px; color: var(--text-secondary);">📥 <strong>Drag these files into your Adobe Express canvas:</strong></p>';

    // Create SVGs for shapes
    if (improvements.addShape) {
        improvements.addShape.forEach((shape, i) => {
            const blob = createShapeSvgBlob(shape);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `shape_${i + 1}.svg`;
            link.className = 'download-link-btn';
            link.innerHTML = `🔷 Download ${shape.type || 'Shape'} ${i + 1}`;
            link.style.cssText = 'display: block; padding: 8px 12px; margin: 4px 0; background: var(--bg-elevated); border-radius: 6px; color: var(--text-primary); text-decoration: none; font-size: 12px;';
            downloadContainer.appendChild(link);
            count++;
        });
    }

    // Create SVGs for decorations
    if (improvements.addDecorations) {
        improvements.addDecorations.forEach((deco, i) => {
            const shapeConfig = {
                type: 'rectangle',
                width: deco.width || 50,
                height: deco.height || 200,
                fill: deco.fill || '#6366f1',
                cornerRadius: deco.cornerRadius || 4
            };
            const blob = createShapeSvgBlob(shapeConfig);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `decoration_${i + 1}.svg`;
            link.className = 'download-link-btn';
            link.innerHTML = `✨ Download Decoration ${i + 1}`;
            link.style.cssText = 'display: block; padding: 8px 12px; margin: 4px 0; background: var(--bg-elevated); border-radius: 6px; color: var(--text-primary); text-decoration: none; font-size: 12px;';
            downloadContainer.appendChild(link);
            count++;
        });
    }

    // Create SVGs for text
    if (improvements.addText) {
        improvements.addText.forEach((text, i) => {
            const blob = createTextSvgBlob(text);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `text_${i + 1}.svg`;
            link.className = 'download-link-btn';
            link.innerHTML = `📝 Download Text "${text.content}"`;
            link.style.cssText = 'display: block; padding: 8px 12px; margin: 4px 0; background: var(--bg-elevated); border-radius: 6px; color: var(--text-primary); text-decoration: none; font-size: 12px;';
            downloadContainer.appendChild(link);
            count++;
        });
    }

    // Add the download container after the Apply button
    const statusGrid = elements.advisorContent.querySelector('.status-grid');
    if (statusGrid) {
        const applyBtn = document.getElementById('applyChangesBtn');
        if (applyBtn) {
            applyBtn.insertAdjacentElement('afterend', downloadContainer);
        } else {
            statusGrid.prepend(downloadContainer);
        }
    }

    return count;
}

// Helper to show success message
function showSuccessMessage(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'status-card advice-item';
    successDiv.style.borderLeft = '3px solid #10b981';
    successDiv.innerHTML = `
        <div class="status-icon-wrapper" style="background: linear-gradient(135deg, #10b981, #059669);">
            <span class="status-icon">✅</span>
        </div>
        <div class="status-info">
            <span class="status-label">Success!</span>
            <span class="status-value text-wrap">${message}</span>
        </div>
    `;
    const statusGrid = elements.advisorContent.querySelector('.status-grid');
    if (statusGrid) statusGrid.prepend(successDiv);
}

// Helper to show error message
function showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'status-card advice-item';
    errorDiv.style.borderLeft = '3px solid #ef4444';
    errorDiv.innerHTML = `
        <div class="status-icon-wrapper" style="background: #ef4444;">
            <span class="status-icon">❌</span>
        </div>
        <div class="status-info">
            <span class="status-label">Error</span>
            <span class="status-value text-wrap">${message}</span>
        </div>
    `;
    const statusGrid = elements.advisorContent.querySelector('.status-grid');
    if (statusGrid) statusGrid.prepend(errorDiv);
}



// Create SVG blob for a shape
function createShapeSvgBlob(shape) {
    const width = shape.width || 100;
    const height = shape.height || 100;
    const fill = shape.fill || '#6366f1';
    const opacity = shape.opacity || 1;
    const cornerRadius = shape.cornerRadius || 0;

    let svgContent = '';

    if (shape.type === 'ellipse' || shape.type === 'circle') {
        const cx = width / 2;
        const cy = height / 2;
        const rx = width / 2;
        const ry = height / 2;
        svgContent = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${opacity}"/>`;
    } else {
        // Rectangle (default)
        svgContent = `<rect width="${width}" height="${height}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${fill}" opacity="${opacity}"/>`;
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${svgContent}
</svg>`;

    return new Blob([svg], { type: 'image/svg+xml' });
}

// Create SVG blob for text
function createTextSvgBlob(textConfig) {
    const content = textConfig.content || 'Text';
    const color = textConfig.color || '#ffffff';
    const fontSize = textConfig.fontSize || 24;

    // Estimate text dimensions
    const charWidth = fontSize * 0.6;
    const width = Math.max(100, content.length * charWidth + 40);
    const height = fontSize + 20;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <text x="10" y="${fontSize}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="${color}">
        ${content}
    </text>
</svg>`;

    return new Blob([svg], { type: 'image/svg+xml' });
}



// Render the improvement suggestions with Apply button
function renderImprovementSuggestions(data) {
    let html = `<div class="status-grid single-col">`;

    // APPLY CHANGES BUTTON (at the top!)
    html += `
        <button id="applyChangesBtn" class="btn-apply-changes">
            <span class="btn-icon">🚀</span>
            <span>Apply All Changes to Canvas</span>
        </button>
    `;

    // AI Reasoning
    if (data.reasoning) {
        html += `
            <div class="status-card advice-item">
                <div class="status-icon-wrapper" style="background: linear-gradient(135deg, #10b981, #059669);">
                    <span class="status-icon">💡</span>
                </div>
                <div class="status-info">
                    <span class="status-label">AI Recommendation</span>
                    <span class="status-value text-wrap">"${data.reasoning}"</span>
                </div>
            </div>
        `;
    }

    // Show suggested shapes
    if (data.improvements && data.improvements.addShape) {
        for (const shape of data.improvements.addShape) {
            html += `
                <div class="status-card advice-item">
                    <div class="status-icon-wrapper" style="background: ${shape.fill || '#6366f1'};">
                        <span class="status-icon">🔷</span>
                    </div>
                    <div class="status-info">
                        <span class="status-label">Add ${shape.type || 'Shape'}</span>
                        <span class="status-value text-wrap">
                            Size: ${shape.width || 100}×${shape.height || 100}px | 
                            Position: (${shape.x || 0}, ${shape.y || 0}) | 
                            Color: ${shape.fill || 'default'}
                        </span>
                    </div>
                </div>
            `;
        }
    }

    // Show suggested text
    if (data.improvements && data.improvements.addText) {
        for (const text of data.improvements.addText) {
            html += `
                <div class="status-card advice-item">
                    <div class="status-icon-wrapper">
                        <span class="status-icon">📝</span>
                    </div>
                    <div class="status-info">
                        <span class="status-label">Add Text</span>
                        <span class="status-value text-wrap">
                            "${text.content || 'Text'}" at (${text.x || 0}, ${text.y || 0})
                        </span>
                    </div>
                </div>
            `;
        }
    }

    // Show suggested decorations
    if (data.improvements && data.improvements.addDecorations) {
        for (const deco of data.improvements.addDecorations) {
            html += `
                <div class="status-card advice-item">
                    <div class="status-icon-wrapper" style="background: ${deco.fill || '#6366f1'};">
                        <span class="status-icon">✨</span>
                    </div>
                    <div class="status-info">
                        <span class="status-label">Add ${deco.type || 'Decoration'}</span>
                        <span class="status-value text-wrap">
                            Size: ${deco.width || 50}×${deco.height || 200}px | Color: ${deco.fill || 'accent'}
                        </span>
                    </div>
                </div>
            `;
        }
    }

    html += `</div>`;
    return html;
}




// ============================================
// Eye Aspect Ratio for Wink Detection
// ============================================

function getEyeAspectRatio(landmarks, eye) {
    const indices = EYE_LANDMARKS[eye];

    const top = landmarks[indices.top];
    const bottom = landmarks[indices.bottom];
    const inner = landmarks[indices.inner];
    const outer = landmarks[indices.outer];

    // Vertical distance (eye opening)
    const vertical = Math.sqrt(
        Math.pow(top.x - bottom.x, 2) +
        Math.pow(top.y - bottom.y, 2)
    );

    // Horizontal distance (eye width)
    const horizontal = Math.sqrt(
        Math.pow(inner.x - outer.x, 2) +
        Math.pow(inner.y - outer.y, 2)
    );

    // Aspect ratio
    return vertical / (horizontal + 0.001);
}

function detectWinks(landmarks) {
    const leftEAR = getEyeAspectRatio(landmarks, 'left');
    const rightEAR = getEyeAspectRatio(landmarks, 'right');

    const winkThreshold = 0.15;  // Eye is closed if EAR < this
    const openThreshold = 0.2;   // Eye is open if EAR > this
    const wideOpenThreshold = 0.35; // Eyes are VERY WIDE open if EAR > this (increased!)

    const now = Date.now();

    // Left eye wink detection (left eye closed, right eye open)
    const leftClosed = leftEAR < winkThreshold;
    const rightClosed = rightEAR < winkThreshold;
    const leftOpen = leftEAR > openThreshold;
    const rightOpen = rightEAR > openThreshold;

    // WIDE EYES detection - both eyes opened very wide
    const leftWideOpen = leftEAR > wideOpenThreshold;
    const rightWideOpen = rightEAR > wideOpenThreshold;
    const bothWideOpen = leftWideOpen && rightWideOpen;

    // Left wink: left eye closes while right stays open
    if (leftClosed && rightOpen && state.leftEyeOpen) {
        if (now - state.lastLeftClick > state.winkCooldown) {
            sendClick('left');
            state.lastLeftClick = now;
            state.clickCount++;
            if (elements.clickCount) elements.clickCount.textContent = state.clickCount;
            showFeedback('👁️ Left Click!');
        }
    }

    // Right wink: right eye closes while left stays open  
    if (rightClosed && leftOpen && state.rightEyeOpen) {
        if (now - state.lastRightClick > state.winkCooldown) {
            sendClick('right');
            state.lastRightClick = now;
            state.clickCount++;
            if (elements.clickCount) elements.clickCount.textContent = state.clickCount;
            showFeedback('👁️ Right Click!');
        }
    }

    // WIDE EYES = trigger removed (replaced by Voice Command)
    // if (bothWideOpen && !state.isAnalyzing) { ... }

    // Update eye state
    state.leftEyeOpen = leftOpen;
    state.rightEyeOpen = rightOpen;

    return { leftEAR, rightEAR, leftClosed, rightClosed, bothWideOpen };
}

// ============================================
// Face Results
// ============================================

function onFaceResults(results) {
    const ctx = elements.canvas.getContext('2d');
    ctx.clearRect(0, 0, 640, 480);

    // Skip ALL processing while speaking - trackingPaused is the authoritative flag
    if (state.speaking || state.trackingPaused) {
        // Still clear canvas but don't process face data
        updateStatus('face', '⏸️ Paused (speaking)', 'warning');
        return;
    }

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        updateStatus('face', 'No face', 'warning');
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const nose = landmarks[4];

    // Get mouth openness using correct landmarks
    // Upper inner lip: 13, Lower inner lip: 14
    // Upper outer lip: 0 (top), Lower outer lip: 17 (bottom)
    // Better landmarks for mouth open detection:
    // Top of upper lip inner: 13, Bottom of lower lip inner: 14
    // OR use: Upper lip top: 0, Lower lip bottom: 17
    const upperLipTop = landmarks[13];    // Upper lip inner
    const lowerLipBottom = landmarks[14]; // Lower lip inner
    const mouthLeft = landmarks[61];      // Left corner of mouth
    const mouthRight = landmarks[291];    // Right corner of mouth

    // Calculate mouth height (vertical opening)
    const mouthHeight = Math.abs(lowerLipBottom.y - upperLipTop.y);

    // Calculate mouth width for ratio
    const mouthWidth = Math.abs(mouthRight.x - mouthLeft.x);

    // Mouth open ratio (height / width) - more reliable than just height
    const mouthOpenRatio = mouthHeight / (mouthWidth + 0.001);

    // Convert to a 0-100 scale for easier threshold checking
    // Normal closed mouth ratio is about 0.1-0.2, open mouth is 0.4+
    const mouthOpen = mouthOpenRatio * 150;

    // Store current nose for calibration
    state.currentNose = { x: nose.x, y: nose.y };

    // Draw mesh
    if (state.showMesh) {
        drawFace(ctx, landmarks, nose);
    }

    updateStatus('face', '✓ Detected', 'active');

    // Detect winks for clicking
    const eyeState = detectWinks(landmarks);

    // Update status to show gestures (show mouth value for debugging)
    if (mouthOpen > 15) {
        updateStatus('mouth', `👄 OPEN (${Math.round(mouthOpen)})`);
    } else if (eyeState.leftClosed && !eyeState.rightClosed) {
        updateStatus('mouth', '😉 Left wink');
    } else if (eyeState.rightClosed && !eyeState.leftClosed) {
        updateStatus('mouth', '😉 Right wink');
    } else {
        updateStatus('mouth', `Ready (${Math.round(mouthOpen)})`);
    }

    // Move cursor if calibrated
    if (state.isCalibrated && state.calibrationNose) {
        moveCursor(nose, mouthOpen);
    }
}

function moveCursor(nose, mouthOpen) {
    const now = Date.now();

    // Calculate offset from calibration center (in normalized 0-1 coordinates)
    const dx = nose.x - state.calibrationNose.x;
    const dy = nose.y - state.calibrationNose.y;

    // Apply dead zone to reduce jitter when face is still
    const distance = Math.sqrt(dx * dx + dy * dy);
    let adjustedDx = dx;
    let adjustedDy = dy;

    if (distance < SMOOTH_CONFIG.deadZone) {
        adjustedDx = 0;
        adjustedDy = 0;
    } else {
        // Gradual dead zone - smooth transition from dead zone
        const deadZoneMultiplier = Math.max(0, (distance - SMOOTH_CONFIG.deadZone)) / distance;
        adjustedDx = dx * deadZoneMultiplier;
        adjustedDy = dy * deadZoneMultiplier;
    }

    // ===== PROPER ASPECT RATIO HANDLING =====
    // Camera is 640x480 (4:3), Screen could be any ratio
    // We want physical nose movement to map proportionally to screen

    const cameraWidth = 640;
    const cameraHeight = 480;
    const cameraAspect = cameraWidth / cameraHeight;  // 1.333
    const screenAspect = CONFIG.screenWidth / CONFIG.screenHeight;  // e.g., 1.777 for 16:9

    // Use the smaller dimension as the base to ensure full screen coverage
    // This makes the movement feel natural and consistent
    const baseScale = Math.min(CONFIG.screenWidth, CONFIG.screenHeight);

    // Sensitivity multiplier (how much screen movement per unit nose movement)
    const sensitivityMultiplier = state.sensitivity * 2.5;

    // Invert X (camera is mirrored) and apply sensitivity
    // Scale both axes uniformly for natural 1:1 movement feel
    const moveX = -adjustedDx * baseScale * sensitivityMultiplier;
    const moveY = adjustedDy * baseScale * sensitivityMultiplier;

    // Compensate for aspect ratio difference between camera and screen
    // This ensures moving nose left-right vs up-down feels consistent
    const aspectCompensation = screenAspect / cameraAspect;
    const finalMoveX = moveX * aspectCompensation;
    const finalMoveY = moveY;

    // Target screen position (centered)
    const centerX = CONFIG.screenWidth / 2;
    const centerY = CONFIG.screenHeight / 2;

    let rawTargetX = centerX + finalMoveX;
    let rawTargetY = centerY + finalMoveY;

    // Clamp to screen bounds
    rawTargetX = Math.max(0, Math.min(CONFIG.screenWidth - 1, rawTargetX));
    rawTargetY = Math.max(0, Math.min(CONFIG.screenHeight - 1, rawTargetY));

    // ====== LAYER 1: Median buffer for noise reduction ======
    addToBuffer(rawBufferX, rawTargetX, RAW_BUFFER_SIZE);
    addToBuffer(rawBufferY, rawTargetY, RAW_BUFFER_SIZE);

    const medianX = getMedian(rawBufferX);
    const medianY = getMedian(rawBufferY);

    // ====== LAYER 2: Kalman filter for prediction ======
    const kalmanedX = kalmanFilter(medianX, kalmanX);
    const kalmanedY = kalmanFilter(medianY, kalmanY);

    // ====== LAYER 3: Calculate velocity for adaptive smoothing ======
    if (lastTargetX !== null && lastTargetTime > 0) {
        const dt = (now - lastTargetTime) / 1000; // seconds
        if (dt > 0) {
            velocityX = lerp(velocityX, (kalmanedX - lastTargetX) / dt, 0.3);
            velocityY = lerp(velocityY, (kalmanedY - lastTargetY) / dt, 0.3);
        }
    }
    lastTargetX = kalmanedX;
    lastTargetY = kalmanedY;
    lastTargetTime = now;

    // Get adaptive smooth factor based on velocity
    const adaptiveFactor = calculateAdaptiveSmoothFactor(velocityX, velocityY);

    // Initialize smooth position
    if (smoothX === null) {
        smoothX = kalmanedX;
        smoothY = kalmanedY;
        outputX = kalmanedX;
        outputY = kalmanedY;
    }

    // Apply adaptive exponential smoothing
    smoothX += (kalmanedX - smoothX) * adaptiveFactor;
    smoothY += (kalmanedY - smoothY) * adaptiveFactor;

    // ====== LAYER 4: Bezier interpolation for ultra-smooth output ======
    // Use bezier curve to smooth the transition
    if (outputX === null) {
        outputX = smoothX;
        outputY = smoothY;
    }

    // Calculate control point for bezier (midpoint with slight offset based on velocity)
    const controlX = (outputX + smoothX) / 2 + velocityX * SMOOTH_CONFIG.bezierFactor;
    const controlY = (outputY + smoothY) / 2 + velocityY * SMOOTH_CONFIG.bezierFactor;

    // Interpolate along bezier curve
    outputX = bezierInterpolate(outputX, controlX, smoothX, SMOOTH_CONFIG.outputLerp);
    outputY = bezierInterpolate(outputY, controlY, smoothY, SMOOTH_CONFIG.outputLerp);

    // ====== Jitter filter - only move if above threshold ======
    const movementDistance = Math.sqrt(
        Math.pow(outputX - lastSentX, 2) +
        Math.pow(outputY - lastSentY, 2)
    );

    const finalX = Math.round(outputX);
    const finalY = Math.round(outputY);

    // Send mouse update (throttled + jitter filtered)
    if (now - lastMouseUpdate >= UPDATE_INTERVAL) {
        // Only send if movement is above jitter threshold OR enough time has passed
        if (movementDistance >= SMOOTH_CONFIG.jitterThreshold || now - lastMouseUpdate > 100) {
            sendMouse(finalX, finalY);
            lastSentX = finalX;
            lastSentY = finalY;
        }
        lastMouseUpdate = now;
    }

    // Update display
    updateStatus('cursor', `${finalX}, ${finalY}`, 'active');
    if (elements.positionDisplay) {
        elements.positionDisplay.textContent = `${finalX}, ${finalY}`;
    }

    // Store final position in state for continuous interpolation
    state.finalX = finalX;
    state.finalY = finalY;

    // MOUTH OPEN = DRAG MODE (threshold 15)
    // Keep mouth open to hold left click (drag)
    if (mouthOpen > 15) {
        if (!state.isDragging) {
            console.log('👄 Mouth open -> Drag Start', mouthOpen);
            sendDragStart();
            state.isDragging = true;
            showFeedback('✊ Dragging...');
        }
    } else {
        if (state.isDragging) {
            console.log('👄 Mouth closed -> Drag End');
            sendDragEnd();
            state.isDragging = false;
            state.clickCount++;
            if (elements.clickCount) elements.clickCount.textContent = state.clickCount;
            showFeedback('✋ Drop!');
        }
    }
}

function drawFace(ctx, landmarks, nose) {
    // Draw nose (main tracking point)
    const nX = nose.x * 640;
    const nY = nose.y * 480;

    ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.beginPath();
    ctx.arc(nX, nY, 10, 0, Math.PI * 2);
    ctx.fill();

    // Crosshair on nose
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nX - 20, nY);
    ctx.lineTo(nX + 20, nY);
    ctx.moveTo(nX, nY - 20);
    ctx.lineTo(nX, nY + 20);
    ctx.stroke();

    // Draw eyes
    drawEye(ctx, landmarks, 'left', 'rgba(139, 92, 246, 0.8)');
    drawEye(ctx, landmarks, 'right', 'rgba(139, 92, 246, 0.8)');
}

function drawEye(ctx, landmarks, eye, color) {
    const indices = EYE_LANDMARKS[eye];
    const points = [indices.top, indices.bottom, indices.inner, indices.outer];

    ctx.fillStyle = color;
    points.forEach(i => {
        const p = landmarks[i];
        ctx.beginPath();
        ctx.arc(p.x * 640, p.y * 480, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

// ============================================
// Calibration
// ============================================

function calibrate() {
    elements.calibrateBtn.disabled = true;
    showFeedback('👀 Look straight ahead...');

    let count = 3;
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            showFeedback(`${count}...`);
        } else {
            clearInterval(interval);

            // Save calibration position
            state.calibrationNose = { x: state.currentNose.x, y: state.currentNose.y };
            state.isCalibrated = true;

            // Reset ALL smoothing state to screen center
            const centerX = CONFIG.screenWidth / 2;
            const centerY = CONFIG.screenHeight / 2;

            smoothX = centerX;
            smoothY = centerY;
            outputX = centerX;
            outputY = centerY;
            lastSentX = centerX;
            lastSentY = centerY;

            // Clear buffers
            rawBufferX = [];
            rawBufferY = [];

            // Reset velocity
            velocityX = 0;
            velocityY = 0;
            lastTargetX = centerX;
            lastTargetY = centerY;
            lastTargetTime = Date.now();

            // Reset Kalman filters with center position
            kalmanX = { estimate: centerX, errorEstimate: 1, errorMeasure: 0.1, q: 0.01 };
            kalmanY = { estimate: centerY, errorEstimate: 1, errorMeasure: 0.1, q: 0.01 };

            // Move cursor to center
            sendMouse(centerX, centerY);

            showFeedback('✅ Calibrated!');
            elements.calibrateBtn.disabled = false;
            elements.calibrateBtn.innerHTML = '🎯 Re-calibrate';
        }
    }, 1000);
}

// ============================================
// Speech Recognition (Speech-to-Text Dictation)
// ============================================

const SPEECH_DEBOUNCE_MS = 1500; // Debounce window for speech pause detection
const SPEECH_INACTIVITY_CHECK_MS = 50; // How often to check for speech inactivity

/**
 * Initialize Web Speech API for continuous recognition
 */
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.error('❌ Web Speech API not supported in this browser');
        showFeedback('❌ Speech not supported');
        return false;
    }

    state.speechRecognition = new SpeechRecognition();
    state.speechRecognition.continuous = true;
    state.speechRecognition.interimResults = true;
    state.speechRecognition.lang = 'en-US';

    // Event handlers
    state.speechRecognition.onresult = onSpeechResult;
    state.speechRecognition.onend = onSpeechEnd;
    state.speechRecognition.onerror = onSpeechError;
    state.speechRecognition.onstart = () => {
        console.log('🎤 Speech recognition started');
    };

    console.log('🎤 Speech recognition initialized');
    return true;
}

/**
 * Handle speech recognition results - write to Adobe Express canvas AND local preview
 */
function onSpeechResult(event) {
    if (!state.speaking) return;

    // Mark speech activity - this extends the debounce window
    state.lastSpeechActivityTime = Date.now();
    console.log('🎤 Speech activity detected, resetting inactivity timer');

    // Reset debounce timer on any speech activity
    resetSpeechDebounce();

    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
            finalTranscript += transcript;
        } else {
            interimTranscript += transcript;
        }
    }

    // Write final transcript to destinations
    if (finalTranscript) {
        // PRIMARY: Write to Adobe Express canvas (selected text element or create new)
        writeToCanvasText(finalTranscript);

        // SECONDARY: Update local transcription area as preview/log
        if (state.targetTextArea) {
            insertTextAtCursor(state.targetTextArea, finalTranscript);
        }
    }

    // Update speech status with interim results
    if (elements.speechStatusText) {
        elements.speechStatusText.textContent = interimTranscript || 'Listening...';
    }
}

/**
 * Write transcribed text to Adobe Express canvas via document sandbox
 * - If text node is selected: append to that node's text
 * - If no text node selected: create new text element
 */
async function writeToCanvasText(spokenText) {
    if (!sandboxProxy) {
        console.log('📝 Sandbox proxy not available, skipping canvas write');
        return;
    }

    try {
        // Call the document sandbox to write text to canvas
        const result = await sandboxProxy.writeToCanvas(spokenText);

        if (result.success) {
            if (result.action === 'appended') {
                console.log('📝 Text appended to selected node:', spokenText);
                showFeedback('📝 Text added');
            } else if (result.action === 'created') {
                console.log('📝 New text element created:', spokenText);
                showFeedback('📝 Created text');
            }
        } else {
            console.error('📝 Canvas write failed:', result.error);
        }

    } catch (error) {
        console.error('📝 Canvas write error:', error);
        // Silently fail - text still goes to preview area
    }
}

/**
 * Insert text at cursor position in a text area, preserving existing content
 */
function insertTextAtCursor(textArea, text) {
    if (!textArea) return;

    // For textarea/input elements
    if (textArea.tagName === 'TEXTAREA' || textArea.tagName === 'INPUT') {
        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const before = textArea.value.substring(0, start);
        const after = textArea.value.substring(end);

        // Add space if needed (after previous text)
        const needsSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
        const insertText = needsSpace ? ' ' + text : text;

        textArea.value = before + insertText + after;

        // Move cursor to end of inserted text
        const newPosition = start + insertText.length;
        textArea.selectionStart = newPosition;
        textArea.selectionEnd = newPosition;
    }
    // For contenteditable elements
    else if (textArea.contentEditable === 'true') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();

            const needsSpace = textArea.textContent.length > 0 &&
                !textArea.textContent.endsWith(' ') &&
                !textArea.textContent.endsWith('\n');
            const insertText = needsSpace ? ' ' + text : text;

            range.insertNode(document.createTextNode(insertText));
            range.collapse(false);
        }
    }

    // Also send to backend for typing (if applicable)
    sendType(text);
}

/**
 * Send type command to backend for system-level text input
 */
function sendType(text) {
    if (!state.backendConnected || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(JSON.stringify({ action: 'type', text }));
}

/**
 * Handle speech recognition end - implement 250ms debounce
 * This fires when the Web Speech API's recognition session ends
 * We restart it immediately and rely on inactivity checking for final stop
 */
function onSpeechEnd() {
    console.log('🎤 Speech recognition session ended');

    // Don't process if not in speaking mode
    if (!state.speaking) return;

    // Try to restart recognition immediately to continue listening
    // The inactivity checker will handle final stop after 250ms silence
    try {
        state.speechRecognition.start();
        console.log('🎤 Speech recognition restarted for continuous listening');
    } catch (e) {
        // May already be running, that's fine
        console.log('🎤 Could not restart (may already be running):', e.message);
    }
}

/**
 * Reset the speech debounce timer
 */
function resetSpeechDebounce() {
    if (state.speechDebounceTimer) {
        clearTimeout(state.speechDebounceTimer);
        state.speechDebounceTimer = null;
    }
}

/**
 * Start the speech inactivity checker interval
 * This continuously checks if 250ms have passed since last speech activity
 */
function startSpeechInactivityChecker() {
    // Clear any existing interval
    stopSpeechInactivityChecker();

    // Initialize last activity time
    state.lastSpeechActivityTime = Date.now();

    // Start checking for inactivity every 50ms
    state.speechInactivityCheckInterval = setInterval(() => {
        if (!state.speaking) {
            stopSpeechInactivityChecker();
            return;
        }

        const timeSinceLastActivity = Date.now() - state.lastSpeechActivityTime;

        if (timeSinceLastActivity >= SPEECH_DEBOUNCE_MS) {
            console.log(`🎤 ${SPEECH_DEBOUNCE_MS}ms of inactivity detected - stopping speech recognition`);
            finalizeSpeechStop();
        }
    }, SPEECH_INACTIVITY_CHECK_MS);

    console.log('🎤 Speech inactivity checker started');
}

/**
 * Stop the speech inactivity checker interval
 */
function stopSpeechInactivityChecker() {
    if (state.speechInactivityCheckInterval) {
        clearInterval(state.speechInactivityCheckInterval);
        state.speechInactivityCheckInterval = null;
        console.log('🎤 Speech inactivity checker stopped');
    }
}

/**
 * Handle speech recognition errors
 */
function onSpeechError(event) {
    console.error('🎤 Speech recognition error:', event.error);

    if (event.error === 'not-allowed') {
        showFeedback('❌ Microphone access denied');
        finalizeSpeechStop();
    } else if (event.error === 'no-speech') {
        // No speech detected, continue listening if still in speaking mode
        if (state.speaking) {
            try {
                state.speechRecognition.start();
            } catch (e) {
                // Ignore
            }
        }
    } else if (event.error === 'aborted') {
        // Manually stopped, don't restart
        console.log('🎤 Speech recognition aborted');
    }
}

/**
 * Start speaking mode - pause tracking and begin transcription
 */
function startSpeaking() {
    // Initialize speech recognition if not done
    if (!state.speechRecognition) {
        if (!initSpeechRecognition()) {
            return;
        }
    }

    // Lock target text area at speech start
    state.targetTextArea = state.lastFocusedTextArea ||
        document.getElementById('targetTranscriptArea');

    if (!state.targetTextArea) {
        showFeedback('❌ No text area available');
        return;
    }

    // Clear the text area for a fresh start when speaking begins
    if (state.targetTextArea.tagName === 'TEXTAREA' || state.targetTextArea.tagName === 'INPUT') {
        state.targetTextArea.value = '';
    } else if (state.targetTextArea.contentEditable === 'true') {
        state.targetTextArea.innerHTML = '';
    }

    // Save current tracking state before pausing (Lines 2021-2024 in original)
    state.preSpeechTrackingState = {
        isRunning: state.isRunning,
        isCalibrated: state.isCalibrated
    };

    console.log('🎤 Saving tracking state:', state.preSpeechTrackingState);

    // Pause ALL tracking - this is the authoritative speaking state
    state.speaking = true;

    state.trackingPaused = true;

    // Update UI
    updateSpeakButtonUI(true);
    if (elements.speechStatusText) {
        elements.speechStatusText.textContent = 'Listening...';
    }

    // Start the inactivity checker for debouncing
    startSpeechInactivityChecker();

    // Start speech recognition
    try {
        state.speechRecognition.start();
        showFeedback('🎤 Listening...');
    } catch (e) {
        console.error('Failed to start speech recognition:', e);
        showFeedback('❌ Could not start');
        finalizeSpeechStop();
    }
}

/**
 * Stop speaking mode manually
 */
function stopSpeaking() {
    console.log('🎤 Manual stop requested');

    resetSpeechDebounce();

    if (state.speechRecognition) {
        try {
            state.speechRecognition.stop();
        } catch (e) {
            // Ignore
        }
    }

    finalizeSpeechStop();
}

/**
 * Finalize speech stop - restore tracking to pre-speech state
 */
function finalizeSpeechStop() {
    console.log('🎤 Finalizing speech stop');

    // Stop the inactivity checker
    stopSpeechInactivityChecker();

    // Stop speech recognition
    if (state.speechRecognition) {
        try {
            state.speechRecognition.stop();
        } catch (e) {
            // Ignore
        }
    }

    // Clear speaking state
    state.speaking = false;
    state.targetTextArea = null;
    state.lastSpeechActivityTime = 0;
    resetSpeechDebounce();

    // Update UI
    updateSpeakButtonUI(false);
    if (elements.speechStatusText) {
        elements.speechStatusText.textContent = 'Ready';
    }

    showFeedback('🎤 Stopped');

    // Resume tracking ONLY if it was active before speech
    // This ensures idempotent, deterministic resume behavior
    if (state.preSpeechTrackingState.isRunning) {
        console.log('🎤 Resuming tracking (was active before speech)');
        state.trackingPaused = false;
        // Tracking will naturally resume on next frame
    } else {
        console.log('🎤 Not resuming tracking (was not active before speech)');
        state.trackingPaused = false;
    }
}

/**
 * Toggle speaking state
 */
function toggleSpeaking() {
    if (state.speaking) {
        stopSpeaking();
    } else {
        startSpeaking();
    }
}

/**
 * Update the speak button UI based on speaking state
 */
function updateSpeakButtonUI(isSpeaking) {
    const speakBtn = elements.speakBtn;
    if (!speakBtn) return;

    if (isSpeaking) {
        speakBtn.classList.add('speaking');
        speakBtn.querySelector('span').textContent = 'Stop';
    } else {
        speakBtn.classList.remove('speaking');
        speakBtn.querySelector('span').textContent = 'Speak';
    }
}

/**
 * Track focused text areas for speech targeting
 */
function setupTextAreaTracking() {
    // Track focus on text areas and contenteditable elements
    document.addEventListener('focusin', (event) => {
        const target = event.target;
        if (target.tagName === 'TEXTAREA' ||
            target.tagName === 'INPUT' && target.type === 'text' ||
            target.contentEditable === 'true') {
            state.lastFocusedTextArea = target;
            console.log('📝 Text area focused:', target.id || target.tagName);
        }
    });
}

// ============================================
// Image Search & Insert to Canvas
// ============================================

let imageSearchState = {
    isSearching: false,
    currentImages: []
};

/**
 * Trigger image search via WebSocket
 */
function triggerImageSearch() {
    const query = elements.imageSearchInput?.value?.trim();

    if (!query) {
        showFeedback('❌ Enter a search term');
        elements.imageSearchInput?.focus();
        return;
    }

    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        showFeedback('❌ Not connected');
        return;
    }

    if (imageSearchState.isSearching) return;

    imageSearchState.isSearching = true;

    // Update button state
    if (elements.searchImagesBtn) {
        elements.searchImagesBtn.classList.add('searching');
        elements.searchImagesBtn.disabled = true;
    }

    // Show loading in gallery
    if (elements.imageGallery) {
        elements.imageGallery.innerHTML = `
            <div class="gallery-loading">
                <span class="loader"></span>
                <p>Searching "${query}"...</p>
            </div>
        `;
    }

    console.log(`🖼️ Searching images: "${query}"`);
    showFeedback(`🔍 Searching...`);

    // Send search request
    websocket.send(JSON.stringify({
        action: 'image_search',
        query: query,
        count: 12
    }));
}

/**
 * Handle image search results
 */
function handleImageSearchResults(data) {
    imageSearchState.isSearching = false;
    imageSearchState.currentImages = data.images || [];

    // Reset button
    if (elements.searchImagesBtn) {
        elements.searchImagesBtn.classList.remove('searching');
        elements.searchImagesBtn.disabled = false;
    }

    // Render gallery
    renderImageGallery(data.query, imageSearchState.currentImages, data.total);

    showFeedback(`🖼️ Found ${imageSearchState.currentImages.length} images!`);
}

/**
 * Handle image search error
 */
function handleImageSearchError(message) {
    imageSearchState.isSearching = false;

    // Reset button
    if (elements.searchImagesBtn) {
        elements.searchImagesBtn.classList.remove('searching');
        elements.searchImagesBtn.disabled = false;
    }

    if (elements.imageGallery) {
        elements.imageGallery.innerHTML = `
            <div class="gallery-placeholder">
                <div class="gallery-placeholder-icon">❌</div>
                <p>${message}</p>
                <p class="gallery-hint">Check your API key</p>
            </div>
        `;
    }

    showFeedback(`❌ ${message}`);
}

/**
 * Render the image gallery
 */
function renderImageGallery(query, images, total) {
    if (!elements.imageGallery) return;

    if (!images || images.length === 0) {
        elements.imageGallery.innerHTML = `
            <div class="gallery-placeholder">
                <div class="gallery-placeholder-icon">🔍</div>
                <p>No images found for "${query}"</p>
                <p class="gallery-hint">Try different keywords</p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="gallery-info">
            <span class="gallery-info-text"><strong>${images.length}</strong> of ${total} results</span>
            <span class="unsplash-credit">Photos by <a href="https://unsplash.com" target="_blank">Unsplash</a></span>
        </div>
        <div class="image-grid">
    `;

    images.forEach((img, index) => {
        html += `
            <div class="image-card" 
                 data-index="${index}"
                 onclick="selectImageForCanvas(${index})"
                 style="background-color: ${img.color || '#333'};">
                <img src="${img.thumbnail}" 
                     alt="${img.description}" 
                     loading="lazy">
                <div class="image-overlay">
                    <span class="image-credit">📷 ${img.photographer.name}</span>
                </div>
                <div class="image-add-icon">+</div>
            </div>
        `;
    });

    html += `</div>`;
    elements.imageGallery.innerHTML = html;
}

/**
 * Select an image and add to canvas
 */
async function selectImageForCanvas(index) {
    const img = imageSearchState.currentImages[index];
    if (!img) {
        showFeedback('❌ Image not found');
        return;
    }

    // Show loading on card
    const card = elements.imageGallery?.querySelector(`[data-index="${index}"]`);
    if (card) {
        card.classList.add('adding');
    }

    showFeedback('🖼️ Adding to canvas...');

    try {
        await addImageToCanvas(img);

        if (card) {
            card.classList.remove('adding');
            card.classList.add('added');
        }

        showFeedback('✅ Image added!');

    } catch (error) {
        console.error('❌ Failed to add image:', error);

        if (card) {
            card.classList.remove('adding');
        }

        // Fallback: open in new tab
        showFeedback('📥 Opening image...');
        window.open(img.regular, '_blank');
    }
}

/**
 * Add image to canvas using Document API
 */
async function addImageToCanvas(img) {
    // Method 1: Try Document API addImage
    if (documentApi && typeof documentApi.addImage === 'function') {
        console.log('🎨 Using Document API...');
        const response = await fetch(img.regular);
        if (!response.ok) throw new Error('Failed to fetch image');
        const blob = await response.blob();
        await documentApi.addImage(blob);
        return;
    }

    // Method 2: Try addOnUISdk
    if (typeof addOnUISdk !== 'undefined' && addOnUISdk.app) {
        await addOnUISdk.ready;
        if (addOnUISdk.app.document?.addImage) {
            const response = await fetch(img.regular);
            const blob = await response.blob();
            await addOnUISdk.app.document.addImage(blob);
            return;
        }
    }

    throw new Error('No canvas API available');
}

// Make selectImageForCanvas available globally for onclick
window.selectImageForCanvas = selectImageForCanvas;

// ============================================
// AI-Powered Image Suggestions
// ============================================

let isSuggestingImages = false;

/**
 * Trigger AI image suggestions
 */
function triggerAISuggestions() {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        showFeedback('❌ Not connected');
        return;
    }

    if (isSuggestingImages) return;

    isSuggestingImages = true;

    // Update button state
    if (elements.suggestImagesBtn) {
        elements.suggestImagesBtn.classList.add('analyzing');
        elements.suggestImagesBtn.disabled = true;
    }

    // Show insight area with loading
    if (elements.aiInsight) {
        elements.aiInsight.style.display = 'flex';
        elements.aiInsightText.textContent = 'Analyzing your canvas...';
    }

    // Show loading in gallery
    if (elements.imageGallery) {
        elements.imageGallery.innerHTML = `
            <div class="gallery-loading">
                <span class="loader"></span>
                <p>🔮 AI is analyzing your design...</p>
            </div>
        `;
    }

    console.log('🔮 Requesting AI image suggestions...');
    showFeedback('🔮 Analyzing canvas...');

    // Send request
    websocket.send(JSON.stringify({
        action: 'suggest_images'
    }));
}

/**
 * Handle AI insight (the search query it came up with)
 */
function handleAIInsight(insight) {
    console.log('💡 AI Insight:', insight);

    if (elements.aiInsight) {
        elements.aiInsight.style.display = 'flex';
        elements.aiInsightText.textContent = `"${insight}"`;
    }

    // Also populate the search input so user can modify it
    if (elements.imageSearchInput) {
        elements.imageSearchInput.value = insight;
    }

    // Update gallery loading message
    if (elements.imageGallery) {
        elements.imageGallery.innerHTML = `
            <div class="gallery-loading">
                <span class="loader"></span>
                <p>Finding "${insight}" photos...</p>
            </div>
        `;
    }
}

/**
 * Handle AI suggestion results
 */
function handleAISuggestionResults(data) {
    isSuggestingImages = false;

    // Reset button
    if (elements.suggestImagesBtn) {
        elements.suggestImagesBtn.classList.remove('analyzing');
        elements.suggestImagesBtn.disabled = false;
    }

    // Store images
    imageSearchState.currentImages = data.images || [];

    // Render gallery (reuse existing function)
    renderImageGallery(data.query, imageSearchState.currentImages, data.total);

    showFeedback(`🔮 Found ${imageSearchState.currentImages.length} suggestions!`);
}

/**
 * Handle AI suggestion error
 */
function handleAISuggestionError(message) {
    isSuggestingImages = false;

    // Reset button
    if (elements.suggestImagesBtn) {
        elements.suggestImagesBtn.classList.remove('analyzing');
        elements.suggestImagesBtn.disabled = false;
    }

    // Hide insight
    if (elements.aiInsight) {
        elements.aiInsight.style.display = 'none';
    }

    if (elements.imageGallery) {
        elements.imageGallery.innerHTML = `
            <div class="gallery-placeholder">
                <div class="gallery-placeholder-icon">❌</div>
                <p>${message}</p>
                <p class="gallery-hint">Try manual search instead</p>
            </div>
        `;
    }

    showFeedback(`❌ ${message}`);
}

// ============================================
// Settings Modal
// ============================================

/**
 * Setup event listeners for the settings modal
 */
function setupSettingsModal() {
    const stickyBtn = document.getElementById('stickySettingsBtn');
    const modalOverlay = document.getElementById('settingsModalOverlay');
    const closeBtn = document.getElementById('settingsModalClose');

    if (!stickyBtn || !modalOverlay || !closeBtn) {
        console.log('⚙️ Settings modal elements not found');
        return;
    }

    // Open modal when sticky button is clicked
    stickyBtn.addEventListener('click', () => {
        modalOverlay.classList.add('active');
        console.log('⚙️ Settings modal opened');
    });

    // Close modal when close button is clicked
    closeBtn.addEventListener('click', () => {
        modalOverlay.classList.remove('active');
        console.log('⚙️ Settings modal closed');
    });

    // Close modal when clicking outside the modal (on overlay)
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.classList.remove('active');
            console.log('⚙️ Settings modal closed (overlay click)');
        }
    });

    // Close modal when pressing Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
            modalOverlay.classList.remove('active');
            console.log('⚙️ Settings modal closed (Escape key)');
        }
    });

    console.log('⚙️ Settings modal initialized');
}

// ============================================
// Helpers
// ============================================

function updateStatus(type, value, cls = '') {
    const el = elements[type + 'Status'];
    if (el) {
        el.textContent = value;
        el.className = 'status-value ' + cls;
    }
}

function showFeedback(msg) {
    if (!elements.feedback) return;
    elements.feedback.textContent = msg;
    elements.feedback.classList.add('show');
    setTimeout(() => elements.feedback.classList.remove('show'), 800);
}
