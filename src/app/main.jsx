import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Self-hosted type (#545): Fraunces for display at its one light weight, Inter
// for UI at the four weights shell.css uses. Only the latin subset is bundled;
// Vite emits the woff2 files under /assets so no page requests a third-party
// font host. The family tokens live in design-tokens.css.
import '@fontsource/fraunces/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <App />
    </StrictMode>
);
