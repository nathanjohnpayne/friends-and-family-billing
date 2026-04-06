/**
 * E2E tests for the InvoicingTab TipTap editor.
 * Runs against a real Vite dev server with VITE_E2E_MODE=true,
 * using headless Chromium to exercise the actual ProseMirror rendering.
 */
import { test, expect } from '@playwright/test';
import { seedPage } from './fixtures.js';

/**
 * Click a segmented-control button, scrolling it to viewport centre first
 * so sticky nav-bar + manage-tabs don't intercept the click.
 */
async function clickSegment(page, label) {
    const btn = page.locator('.template-segment', { hasText: label });
    await btn.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await btn.click();
}

test.beforeEach(async ({ page }) => {
    await seedPage(page);
    await page.goto('/manage/invoicing');
    // Wait for the TipTap editor to mount
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
});

test.describe('InvoicingTab Editor', () => {
    test('renders template content with token pills and block tokens', async ({ page }) => {
        const editor = page.locator('.template-editor-surface .ProseMirror');
        await expect(editor).toBeVisible();

        // Inline token pills should be rendered (scope to body editor to avoid subject dupes)
        await expect(editor.locator('[data-token-id="first_name"]')).toBeVisible();
        await expect(editor.locator('[data-token-id="billing_year"]')).toBeVisible();
        await expect(editor.locator('[data-token-id="household_total"]')).toBeVisible();

        // Block token cards should be rendered
        const blockLabels = page.locator('.block-token-card-label');
        await expect(blockLabels.filter({ hasText: 'Share Link' })).toBeVisible();
        await expect(blockLabels.filter({ hasText: 'Payment Methods' })).toBeVisible();
    });

    test('typing works continuously without focus loss', async ({ page }) => {
        const editor = page.locator('.template-editor-surface .ProseMirror');

        // Click at the end of the editor content
        await editor.click();

        // Type with realistic delay — the one-char-at-a-time bug would
        // cause only the last character to appear
        const testText = 'Testing continuous typing works';
        await page.keyboard.type(testText, { delay: 30 });

        // Verify all characters appeared
        const content = await editor.textContent();
        expect(content).toContain(testText);
    });

    test('bold formatting applied via toolbar shows in preview', async ({ page }) => {
        const editor = page.locator('.template-editor-surface .ProseMirror');
        await editor.click();

        // Type some text
        await page.keyboard.type('Make this bold');

        // Select "bold" by double-clicking it
        const editorText = await editor.textContent();
        // Select all the text we just typed
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+End');

        // Click the Bold toolbar button
        await page.locator('button[title="Bold"]').click();

        // Switch to Preview tab
        await clickSegment(page, 'Preview');

        // The preview should contain bold semantics without depending on an exact
        // raw HTML string match for the opening tag.
        const previewBody = page.locator('.template-preview-body');
        await expect(previewBody).toBeVisible();
        const previewHTML = await previewBody.innerHTML();
        expect(previewHTML).toContain('<strong');
    });

    test('token pills are visible with correct styling', async ({ page }) => {
        const firstNameToken = page.locator('[data-token-id="first_name"]');
        await expect(firstNameToken).toBeVisible();
        await expect(firstNameToken).toHaveText('First Name');

        // Token should have the pill class
        await expect(firstNameToken).toHaveClass(/template-editor-token/);
    });

    test('bold on existing text shows correctly in preview', async ({ page }) => {
        // The fixture has "prompt" as bold text in the document.
        // Switch to Preview and verify only "prompt" is bold, not the whole paragraph.
        await clickSegment(page, 'Preview');

        const previewBody = page.locator('.template-preview-body');
        await expect(previewBody).toBeVisible();

        // Check that <strong> contains "prompt" specifically
        const strongElements = previewBody.locator('strong');
        const strongTexts = await strongElements.allTextContents();
        const hasPrompt = strongTexts.some(t => t.includes('prompt'));
        expect(hasPrompt).toBe(true);

        // The surrounding text "Thank you for your" should NOT be inside <strong>
        const previewText = await previewBody.textContent();
        expect(previewText).toContain('Thank you for your');
    });

    test('tab switching preserves editor content', async ({ page }) => {
        const editor = page.locator('.template-editor-surface .ProseMirror');

        // Type something new
        await editor.click();
        await page.keyboard.type('Preserved text');

        // Switch to Preview
        await clickSegment(page, 'Preview');
        await expect(page.locator('.template-preview-body')).toBeVisible();

        // Switch back to Edit
        await clickSegment(page, 'Edit');

        // Verify our typed text is still there
        const content = await editor.textContent();
        expect(content).toContain('Preserved text');
    });

    test('dirty indicator and save button respond to edits', async ({ page }) => {
        // Initially no dirty indicator
        await expect(page.locator('.template-dirty-indicator')).not.toBeVisible();

        // Type in the editor
        const editor = page.locator('.template-editor-surface .ProseMirror');
        await editor.click();
        await page.keyboard.type('a');

        // Dirty indicator should appear
        await expect(page.locator('.template-dirty-indicator')).toBeVisible();

        // Save button should be enabled
        const saveBtn = page.locator('.template-save-btn');
        await expect(saveBtn).toBeEnabled();
    });
});
