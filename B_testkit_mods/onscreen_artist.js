// Module metadata (required)
export const moduleInfo = {
    name: "onscreen_artist",
    version: "1.0.0",
    description: "On-screen drawing and artistic tools module"
};

// Environment detection
const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

// Module state and utilities
class OnscreenArtist {
    constructor() {
        this.isDrawing = false;
        this.canvas = null;
        this.ctx = null;
        this.currentTool = 'pen';
        this.currentColor = '#000000';
        this.lineWidth = 2;
    }

    async initialize() {
        if (isBrowser) {
            console.log('[onscreen_artist] Initializing canvas...');
            // Canvas setup will go here
        } else {
            console.log('[onscreen_artist] Running in Node.js - limited functionality');
        }
    }

    createCanvas() {
        if (!isBrowser) {
            return "Canvas only available in browser environment";
        }
        // Find a canvas element with id onscreen_artist_canvas
        let canvasEl = document.querySelector('#onscreen_artist_canvas');
        let targetDocument = document;
        
        // If not found in main document, search in iframes
        if (!canvasEl) {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    canvasEl = iframeDoc.querySelector('#onscreen_artist_canvas');
                    if (canvasEl) {
                        targetDocument = iframeDoc;
                        console.log('[onscreen_artist] Canvas element found in iframe');
                        break;
                    }
                } catch (error) {
                    // Cross-origin iframe, skip
                    console.log('[onscreen_artist] Skipping cross-origin iframe');
                }
            }
        }
        
        if (!canvasEl) {
            console.log('[onscreen_artist] No canvas element with id="onscreen_artist_canvas" found in document or iframes');
            return "No canvas element with id='onscreen_artist_canvas' found in document or iframes";
        }
        
        console.log('[onscreen_artist] Canvas element detected, initializing...');
        this.canvas = canvasEl;
        this.ctx = this.canvas.getContext('2d');
        this.targetWindow = targetDocument.defaultView || window;
        
        // Size canvas to fill its container (works for both iframe and viewport)
        this.resizeCanvas();
        
        // Add resize listener to handle container size changes
        this.targetWindow.addEventListener('resize', () => this.resizeCanvas());
        
        // Setup mouse event listeners for drawing
        this.setupDrawingEvents();
        
        console.log('[onscreen_artist] Canvas fully initialized and ready for drawing');
        return "Canvas created successfully";
    }

    resizeCanvas() {
        if (!this.canvas) return;
        
        // Try to get parent container size first, fall back to viewport
        const parent = this.canvas.parentElement;
        let width, height;
        
        // Always use viewport size for iframe context
        const targetWin = this.targetWindow || window;
        width = targetWin.innerWidth;
        height = targetWin.innerHeight;
        
        if (parent && parent !== document.body) {
            const rect = parent.getBoundingClientRect();
            console.log(`[onscreen_artist] Parent container size: ${rect.width}x${rect.height}`);
            console.log(`[onscreen_artist] Viewport size: ${width}x${height}`);
            console.log(`[onscreen_artist] Using viewport size for full coverage`);
        } else {
            console.log(`[onscreen_artist] Sizing canvas to viewport: ${width}x${height}`);
        }
        
        // Set canvas size
        this.canvas.width = width;
        this.canvas.height = height;
        
        // Also set CSS size to match and prevent overflow
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.margin = '0';
        this.canvas.style.padding = '0';
        this.canvas.style.border = '2px solid black';
        this.canvas.style.display = 'block';
        this.canvas.style.boxSizing = 'border-box';
        
        console.log(`[onscreen_artist] Canvas resized to ${width}x${height}`);
    }

    setupDrawingEvents() {
        if (!this.canvas) return;
        
        let lastX = 0;
        let lastY = 0;
        
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDrawing = true;
            [lastX, lastY] = [e.offsetX, e.offsetY];
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isDrawing) return;
            this.draw(lastX, lastY, e.offsetX, e.offsetY);
            [lastX, lastY] = [e.offsetX, e.offsetY];
        });
        
        this.canvas.addEventListener('mouseup', () => {
            this.isDrawing = false;
        });
        
        this.canvas.addEventListener('mouseout', () => {
            this.isDrawing = false;
        });
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            this.isDrawing = true;
            [lastX, lastY] = [x, y];
        });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!this.isDrawing) return;
            const rect = this.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            this.draw(lastX, lastY, x, y);
            [lastX, lastY] = [x, y];
        });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.isDrawing = false;
        });
        
        console.log('[onscreen_artist] Drawing events setup complete');
    }

    draw(x1, y1, x2, y2) {
        if (!this.ctx) return;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        if (this.currentTool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
        }
        
        this.ctx.stroke();
    }

    clearCanvas() {
        if (!this.canvas || !this.ctx) {
            return "No canvas available";
        }
        // Clear canvas logic will go here
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        return "Canvas cleared";
    }

    setTool(tool) {
        const validTools = ['pen', 'brush', 'eraser', 'line', 'rectangle', 'circle'];
        if (validTools.includes(tool)) {
            this.currentTool = tool;
            return `Tool set to: ${tool}`;
        }
        return `Invalid tool. Available tools: ${validTools.join(', ')}`;
    }

    setColor(color) {
        this.currentColor = color;
        return `Color set to: ${color}`;
    }

    setLineWidth(width) {
        const w = parseInt(width);
        if (w > 0 && w <= 50) {
            this.lineWidth = w;
            return `Line width set to: ${w}`;
        }
        return "Line width must be between 1 and 50";
    }
}

