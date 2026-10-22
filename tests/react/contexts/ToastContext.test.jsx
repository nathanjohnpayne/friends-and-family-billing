import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@/app/contexts/ToastContext.jsx';

function TestConsumer() {
    const { showToast } = useToast();
    return <button onClick={() => showToast('Saved!')}>Trigger</button>;
}

describe('ToastContext', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('shows a toast message', () => {
        render(
            <ToastProvider><TestConsumer /></ToastProvider>
        );
        fireEvent.click(screen.getByText('Trigger'));
        expect(screen.getByText('Saved!')).toBeInTheDocument();
    });

    it('auto-dismisses after 3 seconds', () => {
        render(
            <ToastProvider><TestConsumer /></ToastProvider>
        );
        fireEvent.click(screen.getByText('Trigger'));
        expect(screen.getByText('Saved!')).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.queryByText('Saved!')).toBeNull();
    });

    it('can be manually dismissed', () => {
        render(
            <ToastProvider><TestConsumer /></ToastProvider>
        );
        fireEvent.click(screen.getByText('Trigger'));
        expect(screen.getByText('Saved!')).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('Dismiss'));
        expect(screen.queryByText('Saved!')).toBeNull();
    });

    it('replaces previous toast on new showToast call', () => {
        function MultiConsumer() {
            const { showToast } = useToast();
            return (
                <>
                    <button onClick={() => showToast('Toast Alpha')}>Btn A</button>
                    <button onClick={() => showToast('Toast Beta')}>Btn B</button>
                </>
            );
        }
        render(
            <ToastProvider><MultiConsumer /></ToastProvider>
        );
        fireEvent.click(screen.getByText('Btn A'));
        expect(screen.getByText('Toast Alpha')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Btn B'));
        expect(screen.queryByText('Toast Alpha')).toBeNull();
        expect(screen.getByText('Toast Beta')).toBeInTheDocument();
    });

    it('announces a failure toast as an alert (RD-23)', () => {
        function FailConsumer() {
            const { showToast } = useToast();
            return <button onClick={() => showToast('Send failed: no verified sender', { kind: 'failure' })}>Fail</button>;
        }
        render(
            <ToastProvider><FailConsumer /></ToastProvider>
        );
        fireEvent.click(screen.getByText('Fail'));
        const toast = screen.getByRole('alert');
        expect(toast).toHaveTextContent('Send failed: no verified sender');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('announces an ordinary toast as a polite status', () => {
        render(
            <ToastProvider><TestConsumer /></ToastProvider>
        );
        fireEvent.click(screen.getByText('Trigger'));
        expect(screen.getByRole('status')).toHaveTextContent('Saved!');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('throws when used outside provider', () => {
        // Suppress React error boundary output
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<TestConsumer />)).toThrow('useToast must be used inside ToastProvider');
        spy.mockRestore();
    });
});
