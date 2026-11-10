/**
 * Small form controls for the Year-End Review. They reuse the shell's input
 * and label styles (.composer-input, .payment-field-group) and add nothing
 * new except the error line and the number-text behavior below.
 */
import { useEffect, useRef, useState } from 'react';

const toText = value => (value === undefined || value === null || Number.isNaN(value) ? '' : String(value));

/**
 * A labelled field with its inline error and hint. Pass `id` so the label,
 * the control and the error line are tied together.
 */
export function Field({ id, label, error, hint, children, className = '' }) {
    return (
        <div className={'payment-field-group yer-field ' + className}>
            <label htmlFor={id}>{label}</label>
            {children}
            {hint && !error && <p className="yer-hint" id={id + '-hint'}>{hint}</p>}
            {error && <p className="yer-error" id={id + '-error'} role="alert">{error}</p>}
        </div>
    );
}

/**
 * A dollar/number input that keeps the typed text while the draft holds the
 * parsed number. While focused the typed text is never overwritten (so an
 * emptied field can be retyped even when the draft falls back to a default).
 * `onChange` receives a number, or null for an empty field.
 */
export function NumberField({ id, label, value, onChange, error, hint, placeholder, step = '0.01', min = '0', disabled, className, width }) {
    const [text, setText] = useState(toText(value));
    const focused = useRef(false);
    const emitted = useRef(value);
    useEffect(() => {
        if (focused.current) return;
        if (value !== emitted.current || toText(value) !== text) {
            emitted.current = value;
            setText(toText(value));
        }
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
    function handleChange(event) {
        const raw = event.target.value;
        setText(raw);
        const parsed = raw.trim() === '' ? null : Number(raw);
        const next = parsed === null || Number.isNaN(parsed) ? null : parsed;
        emitted.current = next;
        onChange(next);
    }
    return (
        <Field id={id} label={label} error={error} hint={hint} className={className}>
            <input
                id={id}
                className="composer-input"
                type="number"
                inputMode="decimal"
                step={step}
                min={min}
                placeholder={placeholder}
                value={text}
                disabled={disabled}
                style={width ? { width } : undefined}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? id + '-error' : hint ? id + '-hint' : undefined}
                onFocus={() => { focused.current = true; }}
                onBlur={() => { focused.current = false; setText(toText(value)); }}
                onChange={handleChange}
            />
        </Field>
    );
}

export function MonthSelect({ id, label, value, onChange, options, error, placeholder = 'Choose a month' }) {
    return (
        <Field id={id} label={label} error={error}>
            <select
                id={id}
                className="composer-input"
                value={value || ''}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? id + '-error' : undefined}
                onChange={event => onChange(event.target.value || undefined)}
            >
                <option value="">{placeholder}</option>
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        </Field>
    );
}

/** The shell's segmented control (.frequency-toggle) as a pressed-button group. */
export function Segmented({ label, value, options, onChange, className = '' }) {
    return (
        <div className={'frequency-toggle yer-seg ' + className} role="group" aria-label={label}>
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    className={'frequency-option' + (value === option.value ? ' active' : '')}
                    aria-pressed={value === option.value}
                    disabled={option.disabled}
                    title={option.title}
                    onClick={() => onChange(option.value)}
                >{option.label}</button>
            ))}
        </div>
    );
}
