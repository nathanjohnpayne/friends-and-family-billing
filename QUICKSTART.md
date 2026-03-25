# Quick Start Guide

## 🚀 Get Your Multi-User Bill Splitter Live in 10 Minutes

### Prerequisites
- A Google account
- Internet connection

### Step-by-Step Setup

#### 1. Create Firebase Project (2 minutes)
```
1. Visit https://console.firebase.google.com/
2. Click "Add Project"
3. Name it: "family-bill-splitter"
4. Disable Google Analytics
5. Click "Create Project"
```

#### 2. Enable Authentication (1 minute)
```
1. Click "Authentication" → "Get Started"
2. Click "Email/Password" → Toggle "Enable" → "Save"
3. Go back, click "Google" → Toggle "Enable"
4. Select a support email → "Save"
```

#### 3. Create Firestore Database (1 minute)
```
1. Click "Firestore Database" → "Create Database"
2. Select "Production mode"
3. Choose nearest location
4. Click "Enable"
```

#### 4. Set Security Rules (1 minute)
```
1. In Firestore, click "Rules" tab
2. Copy/paste from firestore.rules file
3. Click "Publish"
```

#### 5. Get Firebase Config (2 minutes)
```
1. Click ⚙️ (Settings) → "Project Settings"
2. Scroll to "Your apps" → Click Web icon (</>)
3. Register app: "Bill Splitter"
4. Copy the firebaseConfig object
```

#### 6. Update Config File (1 minute)
```
1. Copy .env.example to .env.local
2. Fill in your Firebase config values as VITE_FIREBASE_* variables
3. Save .env.local (it is gitignored — never commit it)
```

#### 7. Deploy (2 minutes)
```bash
# Install dependencies
npm install

# Build and deploy via 1Password-backed deploy helper
npm run deploy
```

> **Note:** This repo uses `op-firebase-deploy` for deployments — see DEPLOYMENT.md for the 1Password-based credential setup. If Cloud Functions deployment shows IAM errors, that's OK — share links work via direct Firestore reads instead.

#### 8. Done! 🎉
Your app is now live at: `https://your-project-id.web.app`

### Testing Locally (Optional)

Before deploying, test locally with the Vite dev server:

```bash
npm install
npm run dev
# Opens http://localhost:5173 with hot module replacement
```

### First Time Using the App

1. Open your deployed URL
2. Sign in with Google (recommended) or click "Sign Up" for email/password
3. Start adding family members and bills!

### Sharing with Family

Just send them your deployed URL. Each person:
1. Creates their own account
2. Manages their own bills independently
3. Data is private to each user

### Need Help?

- Check DEPLOYMENT.md for detailed instructions
- Browser console (F12) shows error messages
- Firebase console shows database activity

### Common First-Time Issues

**"Firebase not defined" or config errors**
→ Make sure you created `.env.local` from `.env.example` with your real Firebase config values

**"Permission denied"**
→ Check that you published the Firestore security rules

**"Can't login"**
→ Verify Email/Password is enabled in Firebase Console

**"localhost:8000 not working"**
→ Make sure you're in the correct project directory

### What Changed from the Old Version?

- ✅ **Before**: Data saved in browser (lost if you clear cache)
- ✅ **After**: Data saved in cloud (accessible from any device)

- ✅ **Before**: Single user only
- ✅ **After**: Unlimited users, each with private data

- ✅ **Before**: No authentication
- ✅ **After**: Secure email/password login

All your features still work exactly the same:
- Family members with avatars
- Bills with logos
- Parent-child linking
- Payment tracking
- Email invoices
- Everything!

### Pro Tips

1. **Bookmark your app URL** for easy access
2. **Test with a dummy account first** before inviting family
3. **Take a screenshot of your Firebase config** for backup
4. **Check Firebase usage** monthly (totally free for normal use)

Enjoy your multi-user bill splitter! 🎉
