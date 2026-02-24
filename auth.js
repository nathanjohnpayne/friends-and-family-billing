// Authentication handling

function switchTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tab}-tab`).classList.add('active');

    // Clear messages
    hideMessages();
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('success-message').style.display = 'none';
}

function showSuccess(message) {
    const successDiv = document.getElementById('success-message');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('error-message').style.display = 'none';
}

function hideMessages() {
    document.getElementById('error-message').style.display = 'none';
    document.getElementById('success-message').style.display = 'none';
}

async function handleLogin(event) {
    event.preventDefault();
    hideMessages();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        await auth.signInWithEmailAndPassword(email, password);

        // Analytics: Track login
        if (typeof analytics !== 'undefined') {
            analytics.logEvent('login', { method: 'email' });
        }

        // Redirect to main app
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Login error details:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        showError(getErrorMessage(error.code));
    }
}

async function handleSignup(event) {
    event.preventDefault();
    hideMessages();

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-password-confirm').value;

    // Validate passwords match
    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }

    try {
        await auth.createUserWithEmailAndPassword(email, password);

        // Analytics: Track signup
        if (typeof analytics !== 'undefined') {
            analytics.logEvent('sign_up', { method: 'email' });
        }

        showSuccess('Account created successfully! Redirecting...');
        // Redirect to main app after 1 second
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    } catch (error) {
        console.error('Signup error details:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        showError(getErrorMessage(error.code));
    }
}

function getErrorMessage(errorCode) {
    switch (errorCode) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Please login instead.';
        case 'auth/invalid-email':
            return 'Invalid email address.';
        case 'auth/user-not-found':
            return 'No account found with this email.';
        case 'auth/wrong-password':
            return 'Incorrect password.';
        case 'auth/weak-password':
            return 'Password should be at least 6 characters.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        default:
            return 'An error occurred. Please try again.';
    }
}

async function handleGoogleSignIn() {
    hideMessages();

    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);

        // Analytics: Track Google sign-in
        if (typeof analytics !== 'undefined') {
            const isNewUser = result.additionalUserInfo?.isNewUser || false;
            analytics.logEvent(isNewUser ? 'sign_up' : 'login', { method: 'google' });
        }

        // Redirect to main app
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Google sign-in error details:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        if (error.code === 'auth/popup-closed-by-user') {
            showError('Sign-in cancelled. Please try again.');
        } else if (error.code === 'auth/popup-blocked') {
            showError('Pop-up blocked. Please allow pop-ups for this site.');
        } else if (error.code === 'auth/unauthorized-domain') {
            showError('This domain is not authorized. Please contact the administrator.');
        } else {
            showError(getErrorMessage(error.code) + ' (Check console for details)');
        }
    }
}

// Check if user is already logged in
auth.onAuthStateChanged(user => {
    if (user && window.location.pathname.includes('login.html')) {
        // User is logged in, redirect to main app
        window.location.href = 'index.html';
    }
});
