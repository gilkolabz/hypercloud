/*
SUPERMOUSE V4.5.0

some notes

Right now:
plugin options are always rendered once registered,
execute can decide to no-op, but the menu item still shows.
What would make it work cleanly:
add optional when(context) (or visible(context)) to plugin options,
in applyOptionPlugins / element creation, skip rendering when it returns false.

v4.6
adding insert raw html

*/

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

const STYLES = {
    menu: `position: fixed; background: #f0f0f0; border: 2px outset #f0f0f0; padding: 2px; min-width: 120px; max-width: 300px; z-index: 10000; display: none; font-family: sans-serif; font-size: 12px;`,
    item: `padding: 4px 8px; background: #f0f0f0; cursor: pointer; border: 1px solid transparent; margin: 1px;`,
    vanity: `font-style: italic; color: #00bfff; cursor: default;`,
    window: `font-style: italic; color: #666;`,
    input: `width: 100%; padding: 2px 4px; border: 1px inset #f0f0f0; background: white; font-family: monospace; font-size: 12px; outline: none; box-sizing: border-box; overflow-x: auto;`,
    userSelect: `* { -webkit-user-select: none !important; -webkit-touch-callout: none !important; -moz-user-select: none !important; -ms-user-select: none !important; user-select: none !important; } input, textarea, [contenteditable] { -webkit-user-select: text !important; -webkit-touch-callout: default !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important; }`
};

const COLORS = { hover: '#316ac5', normal: '#f0f0f0' };
const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Sizemaxx styles constant
const SIZEMAXX_STYLES = 'display: block; border: none; margin: 0; padding: 0; width: 100vw; height: 100vh; position: fixed; top: 0; left: 0; overflow: auto; background: transparent;';

class SuperMouse {
    constructor() {
        Object.assign(this, {
            isActive: false,
            customMenu: null,
            openDropdown: null,
            isInInputMode: false,
            menuCloseDisabled: false,
            sizemaxxState: new Set(), // Track which iframes have sizemaxx applied
            eventListeners: [], // Store event listeners for cleanup
            clickedElement: null, // Track the element that was right-clicked
            recursion: false, // When true, right-click on the supermouse menu behaves like any other element
            globalOptionPlugins: [],
            iframeOptionPlugins: [],
            menuItems: [
            { id: 'vanity', text: 'supermouse capri blue', type: 'vanity' },
            { id: 'navi_input', text: "navi('callin')", type: 'navi_input' },
            { id: 'element_context', text: '', type: 'element_context' },
            { id: 'window_name', text: '', type: 'window_name' }
            ]
        });
    }

    async init() {
        if (!isBrowser) throw new Error("SuperMouse only works in browser environment");
        this.disableDefaultContextMenu();
        this.setupEventListeners();
        this.isActive = true;
    }

    // Utility functions - consolidated repeated DOM operations
    createElement(tag, styles = '', content = '') {
        const el = document.createElement(tag);
        if (styles) el.style.cssText = styles;
        if (content) el.textContent = content;
        return el;
    }

    addHoverEffect(el, textColor = 'white') {
        el.addEventListener('mouseenter', () => Object.assign(el.style, { background: COLORS.hover, color: textColor }));
        el.addEventListener('mouseleave', () => Object.assign(el.style, { background: COLORS.normal, color: textColor === 'white' ? 'black' : '#666' }));
    }

    isSupermouseMenuTarget(target) {
        return !!(target && this.customMenu && this.customMenu.contains(target));
    }

    shouldHandleContextMenuOn(target) {
        return !this.isSupermouseMenuTarget(target) || this.recursion;
    }

    setRecursion(enabled) {
        this.recursion = !!enabled;
        return this.recursion;
    }

    toggleRecursion() {
        this.recursion = !this.recursion;
        return this.recursion;
    }

