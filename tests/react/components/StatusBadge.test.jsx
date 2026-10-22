import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge, { STATUS_KEYS, getPaymentStatus } from '@/app/components/StatusBadge.jsx';

describe('getPaymentStatus', () => {
    it('returns null when total is 0', () => {
        expect(getPaymentStatus(0, 0)).toBeNull();
    });

    it('returns outstanding when nothing paid', () => {
        expect(getPaymentStatus(100, 0)).toBe('outstanding');
    });

    it('returns partial when partially paid', () => {
        expect(getPaymentStatus(100, 50)).toBe('partial');
    });

    it('returns settled when fully paid', () => {
        expect(getPaymentStatus(100, 100)).toBe('settled');
    });

    it('returns credit when paid more than owed (RD-09: the household holds a Credit)', () => {
        expect(getPaymentStatus(100, 150)).toBe('credit');
    });

    it('never returns the retired overpaid key', () => {
        expect(getPaymentStatus(100, 150)).not.toBe('overpaid');
    });
});

describe('StatusBadge', () => {
    const LABELS = {
        outstanding: 'Outstanding',
        partial: 'Partial',
        settled: 'Settled',
        review: 'Review request',
        credit: 'Credit'
    };

    it('exposes every variant the board can show, in sort order', () => {
        expect(STATUS_KEYS).toEqual(['outstanding', 'partial', 'settled', 'review', 'credit']);
    });

    it.each(Object.entries(LABELS))('renders the %s variant with its label', (status, label) => {
        render(<StatusBadge status={status} />);
        expect(screen.getByText(label)).toBeInTheDocument();
    });

    it.each(Object.entries(LABELS))('renders a decorative glyph beside the %s label (RD-03)', (status, label) => {
        render(<StatusBadge status={status} />);
        const badge = screen.getByText(label);
        const glyph = badge.firstElementChild;
        expect(glyph.tagName.toLowerCase()).toBe('svg');
        expect(glyph).toHaveAttribute('aria-hidden', 'true');
        // The label alone carries the meaning: the glyph adds no text.
        expect(badge).toHaveTextContent(label);
        expect(badge.textContent.trim()).toBe(label);
    });

    it('gives each variant its own glyph', () => {
        const drawings = Object.keys(LABELS).map((status) => {
            const { unmount } = render(<StatusBadge status={status} />);
            const svg = screen.getByText(LABELS[status]).firstElementChild.innerHTML;
            unmount();
            return svg;
        });
        expect(new Set(drawings).size).toBe(drawings.length);
    });

    it('reads Credit, never Overpaid, for an overpaid household', () => {
        render(<StatusBadge status={getPaymentStatus(100, 150)} />);
        expect(screen.getByText('Credit')).toBeInTheDocument();
        expect(screen.queryByText(/overpaid/i)).toBeNull();
    });

    it('renders nothing for the retired overpaid key', () => {
        const { container } = render(<StatusBadge status="overpaid" />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing for unknown status', () => {
        const { container } = render(<StatusBadge status="unknown" />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing for null status', () => {
        const { container } = render(<StatusBadge status={null} />);
        expect(container.innerHTML).toBe('');
    });
});
