/**
 * FaceControl - Document Sandbox (code.js)
 * This file runs in the Adobe Express Document Sandbox and has access to the Document APIs.
 * Handles both design improvements (shapes, layouts) and speech-to-text manipulation.
 */

import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { editor, colorUtils } from "express-document-sdk";

// Get the document sandbox runtime
const sandboxApi = addOnSandboxSdk.instance.runtime;

// ============================================
// Speech-to-Text & Text Manipulation Functions
// ============================================

/**
 * Write spoken text to the currently selected text element or create new text
 * @param {string} spokenText - The transcribed text to write
 * @returns {object} Result with status and message
 */
async function writeToCanvas(spokenText) {
    try {
        // Get current selection
        const selection = editor.context.selection;

        if (selection && selection.length > 0) {
            // Find text node in selection
            for (const node of selection) {
                // Check if it's a text node (TextNode type)
                if (node.type === "Text" || node.type === "StandaloneText") {
                    // Get current text content
                    const currentText = node.fullContent?.text || node.text || '';

                    // Add space if needed
                    const needsSpace = currentText.length > 0 &&
                        !currentText.endsWith(' ') &&
                        !currentText.endsWith('\n');
                    const newText = currentText + (needsSpace ? ' ' : '') + spokenText;

                    // Update the text (different methods for different node types)
                    if (node.fullContent) {
                        node.fullContent.text = newText;
                    } else if (typeof node.text !== 'undefined') {
                        node.text = newText;
                    }

                    return { success: true, action: 'appended', text: spokenText };
                }
            }
        }

        // No text node selected - create new text element
        const textNode = editor.createText();
        if (textNode.fullContent) {
            textNode.fullContent.text = spokenText;
        } else {
            textNode.text = spokenText;
        }

        // Add to the document at the preferred parent location
        const insertParent = editor.context.insertionParent;
        insertParent.children.append(textNode);

        // Styling: Set smaller font size and ensure not bold
        try {
            if (textNode.fullContent && textNode.fullContent.applyCharacterStyles) {
                const styles = {
                    fontSize: 24, // Body text size
                    fontWeight: 400 // Regular (not bold)
                };

                textNode.fullContent.applyCharacterStyles(styles, { start: 0, length: spokenText.length });
            }
        } catch (e) {
            console.error("Failed to apply styles:", e);
        }

        // Positioning: Center in parent
        if (insertParent.width && insertParent.height) {
            const centerX = insertParent.width / 2;
            const centerY = insertParent.height / 2;

            if (textNode.setPositionInParent) {
                // Anchor 0.5, 0.5 means the center of the text node aligns with the position
                textNode.setPositionInParent(
                    { x: centerX, y: centerY },
                    { x: 0.5, y: 0.5 }
                );
            } else {
                textNode.translation = { x: centerX, y: centerY };
            }
        }

        return { success: true, action: 'created', text: spokenText };

    } catch (error) {
        console.error('Document sandbox error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get information about current selection
 * @returns {object} Selection info
 */
function getSelectionInfo() {
    try {
        const selection = editor.context.selection;
        if (!selection || selection.length === 0) {
            return { hasSelection: false, hasTextNode: false };
        }

        const hasTextNode = selection.some(node =>
            node.type === "Text" || node.type === "StandaloneText"
        );

        return {
            hasSelection: true,
            hasTextNode,
            count: selection.length
        };
    } catch (error) {
        return { hasSelection: false, hasTextNode: false, error: error.message };
    }
}

// ============================================
// Design Improvement & Layout Functions
// ============================================

/**
 * Get information about the current document/page
 */
function getDocumentInfo() {
    try {
        const page = editor.context.insertionParent;

        return {
            success: true,
            pageWidth: page?.width || 0,
            pageHeight: page?.height || 0,
            childCount: page?.children?.length || 0
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Apply design improvements to the canvas based on AI suggestions
 * @param {Object} improvements - Object containing design improvement instructions
 */
function applyDesignImprovements(improvements) {
    try {
        const insertionParent = editor.context.insertionParent;
        if (!insertionParent) {
            return { success: false, error: "No active page found" };
        }

        const results = [];

        // Process each improvement type
        if (improvements.addShape) {
            for (const shape of improvements.addShape) {
                const result = addShape(insertionParent, shape);
                results.push(result);
            }
        }

        if (improvements.addText) {
            for (const text of improvements.addText) {
                const result = addText(insertionParent, text);
                results.push(result);
            }
        }

        if (improvements.modifyElements) {
            for (const mod of improvements.modifyElements) {
                const result = modifyElement(insertionParent, mod);
                results.push(result);
            }
        }

        if (improvements.addDecorations) {
            for (const deco of improvements.addDecorations) {
                const result = addDecoration(insertionParent, deco);
                results.push(result);
            }
        }

        return {
            success: true,
            message: `Applied ${results.filter(r => r.success).length} improvements`,
            details: results
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Add a shape to the canvas
 */
function addShape(parent, config) {
    try {
        let shape;

        if (config.type === "rectangle") {
            shape = editor.createRectangle();
            shape.width = config.width || 100;
            shape.height = config.height || 100;
            if (config.cornerRadius) {
                shape.setUniformCornerRadius(config.cornerRadius);
            }
        } else if (config.type === "ellipse") {
            shape = editor.createEllipse();
            shape.rx = (config.width || 100) / 2;
            shape.ry = (config.height || 100) / 2;
        } else if (config.type === "line") {
            shape = editor.createLine();
            shape.setEndPoints(
                { x: config.x1 || 0, y: config.y1 || 0 },
                { x: config.x2 || 100, y: config.y2 || 0 }
            );
        }

        if (shape) {
            // Set position
            shape.translation = {
                x: config.x || 0,
                y: config.y || 0
            };

            // Set fill color if provided
            if (config.fill) {
                const color = colorUtils.fromHex(config.fill);
                shape.fill = editor.makeColorFill(color);
            }

            // Set stroke if provided
            if (config.stroke) {
                const strokeColor = colorUtils.fromHex(config.stroke.color || "#000000");
                shape.stroke = editor.makeStroke({
                    color: strokeColor,
                    width: config.stroke.width || 1
                });
            }

            // Set opacity if provided
            if (config.opacity !== undefined) {
                shape.opacity = config.opacity;
            }

            parent.children.append(shape);
            return { success: true, type: "shape", shapeType: config.type };
        }

        return { success: false, error: "Unknown shape type" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Add text to the canvas (Design mode)
 */
function addText(parent, config) {
    try {
        const textNode = editor.createText(config.content || "Text");

        // Set position
        textNode.setPositionInParent(
            { x: config.x || 0, y: config.y || 0 },
            { x: 0, y: 0 }
        );

        // Set text color if provided
        if (config.color) {
            const color = colorUtils.fromHex(config.color);
            textNode.fill = editor.makeColorFill(color);
        }

        parent.children.append(textNode);
        return { success: true, type: "text", content: config.content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Add decorative elements (backgrounds, overlays, etc.)
 */
function addDecoration(parent, config) {
    try {
        if (config.type === "background-overlay") {
            // Create a semi-transparent overlay
            const overlay = editor.createRectangle();
            overlay.width = parent.width || 800;
            overlay.height = parent.height || 600;
            overlay.translation = { x: 0, y: 0 };

            const color = colorUtils.fromRGB(
                config.r || 0,
                config.g || 0,
                config.b || 0,
                config.opacity || 0.3
            );
            overlay.fill = editor.makeColorFill(color);

            // Insert at the beginning (back)
            if (parent.children.length > 0) {
                parent.children.insertBefore(overlay, parent.children[0]);
            } else {
                parent.children.append(overlay);
            }

            return { success: true, type: "decoration", decorationType: "overlay" };
        }

        if (config.type === "accent-shape") {
            // Create an accent shape
            const accent = editor.createRectangle();
            accent.width = config.width || 50;
            accent.height = config.height || 200;
            accent.translation = { x: config.x || 0, y: config.y || 0 };

            if (config.cornerRadius) {
                accent.setUniformCornerRadius(config.cornerRadius);
            }

            const color = colorUtils.fromHex(config.fill || "#6366f1");
            accent.fill = editor.makeColorFill(color);

            parent.children.append(accent);
            return { success: true, type: "decoration", decorationType: "accent" };
        }

        return { success: false, error: "Unknown decoration type" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Modify existing elements (limited - can iterate children)
 */
function modifyElement(parent, config) {
    try {
        if (config.index !== undefined && parent.children[config.index]) {
            const element = parent.children[config.index];

            if (config.opacity !== undefined) {
                element.opacity = config.opacity;
            }

            if (config.translation) {
                element.translation = config.translation;
            }

            return { success: true, type: "modify", index: config.index };
        }

        return { success: false, error: "Element not found" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Add a professional gradient background
 */
function addGradientBackground(gradientConfig) {
    try {
        const insertionParent = editor.context.insertionParent;
        if (!insertionParent) {
            return { success: false, error: "No active page" };
        }

        // Create a full-page rectangle as background
        const bg = editor.createRectangle();
        bg.width = insertionParent.width || 800;
        bg.height = insertionParent.height || 600;
        bg.translation = { x: 0, y: 0 };

        // For now, use solid color (gradient support varies)
        const color = colorUtils.fromHex(gradientConfig.startColor || "#1a1a2e");
        bg.fill = editor.makeColorFill(color);

        // Insert at back
        if (insertionParent.children.length > 0) {
            insertionParent.children.insertBefore(bg, insertionParent.children[0]);
        } else {
            insertionParent.children.append(bg);
        }

        return { success: true, type: "background" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Clear the entire canvas (dangerous - use with caution)
 */
function clearCanvas() {
    try {
        const insertionParent = editor.context.insertionParent;
        if (!insertionParent) {
            return { success: false, error: "No active page" };
        }

        // Remove all children
        while (insertionParent.children.length > 0) {
            insertionParent.children[0].removeFromParent();
        }

        return { success: true, message: "Canvas cleared" };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// Expose APIs to the UI iframe
// ============================================

sandboxApi.exposeApi({
    // Text / Speech APIs
    writeToCanvas,
    getSelectionInfo,

    // Design / Layout APIs
    getDocumentInfo,
    applyDesignImprovements,
    addGradientBackground,
    clearCanvas,

    // Direct shape creation for testing
    addTestRectangle: function () {
        try {
            const insertionParent = editor.context.insertionParent;
            const rect = editor.createRectangle();
            rect.width = 200;
            rect.height = 100;
            rect.translation = { x: 100, y: 100 };

            const color = colorUtils.fromHex("#6366f1");
            rect.fill = editor.makeColorFill(color);

            insertionParent.children.append(rect);
            return { success: true, message: "Test rectangle added!" };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
});

console.log("🎨 FaceControl Document Sandbox loaded - Canvas & Speech manipulation ready!");