    disableDefaultContextMenu() {
        this.disableDefaultContextMenuForDocument(document);
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        if (iframeDoc) {
                    this.disableDefaultContextMenuForDocument(iframeDoc);
                        }
                    } catch (error) {
                // Cross-origin iframe
            }
        });
    }

    setupEventListeners() {
        const handleRightClick = (e, doc = document) => {
            if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                if (!this.shouldHandleContextMenuOn(e.target)) return;

                // Capture the clicked element
                this.clickedElement = e.target;

                // For iframe clicks, use the click coordinates relative to the iframe
                // Don't add iframe offset since menu will be positioned within the iframe
                this.showMenu(e.clientX, e.clientY, doc);
            }
        };

        const handleClick = (e) => {
            if (e.button === 0 && this.customMenu && !this.customMenu.contains(e.target) && !this.isInInputMode && !this.menuCloseDisabled) {
                        this.hideMenu();
                    }
        };

        // Setup for main document
        const rightClickHandler = e => handleRightClick(e, document);
        const clickHandler = handleClick;
        const keydownHandler = e => e.key === 'Escape' && this.hideMenu();
        
        document.addEventListener('mousedown', rightClickHandler, true);
        document.addEventListener('mousedown', clickHandler);
        document.addEventListener('keydown', keydownHandler);
        
        // Store listeners for cleanup
        this.eventListeners.push(
            { element: document, event: 'mousedown', handler: rightClickHandler, capture: true },
            { element: document, event: 'mousedown', handler: clickHandler, capture: false },
            { element: document, event: 'keydown', handler: keydownHandler, capture: false }
        );
        
        // Setup for existing iframes
        this.setupIframeListeners();
        this.setupIframeObserver();

        // Touch support - simplified long press detection
        let touchTimer, touchStart;
        const touchStartHandler = e => {
            if (e.touches.length !== 1) return;
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
            touchTimer = setTimeout(() => {
                if (touchStart.moved) return;
                const target = doc.elementFromPoint(touchStart.x, touchStart.y);
                if (!this.shouldHandleContextMenuOn(target)) return;
                this.clickedElement = target;
                this.showMenu(touchStart.x, touchStart.y, doc);
            }, 800);
        };
        
        const touchMoveHandler = e => {
            if (touchTimer && Math.hypot(e.touches[0].clientX - touchStart.x, e.touches[0].clientY - touchStart.y) > 5) {
                touchStart.moved = true;
                clearTimeout(touchTimer);
            }
        };
        
        const touchEndHandler = () => clearTimeout(touchTimer);

        document.addEventListener('touchstart', touchStartHandler, true);
        document.addEventListener('touchmove', touchMoveHandler);
        document.addEventListener('touchend', touchEndHandler);
        
        // Store touch listeners
        this.eventListeners.push(
            { element: document, event: 'touchstart', handler: touchStartHandler, capture: true },
            { element: document, event: 'touchmove', handler: touchMoveHandler, capture: false },
            { element: document, event: 'touchend', handler: touchEndHandler, capture: false }
        );
    }

    setupIframeListeners() {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => this.setupSingleIframeListener(iframe));
    }

    setupSingleIframeListener(iframe) {
            try {
                iframe.addEventListener('load', () => {
                    try {
                        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                        if (iframeDoc) {
                        this.disableDefaultContextMenuForDocument(iframeDoc);
                            this.setupDocumentListeners(iframeDoc);
                        }
                    } catch (error) {
                    // Cross-origin iframe
                    }
                });
            
                if (iframe.contentDocument) {
                    try {
                        const iframeDoc = iframe.contentDocument;
                    this.disableDefaultContextMenuForDocument(iframeDoc);
                        this.setupDocumentListeners(iframeDoc);
                    } catch (error) {
                    // Cross-origin iframe
                    }
                }
            } catch (error) {
            // Cross-origin iframe
        }
    }

    disableDefaultContextMenuForDocument(doc) {
        if (!doc.head) return;
        
        const style = this.createElement('style');
        style.textContent = STYLES.userSelect;
        doc.head.appendChild(style);
        
        ['contextmenu', 'selectstart'].forEach(event => {
            doc.addEventListener(event, e => {
                if (event === 'selectstart' && (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.contentEditable === 'true')) return;
                e.preventDefault();
                return false;
            }, true);
        });
    }

    setupDocumentListeners(doc) {
        const handleRightClick = (e) => {
            if (e.button === 2) {
                e.preventDefault();
                e.stopPropagation();
                if (!this.shouldHandleContextMenuOn(e.target)) return;

                // Capture the clicked element
                this.clickedElement = e.target;

                // For iframe clicks, use the click coordinates relative to the iframe
                // Don't add iframe offset since menu will be positioned within the iframe
                this.showMenu(e.clientX, e.clientY, doc);
            }
        };

        const handleClick = (e) => {
            if (e.button === 0 && this.customMenu && !this.customMenu.contains(e.target) && !this.isInInputMode && !this.menuCloseDisabled) {
                this.hideMenu();
            }
        };

        const keydownHandler = e => e.key === 'Escape' && this.hideMenu();

        doc.addEventListener('mousedown', handleRightClick, true);
        doc.addEventListener('mousedown', handleClick);
        doc.addEventListener('keydown', keydownHandler);

        // Store iframe listeners for cleanup
        this.eventListeners.push(
            { element: doc, event: 'mousedown', handler: handleRightClick, capture: true },
            { element: doc, event: 'mousedown', handler: handleClick, capture: false },
            { element: doc, event: 'keydown', handler: keydownHandler, capture: false }
        );

        // Touch support for iframe documents - long press detection
        let touchTimer, touchStart;
        const touchStartHandler = e => {
            if (e.touches.length !== 1) return;
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
            touchTimer = setTimeout(() => {
                if (touchStart.moved) return;
                const target = doc.elementFromPoint(touchStart.x, touchStart.y);
                if (!this.shouldHandleContextMenuOn(target)) return;
                this.clickedElement = target;
                this.showMenu(touchStart.x, touchStart.y, doc);
            }, 800);
        };
        
        const touchMoveHandler = e => {
            if (touchTimer && Math.hypot(e.touches[0].clientX - touchStart.x, e.touches[0].clientY - touchStart.y) > 5) {
                touchStart.moved = true;
                clearTimeout(touchTimer);
            }
        };
        
        const touchEndHandler = () => clearTimeout(touchTimer);

        doc.addEventListener('touchstart', touchStartHandler, true);
        doc.addEventListener('touchmove', touchMoveHandler);
        doc.addEventListener('touchend', touchEndHandler);
        
        // Store iframe touch listeners
        this.eventListeners.push(
            { element: doc, event: 'touchstart', handler: touchStartHandler, capture: true },
            { element: doc, event: 'touchmove', handler: touchMoveHandler, capture: false },
            { element: doc, event: 'touchend', handler: touchEndHandler, capture: false }
        );
    }

    setupIframeObserver() {
        if (typeof MutationObserver !== 'undefined') {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.tagName === 'IFRAME') {
                                this.setupSingleIframeListener(node);
                            }
                            const iframes = node.querySelectorAll ? node.querySelectorAll('iframe') : [];
                            iframes.forEach(iframe => this.setupSingleIframeListener(iframe));
                        }
                    });
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            
            // Store observer for cleanup
            this.iframeObserver = observer;
        }
    }

    showMenu(x, y, doc = document) {
        this.destroyMenu();
        this.createCustomMenu(doc);
        
        // Use the appropriate window context for viewport dimensions
        const targetWindow = doc.defaultView || window;
        const vw = targetWindow.innerWidth || window.innerWidth;
        const vh = targetWindow.innerHeight || window.innerHeight;
        const menuW = 120, menuH = this.menuItems.length * 25;
        
        // Ensure coordinates are valid numbers
        const safeX = isNaN(x) || x === undefined ? 10 : x;
        const safeY = isNaN(y) || y === undefined ? 10 : y;
        
        const finalLeft = Math.max(10, Math.min(safeX, vw - menuW - 10));
        const finalTop = Math.max(10, Math.min(safeY, vh - menuH - 10));
        
        Object.assign(this.customMenu.style, {
            left: finalLeft + 'px',
            top: finalTop + 'px',
            display: 'block',
            opacity: '0',
            transform: 'scale(0.9)',
            transition: 'opacity 0.15s ease, transform 0.15s ease'
        });
        
        setTimeout(() => Object.assign(this.customMenu.style, { opacity: '1', transform: 'scale(1)' }), 10);
    }

    createCustomMenu(doc = document) {
        this.customMenu = this.createElement('div', STYLES.menu);
        this.customMenu.id = 'supermouse-context-menu';
        
        const currentWindow = doc.defaultView;
        const isInIframe = currentWindow !== currentWindow.parent;
        const iframeName = isInIframe ? (currentWindow.frameElement?.name || currentWindow.name || 'iframe') : 'global';

        this.menuItems.forEach(item => {
            const menuItem = this.createElement('div', STYLES.item);
            menuItem.className = 'supermouse-menu-item';
            
            if (item.type === 'vanity') {
                menuItem.style.cssText += STYLES.vanity;
                menuItem.textContent = item.text;
            } else if (item.type === 'element_context') {
                const elementId = this.getElementIdentifier(this.clickedElement);
                menuItem.style.cssText += STYLES.window;
                menuItem.textContent = elementId;
                this.addHoverEffect(menuItem, '#666');
                menuItem.addEventListener('click', e => {
                    e.stopPropagation();
                    this.showElementOptions(menuItem);
                });
            } else if (item.type === 'window_name') {
                menuItem.style.cssText += STYLES.window;
                menuItem.textContent = iframeName;
                this.addHoverEffect(menuItem, '#666');
                menuItem.addEventListener('click', e => {
                    e.stopPropagation();
                    if (iframeName === 'global') this.showGlobalOptions(menuItem);
                    else this.showIframeOptions(menuItem, this.findIframeByName(iframeName));
                });
            } else {
                menuItem.textContent = item.text;
                this.addHoverEffect(menuItem);
                menuItem.addEventListener('click', e => {
                e.stopPropagation();
                    this.handleMenuItemClick(item.id);
                });
            }
            
            this.customMenu.appendChild(menuItem);
        });

        // Add iframe list - simplified
        if (iframeName === 'global') {
            document.querySelectorAll('iframe').forEach((iframe, i) => {
                const item = this.createElement('div', STYLES.item + STYLES.window, iframe.name || iframe.id || `window[${i}]`);
                item.className = 'supermouse-menu-item';
                this.addHoverEffect(item, '#666');
                item.addEventListener('click', e => {
                e.stopPropagation();
                    this.showIframeOptions(item, iframe);
                });
                this.customMenu.appendChild(item);
            });
        }

        doc.body.appendChild(this.customMenu);
    }

    showGlobalOptions(parentItem) {
        if (this.openDropdown === parentItem) return this.closeDropdown();
            this.closeDropdown();
        
        const createItem = this.createElement('div', STYLES.item + STYLES.window, 'create iframe');
        createItem.className = 'supermouse-menu-item';
        createItem.dataset.dropdown = 'true';
        this.addHoverEffect(createItem, '#666');
        createItem.addEventListener('click', e => {
            e.stopPropagation();
            if (isMobile()) {
                const newSrc = prompt('Enter iframe src:', 'about:blank');
                if (newSrc !== null) this.createNewIframe(this.formatSrcForAttribute(newSrc));
                this.hideMenu();
            } else {
                this.createIframeInput(createItem);
            }
        });

        const baseItems = [{ id: 'create_iframe', element: createItem }];
        const itemsToRender = this.applyOptionPlugins(baseItems, this.globalOptionPlugins, {
            parentItem,
            type: 'global'
        });
        
        let insertAfter = parentItem;
        itemsToRender.forEach(item => {
            insertAfter.parentNode.insertBefore(item.element, insertAfter.nextElementSibling);
            insertAfter = item.element;
        });

        this.openDropdown = parentItem;
    }

    showElementOptions(parentItem) {
        if (this.openDropdown === parentItem) return this.closeDropdown();
        this.closeDropdown();
        
        const insertItem = this.createElement('div', STYLES.item, 'insert');
        insertItem.className = 'supermouse-menu-item';
        insertItem.dataset.dropdown = 'true';
        this.addHoverEffect(insertItem, 'white');
        
        insertItem.addEventListener('click', e => {
            e.stopPropagation();
            this.createElementInsertInput(insertItem);
        });
        
        parentItem.parentNode.insertBefore(insertItem, parentItem.nextElementSibling);
        this.openDropdown = parentItem;
    }

    showIframeOptions(parentItem, iframe) {
        if (this.openDropdown === parentItem) return this.closeDropdown();
        this.closeDropdown();
        
        const srcItem = this.createElement('div', STYLES.item + STYLES.window, this.formatSrcForDisplay(this.getCurrentIframeUrl(iframe)));
        
        // Create sizemaxx/unsizemaxx button based on current state
        const isHidden = this.isIframeHidden(iframe);
        const isSizemaxxed = this.isIframeSizemaxxed(iframe);
        const sizemaxxItem = this.createElement('div', STYLES.item, isSizemaxxed ? 'unsizemaxx' : 'sizemaxx');
        
        const hideItem = this.createElement('div', STYLES.item, isHidden ? 'reveal' : 'hide');
        
        [srcItem, sizemaxxItem, hideItem].forEach(item => {
            item.className = 'supermouse-menu-item';
            item.dataset.dropdown = 'true';
            this.addHoverEffect(item, item === srcItem ? '#666' : 'white');
        });

        srcItem.addEventListener('click', e => {
                e.stopPropagation();
            if (isMobile()) {
                const newSrc = prompt('Enter iframe src:', this.formatSrcForDisplay(this.getCurrentIframeUrl(iframe)));
                if (newSrc !== null) iframe.setAttribute('src', this.formatSrcForAttribute(newSrc));
                this.hideMenu();
            } else {
                this.createInput(srcItem, iframe);
            }
        });

        sizemaxxItem.addEventListener('click', e => {
            e.stopPropagation();
            if (this.isIframeSizemaxxed(iframe)) {
                this.removeSizemaxx(iframe);
            } else {
                this.applySizemaxx(iframe);
            }
            this.hideMenu();
        });

        hideItem.addEventListener('click', e => {
                e.stopPropagation();
            this.toggleIframeVisibility(iframe);
            this.hideMenu();
            });

        const baseItems = [
            { id: 'src', element: srcItem },
            { id: 'sizemaxx', element: sizemaxxItem },
            { id: 'hide', element: hideItem }
        ];
        const itemsToRender = this.applyOptionPlugins(baseItems, this.iframeOptionPlugins, {
            parentItem,
            iframe,
            type: 'iframe'
        });

        let insertAfter = parentItem;
        itemsToRender.forEach(item => {
            insertAfter.parentNode.insertBefore(item.element, insertAfter.nextElementSibling);
            insertAfter = item.element;
        });
        
        this.openDropdown = parentItem;
    }

    registerGlobalOption(option = {}) {
        const normalized = this.normalizePluginOption(option);
        this.globalOptionPlugins.push(normalized);
        return () => {
            this.globalOptionPlugins = this.globalOptionPlugins.filter(item => item.id !== normalized.id);
        };
    }

    registerIframeOption(option = {}) {
        const normalized = this.normalizePluginOption(option);
        this.iframeOptionPlugins.push(normalized);
        return () => {
            this.iframeOptionPlugins = this.iframeOptionPlugins.filter(item => item.id !== normalized.id);
        };
    }

    normalizePluginOption(option = {}) {
        const id = option.id || `plugin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const execute = typeof option.execute === 'function' ? option.execute : option.onClick;
        if (typeof execute !== 'function') throw new Error(`[supermouse] Plugin option "${id}" requires an execute function`);
        const parsedOrder = Number.isFinite(Number(option.order)) ? Number(option.order) : null;
        const hasPosition = Object.prototype.hasOwnProperty.call(option, 'position');
        const parsedPosition = hasPosition && Number.isFinite(Number(option.position)) ? Number(option.position) : null;
        return {
            id,
            text: option.text || option.label || id,
            textColor: option.textColor || 'white',
            style: option.style === 'window' ? STYLES.item + STYLES.window : STYLES.item,
            closeMenu: option.closeMenu !== false,
            // Preferred placement controls (stable; not tied to built-in ids)
            order: parsedOrder,
            position: parsedPosition,
            // Backward-compatible anchors (optional, legacy)
            before: option.before || null,
            after: option.after || null,
            execute
        };
    }

    createPluginMenuElement(option, context) {
        const label = typeof option.text === 'function' ? option.text(context) : option.text;
        const pluginItem = this.createElement('div', option.style, String(label || option.id));
        pluginItem.className = 'supermouse-menu-item';
        pluginItem.dataset.dropdown = 'true';
        this.addHoverEffect(pluginItem, option.textColor);
        pluginItem.addEventListener('click', async e => {
            e.stopPropagation();
            try {
                await option.execute({
                    event: e,
                    superMouse: this,
                    parentItem: context.parentItem,
                    iframe: context.iframe || null,
                    clickedElement: this.clickedElement,
                    isMobile: isMobile()
                });
            } catch (error) {
                console.error(`[supermouse] Plugin "${option.id}" failed`, error);
            }
            if (option.closeMenu) this.hideMenu();
        });
        return pluginItem;
    }

    applyOptionPlugins(baseItems, plugins, context) {
        const orderedItems = [...baseItems];
        const withExplicitPosition = [];
        const withOrder = [];
        const withAnchors = [];
        const appendOnly = [];

        plugins.forEach(option => {
            const element = this.createPluginMenuElement(option, context);
            const insertion = { id: option.id, element };

            if (Number.isFinite(option.position)) {
                withExplicitPosition.push({ option, insertion });
                return;
            }

            if (Number.isFinite(option.order)) {
                withOrder.push({ option, insertion });
                return;
            }

            if (option.before || option.after) {
                withAnchors.push({ option, insertion });
                return;
            }

            appendOnly.push({ option, insertion });
        });

        withExplicitPosition
            .sort((a, b) => a.option.position - b.option.position)
            .forEach(({ option, insertion }) => {
                const maxIndex = orderedItems.length;
                const index = Math.max(0, Math.min(Math.floor(option.position), maxIndex));
                orderedItems.splice(index, 0, insertion);
            });

        withOrder
            .sort((a, b) => a.option.order - b.option.order)
            .forEach(({ insertion }) => {
                orderedItems.push(insertion);
            });

        withAnchors.forEach(({ option, insertion }) => {
            const anchorIndex = option.before
                ? orderedItems.findIndex(item => item.id === option.before)
                : orderedItems.findIndex(item => item.id === option.after);
            if (anchorIndex === -1) {
                orderedItems.push(insertion);
                return;
            }
            const insertAt = option.before ? anchorIndex : anchorIndex + 1;
            orderedItems.splice(insertAt, 0, insertion);
        });

        appendOnly.forEach(({ insertion }) => orderedItems.push(insertion));
        return orderedItems;
    }

    createInput(container, iframe) {
        this.isInInputMode = true;
        this.menuCloseDisabled = true; // Prevent menu from closing during input
        container.innerHTML = '';
        const input = this.createElement('input', STYLES.input);
        input.value = this.formatSrcForDisplay(this.getCurrentIframeUrl(iframe));
        container.appendChild(input);
        input.focus();
        input.select(); // Select all text for easy editing

        // Prevent clicks on input from bubbling up and closing menu
        input.addEventListener('click', e => {
            e.stopPropagation();
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                iframe.setAttribute('src', this.formatSrcForAttribute(input.value.trim()));
                this.isInInputMode = false;
                this.menuCloseDisabled = false;
                this.hideMenu();
            } else if (e.key === 'Escape') {
                this.isInInputMode = false;
                this.menuCloseDisabled = false;
                container.textContent = this.formatSrcForDisplay(this.getCurrentIframeUrl(iframe));
            }
        });

        // Add blur handler to reset input mode if user clicks out without entering
        input.addEventListener('blur', e => {
            // Only reset if the blur wasn't caused by the menu being hidden
            setTimeout(() => {
                if (this.customMenu && this.isInInputMode) {
                    this.isInInputMode = false;
                    this.menuCloseDisabled = false;
                    container.textContent = this.formatSrcForDisplay(this.getCurrentIframeUrl(iframe));
                }
            }, 10);
        });
    }

    createIframeInput(container) {
        this.isInInputMode = true;
        this.menuCloseDisabled = true; // Prevent menu from closing during input
        container.innerHTML = '';
        const input = this.createElement('input', STYLES.input);
        input.placeholder = 'Enter iframe src...';
        container.appendChild(input);
        input.focus();
        input.select(); // Select the default text

        // Prevent clicks on input from bubbling up and closing menu
        input.addEventListener('click', e => {
            e.stopPropagation();
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const src = input.value.trim() || 'about:blank';
                this.createNewIframe(this.formatSrcForAttribute(src));
                this.isInInputMode = false;
                this.menuCloseDisabled = false;
                this.hideMenu();
            } else if (e.key === 'Escape') {
                this.isInInputMode = false;
                this.menuCloseDisabled = false;
                container.textContent = 'create iframe';
            }
        });

        // Add blur handler to reset input mode if user clicks out without entering
        input.addEventListener('blur', e => {
            // Only reset if the blur wasn't caused by the menu being hidden
            setTimeout(() => {
                if (this.customMenu && this.isInInputMode) {
                    this.isInInputMode = false;
                    this.menuCloseDisabled = false;
                    container.textContent = 'create iframe';
                }
            }, 10);
        });
    }

    createElementInsertInput(container) {
        this.isInInputMode = true;
        this.menuCloseDisabled = true; // Prevent menu from closing during input
        container.innerHTML = '';
        const input = this.createElement('input', STYLES.input);
        input.placeholder = 'Enter path (e.g., manifest snippet c)...';
        container.appendChild(input);
        input.focus();
        input.select(); // Select all text for easy editing

        // Prevent clicks on input from bubbling up and closing menu
        input.addEventListener('click', e => {
            e.stopPropagation();
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const path = input.value.trim();
                if (path) {
                    this.resolveAndInsertContent(path);
                }
                this.isInInputMode = false;
                this.menuCloseDisabled = false;
                this.hideMenu();
            } else if (e.key === 'Escape') {
                this.isInInputMode = false;
                this.menuCloseDisabled = false;
                container.textContent = 'insert';
            }
        });

        // Add blur handler to reset input mode if user clicks out without entering
        input.addEventListener('blur', e => {
            // Only reset if the blur wasn't caused by the menu being hidden
            setTimeout(() => {
                if (this.customMenu && this.isInInputMode) {
                    this.isInInputMode = false;
                    this.menuCloseDisabled = false;
                    container.textContent = 'insert';
                }
            }, 10);
        });
    }

    async resolveAndInsertContent(path) {
        if (!this.clickedElement) return;
        
        try {
            // Convert path format to URL format
            const urlPath = path.replace(/\s+/g, '/');
            const fullUrl = `https://foobarch.net/${urlPath}`;
            
            // Fetch the content
            const response = await fetch(fullUrl);
            if (!response.ok) {
                console.error(`Failed to fetch content from ${fullUrl}: ${response.status}`);
                return;
            }
            
            const content = await response.text();
            
            // Create a temporary container to parse the HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            
            // Insert each child element before the first child of the clicked element
            const children = Array.from(tempDiv.children);
            children.forEach(child => {
                this.clickedElement.insertBefore(child, this.clickedElement.firstChild);
            });
            
            console.log(`Inserted content from ${fullUrl} into ${this.getElementIdentifier(this.clickedElement)}`);
        } catch (error) {
            console.error('Error resolving and inserting content:', error);
        }
    }

    handleMenuItemClick(itemId) {
        if (itemId === 'navi_input') {
            if (isMobile()) {
                const command = prompt('Enter navi command:');
                if (command?.trim() && typeof globalThis.navi === 'function') {
                    globalThis.navi(command.trim());
                }
                this.hideMenu();
            } else {
                const naviItem = [...this.customMenu.querySelectorAll('.supermouse-menu-item')].find(item => item.textContent.includes("navi('callin')"));
                if (naviItem) {
                    this.isInInputMode = true;
                    this.menuCloseDisabled = true; // Prevent menu from closing during input
                    naviItem.innerHTML = '';
                    const input = this.createElement('input', STYLES.input);
                    input.placeholder = 'Enter command...';
                    naviItem.appendChild(input);
                    input.focus();
                    input.select(); // Select all text for easy editing

                    // Prevent clicks on input from bubbling up and closing menu
                    input.addEventListener('click', e => {
                        e.stopPropagation();
                    });

                    input.addEventListener('keydown', e => {
                        if (e.key === 'Enter') {
                            const command = input.value.trim();
                            if (command && typeof globalThis.navi === 'function') globalThis.navi(command);
                            this.isInInputMode = false;
                            this.menuCloseDisabled = false;
                            this.hideMenu();
                        } else if (e.key === 'Escape') {
                            this.isInInputMode = false;
                            this.menuCloseDisabled = false;
                            naviItem.textContent = "navi('callin')";
                        }
                    });

                    // Add blur handler to reset input mode if user clicks out without entering
                    input.addEventListener('blur', e => {
                        // Only reset if the blur wasn't caused by the menu being hidden
                        setTimeout(() => {
                            if (this.customMenu && this.isInInputMode) {
                                this.isInInputMode = false;
                                this.menuCloseDisabled = false;
                                naviItem.textContent = "navi('callin')";
                            }
                        }, 10);
                    });
                }
            }
        }
    }

    // Utility methods - simplified
    findIframeByName(name) {
        return [...document.querySelectorAll('iframe')].find(iframe => iframe.name === name || iframe.id === name) || null;
    }

    getElementIdentifier(element) {
        if (!element) return 'unknown';
        
        // Check for name attribute first
        if (element.name) return element.name;
        
        // Check for id attribute
        if (element.id) return element.id;
        
        // Check for class name (first class)
        if (element.className && typeof element.className === 'string') {
            const firstClass = element.className.split(' ')[0];
            if (firstClass) return `.${firstClass}`;
        }
        
        // Fall back to tag name
        return `<${element.tagName.toLowerCase()}>`;
    }

    getCurrentIframeUrl(iframe) {
        try {
            return iframe.contentWindow?.location?.href || iframe.getAttribute('src') || '';
        } catch {
            return iframe.getAttribute('src') || '';
        }
    }

    formatSrcForDisplay(src) {
        if (!src) return '(inline)';
        
        // Handle the specific case where spaces are already in the URL
        if (src.includes(' ')) {
            // This looks like it's already been processed incorrectly
            // Try to reconstruct the proper URL
            let result = src.replace(/\s+/g, '/');
            
            try {
                const url = new URL(result);
                const pathname = url.pathname;
                return pathname.replace(/^\//, '').replace(/\//g, ' ');
            } catch (e) {
                // If reconstruction fails, try to extract just the path part
                // Handle patterns like "https: foobarch.net manifest" -> "manifest"
                let cleaned = src.replace(/^https?:\s*/, ''); // Remove "https: " or "http: "
                cleaned = cleaned.replace(/^[^\s]+\s+/, ''); // Remove domain part like "foobarch.net "
                cleaned = cleaned.replace(/\s+/g, ' ').trim(); // Clean up spaces
                return cleaned || '(inline)';
            }
        }
        
        try {
            // Handle different URL formats - extract only the pathname
            let url;
            if (src.startsWith('http://') || src.startsWith('https://')) {
                url = new URL(src);
            } else {
                url = new URL(src, window.location.origin);
            }
            
            // Extract pathname and remove leading slash, convert remaining slashes to spaces
            const pathname = url.pathname;
            return pathname.replace(/^\//, '').replace(/\//g, ' ');
        } catch (error) {
            // Fallback: try to manually strip common patterns
            let result = src;
            
            // Remove protocol and domain patterns
            result = result.replace(/^https?:\/\//, '');
            result = result.replace(/^[^\/]+\//, ''); // Remove domain part
            result = result.replace(/\//g, ' ');
            result = result.replace(/^\s+/, ''); // Remove leading spaces
            
            return result || '(inline)';
        }
    }

    formatSrcForAttribute(src) {
        return src ? src.replace(/\s+/g, '/') : '';
    }

    isIframeHidden(iframe) {
        return iframe.style.display === 'none' || iframe.style.visibility === 'hidden' || iframe.hidden;
    }

    isIframeSizemaxxed(iframe) {
        // Check if iframe has sizemaxx styles applied
        if (this.sizemaxxState.has(iframe)) return true;
        
        // Check if the iframe already has the sizemaxx styles applied
        const style = iframe.style;
        const computed = window.getComputedStyle(iframe);
        
        // More flexible matching - check key properties that indicate sizemaxx
        const hasSizemaxxDimensions = (style.width === '100vw' || computed.width === window.innerWidth + 'px') &&
                                      (style.height === '100vh' || computed.height === window.innerHeight + 'px');
        const hasSizemaxxPosition = style.position === 'fixed' && 
                                    (style.top === '0px' || style.top === '0') && 
                                    (style.left === '0px' || style.left === '0');
        const hasSizemaxxBorder = style.border === 'none' || style.borderWidth === '0px' || style.border === '';
        
        return hasSizemaxxDimensions && hasSizemaxxPosition && hasSizemaxxBorder;
    }

    applySizemaxx(iframe) {
        iframe.style.cssText = SIZEMAXX_STYLES;
        this.sizemaxxState.add(iframe);
    }

    removeSizemaxx(iframe) {
        iframe.style.cssText = '';
        this.sizemaxxState.delete(iframe);
    }

    toggleIframeVisibility(iframe) {
        if (this.isIframeHidden(iframe)) {
            Object.assign(iframe.style, { display: '', visibility: '' });
            iframe.hidden = false;
        } else {
            iframe.style.display = 'none';
        }
    }

    createNewIframe(src = 'about:blank') {
        const iframe = this.createElement('iframe');
        const count = document.querySelectorAll('iframe').length;
        const name = `iframe_${count + 1}`;
        
        Object.assign(iframe, { name, id: name, src });

        
        document.body.appendChild(iframe);
        this.setupSingleIframeListener(iframe);
        console.log(`Created new iframe: ${name} with src: ${src}`);
    }

    closeDropdown() {
        if (this.openDropdown) {
            [...this.customMenu.querySelectorAll('[data-dropdown="true"]')].forEach(item => item.remove());
            this.openDropdown = null;
        }
    }

    hideMenu() {
        if (!this.menuCloseDisabled) this.destroyMenu();
    }

    destroyMenu() {
        if (this.customMenu) {
            this.closeDropdown();
            this.customMenu.remove();
            this.customMenu = null;
        }
        }
        
    deactivate() {
        this.destroyMenu();
        document.getElementById('supermouse-styles')?.remove();
        this.isActive = false;
    }

    restoreDefaultBehavior() {
        // Remove all event listeners and restore default context menu
        this.destroyMenu();
        
        // Remove all stored event listeners
        this.eventListeners.forEach(({ element, event, handler, capture }) => {
            element.removeEventListener(event, handler, capture);
        });
        this.eventListeners = [];
        
        // Disconnect iframe observer
        if (this.iframeObserver) {
            this.iframeObserver.disconnect();
            this.iframeObserver = null;
        }
        
        // Remove the user-select styles that were added
        const styleElements = document.querySelectorAll('style');
        styleElements.forEach(style => {
            if (style.textContent && style.textContent.includes('user-select')) {
                style.remove();
            }
        });
        
        // Remove styles from iframes
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (iframeDoc) {
                    const iframeStyles = iframeDoc.querySelectorAll('style');
                    iframeStyles.forEach(style => {
                        if (style.textContent && style.textContent.includes('user-select')) {
                            style.remove();
                        }
                    });
                }
            } catch (error) {
                // Cross-origin iframe
            }
        });
        
        // Remove any remaining supermouse elements
        const supermouseElements = document.querySelectorAll('[id*="supermouse"], [class*="supermouse"]');
        supermouseElements.forEach(el => el.remove());
        
        this.isActive = false;
        console.log('[supermouse] Default browser behavior restored');
    }
}

    const superMouse = new SuperMouse();

    return {
        name: "supermouse_capri_blue_v4_5",
        version: "4.5.0", //4.5 adds plugin support
        description: "Custom mouse behavior with right-click context menu replacement",
        
        moduleInfo: {
            name: "supermouse capri blue edition v4.5.0",
            version: "4.5.0",
            description: "Custom mouse behavior with right-click context menu replacement"
        },
        
        commands: {
            supermouse: {
                name: "supermouse",
                description: "SuperMouse commands: supermouse <deactivate|status|recursion|help>",
                execute: async (subcommand, ...args) => {
                    const recursionArg = args[0]?.toLowerCase?.();
                    const responses = {
                        deactivate: () => (superMouse.deactivate(), "SuperMouse deactivated. Default browser behavior restored."),
                        status: () => `SuperMouse Status: ${superMouse.isActive ? 'ACTIVE' : 'INACTIVE'}\nEnvironment: ${isBrowser ? 'Browser' : 'Node.js'}\nMenu Items: ${superMouse.menuItems.length}\nRecursion: ${superMouse.recursion ? 'ON' : 'OFF'}`,
                        recursion: () => {
                            if (recursionArg === 'on' || recursionArg === 'true' || recursionArg === '1') {
                                superMouse.setRecursion(true);
                                return 'SuperMouse recursion enabled. Right-click on the context menu opens a new menu.';
                            }
                            if (recursionArg === 'off' || recursionArg === 'false' || recursionArg === '0') {
                                superMouse.setRecursion(false);
                                return 'SuperMouse recursion disabled. Right-click on the context menu is ignored.';
                            }
                            if (recursionArg === 'toggle') {
                                const enabled = superMouse.toggleRecursion();
                                return `SuperMouse recursion ${enabled ? 'enabled' : 'disabled'}.`;
                            }
                            return `SuperMouse recursion: ${superMouse.recursion ? 'ON' : 'OFF'}\nUsage: supermouse recursion <on|off|toggle>`;
                        },
                        help: () => `SuperMouse v4.5.0\nCustom mouse behavior with right-click context menu replacement\n\nCommands:\n  deactivate - Disable custom mouse behavior\n  status - Show current status\n  recursion [on|off|toggle] - Allow right-click on the context menu itself\n  help - Show this help\n\nFeatures: Custom context menu, iframe management, navi input, mobile support, recursion`
                    };
                    
                    return responses[subcommand] ? responses[subcommand]() : 
                           !subcommand ? `SuperMouse v4.5.0\nUsage: supermouse <deactivate|status|recursion|help>\nActivates automatically when module loads.` :
                           `Unknown command: ${subcommand}. Type 'supermouse' for available commands.`;
                }
            }
        },
        
        // Expose the superMouse instance for external access
        superMouse,
        
        onMount: async () => {
            if (isBrowser) {
                await superMouse.init();
                console.log('[supermouse] SuperMouse capri blue edition v4.5.0 mounted!');
            } else {
                console.log('[supermouse] Browser environment required - module inactive');
            }
        },
        
        onUnmount: () => {
            if (superMouse.isActive) {
                superMouse.restoreDefaultBehavior();
            }
            console.log('[supermouse] Module unmounted');
        }
    };
};
