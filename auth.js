// Authentication handling

function showAuthForm(form) {
    document.getElementById('login-form-container').classList.toggle('active', form === 'login');
    document.getElementById('signup-form-container').classList.toggle('active', form === 'signup');
    hideMessages();
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.innerHTML = message;
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

        if (analytics) {
            analytics.logEvent('login', { method: 'email' });
        }

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

    if (password !== confirmPassword) {
        showError('Passwords do not match.');
        return;
    }

    try {
        await auth.createUserWithEmailAndPassword(email, password);

        if (analytics) {
            analytics.logEvent('sign_up', { method: 'email' });
        }

        showSuccess('Account created successfully! Redirecting...');
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

async function handleForgotPassword() {
    hideMessages();

    const email = document.getElementById('login-email').value.trim();
    if (!email) {
        showError('Enter your email address above, then click "Forgot password?" again.');
        return;
    }

    try {
        await auth.sendPasswordResetEmail(email);
        showSuccess('Password reset email sent to ' + email + '. Check your inbox.');
    } catch (error) {
        console.error('Password reset error:', error);
        if (error.code === 'auth/user-not-found') {
            showError('No account found with this email. This account may have been created using Google Sign\u2011In.');
        } else if (error.code === 'auth/invalid-email') {
            showError('Please enter a valid email address.');
        } else {
            showError('Unable to send reset email. Please try again.');
        }
    }
}

function getErrorMessage(errorCode) {
    switch (errorCode) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Try signing in instead.';
        case 'auth/invalid-email':
            return 'Invalid email address.';
        case 'auth/user-not-found':
            return 'No account found with this email. This account may have been created using Google Sign\u2011In.';
        case 'auth/wrong-password':
            return 'Incorrect password. <a onclick="handleForgotPassword()" style="color:#dc2626;text-decoration:underline;cursor:pointer">Reset it?</a>';
        case 'auth/weak-password':
            return 'Password should be at least 6 characters.';
        case 'auth/network-request-failed':
            return 'Network error. Please check your connection.';
        case 'auth/invalid-credential':
            return 'Invalid credentials. This account may have been created using Google Sign\u2011In.';
        default:
            return 'An error occurred. Please try again.';
    }
}

async function handleGoogleSignIn() {
    hideMessages();

    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);

        if (analytics) {
            const isNewUser = result.additionalUserInfo?.isNewUser || false;
            analytics.logEvent(isNewUser ? 'sign_up' : 'login', { method: 'google' });
        }

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

auth.onAuthStateChanged(user => {
    if (user && window.location.pathname.includes('login.html')) {
        window.location.href = 'index.html';
    }
});
