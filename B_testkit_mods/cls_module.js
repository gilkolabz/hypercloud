// Clear screen module for navi shell
// Handles 'cls' command in both Node.js and browser environments

export const moduleInfo = {
    name: "testkit_cls",
    version: "1.0.1",
    description: "clear screen command for navi shell"
};

const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

// Clear function for Node.js environment
function clearNodeCli() {
    if (typeof process !== "undefined" && process.stdout && process.stdout.write) {
        try {
            // Method 1: Use proper ANSI escape codes
            // \x1B[2J = clear entire screen
            // \x1B[0;0H = move cursor to row 0, column 0 (top-left)
            process.stdout.write('\x1B[2J\x1B[0;0H');
            
            // Force flush the output
            if (process.stdout.flush) {
                process.stdout.flush();
            }
            
            // Method 2: Alternative clear sequence
            process.stdout.write('\x1Bc');
            
        } catch (error) {
            console.log('[cls] ANSI escape codes failed, trying alternative methods...');
            
            try {
                // Method 3: Use console.clear() if available
                if (typeof console.clear === 'function') {
                    console.clear();
                } else {
                    throw new Error('console.clear not available');
                }
            } catch (clearError) {
                console.log('[cls] console.clear failed, using newline fallback...');
                
                // Method 4: Print many newlines to push content up
                const lines = process.stdout.rows || 50;
                console.log('\n'.repeat(lines));
            }
        }
    } else {
        // Fallback for environments without process.stdout
        console.log('\n'.repeat(50));
    }
}

// Clear function for browser environment
function clearBrowserConsole() {
    if (typeof console.clear === 'function') {
        console.clear();
    } else {
        // Fallback: print separator
        console.log('\n' + '='.repeat(80) + '\n');
    }
}

// Main clear function that detects environment
function clearScreen() {
    if (isBrowser) {
        clearBrowserConsole();
    } else {
        clearNodeCli();
    }
}

// Set up stdin listener when navi is available
function setupStdinListener() {
    if (typeof globalThis !== "undefined" && globalThis.navi && typeof globalThis.navi.on === "function") {
        
        globalThis.navi.on('stdin', async (input) => {
            const trimmed = input.trim().toLowerCase();
            
            // Handle various clear commands
            if (trimmed === 'cls' || trimmed === 'clear') {
                clearScreen();
            }
        });
        
        console.log('[cls] Stdin listener registered - type "cls" or "clear" to clear screen');
    } else {
        console.log('[cls] Warning: navi not available, stdin listener not registered');
    }
}

// Auto-setup when module loads
setupStdinListener();

// Export the clear function for direct use
export const clear = clearScreen;

// Export commands object for compatibility with other modules
export const commands = {
    cls: {
        name: "cls",
        description: "Clear the screen/console",
        execute: async () => {
            clearScreen();
            return "Screen cleared";
        }
    },
    clear: {
        name: "clear", 
        description: "Clear the screen/console (alias for cls)",
        execute: async () => {
            clearScreen();
            return "Screen cleared";
        }
    }
};

export default {
    name: "testkit_cls",
    moduleInfo,
    commands,
    clear: clearScreen
};

console.log('[cls] Clear screen module loaded - supports both "cls" and "clear" commands');
