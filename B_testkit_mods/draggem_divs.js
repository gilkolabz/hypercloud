//this module is a recompilation of two classic modules written for early xomud testkit work
//drag_functions.js and enclose_draggable.js
//enjoy:
//  draggem_divz RUN! SUPERMOUSE PLUGIN! 1.5.2
//  ENCLOSE IFRAMES IN DRAGGABLE DIVS!

//bugs:

// maximize/restore resets state of iframe on transition to windowed
// if the mouse isnt tracked well then drag/resize is buggy

export const register = (navi) => {
    // Environment detection
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
    const unregisterIframeOptions = [];
    
    // ⚠️ IMPORTANT: Track all resources for cleanup
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];
    
    const resolveSuperMouse = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        if (!mod) return null;

        // Prefer known module names first.
        const directMatch = mod.supermouse_capri_blue_v4 || mod.supermouse || null;
        if (directMatch?.superMouse) return directMatch.superMouse;

        // Fallback: scan registry for any module exposing superMouse API.
        const anyModule = Object.values(mod).find(entry =>
            entry?.superMouse &&
            typeof entry.superMouse.registerIframeOption === 'function'
        );
        return anyModule?.superMouse || null;
    };

    class draggem_divzManager {
        constructor() {
            this.initializedElements = new WeakSet();
            this.highestZIndex = 1;
        }

        initialize() {
            if (!isBrowser) return;
            this.defineCustomElement();
            this.setupDragRuntime();
            this.injectStyles();
        }

        cleanup() {
            // Listener and observer cleanup is handled by module-level trackers.
        }

        defineCustomElement() {
            if (customElements.get('x-draggem_divz')) return;

            class Xdraggem_divz extends HTMLElement {
                connectedCallback() {
                    if (this.dataset.draggem_divzInitialized === 'true') return;
                    this.dataset.draggem_divzInitialized = 'true';

                    const preservedNodes = [];
                    while (this.firstChild) {
                        preservedNodes.push(this.firstChild);
                        this.removeChild(this.firstChild);
                    }

                    const controlsEl = document.createElement('div');
                    controlsEl.className = 'draggem_divz_controls';
                    controlsEl.innerHTML = `
                        <button style="margin:2px;" class="draggem_divz-remove-btn">x</button>
                        <button style="margin:2px;" class="draggem_divz-maximize-btn">□</button>
                        <button style="margin:2px;" class="draggem_divz-hide-btn">-</button>
                    `;

                    const contentEl = document.createElement('div');
                    contentEl.className = 'draggem_divz_dragged_content';
                    preservedNodes.forEach(node => contentEl.appendChild(node));

                    this.appendChild(controlsEl);
                    this.appendChild(contentEl);

                    this.classList.add('draggem_divz_draggable');
                    this.style.paddingTop = '0';
                    this.style.display = this.style.display || 'inline-block';
                    this.style.position = this.style.position || 'absolute';

                    const removeBtn = this.querySelector('.draggem_divz-remove-btn');
                    const hideBtn = this.querySelector('.draggem_divz-hide-btn');
                    const maximizeBtn = this.querySelector('.draggem_divz-maximize-btn');

                    removeBtn?.addEventListener('click', e => {
                        e.stopPropagation();
                        this.remove();
                    });

                    hideBtn?.addEventListener('click', e => {
                        e.stopPropagation();
                        this.style.display = 'none';
                    });

                    maximizeBtn?.addEventListener('click', e => {
                        e.stopPropagation();
                        const contentEl = this.querySelector('.draggem_divz_dragged_content');
                        if (!contentEl) return;
                        const iframeEls = contentEl.querySelectorAll('iframe');

                        if (!this.hasAttribute('data-maximized')) {
                            this.setAttribute('data-original-transform', this.style.transform || '');
                            this.setAttribute('data-original-position', this.style.position || '');
                            this.setAttribute('data-original-left', this.style.left || '');
                            this.setAttribute('data-original-top', this.style.top || '');
                            this.setAttribute('data-original-right', this.style.right || '');
                            this.setAttribute('data-original-bottom', this.style.bottom || '');
                            this.setAttribute('data-original-inset', this.style.inset || '');
                            this.setAttribute('data-original-display', this.style.display || '');
                            this.setAttribute('data-original-zindex', this.style.zIndex || '');
                            this.setAttribute('data-original-wrapper-width', this.style.width || '');
                            this.setAttribute('data-original-wrapper-height', this.style.height || '');
                            this.setAttribute('data-original-wrapper-resize', this.style.resize || '');
                            this.setAttribute('data-original-wrapper-overflow', this.style.overflow || '');
                            this.setAttribute('data-original-width', contentEl.style.width || '');
                            this.setAttribute('data-original-height', contentEl.style.height || '');
                            this.setAttribute('data-original-content-overflow', contentEl.style.overflow || '');

                            this.style.transform = 'none';
                            this.style.setProperty('transform', 'none', 'important');
                            this.style.setProperty('position', 'fixed', 'important');
                            this.style.setProperty('left', '0', 'important');
                            this.style.setProperty('top', '0', 'important');
                            this.style.setProperty('right', '0', 'important');
                            this.style.setProperty('bottom', '0', 'important');
                            this.style.setProperty('inset', '0', 'important');
                            this.style.setProperty('display', 'block', 'important');
                            this.style.setProperty('z-index', '9999', 'important');
                            this.style.setProperty('max-width', '100vw', 'important');
                            this.style.setProperty('max-height', '100vh', 'important');
                            this.style.setProperty('resize', 'none', 'important');
                            this.style.setProperty('overflow', 'hidden', 'important');
                            const applyFullscreenSize = () => {
                                const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0);
                                const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
                                this.style.setProperty('width', `${viewportWidth}px`, 'important');
                                this.style.setProperty('height', `${viewportHeight}px`, 'important');
                            };

                            applyFullscreenSize();
                            this._draggemDivzFullscreenResizeHandler = applyFullscreenSize;
                            window.addEventListener('resize', applyFullscreenSize);
                            this.style.resize = 'none';
                            this.style.overflow = 'hidden';
                            contentEl.style.width = '';
                            contentEl.style.height = '';
                            contentEl.style.overflow = 'auto';

                            iframeEls.forEach(iframe => {
                                iframe.setAttribute('data-draggem-divz-original-width', iframe.style.width || '');
                                iframe.setAttribute('data-draggem-divz-original-height', iframe.style.height || '');
                                iframe.setAttribute('data-draggem-divz-original-display', iframe.style.display || '');
                                iframe.style.width = '100%';
                                iframe.style.height = '100%';
                                iframe.style.display = 'block';
                            });
                            this.setAttribute('data-maximized', 'true');
                            return;
                        }

                        this.style.transform = this.getAttribute('data-original-transform') || '';
                        this.style.setProperty('position', this.getAttribute('data-original-position') || 'absolute');
                        this.style.setProperty('left', this.getAttribute('data-original-left') || '');
                        this.style.setProperty('top', this.getAttribute('data-original-top') || '');
                        this.style.setProperty('right', this.getAttribute('data-original-right') || '');
                        this.style.setProperty('bottom', this.getAttribute('data-original-bottom') || '');
                        this.style.setProperty('inset', this.getAttribute('data-original-inset') || '');
                        this.style.setProperty('display', this.getAttribute('data-original-display') || 'inline-block');
                        this.style.setProperty('z-index', this.getAttribute('data-original-zindex') || '');
                        this.style.removeProperty('max-width');
                        this.style.removeProperty('max-height');
                        const fullscreenResizeHandler = this._draggemDivzFullscreenResizeHandler;
                        if (fullscreenResizeHandler) {
                            window.removeEventListener('resize', fullscreenResizeHandler);
                            delete this._draggemDivzFullscreenResizeHandler;
                        }
                        this.style.removeProperty('position');
                        this.style.removeProperty('left');
                        this.style.removeProperty('top');
                        this.style.removeProperty('right');
                        this.style.removeProperty('bottom');
                        this.style.removeProperty('inset');
                        this.style.removeProperty('display');
                        this.style.removeProperty('z-index');
                        this.style.removeProperty('transform');
                        this.style.removeProperty('resize');
                        this.style.removeProperty('overflow');
                        this.style.removeProperty('width');
                        this.style.removeProperty('height');
                        this.style.width = this.getAttribute('data-original-wrapper-width') || '';
                        this.style.height = this.getAttribute('data-original-wrapper-height') || '';
                        this.style.resize = this.getAttribute('data-original-wrapper-resize') || '';
                        this.style.overflow = this.getAttribute('data-original-wrapper-overflow') || '';

                        contentEl.style.width = this.getAttribute('data-original-width') || '';
                        contentEl.style.height = this.getAttribute('data-original-height') || '';
                        contentEl.style.overflow = this.getAttribute('data-original-content-overflow') || '';

                        iframeEls.forEach(iframe => {
                            iframe.style.width = iframe.getAttribute('data-draggem-divz-original-width') || '';
                            iframe.style.height = iframe.getAttribute('data-draggem-divz-original-height') || '';
                            iframe.style.display = iframe.getAttribute('data-draggem-divz-original-display') || '';
                            iframe.removeAttribute('data-draggem-divz-original-width');
                            iframe.removeAttribute('data-draggem-divz-original-height');
                            iframe.removeAttribute('data-draggem-divz-original-display');
                        });

                        this.removeAttribute('data-maximized');
                        this.removeAttribute('data-original-transform');
                        this.removeAttribute('data-original-position');
                        this.removeAttribute('data-original-left');
                        this.removeAttribute('data-original-top');
                        this.removeAttribute('data-original-right');
                        this.removeAttribute('data-original-bottom');
                        this.removeAttribute('data-original-inset');
                        this.removeAttribute('data-original-display');
                        this.removeAttribute('data-original-zindex');
                        this.removeAttribute('data-original-wrapper-width');
                        this.removeAttribute('data-original-wrapper-height');
                        this.removeAttribute('data-original-wrapper-resize');
                        this.removeAttribute('data-original-wrapper-overflow');
                        this.removeAttribute('data-original-width');
                        this.removeAttribute('data-original-height');
                        this.removeAttribute('data-original-content-overflow');
                    });
                }
            }

            customElements.define('x-draggem_divz', Xdraggem_divz);
        }

        setupDragRuntime() {
            const draggin = e => {
                const element = e.currentTarget;
                if (!(element instanceof HTMLElement)) return;
                if (e.target.closest('button')) return;
                if (e.target.closest('.draggem_divz_dragged_content')) return;
                if (element.hasAttribute('data-maximized')) return;
                if (element.hasAttribute('data-contained')) return;

                // Let native bottom-right resize handle behavior win over dragging.
                if (e.type === 'mousedown') {
                    const rect = element.getBoundingClientRect();
                    const resizeZoneSize = 18; // pixels from bottom-right corner
                    const clickXFromRight = rect.right - e.clientX;
                    const clickYFromBottom = rect.bottom - e.clientY;
                    const isInResizeCorner = clickXFromRight >= 0 &&
                        clickYFromBottom >= 0 &&
                        clickXFromRight <= resizeZoneSize &&
                        clickYFromBottom <= resizeZoneSize;
                    if (isInResizeCorner) return;
                }

                e.preventDefault();

                element.style.zIndex = String(++this.highestZIndex);

                const isTouchEvent = e.type.includes('touch');
                const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX;
                const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY;
                const rect = element.getBoundingClientRect();
                const offsetX = clientX - rect.left;
                const offsetY = clientY - rect.top;

                let translateX = 0;
                let translateY = 0;
                const transform = window.getComputedStyle(element).transform;
                if (transform && transform !== 'none') {
                    const matrixValues = transform.match(/matrix.*\((.+)\)/);
                    if (matrixValues) {
                        const values = matrixValues[1].split(', ');
                        translateX = parseFloat(values[4]) || 0;
                        translateY = parseFloat(values[5]) || 0;
                    }
                }

                const dragMove = moveEvent => {
                    const moveClientX = isTouchEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
                    const moveClientY = isTouchEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
                    const newX = moveClientX - offsetX;
                    const newY = moveClientY - offsetY;
                    const deltaX = newX - rect.left;
                    const deltaY = newY - rect.top;
                    element.style.transform = `translate(${translateX + deltaX}px, ${translateY + deltaY}px)`;
                };

                const dragEnd = () => {
                    document.removeEventListener('mousemove', dragMove);
                    document.removeEventListener('mouseup', dragEnd);
                    document.removeEventListener('touchmove', dragMove);
                    document.removeEventListener('touchend', dragEnd);
                };

                document.addEventListener('mousemove', dragMove);
                document.addEventListener('mouseup', dragEnd);
                document.addEventListener('touchmove', dragMove);
                document.addEventListener('touchend', dragEnd);
            };

            const addDragEventListener = element => {
                if (!(element instanceof HTMLElement) || this.initializedElements.has(element)) return;
                this.initializedElements.add(element);

                element.style.position = 'absolute';
                if (!element.style.transform) element.style.transform = 'translate(12px, 12px)';

                const mousedownHandler = e => draggin(e);
                const touchstartHandler = e => draggin(e);
                element.addEventListener('mousedown', mousedownHandler);
                element.addEventListener('touchstart', touchstartHandler);
                eventListeners.push(
                    { element, event: 'mousedown', handler: mousedownHandler },
                    { element, event: 'touchstart', handler: touchstartHandler }
                );
            };

            const bodyMousedownHandler = e => {
                const draggable = e.target?.closest?.('x-draggem_divz');
                if (draggable) addDragEventListener(draggable);
            };
            const bodyTouchstartHandler = e => {
                const draggable = e.target?.closest?.('x-draggem_divz');
                if (draggable) addDragEventListener(draggable);
            };

            document.body.addEventListener('mousedown', bodyMousedownHandler);
            document.body.addEventListener('touchstart', bodyTouchstartHandler);
            eventListeners.push(
                { element: document.body, event: 'mousedown', handler: bodyMousedownHandler },
                { element: document.body, event: 'touchstart', handler: bodyTouchstartHandler }
            );

            const observer = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.nodeName === 'X-draggem_divz') {
                            addDragEventListener(node);
                        }
                    });
                });
            });

            observer.observe(document.body, { childList: true, subtree: true });
            observers.push(observer);

            document.querySelectorAll('x-draggem_divz').forEach(element => addDragEventListener(element));
        }

        injectStyles() {
            const styleId = 'draggem_divz-style';
            const cssText = `
                .draggem_divz_draggable {
                    padding: 2px;
                    background-color: gold;
                    line-height: normal;
                    position: absolute;
                    cursor: move;
                    resize: both;
                    overflow: hidden;
                    box-sizing: border-box;
                    min-width: 220px;
                    min-height: 170px;
                }
                .draggem_divz_draggable[data-maximized="true"] {
                    position: fixed !important;
                    inset: 0 !important;
                    left: 0 !important;
                    top: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                    display: block !important;
                    z-index: 9999 !important;
                    transform: none !important;
                    resize: none !important;
                    overflow: hidden !important;
                    min-width: 0 !important;
                    min-height: 0 !important;
                }
                .draggem_divz_controls {
                    position: absolute;
                    top: 4px;
                    left: 4px;
                    z-index: 2;
                }
                .draggem_divz_dragged_content {
                    position: absolute;
                    top: 34px;
                    left: 2px;
                    right: 2px;
                    bottom: 2px;
                    padding: 10px;
                    background-color: silver;
                    cursor: auto;
                    user-select: text;
                    overflow-y: auto;
                    overflow-x: hidden;
                    box-sizing: border-box;
                }
                .draggem_divz_dragged_content iframe {
                    display: block;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                }
            `;
            const existingStyle = document.getElementById(styleId);
            if (existingStyle && existingStyle.tagName === 'STYLE') {
                existingStyle.textContent = cssText;
                return;
            }

            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = cssText;
            document.head.appendChild(style);
            addedStyles.push(style);
        }

        draggablizeElement(element) {
            if (!isBrowser || !(element instanceof HTMLElement)) return null;
            const parent = element.parentNode;
            if (!parent) return null;

            const existingWrapper = element.closest('x-draggem_divz');
            if (existingWrapper) return existingWrapper;

            const wrapper = document.createElement('x-draggem_divz');
            parent.insertBefore(wrapper, element);
            wrapper.appendChild(element);

            // connectedCallback runs when wrapper is inserted, before this append.
            // Move target node into dragged_content so it is not a sibling of content.
            const contentContainer = wrapper.querySelector('.draggem_divz_dragged_content');
            if (contentContainer) {
                contentContainer.appendChild(element);
            }

            // Keep wrapped iframes in normal flow so dragged_content contains them.
            if (element.tagName === 'IFRAME') {
                const iframe = element;
                if (contentContainer) {
                    contentContainer.setAttribute('data-draggem-divz-orig-overflow-y', contentContainer.style.overflowY || '');
                    contentContainer.style.overflowY = 'hidden';
                }
                iframe.setAttribute('data-draggem-divz-orig-position', iframe.style.position || '');
                iframe.setAttribute('data-draggem-divz-orig-top', iframe.style.top || '');
                iframe.setAttribute('data-draggem-divz-orig-left', iframe.style.left || '');
                iframe.setAttribute('data-draggem-divz-orig-width', iframe.style.width || '');
                iframe.setAttribute('data-draggem-divz-orig-height', iframe.style.height || '');
                iframe.style.position = 'static';
                iframe.style.top = '';
                iframe.style.left = '';
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.display = 'block';
            }

            createdElements.push(wrapper);
            return wrapper;
        }

        undraggablizeElement(element) {
            if (!isBrowser || !(element instanceof HTMLElement)) return null;
            const wrapper = element.closest('x-draggem_divz');
            if (!wrapper || !wrapper.parentNode) return null;
            const contentContainer = wrapper.querySelector('.draggem_divz_dragged_content');

            if (element.tagName === 'IFRAME') {
                const iframe = element;
                if (contentContainer) {
                    contentContainer.style.overflowY = contentContainer.getAttribute('data-draggem-divz-orig-overflow-y') || '';
                    contentContainer.removeAttribute('data-draggem-divz-orig-overflow-y');
                }
                iframe.style.position = iframe.getAttribute('data-draggem-divz-orig-position') || '';
                iframe.style.top = iframe.getAttribute('data-draggem-divz-orig-top') || '';
                iframe.style.left = iframe.getAttribute('data-draggem-divz-orig-left') || '';
                iframe.style.width = iframe.getAttribute('data-draggem-divz-orig-width') || '';
                iframe.style.height = iframe.getAttribute('data-draggem-divz-orig-height') || '';
                iframe.style.removeProperty('display');
                iframe.removeAttribute('data-draggem-divz-orig-position');
                iframe.removeAttribute('data-draggem-divz-orig-top');
                iframe.removeAttribute('data-draggem-divz-orig-left');
                iframe.removeAttribute('data-draggem-divz-orig-width');
                iframe.removeAttribute('data-draggem-divz-orig-height');
            }

            wrapper.parentNode.insertBefore(element, wrapper);
            wrapper.remove();
            return element;
        }
    }

    const registerIframePluginHook = () => {
        const superMouse = resolveSuperMouse();
        if (!superMouse) {
            console.warn('[draggem_divz] supermouse not found; plugin not registered');
            return false;
        }

        const unregisterDraggablize = superMouse.registerIframeOption({
            id: 'draggem_divz_enclose_iframe',
            text: 'draggablize',
            position: 2,
            execute: ({ iframe }) => {
                const wrapped = myObject.draggablizeElement(iframe);
                if (!wrapped) {
                    console.warn('[draggem_divz] unable to draggablize iframe');
                }
            }
        });
        unregisterIframeOptions.push(unregisterDraggablize);

        const unregisterUndragg = superMouse.registerIframeOption({
            id: 'draggem_divz_undraggablize_iframe',
            text: 'undraggablize',
            position: 3,
            execute: ({ iframe }) => {
                const unwrapped = myObject.undraggablizeElement(iframe);
                if (!unwrapped) {
                    console.warn('[draggem_divz] iframe is not draggablized');
                }
            }
        });
        unregisterIframeOptions.push(unregisterUndragg);

        console.log('[draggem_divz] registered iframe option with supermouse');
        return true;
    };

    const myObject = new draggem_divzManager();
    
    return {
        name: "draggem_divz",
        version: "1.5.2", // 1.5.2 includes styling + maximize iframe fixes
        description: "enclose html elements in draggable divs",
        
        // Module metadata (for compatibility and discoverability)
        moduleInfo: {
            name: "draggem_divz",
            version: "1.5.2",
            description: "enclose html elements in draggable divs",
        },
        
        myObject,

        // Commands object - automatically gets stdin listeners
        commands: {
            command_name: {
                name: "command_name",
                description: "What this command does",
                execute: async (...args) => {
                    // Command implementation using myObject
                    return "Command result";
                }
            }
        },
                
        // Lifecycle hooks
        onMount: async () => {
            // Initialize your module
            await myObject.initialize();
            if (isBrowser) registerIframePluginHook();
            console.log('[draggem_divz] Module loaded v1.5.2');
        },
        
        onUnmount: () => {
            // ⚠️ CRITICAL: Clean up ALL resources
            // Remove event listeners
            eventListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            eventListeners.length = 0;
            
            // Remove DOM elements
            createdElements.forEach(el => el.remove());
            createdElements.length = 0;
            
            // Remove styles
            addedStyles.forEach(style => style.remove());
            addedStyles.length = 0;
            
            // Disconnect observers
            observers.forEach(observer => observer.disconnect());
            observers.length = 0;
            
            // Clear timers
            timers.forEach(({ type, id }) => {
                if (type === 'interval') clearInterval(id);
                if (type === 'timeout') clearTimeout(id);
            });
            timers.length = 0;
            
            // Module-specific cleanup
            unregisterIframeOptions.forEach(unregister => {
                if (typeof unregister === 'function') unregister();
            });
            unregisterIframeOptions.length = 0;
            myObject.cleanup();
            console.log('[draggem_divz] Module unmounted');
        }
    };
};