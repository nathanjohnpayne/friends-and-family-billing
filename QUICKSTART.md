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
2. Click "Email/Password"
3. Toggle "Enable"
4. Click "Save"
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
1. Open firebase-config.js
2. Replace YOUR_API_KEY, YOUR_PROJECT_ID, etc. with your values
3. Save the file
```

#### 7. Deploy (2 minutes)
```bash
# Install Firebase CLI (one-time)
npm install -g firebase-tools

# Login
firebase login

# Deploy
cd "/Users/nathanpayne/Claude Code"
firebase deploy --only hosting
```

#### 8. Done! 🎉
Your app is now live at: `https://your-project-id.web.app`

### Testing Locally (Optional)

Before deploying, test locally:

```bash
# Option 1: Python
python3 -m http.server 8000
# Open http://localhost:8000

# Option 2: Firebase emulator
firebase serve
# Open http://localhost:5000
```

### First Time Using the App

1. Open your deployed URL
2. Click "Sign Up"
3. Enter email and password (min 6 characters)
4. Login automatically
5. Start adding family members and bills!

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

**"Firebase not defined"**
→ Make sure you updated firebase-config.js with your real Firebase config

**"Permission denied"**
→ Check that you published the Firestore security rules

**"Can't login"**
→ Verify Email/Password is enabled in Firebase Console

**"localhost:8000 not working"**
→ Make sure you're in the correct directory: cd "/Users/nathanpayne/Claude Code"

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