const artist = new OnscreenArtist();

// Commands object for both stdin interface AND programmatic access
export const commands = {
    draw: {
        name: "draw",
        description: "Start drawing mode or create canvas",
        execute: async () => {
            return artist.createCanvas();
        }
    },

    clear: {
        name: "clear",
        description: "Clear the drawing canvas",
        execute: async () => {
            return artist.clearCanvas();
        }
    },

    tool: {
        name: "tool",
        description: "Set drawing tool: tool <pen|brush|eraser|line|rectangle|circle>",
        execute: async (toolName) => {
            if (!toolName) {
                return "Usage: tool <pen|brush|eraser|line|rectangle|circle>";
            }
            return artist.setTool(toolName);
        }
    },

    color: {
        name: "color",
        description: "Set drawing color: color <hex-color>",
        execute: async (colorValue) => {
            if (!colorValue) {
                return "Usage: color <hex-color> (e.g., color #ff0000)";
            }
            return artist.setColor(colorValue);
        }
    },

    width: {
        name: "width",
        description: "Set line width: width <1-50>",
        execute: async (widthValue) => {
            if (!widthValue) {
                return "Usage: width <1-50>";
            }
            return artist.setLineWidth(widthValue);
        }
    },

    status: {
        name: "status",
        description: "Show current drawing settings",
        execute: async () => {
            return [
                `Tool: ${artist.currentTool}`,
                `Color: ${artist.currentColor}`,
                `Line Width: ${artist.lineWidth}`,
                `Environment: ${isBrowser ? 'Browser' : 'Node.js'}`,
                `Canvas: ${artist.canvas ? 'Available' : 'Not created'}`
            ].join('\n');
        }
    },

    help: {
        name: "help",
        description: "Show available commands",
        execute: async () => {
            const cmdList = Object.keys(commands).map(cmd => 
                `  ${cmd}: ${commands[cmd].description}`
            ).join('\n');
            
            return [
                "Onscreen Artist v" + moduleInfo.version,
                "",
                "Available commands:",
                cmdList,
                "",
                "Examples:",
                "  draw          - Create drawing canvas",
                "  tool pen      - Switch to pen tool",
                "  color #ff0000 - Set color to red",
                "  width 5       - Set line width to 5"
            ].join('\n');
        }
    }
};

// Stdin listener setup (for interactive commands)
function setupStdinListener() {
    if (typeof globalThis !== "undefined" && globalThis.navi && typeof globalThis.navi.on === "function") {
        globalThis.navi.on('stdin', async (input) => {
            const trimmed = input.trim();
            if (!trimmed) return;
            
            const [cmd, ...args] = trimmed.split(' ').filter(arg => arg.length > 0);
            
            const command = commands[cmd];
            if (command) {
                try {
                    const result = await command.execute(...args);
                    console.log(result);
                } catch (error) {
                    console.error("Error:", error.message || error);
                }
            }
        });
        
        console.log('[onscreen_artist] Stdin listener ready!');
    }
}

// Auto-setup when module loads
async function initialize() {
    
    await artist.initialize();
    setupStdinListener();
    console.log('[onscreen_artist] Onscreen Artist module loaded');
}

initialize();

// Default export (required)
export default {
    name: "onscreen_artist",
    moduleInfo,
    commands,
    artist
};
